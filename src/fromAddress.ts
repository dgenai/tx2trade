import { SolanaRpcClient } from "./services/SolanaRpcClient.js";
import { BinanceKlinesService } from "./services/BinanceKlinesService.js";
import { transactionToSwapLegs_SOLBridge } from "./core/transactionToSwapLegs.js";
import { legsToTradeActions } from "./core/actions.js";
import { inferUserWallets } from "./core/inferUserWallet.js";
import { TradeAction } from "./types.js";
import { exit } from "node:process";

type BuildFromAddressInput = {
  rpc: SolanaRpcClient;
  address: string;
  total?: number;
  pageSize?: number;
  before?: string;
  until?: string;

  // Date range filter (address mode)
  fromDate?: string;
  toDate?: string;

  debug: boolean;
  windowTotalFromOut: number;
  requireAuthorityUserForOut: boolean;
};

type ParsedTxCtx = {
  sig: string;
  wallets: string[];
  blockTime: number;
  legs: any[]; // SwapLeg[]
};

function buildWindows(
  startTimeMs: number,
  endTimeMs: number,
  intervalMs = 60_000,
  maxCandles = 1500
) {
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

async function fetchCandlesForBlockTimeRange(
  minBlockTime: number,
  maxBlockTime: number
) {
  // blockTime is in seconds → convert to ms and add a 60s margin
  const startMs = (minBlockTime - 60) * 1000;
  const endMs = (maxBlockTime + 60) * 1000;

  const svc = new BinanceKlinesService({ market: "spot" });
  const windows = buildWindows(startMs, endMs, 60_000, 1500);

  const tasks = windows.map(w => async () =>
    svc.fetchKlinesRange({
      symbol: "SOLUSDT",
      interval: "1m",
      startTimeMs: w.startMs,
      endTimeMs: w.endMs,
      limitPerCall: 1500,
    })
  );

  const results: any[][] = [];
  let index = 0;
  const concurrency = 5;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return results.flat().sort((a, b) => a.openTime - b.openTime);
}

export async function buildActionsFromAddress(
  input: BuildFromAddressInput
): Promise<TradeAction[]> {
  const {
    rpc,
    address,
    total,
    pageSize,
    before,
    until,
    fromDate,
    toDate,
    debug,
    windowTotalFromOut,
    requireAuthorityUserForOut,
  } = input;

  if (!address) throw new Error("buildActionsFromAddress: address is required");

  const hasDateFilter = !!(fromDate || toDate);
  const target = !hasDateFilter && typeof total === "number" && total > 0 ? total : undefined;

  const perPage = pageSize ?? 100;
  const CHUNK = 30;
  let cursor = before;

  const parsed: ParsedTxCtx[] = [];
  let approxActions = 0;
  let minBlockTime: number | undefined;
  let maxBlockTime: number | undefined;
  let done = false;

  // Convert ISO dates to UNIX seconds
  const fromTs = fromDate ? Math.floor(new Date(fromDate).getTime() / 1000) : undefined;
  const toTs   = toDate   ? Math.floor(new Date(toDate).getTime()   / 1000) : undefined;
  const lowerTs = fromTs && toTs ? Math.min(fromTs, toTs) : fromTs ?? toTs;
  const upperTs = fromTs && toTs ? Math.max(fromTs, toTs) : undefined;

  while (!done) {
    const sigPage = await rpc.fetchAllSignaturesWithPagination(address, {
      total: perPage,
      pageSize: perPage,
      before: cursor,
      until,
      fromDate,
      toDate,
    });

    if (sigPage.length === 0) break;

    // Check the last transaction of this page to know if we should stop
    const lastSig = sigPage[sigPage.length - 1];
    const lastTxMeta = await rpc.getTransactionsParsedBatch([lastSig], 0);
    const lastBlockTime = lastTxMeta[0]?.blockTime ?? 0;

    if (hasDateFilter && lowerTs && lastBlockTime > 0 && lastBlockTime < lowerTs) {
      if (debug)
        console.log(`🛑 Stop pagination: last blockTime=${lastBlockTime} < lower bound=${lowerTs}`);
      break;
    }

    // Process this page
    for (let i = 0; i < sigPage.length; i += CHUNK) {
      const sigChunk = sigPage.slice(i, i + CHUNK);
      const txs = await rpc.getTransactionsParsedBatch(sigChunk, 0);

      for (let j = 0; j < sigChunk.length; j++) {
        const sig = sigChunk[j];
        const tx = txs[j] ?? null;

        if (!tx) {
          if (debug) console.warn(`missing tx: ${sig}`);
          continue;
        }
        if (tx.meta?.err) {
          if (debug) console.warn(`skip failed tx: ${sig}`);
          continue;
        }

        const blockTime = typeof tx.blockTime === "number" ? tx.blockTime : 0;
        if (hasDateFilter) {
          if (upperTs && blockTime > upperTs) continue; // too recent
          if (lowerTs && blockTime < lowerTs) continue; // too old
        }

        try {
          const wallets = inferUserWallets(tx);
          const legs = transactionToSwapLegs_SOLBridge(sig, tx, wallets, {
            windowTotalFromOut,
            requireAuthorityUserForOut,
            debug,
          });

          if (!legs || legs.length === 0) continue;

          if (blockTime > 0) {
            if (minBlockTime === undefined || blockTime < minBlockTime) minBlockTime = blockTime;
            if (maxBlockTime === undefined || blockTime > maxBlockTime) maxBlockTime = blockTime;
          }

          parsed.push({ sig, wallets, blockTime, legs });
          approxActions += legs.length;

          if (target && approxActions >= target) {
            done = true;
            break;
          }
        } catch (e) {
          console.error(`error parsing legs for ${sig}:`, e);
        }
      }
      if (done) break;
    }

    cursor = sigPage[sigPage.length - 1];
    if (!target && sigPage.length < perPage) break;
  }

  // Fetch Binance candles for the date range
  let candles: any[] = [];
  if (minBlockTime !== undefined && maxBlockTime !== undefined) {
    candles = await fetchCandlesForBlockTimeRange(minBlockTime, maxBlockTime);
  } else if (debug) {
    console.warn("buildActionsFromAddress: no valid blockTime for candles");
  }

  // Build final trade actions
  const allActions: TradeAction[] = [];
  for (const ctx of parsed) {
    const { sig, wallets, blockTime, legs } = ctx;
    try {
      const actions = legsToTradeActions(legs, {
        txHash: sig,
        wallets,
        blockTime,
        candles,
        debug,
      });
      if (actions.length) allActions.push(...actions);
      if (target && allActions.length >= target) break;
    } catch (e) {
      console.error(`error building actions for ${sig}:`, e);
    }
  }

  return target && allActions.length > target ? allActions.slice(0, target) : allActions;
}

