import { SwapLeg, TradeAction } from "../types.js";
export declare function legsToTradeActions(legs: SwapLeg[], ctx: {
    txHash: string;
    wallet: string;
    blockTime: number;
    debug?: boolean;
    log?: (...args: any[]) => void;
}): TradeAction[];
//# sourceMappingURL=actions.d.ts.map