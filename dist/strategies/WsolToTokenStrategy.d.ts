import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
export declare class WsolToTokenStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallet: string, opts?: {
        windowTotalFromOut?: number;
        windowSolAfterIn?: number;
        debug?: boolean;
        log?: (...args: any[]) => void;
    }): SwapLeg[];
}
//# sourceMappingURL=WsolToTokenStrategy.d.ts.map