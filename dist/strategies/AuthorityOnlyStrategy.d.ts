import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
export declare class AuthorityOnlyStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallet: string, opts: {
        windowTotalFromOut?: number;
        debug?: boolean;
        log?: (...args: any[]) => void;
    }): SwapLeg[];
}
//# sourceMappingURL=AuthorityOnlyStrategy.d.ts.map