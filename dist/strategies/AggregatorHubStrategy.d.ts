import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
export declare class AggregatorHubStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallets: string[], opts?: {
        debug?: boolean;
        log?: (...args: any[]) => void;
    }): SwapLeg[];
}
//# sourceMappingURL=AggregatorHubStrategy.d.ts.map