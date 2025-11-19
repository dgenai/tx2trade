import { SwapLeg, TransferEdge } from "../types.js";
export declare class ProxyVaultSwapStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallets: string[], opts?: {
        debug?: boolean;
        log?: (...a: any[]) => void;
    }): SwapLeg[];
}
//# sourceMappingURL=ProxyVaultSwapStrategy.d.ts.map