import { SwapLeg, TransferEdge } from "../types.js";
export interface LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallet: string[], opts: any): SwapLeg[];
}
//# sourceMappingURL=LegStrategy.d.ts.map