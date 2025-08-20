import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge, WSOL_MINT } from "../types.js";

export class AuthorityOnlyStrategy implements LegStrategy {
  name = "AuthorityOnly";

  match(
    edges: TransferEdge[],
    _userTokenAccounts: Set<string>,
    userWallet: string,
    opts?: { windowTotalFromOut?: number; debug?: boolean; log?: (...args: any[]) => void }
  ): SwapLeg[] {
    const {
      windowTotalFromOut = 400,
      debug = true,
      log = (..._args: any[]) => {},
    } = opts ?? {};

    const dbg = (...args: any[]) => {
      if (debug) log("[AuthorityOnly]", ...args);
    };

    dbg("Starting strategy with", edges.length, "edges");

    // Step 1: sort user SOL outs
    const userSolOuts = edges.filter(
      (e) => e.mint === WSOL_MINT && e.authority === userWallet
    );
    const tokenIns = edges.filter((e) => e.mint !== WSOL_MINT);

    dbg("Found candidates", {
      userSolOuts: userSolOuts.length,
      tokenIns: tokenIns.length,
    });

    if (!userSolOuts.length || !tokenIns.length) {
      dbg("No matching SOL outs or token ins, skipping");
      return [];
    }

    const legs: SwapLeg[] = [];
    const usedIn = new Set<number>();

    // Step 2: match each token IN with best preceding SOL OUT
    for (const inn of tokenIns) {
      const cands = userSolOuts.filter(
        (out) => out.seq < inn.seq && inn.seq - out.seq <= windowTotalFromOut
      );
      if (!cands.length) continue;

      const bestOut = cands.reduce((a, b) =>
        a.amount >= b.amount ? a : b
      );
      if (usedIn.has(inn.seq)) continue;

      legs.push({
        soldMint: WSOL_MINT,
        soldAmount: bestOut.amount,
        boughtMint: inn.mint,
        boughtAmount: inn.amount,
        path: [bestOut, inn],
      });
      usedIn.add(inn.seq);

      dbg("Matched leg", {
        soldAmount: bestOut.amount,
        boughtMint: inn.mint,
        boughtAmount: inn.amount,
        seqs: { out: bestOut.seq, inn: inn.seq },
      });
    }

    // Step 3: dedup
    const uniq = new Map<string, SwapLeg>();
    for (const leg of legs) {
      const key = `${leg.soldMint}|${leg.boughtMint}|${leg.path
        .map((p) => p.seq)
        .join("-")}`;
      if (!uniq.has(key)) uniq.set(key, leg);
    }

    const result = [...uniq.values()];
    dbg("Final legs", result);
    return result;
  }
}
