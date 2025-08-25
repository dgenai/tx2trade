import { TransferEdge } from "../types.js";
export type SolHub = {
    account: string;
    inEdges: TransferEdge[];
    outEdges: TransferEdge[];
};
export declare function findSolHubsByAuthority(edges: TransferEdge[], userWallet: string, opts?: {
    debug?: boolean;
    log?: (...args: any[]) => void;
}): Map<string, SolHub>;
//# sourceMappingURL=utils.d.ts.map