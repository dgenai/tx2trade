import { TransferEdge, TokAccInfo } from "../types.js";
/**
 * Build the transfer edges and account index from a parsed Solana transaction.
 *
 * Steps:
 *  1) Initialize containers
 *  2) Prepare VisitContext
 *  3) Apply instruction visitors (Token, ATA, Noop)
 *  4) Sort edges by sequence and return
 */
export declare function buildEdgesAndIndex(tx: any, opts?: {
    debug?: boolean;
}): {
    edges: TransferEdge[];
    accountIndex: Map<string, TokAccInfo>;
};
//# sourceMappingURL=buildEdgesAndIndex.d.ts.map