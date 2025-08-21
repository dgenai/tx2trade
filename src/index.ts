import { SolanaRpcClient } from "./services/SolanaRpcClient.js";
import { MetaplexMetadataService } from "./services/MetaplexMetadataService.js";

import { transactionToSwapLegs_SOLBridge } from "./core/transactionToSwapLegs.js";
import { legsToTradeActions } from "./core/actions.js";
import { inferUserWallet } from "./core/inferUserWallet.js";
import { chunkArray } from "./utils/helpers.js"; 

/**
 * Options for customizing transaction-to-trade parsing.
 */
type Tx2TradeOpts = {
  debug?: boolean;
  windowTotalFromOut?: number;
  requireAuthorityUserForOut?: boolean;
};


export { SolanaRpcClient } from "./services/SolanaRpcClient.js";


/**
 * Convert a list of Solana transaction signatures into enriched trade actions.
 *
 * Workflow:
 *  1. Initialize Solana RPC client and metadata service.
 *  2. Fetch transactions in safe-sized chunks (to avoid RPC limits).
 *  3. For each transaction:
 *     - Infer the most likely user wallet involved.
 *     - Extract swap legs via `transactionToSwapLegs_SOLBridge`.
 *     - Convert swap legs into high-level trade actions.
 *  4. Enrich aggregated trade actions with token metadata from Metaplex.
 *  5. Return the enriched trade history.
 *
 * Notes:
 *  - Default options enforce stricter wallet inference (`requireAuthorityUserForOut = true`).
 *  - Uses a sliding window (`windowTotalFromOut`) to detect multi-leg swaps.
 *  - Debug mode prints intermediate parsing results for troubleshooting.
 *
 * @param sigs - List of transaction signatures
 * @param rpcEndpoint - Solana RPC endpoint URL
 * @param opts - Optional parsing and debug configuration
 * @returns Array of enriched trade actions across all transactions
 */
export async function tx2trade(
  sigs: string[],
  rpcEndpoint: string,
  opts: Tx2TradeOpts = {}
) {
  const {
    debug = false,
    windowTotalFromOut = 500,
    requireAuthorityUserForOut = true,
  } = opts;

  // Initialize Solana RPC client with retry & timeout strategy
   const rpc = new SolanaRpcClient({
    endpoint: rpcEndpoint,
    timeoutMs: 25_000,
    maxRetries: 3,
    retryBackoffMs: 300,
    defaultCommitment: "confirmed",
    log: (...args: any[]) => console.log(...args)
  });

  // Service for fetching and enriching with Metaplex token metadata
  const metaSvc = new MetaplexMetadataService(rpc);

  // Split signatures into batches of 100 to avoid RPC limits
  const sigChunks = chunkArray(sigs, 50);
  const allActions: any[] = [];

  for (const chunk of sigChunks) {
    // Fetch parsed transactions for the current batch
    const txs = await rpc.getTransactionsParsedBatch(chunk, 0);

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const sig = chunk[i];

      // Handle missing transactions gracefully
      if (!tx) {
        console.warn(`⚠️ Transaction not found: ${sig}`);
        continue;
      }

      try {
        // Step 1: Infer the user wallet involved
        const userWallet = inferUserWallet(tx);

        // Step 2: Convert transaction into swap legs
        const legs = transactionToSwapLegs_SOLBridge(tx, userWallet, {
          windowTotalFromOut,
          requireAuthorityUserForOut,
          debug,
        });

        // Step 3: Convert legs into high-level trade actions
        const actions = legsToTradeActions(legs, {
          txHash: sig,
          wallet: userWallet,
          blockTime: tx.blockTime,
        });

        if (debug) {
          console.debug("tx2trade result", { sig, actions, legsCount: legs.length });
        }

        // Aggregate results
        allActions.push(...actions);
      } catch (err) {
        console.error(`❌ Error parsing TX ${sig}:`, err);
      }
    }
  }

  // Enrich aggregated actions with token metadata
  const metaMap = await metaSvc.fetchTokenMetadataMapFromActions(allActions);
  const enriched = metaSvc.enrichActionsWithMetadata(allActions, metaMap);

  return enriched; // Final aggregated & enriched trade history
}
