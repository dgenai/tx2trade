#!/usr/bin/env ts-node

import { Connection } from "@solana/web3.js";
import clipboardy from "clipboardy";
import { transactionToSwapLegs_SOLBridge } from "../src/core/transactionToSwapLegs.js";
import { legsToTradeActions } from "../src/core/actions.js";
import { inferUserWallet } from "../src/inferUserWallet.js";
import dotenv from "dotenv";

// "33ciuLsuBh1Fr7pPEjeh9Nrwgmz86UwQaq3G5XvMiqYhzMcpAEx7ByhWtmQiktxrnHUygZWdjGCmEzGxsqs1qVZH"; //OK
// "65HzcNWJuwfyYgVCsWqCxrS3P256eHqDbexgpM381SUPSerP4ZcWGFPyfWnga2mRzXGonD1wB4gcNwy9q1GSwh5V"; //OK
// "9yYpmLniuVj6D6sDEvGsD1YqP2D4BQG1JL55mdLDtv8zByBcY9fEyv8zBXbB2vxphoczHp1hj9yeNTkYkQZQM5P"; //OK
// "3FNXSBn3DtjzYW5vta5AorfVbhghiKkMtgQ2bZ1MxGhEzL7PqewSFsiKq3gU3Zu7szfhkssEnQWF9nSwDNEuNtE7"; //OK
// "3YgACS7s4BxCxUhTN7vgqFJ3NkUh1uVqaLeVUP49hnVK9A2Ph6FZrok9JQHFvRSWUpHW5WEyTXW3SjVUbfcTxS9Z"; // OK
// "49T2pRgzsNr4NNLnf5zXgi7sKn1nWjMZCvCQG4XdfUoT6F7sDyVHUX1bVbhjfAzWLWXV7ox2UTC9TvU4aGqBreZA" // OK
// "DYha16kPSysyRr4y5UkXzpAnviUgsxcUQZGkGqRALHSZxxXH54cPcD3YYgeKvCs3szYP1JZ9mNvsphfzkDLXq8H" //OK

dotenv.config();

async function main() {
  const RPC_ENDPOINT = process.env.RPC_ENDPOINT!;
  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const debug = true; 
  // Retrieve CLI argument: transaction signature
  const sig = process.argv[2];
  if (!sig) {
    console.error("❌ Usage: ts-node src/main.ts <signature>");
    process.exit(1);
  }

  console.log(`🔎 Fetching transaction: ${sig} from RPC: ${RPC_ENDPOINT}`);

  // Fetch parsed transaction from Solana RPC
  const tx = await connection.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) {
    console.error("❌ Transaction not found:", sig);
    return;
  }
  console.log("✅ Transaction successfully retrieved.");

  // Infer the user's wallet address involved in this transaction
  const userWallet = inferUserWallet(tx);
  console.log("👤 Inferred user wallet:", userWallet);

  // Convert transaction data into a list of "swap legs"
  // (each leg represents one atomic movement of assets within the swap/bridge)
  const legs = transactionToSwapLegs_SOLBridge(tx, userWallet, {
    windowTotalFromOut: 500,             // tolerance window for balance mismatches
    requireAuthorityUserForOut: true,    // enforce user as authority for outgoing transfers
    debug: debug,                         // enable verbose logging
  });
  console.log(`🔗 Detected ${legs.length} swap legs.`);

  // Convert legs into higher-level "trade actions"
  // (e.g., Buy, Sell, Bridge, Deposit, Withdraw)
  const actions = legsToTradeActions(legs, {
    txHash: sig,
    wallet: userWallet,
    debug: debug
  });

  console.log("📊 Trade actions derived from transaction:");
  console.log(JSON.stringify(actions, null, 2));
}

// Run the main function and catch any unhandled errors
main().catch((err) => {
  console.error("❌ Unhandled error in main():", err);
});