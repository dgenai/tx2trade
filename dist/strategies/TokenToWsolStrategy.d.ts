/**
 * TokenToWsolStrategy
 * -------------------
 * Reconstructs swap legs where the user sells a fungible token (non-WSOL) and receives WSOL.
 *
 * Core idea
 * - We match *by WSOL inflow*: for each WSOL credit into a user ATA, we search nearby
 *   (symmetrically if windowAroundIn is set) for the user’s token debits (outs) that funded it.
 *
 * Windowing
 * - If `windowAroundIn` is provided, select outs with |seq(out) - seq(in)| <= windowAroundIn.
 * - Else, fall back to look-back only: out.seq < in.seq && (in.seq - out.seq) <= windowTotalFromOut.
 *
 * Tagging
 * - Edges tagged "fee" are excluded from OUT candidates. (Dust left to engine policy.)
 *
 * Modes
 * - aggregateOuts=false (default): pick the single largest qualifying token out.
 * - aggregateOuts=true : sum all qualifying outs in the window (recommended: same mint).
 */
import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
type MatchOpts = {
    /** Look-back window when windowAroundIn is not set. */
    windowTotalFromOut?: number;
    /** Symmetric window around the WSOL IN (overrides look-back if set). */
    windowAroundIn?: number;
    debug?: boolean;
    log?: (...args: any[]) => void;
    tags?: Map<number, "fee" | "dust" | "normal">;
    /** Sum all qualifying outs vs take the single largest one. */
    aggregateOuts?: boolean;
};
export declare class TokenToWsolStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallet: string, opts?: MatchOpts): SwapLeg[];
}
export {};
//# sourceMappingURL=TokenToWsolStrategy.d.ts.map