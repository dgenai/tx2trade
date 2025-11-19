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
 * New engine:
 * - multi-pass
 * - no short-circuit (do not return on first match)
 * - consume used edges so subsequent strategies don’t reuse them
 */
export declare function transactionToSwapLegs_SOLBridge(sig: string, tx: any, userWallets: string[], opts: Options): SwapLeg[];
export {};
//# sourceMappingURL=transactionToSwapLegs.d.ts.map