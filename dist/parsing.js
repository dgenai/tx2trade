import { transactionToSwapLegs_SOLBridge } from "./core/transactionToSwapLegs.js";
import { legsToTradeActions } from "./core/actions.js";
import { inferUserWallets } from "./core/inferUserWallet.js";
/**
 * Parse a single Solana transaction into trade actions without market data.
 * Candles will be added later in a dedicated enrichment step.
 */
export function parseTransactionToActionsWithoutCandles(sig, tx, options) {
    const { debug, windowTotalFromOut, requireAuthorityUserForOut } = options;
    if (!tx) {
        if (debug)
            console.warn(`tx2trade: missing transaction: ${sig}`);
        return { actions: [], blockTime: null };
    }
    if (tx.meta?.err) {
        if (debug)
            console.warn(`tx2trade: skip failed transaction: ${sig}`);
        return { actions: [], blockTime: null };
    }
    const blockTime = typeof tx.blockTime === "number" ? tx.blockTime : null;
    try {
        const wallets = inferUserWallets(tx);
        const legs = transactionToSwapLegs_SOLBridge(sig, tx, wallets, {
            windowTotalFromOut,
            requireAuthorityUserForOut,
            debug,
        });
        // Important: we call legsToTradeActions WITHOUT candles here.
        // You may need to update legsToTradeActions to accept an optional candles field
        // and skip price enrichment when not provided.
        const actions = legsToTradeActions(legs, {
            txHash: sig,
            wallets,
            blockTime,
            candles: undefined, // no market data at this stage
        });
        return { actions, blockTime };
    }
    catch (e) {
        console.error(`tx2trade: error parsing transaction ${sig}:`, e);
        return { actions: [], blockTime };
    }
}
//# sourceMappingURL=parsing.js.map