import { SwapLeg } from "../types.js";
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
/**
 * New engine:
 * - multi-pass
 * - no short-circuit (do not return on first match)
 * - consume used edges so subsequent strategies don’t reuse them
 */
export declare function transactionToSwapLegs_SOLBridge(tx: any, userWallet: string, opts?: Options): SwapLeg[];
export {};
//# sourceMappingURL=transactionToSwapLegs.d.ts.map