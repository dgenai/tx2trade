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
import { SwapLeg, TransferEdge, WSOL_MINT } from "../types.js";

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

export class TokenToWsolStrategy implements LegStrategy {
  name = "TokenToWsol";

  match(
    edges: TransferEdge[],
    userTokenAccounts: Set<string>,
    userWallet: string,
    opts: MatchOpts
  ): SwapLeg[] {
    const {
      windowTotalFromOut = 400,
      windowAroundIn = 200,              // <-- NEW
      debug = opts.debug || false,
      log = () => {},
      tags,
      aggregateOuts = false,
    } = (opts ?? {}) as MatchOpts;

    const dbg = (...a: any[]) => { if (debug) log(`[${this.name}]`, ...a); };

    // OUTs: user-signed debits of non-WSOL tokens from user-owned token accounts (exclude explicit fees)
    const outs = edges
      .filter(
        (e) =>
          e.mint !== WSOL_MINT &&
          userTokenAccounts.has(e.source) &&
          e.authority === userWallet &&
          (tags?.get(e.seq) ?? "normal") !== "fee"
      )
      .sort((a, b) => a.seq - b.seq);

    // INs: WSOL credits into user ATS (typically authority != user)
    const ins = edges
    .filter(
      (e) =>
        e.mint === WSOL_MINT &&
        (userTokenAccounts.has(e.destination) || e.destination === userWallet) &&
        e.authority !== userWallet
    )
    .sort((a, b) => a.seq - b.seq);

    dbg("candidates", { outs: outs.length, ins: ins.length });
    if (!outs.length || !ins.length) return [];

    const legs: SwapLeg[] = [];
    const usedOut = new Set<number>();

    for (const inn of ins) {
      let windowOuts: TransferEdge[];

      if (typeof windowAroundIn === "number") {

        windowOuts = outs.filter(
          (o) => !usedOut.has(o.seq) && Math.abs(o.seq - inn.seq) <= windowAroundIn
        );
      } else {
       
        windowOuts = outs.filter(
          (o) => !usedOut.has(o.seq) && o.seq < inn.seq && inn.seq - o.seq <= windowTotalFromOut
        );
      }

      if (!windowOuts.length) continue;

      if (aggregateOuts) {

        const soldMint = windowOuts[0].mint;
        const total = windowOuts.reduce((sum, o) => {
          usedOut.add(o.seq);
          return sum + o.amount;
        }, 0);

        legs.push({
          soldMint,
          soldAmount: total,
          boughtMint: WSOL_MINT,
          boughtAmount: inn.amount,
          path: [...windowOuts, inn],
        });
      } else {

        const best = windowOuts.reduce((a, b) => (a.amount >= b.amount ? a : b));
        usedOut.add(best.seq);

        legs.push({
          soldMint: best.mint,
          soldAmount: best.amount,
          boughtMint: WSOL_MINT,
          boughtAmount: inn.amount,
          path: [best, inn],
        });
      }
    }

    dbg("legs", legs);
    return legs;
  }
}
