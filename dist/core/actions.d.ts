import { SwapLeg, TradeAction } from "../types.js";
/**
 * Convert swap legs into high-level trade actions, enriched with USD pricing.
 */
export declare function legsToTradeActions(legs: SwapLeg[], ctx: {
    txHash: string;
    wallets: string[];
    blockTime: number;
    candles?: any[];
    debug?: boolean;
    log?: (...args: any[]) => void;
}): TradeAction[];
//# sourceMappingURL=actions.d.ts.map