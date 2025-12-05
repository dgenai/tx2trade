import { BinanceKlinesService } from "./services/BinanceKlinesService.js";
import { transactionToSwapLegs_SOLBridge } from "./core/transactionToSwapLegs.js";
import { legsToTradeActions } from "./core/actions.js";
import { inferUserWallets } from "./core/inferUserWallet.js";
function buildWindows(startTimeMs, endTimeMs, intervalMs = 60000, maxCandles = 1500) {
    const maxSpan = intervalMs * maxCandles;
    const windows = [];
    let curStart = startTimeMs;
    while (curStart < endTimeMs) {
        const curEnd = Math.min(curStart + maxSpan - 1, endTimeMs);
        windows.push({ startMs: curStart, endMs: curEnd });
        curStart = curEnd + 1;
    }
    return windows;
}
async function fetchCandlesForBlockTimeRange(minBlockTime, maxBlockTime) {
    // blockTime est en secondes → on passe en ms, avec une marge de 60s
    const startMs = (minBlockTime - 60) * 1000;
    const endMs = (maxBlockTime + 60) * 1000;
    const svc = new BinanceKlinesService({ market: "spot" });
    const windows = buildWindows(startMs, endMs, 60000, 1500);
    const tasks = windows.map(w => async () => svc.fetchKlinesRange({
        symbol: "SOLUSDT",
        interval: "1m",
        startTimeMs: w.startMs,
        endTimeMs: w.endMs,
        limitPerCall: 1500,
    }));
    const results = [];
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
export async function buildActionsFromSignatures(input) {
    const { rpc, signatures, debug, windowTotalFromOut, requireAuthorityUserForOut, } = input;
    if (!signatures || signatures.length === 0) {
        throw new Error("buildActionsFromSignatures: signatures are required");
    }
    const CHUNK = 50;
    const parsed = [];
    let minBlockTime;
    let maxBlockTime;
    for (let i = 0; i < signatures.length; i += CHUNK) {
        const sigChunk = signatures.slice(i, i + CHUNK);
        const txs = await rpc.getTransactionsParsedBatch(sigChunk, 0);
        for (let j = 0; j < sigChunk.length; j++) {
            const sig = sigChunk[j];
            const tx = txs[j] ?? null;
            if (!tx) {
                if (debug)
                    console.warn(`missing tx: ${sig}`);
                continue;
            }
            if (tx.meta?.err) {
                if (debug)
                    console.warn(`skip failed tx: ${sig}`);
                continue;
            }
            try {
                const wallets = inferUserWallets(tx);
                const legs = transactionToSwapLegs_SOLBridge(sig, tx, wallets, {
                    windowTotalFromOut,
                    requireAuthorityUserForOut,
                    debug,
                });
                if (!legs || legs.length === 0)
                    continue;
                const blockTime = typeof tx.blockTime === "number" ? tx.blockTime : 0;
                if (blockTime > 0) {
                    if (minBlockTime === undefined || blockTime < minBlockTime) {
                        minBlockTime = blockTime;
                    }
                    if (maxBlockTime === undefined || blockTime > maxBlockTime) {
                        maxBlockTime = blockTime;
                    }
                }
                parsed.push({ sig, wallets, blockTime, legs });
            }
            catch (e) {
                console.error(`error parsing legs for ${sig}:`, e);
            }
        }
    }
    // ------------------- fetch real prices (Binance) ----------------------
    let candles = [];
    if (minBlockTime !== undefined && maxBlockTime !== undefined) {
        candles = await fetchCandlesForBlockTimeRange(minBlockTime, maxBlockTime);
    }
    else if (debug) {
        console.warn("buildActionsFromSignatures: no valid blockTime for candles");
    }
    // ------------------- build final TradeActions with pricing ------------
    const allActions = [];
    for (const ctx of parsed) {
        const { sig, wallets, blockTime, legs } = ctx;
        try {
            const actions = legsToTradeActions(legs, {
                txHash: sig,
                wallets,
                blockTime,
                candles, // pricing via getSolPriceAt()
                debug,
            });
            if (!actions.length)
                continue;
            allActions.push(...actions);
        }
        catch (e) {
            console.error(`error building actions for ${sig}:`, e);
        }
    }
    return allActions;
}
//# sourceMappingURL=fromSignatures.js.map