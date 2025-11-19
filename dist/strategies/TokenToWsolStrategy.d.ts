/**
 * TokenToWsolStrategy
 * -------------------
 * Reconstructs swap legs where the user sells a fungible token (non-WSOL) and receives WSOL.
 *
 * Core idea
 * - We match by WSOL inflow: for each WSOL credit into a user wallet/ATA, we search nearby
 *   for the user's token debits (outs) that funded it.
 *
 * Windowing
 * - If `windowAroundIn` is provided, select outs with |seq(out) - seq(in)| <= windowAroundIn.
 * - Else, fall back to look-back only: out.seq < in.seq && (in.seq - out.seq) <= windowTotalFromOut.
 *
 * Tagging
 * - Edges tagged "fee" are excluded from OUT candidates.
 *
 * Modes
 * - aggregateOuts=false: pick the single biggest out.
 * - aggregateOuts=true : sum all outs in the window.
 */
import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
type MatchOpts = {
    windowTotalFromOut?: number;
    windowAroundIn?: number;
    debug?: boolean;
    log?: (...args: any[]) => void;
    tags?: Map<number, "fee" | "dust" | "normal">;
    aggregateOuts?: boolean;
};
export declare class TokenToWsolStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallets: string[], opts: MatchOpts): SwapLeg[];
}
export {};
//# sourceMappingURL=TokenToWsolStrategy.d.ts.map