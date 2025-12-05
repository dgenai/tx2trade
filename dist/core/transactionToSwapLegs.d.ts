import { SwapLeg, TransferEdge } from "../types.js";
type Options = {
    windowOutToSolIn?: number;
    windowHubToUserIn?: number;
    windowTotalFromOut?: number;
    requireAuthorityUserForOut?: boolean;
    debug?: boolean;
    minWsolLamports?: number;
    dustRelPct?: number;
    maxPasses?: number;
    windowAroundIn?: number;
};
type EdgeTag = "fee" | "dust" | "normal" | "tip";
/**
 * Classify edges as fee / dust / normal / tip.
 *
 * This is a combined absolute + relative dust filter, and then
 * a second pass that tries to identify fee/tip patterns per user wallet
 * based on WSOL flows, checked/non-checked transfers, and small sinks.
 */
export declare function tagEdgesForFeesDust(edges: TransferEdge[], userWallets: string[], { minWsolLamports, dustRelPct, clusterWindowSeq, }: {
    minWsolLamports?: number;
    dustRelPct?: number;
    clusterWindowSeq?: number;
}): Map<number, EdgeTag>;
export declare function attachFeesAndNetsToLegs({ tx, legs, edges, tags, userWallets, windowSeq, }: {
    tx: any;
    legs: SwapLeg[];
    edges: TransferEdge[];
    tags: Map<number, "fee" | "dust" | "normal" | "tip">;
    userWallets: string[];
    windowSeq?: number;
}): void;
/**
 * Transaction → SwapLegs engine for the "SOLBridge" model.
 *
 * Responsibilities:
 *  - Build token-transfer edges from a parsed transaction
 *  - Add synthetic WSOL delta edges for user wallets
 *  - Detect user token accounts
 *  - Tag edges as fee/dust/normal/tip
 *  - Run a strategy pipeline (AggregatorHub, ProxyVault, WSOL<->Token, etc.)
 *    instruction by instruction (ixIndex-based)
 *  - Attach fees and net amounts to the resulting legs
 */
export declare function transactionToSwapLegs_SOLBridge(sig: string, tx: any, userWallets: string[], opts: Options): SwapLeg[];
export {};
//# sourceMappingURL=transactionToSwapLegs.d.ts.map