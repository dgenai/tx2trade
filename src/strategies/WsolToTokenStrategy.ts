import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge, WSOL_MINT } from "../types.js";

export class WsolToTokenStrategy implements LegStrategy {
  name = "WsolToToken";

  match(
    edges: TransferEdge[],
    userTokenAccounts: Set<string>,
    userWallet: string,
    opts?: { windowTotalFromOut?: number; debug?: boolean; log?: (...args: any[]) => void }
  ): SwapLeg[] {
    const {
      windowTotalFromOut = 400,
      debug = true,
      log = (..._args: any[]) => {},
    } = opts ?? {};

    const dbg = (...args: any[]) => { if (debug) log(`[${this.name}]`, ...args); };

    dbg("Starting strategy with", edges.length, "edges");

    const userSolOuts = edges.filter(
      (e) => e.mint === WSOL_MINT && e.authority === userWallet && userTokenAccounts.has(e.source)
    );
    const userTokenIns = edges.filter(
      (e) => e.mint !== WSOL_MINT && userTokenAccounts.has(e.destination) && e.authority !== userWallet
    );

    dbg("Collected candidates", {
      userSolOuts: userSolOuts.length,
      userTokenIns: userTokenIns.length,
    });

    if (!userSolOuts.length || !userTokenIns.length) {
      dbg("No matching outs or ins, skipping");
      return [];
    }

    const legs: SwapLeg[] = [];
    const usedIn = new Set<number>();

    for (const inn of userTokenIns) {
      const candidates = userSolOuts.filter(
        (out) => out.seq < inn.seq && inn.seq - out.seq <= windowTotalFromOut
      );

      dbg("Candidates for inn", { innSeq: inn.seq, count: candidates.length });

      if (!candidates.length) continue;

      const bestOut = candidates.reduce((a, b) => (a.amount >= b.amount ? a : b));
      if (usedIn.has(inn.seq)) continue;

      legs.push({
        soldMint: WSOL_MINT,
        soldAmount: bestOut.amount,
        boughtMint: inn.mint,
        boughtAmount: inn.amount,
        path: [bestOut, inn],
      });

      usedIn.add(inn.seq);

      dbg("Leg created", {
        soldAmount: bestOut.amount,
        boughtAmount: inn.amount,
        soldMint: WSOL_MINT,
        boughtMint: inn.mint,
        outSeq: bestOut.seq,
        inSeq: inn.seq,
      });
    }

    dbg("Final legs", legs);
    return legs;
  }
}
