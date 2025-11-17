import { SolanaRpcClient } from "./services/SolanaRpcClient.js";
import { MetaplexMetadataService } from "./services/MetaplexMetadataService.js";
import { BinanceKlinesService } from "./services/BinanceKlinesService.js";
import { transactionToSwapLegs_SOLBridge } from "./core/transactionToSwapLegs.js";
import { legsToTradeActions } from "./core/actions.js";
import { inferUserWallet } from "./core/inferUserWallet.js";
export { SolanaRpcClient } from "./services/SolanaRpcClient.js";
/**
 * Build windows for Binance klines queries, aligned with CLI:
 *  - 1-minute granularity
 *  - 1500 candles per API call
 */
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
/** Concurrency limiter for parallel Binance window fetches */
async function runWithLimit(tasks, concurrency = 5) {
    const results = [];
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
 * tx2trade()
 * ==========
 * Main pipeline used by the CLI:
 *  - Signature-mode or address-mode
 *  - Full transaction fetch with strict validation
 *  - Skip failed tx (meta.err)
 *  - Klines enrichment identical to CLI
 *  - Legs → Actions → Metadata enrichment
 *
 * Output: Array of enriched trade actions
 */
export async function tx2trade(input) {
    const { sigs, address, total, pageSize, before, until, rpcEndpoint, debug = false, windowTotalFromOut = 500, requireAuthorityUserForOut = true, } = input;
    if (!rpcEndpoint) {
        throw new Error("tx2trade: rpcEndpoint is required");
    }
    // RPC client identical to CLI
    const rpc = new SolanaRpcClient({
        endpoint: rpcEndpoint,
        timeoutMs: 25000,
        maxRetries: 3,
        retryBackoffMs: 3000,
        defaultCommitment: "confirmed",
        log: (...args) => console.log(...args),
    });
    const metaSvc = new MetaplexMetadataService(rpc);
    // --------------------------------------------------------------------
    // MODE ADDRESS — IDENTICAL LOGIC TO CLI WITH WHILE-PAGINATION
    // --------------------------------------------------------------------
    let finalSignatures = sigs;
    if (!sigs && address) {
        const required = Math.max(1, total ?? pageSize ?? 50);
        const perPage = pageSize ?? Math.min(100, required);
        let cursor = before;
        let fetchedSigs = [];
        while (fetchedSigs.length < required) {
            const remaining = required - fetchedSigs.length;
            const batch = Math.min(perPage, remaining);
            const page = await rpc.fetchAllSignaturesWithPagination(address, {
                total: batch,
                pageSize: batch,
                before: cursor,
                until,
            });
            if (page.length === 0)
                break;
            fetchedSigs.push(...page);
            cursor = page[page.length - 1];
        }
        if (fetchedSigs.length < required) {
            throw new Error(`tx2trade: needed ${required} signatures but only found ${fetchedSigs.length}`);
        }
        finalSignatures = fetchedSigs.slice(0, required);
    }
    // --------------------------------------------------------------------
    // VALIDATION SIGNATURES MODE
    // --------------------------------------------------------------------
    if (!finalSignatures || finalSignatures.length === 0) {
        throw new Error("tx2trade: no signatures to process");
    }
    // --------------------------------------------------------------------
    // FETCH TRANSACTIONS — CHUNK=10 (IDENTICAL TO CLI)
    // --------------------------------------------------------------------
    const CHUNK = 10;
    const fetched = [];
    for (let i = 0; i < finalSignatures.length; i += CHUNK) {
        const chunk = finalSignatures.slice(i, i + CHUNK);
        const txs = await rpc.getTransactionsParsedBatch(chunk, 0);
        for (let j = 0; j < chunk.length; j++) {
            fetched.push({ sig: chunk[j], tx: txs[j] ?? null });
        }
    }
    // Strict count validation (identical to CLI)
    if (fetched.length !== finalSignatures.length) {
        throw new Error(`BUG: fetched=${fetched.length} required=${finalSignatures.length}`);
    }
    // --------------------------------------------------------------------
    // CANDLES (IDENTICAL TO CLI)
    // --------------------------------------------------------------------
    const validTimes = fetched
        .map(f => f.tx?.blockTime)
        .filter((t) => typeof t === "number" && t > 0);
    let candles = [];
    if (validTimes.length > 0) {
        const min = Math.min(...validTimes);
        const max = Math.max(...validTimes);
        const startMs = Math.floor(min / 60) * 60 * 1000;
        const endMs = (Math.floor(max / 60) + 1) * 60 * 1000;
        const svc = new BinanceKlinesService({ market: "spot" });
        const windows = buildWindows(startMs, endMs, 60000, 1500);
        const tasks = windows.map(w => async () => svc.fetchKlinesRange({
            symbol: "SOLUSDT",
            interval: "1m",
            startTimeMs: w.startMs,
            endTimeMs: w.endMs,
            limitPerCall: 1500,
        }));
        const results = await runWithLimit(tasks, 5);
        candles = results.flat().sort((a, b) => a.openTime - b.openTime);
    }
    // --------------------------------------------------------------------
    // PARSE TRANSACTIONS
    // --------------------------------------------------------------------
    const allActions = [];
    for (const { sig, tx } of fetched) {
        if (!tx) {
            console.warn(`⚠️ Missing transaction: ${sig}`);
            continue;
        }
        if (tx.meta?.err) {
            if (debug)
                console.warn(`⚠️ Skip failed TX: ${sig}`);
            continue;
        }
        try {
            const wallet = inferUserWallet(tx);
            const legs = transactionToSwapLegs_SOLBridge(sig, tx, wallet, {
                windowTotalFromOut,
                requireAuthorityUserForOut,
                debug,
            });
            const actions = legsToTradeActions(legs, {
                txHash: sig,
                wallet,
                blockTime: tx.blockTime,
                candles,
            });
            allActions.push(...actions);
        }
        catch (e) {
            console.error(`❌ Error parsing ${sig}:`, e);
        }
    }
    // --------------------------------------------------------------------
    // METADATA ENRICHMENT (IDENTICAL TO CLI)
    // --------------------------------------------------------------------
    const metaMap = await metaSvc.fetchTokenMetadataMapFromActions(allActions);
    const enriched = metaSvc.enrichActionsWithMetadata(allActions, metaMap);
    return enriched;
}
//# sourceMappingURL=index.js.map