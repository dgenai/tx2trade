import { transactionToSwapLegs_SOLBridge } from "./core/transactionToSwapLegs.js";
import { legsToTradeActions } from "./core/actions.js";
import { inferUserWallet } from "./inferUserWallet.js";

type Tx2TradeOpts = {
  debug?: boolean;
  windowTotalFromOut?: number;
  requireAuthorityUserForOut?: boolean;
};

/**
 * Fetch parsed transactions in batch (order preserved using id).
 */
async function fetchParsedTransactionsBatch(
  signatures: string[],
  rpcEndpoint: string
): Promise<(any | null)[]> {
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

  // Helius sometimes wraps responses
  if (results.data && Array.isArray(results.data)) {
    results = results.data;
  }
  if (!Array.isArray(results)) {
    results = [results];
  }

  // Build map: id -> result
  const resultMap = new Map<number, any>();
  for (const r of results) {
    if (r?.error) {
      console.warn(`⚠️ RPC error for request id ${r.id}:`, r.error);
      continue;
    }
    if (typeof r.id === "number") {
      resultMap.set(r.id, r.result);
    }
  }

  // Return txs in same order as input signatures
  return signatures.map((_, idx) => resultMap.get(idx) || null);
}

/**
 * Split array into chunks of given size.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Convert a list of signatures into aggregated trade actions.
 */
export async function txs2trades(
  sigs: string[],
  rpcEndpoint: string,
  opts: Tx2TradeOpts = {}
) {
  const {
    debug = false,
    windowTotalFromOut = 500,
    requireAuthorityUserForOut = true,
  } = opts;

  const sigChunks = chunkArray(sigs, 100); // avoid RPC limits
  const allActions: any[] = [];

  for (const chunk of sigChunks) {
    const txs = await fetchParsedTransactionsBatch(chunk, rpcEndpoint);

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

        // Transaction -> legs
        const legs = transactionToSwapLegs_SOLBridge(tx, userWallet, {
          windowTotalFromOut,
          requireAuthorityUserForOut,
          debug,
        });

        // Legs -> trade actions
        const actions = legsToTradeActions(legs, {
          txHash: sig,
          wallet: userWallet,
        });

        if (debug) {
          console.debug("tx2trade result", { sig, actions, legsCount: legs.length });
        }

        allActions.push(...actions);
      } catch (err) {
        console.error(`❌ Error parsing TX ${sig}:`, err);
      }
    }
  }

  return allActions; // aggregated trade history
}
