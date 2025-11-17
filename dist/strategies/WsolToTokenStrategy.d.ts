import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
export declare class WsolToTokenStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallet: string, opts: {
        windowTotalFromOut?: number;
        windowSolAfterIn?: number;
        windowAroundIn?: number;
        debug?: boolean;
        log?: (...args: any[]) => void;
        tags?: Map<number, "fee" | "dust" | "normal">;
        minLamportsToSum?: number;
    }): SwapLeg[];
}
//# sourceMappingURL=WsolToTokenStrategy.d.ts.map