import { WSOL_MINT } from "../types.js";
import { blockTimeToDate } from "../utils/helpers.js";
import { STABLES } from "../constants.js";
/**
 * Retrieve the USD price of SOL at (or nearest to) a given block time.
 */
function getSolPriceAt(candles, blockTime) {
    if (!candles || candles.length === 0)
        return null;
    // blockTime en secondes -> ms
    const ts = blockTime * 1000;
    // Always pick the closest candle by openTime
    let nearest = candles[0];
    let best = Math.abs(nearest.openTime - ts);
    for (let i = 1; i < candles.length; i++) {
        const c = candles[i];
        const d = Math.abs(c.openTime - ts);
        if (d < best) {
            best = d;
            nearest = c;
        }
    }
    const price = Number(nearest.close);
    return Number.isFinite(price) ? price : null;
}
/**
 * Formats a numeric value as a plain decimal string (no scientific notation).
 */
function safeUsd(value, opts) {
    if (value == null || !Number.isFinite(value))
        return "0";
    const { maxSmallDecimals = 18, maxLargeDecimals = 6, minDecimals = 0 } = opts ?? {};
    const abs = Math.abs(value);
    const maxDecimals = abs >= 1 ? maxLargeDecimals : maxSmallDecimals;
    let s = value.toLocaleString("en-US", {
        useGrouping: false,
        minimumFractionDigits: minDecimals,
        maximumFractionDigits: maxDecimals,
    });
    if (/[eE]/.test(s))
        s = value.toFixed(maxDecimals);
    s = s.replace(/(\.\d*?[1-9])0+$/u, "$1")
        .replace(/\.0+$/u, "")
        .replace(/\.$/u, "");
    if (s === "-0")
        s = "0";
    return s;
}
/**
 * Convert swap legs into high-level trade actions, enriched with USD pricing.
 */
export function legsToTradeActions(legs, ctx) {
    const { debug = false, candles = [] } = ctx;
    const log = ctx.log ?? ((...args) => {
        if (debug)
            console.debug("[legsToTradeActions]", ...args);
    });
    const actions = [];
    const txDate = blockTimeToDate(ctx.blockTime);
    const solPrice = getSolPriceAt(candles, ctx.blockTime);
    for (const leg of legs) {
        log("Processing leg", leg);
        const soldAmt = Number(leg.soldAmount ?? 0);
        const boughtAmt = Number(leg.boughtAmount ?? 0);
        const router = Number(leg.routerFees ?? 0);
        const tip = Number(leg.tip ?? 0);
        const network = Number(leg.networkFee ?? 0);
        const rent = Number(leg.rent ?? 0);
        // IMPORTANT : pick correct wallet for this leg
        const wallet = leg.userWallet ?? ctx.wallets[0];
        // -------------------------------------------------------------------------
        // TRANSFER-OUT
        // -------------------------------------------------------------------------
        if (boughtAmt === 0 && !leg.boughtMint && soldAmt > 0) {
            actions.push({
                transactionDate: txDate,
                transactionHash: ctx.txHash,
                transactionType: "transfer",
                walletAddress: wallet,
                sold: {
                    address: leg.soldMint,
                    amount: soldAmt,
                    unitPriceUsd: "0",
                    amountUsd: "0",
                },
                bought: {
                    ...(leg.targetWallet && { targetWallet: leg.targetWallet }),
                    unitPriceUsd: "0",
                    amountUsd: "0",
                },
            });
            continue;
        }
        // -------------------------------------------------------------------------
        // BUY (SOL → Token)
        // -------------------------------------------------------------------------
        if (leg.soldMint === WSOL_MINT) {
            const coreSol = Number(leg.soldCore ?? soldAmt);
            const soldSolUnit = solPrice;
            const soldSolUsd = soldSolUnit ? coreSol * soldSolUnit : null;
            const boughtTokenUnit = boughtAmt > 0 && soldSolUsd != null
                ? soldSolUsd / boughtAmt
                : null;
            const boughtTokenUsd = boughtTokenUnit != null ? boughtAmt * boughtTokenUnit : null;
            actions.push({
                transactionDate: txDate,
                transactionHash: ctx.txHash,
                transactionType: "buy",
                walletAddress: wallet,
                sold: {
                    address: WSOL_MINT,
                    symbol: "SOL",
                    amount: coreSol,
                    unitPriceUsd: safeUsd(soldSolUnit),
                    amountUsd: safeUsd(soldSolUsd),
                },
                bought: {
                    address: leg.boughtMint,
                    amount: boughtAmt,
                    unitPriceUsd: safeUsd(boughtTokenUnit),
                    amountUsd: safeUsd(boughtTokenUsd),
                },
            });
            continue;
        }
        // -------------------------------------------------------------------------
        // SELL (Token → SOL)
        // -------------------------------------------------------------------------
        if (leg.boughtMint === WSOL_MINT) {
            const netSol = boughtAmt;
            const grossSol = netSol + router + tip + network + rent;
            const solUnit = solPrice;
            const boughtSolUsdNet = solUnit ? netSol * solUnit : null;
            const soldTokenUsdGross = solUnit ? grossSol * solUnit : null;
            const soldTokenUnit = soldAmt > 0 && soldTokenUsdGross != null
                ? soldTokenUsdGross / soldAmt
                : null;
            actions.push({
                transactionDate: txDate,
                transactionHash: ctx.txHash,
                transactionType: "sell",
                walletAddress: wallet,
                sold: {
                    address: leg.soldMint,
                    amount: soldAmt,
                    unitPriceUsd: safeUsd(soldTokenUnit),
                    amountUsd: safeUsd(soldTokenUsdGross),
                },
                bought: {
                    address: WSOL_MINT,
                    symbol: "SOL",
                    amount: netSol,
                    unitPriceUsd: safeUsd(solUnit),
                    amountUsd: safeUsd(boughtSolUsdNet),
                },
            });
            continue;
        }
        // -------------------------------------------------------------------------
        // TOKEN ↔ TOKEN (NO SWAP ALLOWED)
        // Classification forced into BUY or SELL
        // -------------------------------------------------------------------------
        const soldIsStable = STABLES.has(leg.soldMint);
        const boughtIsStable = STABLES.has(leg.boughtMint);
        if (soldIsStable && !boughtIsStable) {
            // Stable → Token = BUY
            const usd = soldAmt;
            const unit = boughtAmt > 0 ? usd / boughtAmt : null;
            actions.push({
                transactionDate: txDate,
                transactionHash: ctx.txHash,
                transactionType: "buy",
                walletAddress: wallet,
                sold: {
                    address: leg.soldMint,
                    amount: soldAmt,
                    unitPriceUsd: "1",
                    amountUsd: safeUsd(usd),
                },
                bought: {
                    address: leg.boughtMint,
                    amount: boughtAmt,
                    unitPriceUsd: safeUsd(unit),
                    amountUsd: safeUsd(usd),
                },
            });
            continue;
        }
        if (!soldIsStable && boughtIsStable) {
            // Token → Stable = SELL
            const usd = boughtAmt;
            const unit = soldAmt > 0 ? usd / soldAmt : null;
            actions.push({
                transactionDate: txDate,
                transactionHash: ctx.txHash,
                transactionType: "sell",
                walletAddress: wallet,
                sold: {
                    address: leg.soldMint,
                    amount: soldAmt,
                    unitPriceUsd: safeUsd(unit),
                    amountUsd: safeUsd(usd),
                },
                bought: {
                    address: leg.boughtMint,
                    amount: boughtAmt,
                    unitPriceUsd: "1",
                    amountUsd: safeUsd(usd),
                },
            });
            continue;
        }
        let soldUnitUsd = "0";
        let soldAmountUsd = "0";
        let boughtUnitUsd = "0";
        let boughtAmountUsd = "0";
        let txType = "buy";
        const soldCore = Number(leg.soldCore ?? 0);
        if (solPrice && Number.isFinite(solPrice) && soldCore > 0 && boughtAmt > 0) {
            const totalUsd = soldCore * solPrice;
            const unitBought = totalUsd / boughtAmt;
            soldUnitUsd = safeUsd(solPrice);
            soldAmountUsd = safeUsd(totalUsd);
            boughtUnitUsd = safeUsd(unitBought);
            boughtAmountUsd = safeUsd(totalUsd);
        }
        actions.push({
            transactionDate: txDate,
            transactionHash: ctx.txHash,
            transactionType: txType,
            walletAddress: wallet,
            sold: {
                address: leg.soldMint,
                amount: soldAmt,
                unitPriceUsd: soldUnitUsd,
                amountUsd: soldAmountUsd,
            },
            bought: {
                address: leg.boughtMint,
                amount: boughtAmt,
                unitPriceUsd: boughtUnitUsd,
                amountUsd: boughtAmountUsd,
            },
        });
    }
    log(`Built ${actions.length} actions`, actions);
    return actions;
}
//# sourceMappingURL=actions.js.map