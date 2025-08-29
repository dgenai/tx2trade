import { SolanaRpcClient } from "./services/SolanaRpcClient.js";
import { MetaplexMetadataService } from "./services/MetaplexMetadataService.js";

import { transactionToSwapLegs_SOLBridge } from "./core/transactionToSwapLegs.js";
import { legsToTradeActions } from "./core/actions.js";
import { inferUserWallet } from "./core/inferUserWallet.js";
import { chunkArray } from "./utils/helpers.js";
import { BinanceKlinesService } from "./services/BinanceKlinesService.js";

/**
 * Options for customizing transaction-to-trade parsing.
 */
type Tx2TradeOpts = {
  debug?: boolean;
  windowTotalFromOut?: number;
  requireAuthorityUserForOut?: boolean;
};

export { SolanaRpcClient } from "./services/SolanaRpcClient.js";


function buildWindows(startTimeMs: number, endTimeMs: number, intervalMs = 60_000, maxCandles = 1000) {
  const maxSpan = intervalMs * maxCandles;
  const windows: { startMs: number; endMs: number }[] = [];
  let curStart = startTimeMs;
  while (curStart < endTimeMs) {
    const curEnd = Math.min(curStart + maxSpan - 1, endTimeMs);
    windows.push({ startMs: curStart, endMs: curEnd });
    curStart = curEnd + 1;
  }
  return windows;
}

// limiteur de concurrence simple
async function runWithLimit<T>(tasks: (() => Promise<T>)[], concurrency = 20): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}



/**
 * Convert a list of Solana transaction signatures into enriched trade actions.
 * Now:
 *  1) Fetch ALL transactions in batches
 *  2) Parse AFTER everything is fetched
 *  3) Enrich with Metaplex metadata
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
    log: (...args: any[]) => console.log(...args),
  });

  // Service for fetching and enriching with Metaplex token metadata
  const metaSvc = new MetaplexMetadataService(rpc);

  // 1) FETCH — Split signatures into batches to avoid RPC limits
  const sigChunks = chunkArray(sigs, 50);
  const fetched: Array<{ sig: string; tx: any | null }> = [];

  for (const chunk of sigChunks) {
    const txs = await rpc.getTransactionsParsedBatch(chunk, 0);
    for (let i = 0; i < chunk.length; i++) {
      fetched.push({ sig: chunk[i], tx: txs[i] ?? null });
    }
  }


  // -------------------------------
  // 2) Retrieve SOL/USDT candles
  // -------------------------------
  const validBlockTimes = fetched
    .map(f => f.tx?.blockTime)
    .filter((t): t is number => typeof t === "number" && t > 0);

  let candles: any[] = [];
  if (validBlockTimes.length > 0) {
    const minBlockTime = Math.min(...validBlockTimes);
    const maxBlockTime = Math.max(...validBlockTimes);
  
    // Round to minute boundaries
    const startTimeMs = Math.floor(minBlockTime / 60) * 60 * 1000;
    const endTimeMs = (Math.floor(maxBlockTime / 60) + 1) * 60 * 1000;
  
    const svc = new BinanceKlinesService({ market: "spot" });
  
    // 1. Construire les fenêtres de 1000 minutes max
    const windows = buildWindows(startTimeMs, endTimeMs, 60_000, 1000);
    if (debug) console.log(`📊 ${windows.length} fenêtre(s) à récupérer en parallèle`);
  
    // 2. Préparer les tâches
    const tasks = windows.map(w => async () => {
      if (debug) {
        console.log(`⏳ Fetching window ${new Date(w.startMs).toISOString()} → ${new Date(w.endMs).toISOString()}`);
      }
      const batch = await svc.fetchKlinesRange({
        symbol: "SOLUSDT",
        interval: "1m",
        startTimeMs: w.startMs,
        endTimeMs: w.endMs,
        limitPerCall: 1500,
      });
      return batch;
    });
  
    // 3. Lancer avec concurrence limitée
    const results = await runWithLimit(tasks, 5);
  
    // 4. Fusionner + trier
    candles = results.flat().sort((a, b) => a.openTime - b.openTime);
  
    if (debug) console.log(`📈 Binance returned ${candles.length} candles (1m).`);
  }
  

  // 2) PARSE — Only after all tx are fetched
  const allActions: any[] = [];

  for (const { sig, tx } of fetched) {
    if (!tx) {
      console.warn(`⚠️ Transaction not found: ${sig}`);
      continue;
    }

    try {
      // Infer the user wallet involved
      const userWallet = inferUserWallet(tx);

      // Convert transaction into swap legs
      const legs = transactionToSwapLegs_SOLBridge(tx, userWallet, {
        windowTotalFromOut,
        requireAuthorityUserForOut,
        debug,
      });

      // Convert legs into high-level trade actions
      const actions = legsToTradeActions(legs, {
        txHash: sig,
        wallet: userWallet,
        blockTime: tx.blockTime,
        candles,
      });

      if (debug) {
        console.debug("tx2trade result", { sig, actions, legsCount: legs.length });
      }

      allActions.push(...actions);
    } catch (err) {
      console.error(`❌ Error parsing TX ${sig}:`, err);
    }
  }

  // 3) ENRICH — Enrich aggregated actions with token metadata
  const metaMap = await metaSvc.fetchTokenMetadataMapFromActions(allActions);
  const enriched = metaSvc.enrichActionsWithMetadata(allActions, metaMap);

  return enriched; // Final aggregated & enriched trade history
}
