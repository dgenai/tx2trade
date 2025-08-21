#!/usr/bin/env ts-node 

/**
 * Main entrypoint for parsing Solana transactions into trade actions with enriched metadata.
 *
 * Workflow:
 *  1. Load environment variables (expects `RPC_ENDPOINT`).
 *  2. Accept transaction signatures from CLI arguments.
 *  3. Fetch and parse transactions in batches via `SolanaRpcClient`.
 *  4. Infer the likely user wallet involved in each transaction.
 *  5. Transform raw transactions into swap legs (via `transactionToSwapLegs_SOLBridge`).
 *  6. Convert legs into high-level trade actions (`legsToTradeActions`).
 *  7. Enrich trade actions with token metadata from the Metaplex service.
 *  8. Aggregate and output the enriched actions (optionally copy to clipboard).
 *
 * Notes:
 *  - Batches are processed in chunks of 100 signatures to reduce RPC load.
 *  - Debug logs provide visibility at each step (wallet inference, leg extraction, actions count, metadata enrichment).
 *  - Gracefully handles missing or unparsable transactions without stopping execution.
 *  - Clipboard export is optional and wrapped in a try/catch to avoid runtime crashes on unsupported systems.
 *
 * Usage:
 *    ts-node src/app/main.ts <signature1> [signature2 ...]
 *
 * Example:
 *    ts-node src/app/main.ts 3ms3r4f... 8kx9sd...
 */

import clipboardy from "clipboardy";
import dotenv from "dotenv";
dotenv.config();

import { SolanaRpcClient } from "../src/services/SolanaRpcClient.js";
import { MetaplexMetadataService } from "../src/services/MetaplexMetadataService.js";

import { transactionToSwapLegs_SOLBridge } from "../src/core/transactionToSwapLegs.js";
import { legsToTradeActions } from "../src/core/actions.js";
import { inferUserWallet } from "../src/core/inferUserWallet.js";

const debug = true;

async function main() {
  // Load the RPC endpoint from environment variables
  const RPC_ENDPOINT = process.env.RPC_ENDPOINT!;
  const sigs = process.argv.slice(2);

  if (!RPC_ENDPOINT) throw new Error("RPC_ENDPOINT is missing");
  if (sigs.length === 0) {
    console.error("❌ Usage: ts-node src/app/main.ts <signature1> [signature2 ...]");
    process.exit(1);
  }

  // Initialize Solana RPC client and Metaplex metadata service
  const rpc = new SolanaRpcClient({
    endpoint: RPC_ENDPOINT,
    timeoutMs: 25_000,
    maxRetries: 3,
    retryBackoffMs: 300,
    defaultCommitment: "confirmed",
  });
  const metaSvc = new MetaplexMetadataService(rpc);

  if (debug) console.log(`🔎 Fetching ${sigs.length} transaction(s) from RPC: ${RPC_ENDPOINT}`);

  const allActions: any[] = [];

  // Process signatures in batches of 100 to optimize RPC calls
  for (let i = 0; i < sigs.length; i += 100) {
    const chunk = sigs.slice(i, i + 100);
    const txs = await rpc.getTransactionsParsedBatch(chunk, 0);

    // Iterate through each transaction in the current batch
    for (let j = 0; j < txs.length; j++) {
      const tx = txs[j];
      const sig = chunk[j];

      // Skip missing transactions
      if (!tx) {
        if (debug) console.warn(`⚠️ Transaction not found: ${sig}`);
        continue;
      }

      try {
        // Step 1: Infer the main wallet involved in the transaction
        const userWallet = inferUserWallet(tx);
        if (debug) console.log("👤 Inferred wallet:", userWallet);

        // Step 2: Extract swap legs from the transaction
        const legs = transactionToSwapLegs_SOLBridge(tx, userWallet, {
          windowTotalFromOut: 500,
          requireAuthorityUserForOut: true,
          debug,
        });
        if (debug) console.log(`🔗 TX ${sig}: ${legs.length} legs`);

        // Step 3: Convert legs into trade actions
        const actions = legsToTradeActions(legs, {
          txHash: sig,
          wallet: userWallet,
          blockTime: tx.blockTime,
        });
        if (debug) console.log(`📊 TX ${sig}: ${actions.length} actions`);

        // Aggregate all actions for later enrichment
        allActions.push(...actions);
      } catch (err) {
        console.error(`❌ Error parsing TX ${sig}:`, err);
      }
    }
  }

  // Debug output: aggregated trade actions before metadata enrichment
  if (debug) {
    console.log("\n📊 Aggregated trade actions across all transactions:");
    console.log(JSON.stringify(allActions, null, 2));
  }

  // Fetch token metadata and enrich trade actions
  const metaMap = await metaSvc.fetchTokenMetadataMapFromActions(allActions);
  const enriched = metaSvc.enrichActionsWithMetadata(allActions, metaMap);

  if (debug) {
    console.log("\n🧬 Actions + metadata:");
    console.log(JSON.stringify(enriched, null, 2));
  }

  // Try to copy results to clipboard for convenience
  try {
    // clipboardy.writeSync(JSON.stringify(enriched, null, 2));
    if (debug) console.log("📋 Results copied to clipboard.");
  } catch {
    if (debug) console.log("⚠️ Could not copy results to clipboard.");
  }
}

// Global error handler for the async main()
main().catch((err) => {
  console.error("❌ Unhandled error in main():", err);
});
