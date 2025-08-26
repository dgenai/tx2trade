import { SwapLeg, TradeAction } from "../types.js";
/**
 * Convert swap legs into high-level trade actions, enriched with USD pricing.
 *
 * Pricing logic:
 *  - SOL ↔ Token swaps:
 *      Use Binance candles to derive SOL/USD, then infer token/USD via ratio.
 *  - Token ↔ Token swaps:
 *      Cannot infer USD without external reference; values set to "0".
 *
 * Each trade action includes both sides of the swap with amount, unit price, and USD value.
 */
export declare function legsToTradeActions(legs: SwapLeg[], ctx: {
    txHash: string;
    wallet: string;
    blockTime: number;
    candles?: any[];
    debug?: boolean;
    log?: (...args: any[]) => void;
}): TradeAction[];
//# sourceMappingURL=actions.d.ts.map