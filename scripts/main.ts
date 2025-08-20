#!/usr/bin/env ts-node

import clipboardy from "clipboardy";
import dotenv from "dotenv";
import { transactionToSwapLegs_SOLBridge } from "../src/core/transactionToSwapLegs.js";
import { legsToTradeActions } from "../src/core/actions.js";
import { inferUserWallet } from "../src/inferUserWallet.js";

dotenv.config();

/**
 * Fetch parsed transactions in batch (chunked by 100 signatures).
 */
async function fetchParsedTransactionsBatch(
  signatures: string[],
  rpcEndpoint: string
) {
  const requests = signatures.map((sig, idx) => ({
    jsonrpc: "2.0",
    id: idx, // keep index to restore order later
    method: "getTransaction",
    params: [
      sig,
      {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
        encoding: "jsonParsed",
      },
    ],
  }));

  const response = await fetch(rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requests),
  });

  let results = await response.json();

  if (results.data && Array.isArray(results.data)) {
    results = results.data;
  }
  if (!Array.isArray(results)) {
    results = [results];
  }

  // Build map: id -> result
  const resultMap = new Map<number, any>();
  for (const r of results) {
    if (r && typeof r.id === "number") {
      resultMap.set(r.id, r.result);
    }
  }

  // Return transactions in the same order as input signatures
  return signatures.map((_, idx) => resultMap.get(idx) || null);
}


/**
 * Helper to split an array into smaller chunks.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const RPC_ENDPOINT = process.env.RPC_ENDPOINT!;
  const debug = true;

  // Get CLI arguments: list of signatures
  const sigs = process.argv.slice(2);
  if (sigs.length === 0) {
    console.error("❌ Usage: ts-node src/main.ts <signature1> [signature2 ...]");
    process.exit(1);
  }

  console.log(`🔎 Fetching ${sigs.length} transaction(s) from RPC: ${RPC_ENDPOINT}`);

  const sigChunks = chunkArray(sigs, 100);
  const allActions: any[] = [];

  for (const chunk of sigChunks) {
    const txs = await fetchParsedTransactionsBatch(chunk, RPC_ENDPOINT);

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const sig = chunk[i];

      if (!tx) {
        console.warn(`⚠️ Transaction not found: ${sig}`);
        continue;
      }

      try {
        // Infer user wallet
        const userWallet = inferUserWallet(tx);
        if (debug) console.log("👤 Inferred wallet:", userWallet);

        // Convert TX -> swap legs
        const legs = transactionToSwapLegs_SOLBridge(tx, userWallet, {
          windowTotalFromOut: 500,
          requireAuthorityUserForOut: true,
          debug,
        });

        if (debug) console.log(`🔗 TX ${sig}: ${legs.length} legs`);

        // Legs -> trade actions
        const actions = legsToTradeActions(legs, {
          txHash: sig,
          wallet: userWallet,
        });

        if (debug) console.log(`📊 TX ${sig}: ${actions.length} actions`);

        allActions.push(...actions);
      } catch (err) {
        console.error(`❌ Error parsing TX ${sig}:`, err);
      }
    }
  }

  console.log("\n📊 Aggregated trade actions across all transactions:");
  console.log(JSON.stringify(allActions, null, 2));

  // Copy to clipboard for convenience
  try {
    clipboardy.writeSync(JSON.stringify(allActions, null, 2));
    console.log("📋 Results copied to clipboard.");
  } catch {
    console.log("⚠️ Could not copy results to clipboard.");
  }
}

main().catch((err) => {
  console.error("❌ Unhandled error in main():", err);
});
