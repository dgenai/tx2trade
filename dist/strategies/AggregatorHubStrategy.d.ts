import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
export declare class AggregatorHubStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallets: string[], opts: {
        windowOutToSolIn?: number;
        windowHubToUserIn?: number;
        windowTotalFromOut?: number;
        debug?: boolean;
        log?: (...args: any[]) => void;
        tags?: Map<number, "fee" | "dust" | "normal">;
    }): SwapLeg[];
}
//# sourceMappingURL=AggregatorHubStrategy.d.ts.map