import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge, WSOL_MINT } from "../types.js";
import { findSolHubsByAuthority } from "../matching/utils.js";

export class AggregatorHubStrategy implements LegStrategy {
  name = "AggregatorHub";

  match(
    edges: TransferEdge[],
    userTokenAccounts: Set<string>,
    userWallet: string,
    opts: {
      windowOutToSolIn?: number;
      windowHubToUserIn?: number;
      windowTotalFromOut?: number;
      debug?: boolean;
      log?: (...args: any[]) => void;
    }
  ): SwapLeg[] {
    const {
      windowOutToSolIn = 120,
      windowHubToUserIn = 120,
      windowTotalFromOut = 400,
      debug = true,
      log = (..._args: any[]) => {},
    } = opts ?? {};

    const dbg = (...args: any[]) => { if (debug) log("[AggregatorHub]", ...args); };

    const legs: SwapLeg[] = [];

    // OUTs: user → hub (non-WSOL)
    const userOuts = edges.filter(
      (e) => userTokenAccounts.has(e.source) && e.authority === userWallet && e.mint !== WSOL_MINT
    );
    // INs: hub → user (non-WSOL, authority ≠ user)
    const userIns = edges.filter(
      (e) => userTokenAccounts.has(e.destination) && e.authority !== userWallet && e.mint !== WSOL_MINT
    );

    const hubs = findSolHubsByAuthority(edges, userWallet, { debug: debug });

    dbg("Candidates collected", {
      totalEdges: edges.length,
      userOuts: userOuts.length,
      userIns: userIns.length,
      hubs: hubs.size,
    });

    if (!userOuts.length || !hubs.size) return [];

    for (const out of userOuts) {
      dbg("Processing user OUT", {
        seq: out.seq,
        source: out.source,
        mint: out.mint,
        amount: out.amount,
      });

      // Step 1: find SOL IN candidates after the user out
      const solInCandidates: Array<{ hub: string; solIn: TransferEdge }> = [];
      for (const [hubAcc, h] of hubs) {
        const solIn = h.inEdges.find(
          (e) => e.seq > out.seq && e.seq - out.seq <= windowOutToSolIn
        );
        if (solIn) solInCandidates.push({ hub: hubAcc, solIn });
      }
      dbg("SOL IN candidates", solInCandidates.map(c => ({
        hub: c.hub, seq: c.solIn.seq, amount: c.solIn.amount
      })));
      if (!solInCandidates.length) continue;

      solInCandidates.sort((a, b) => (a.solIn.seq - out.seq) - (b.solIn.seq - out.seq));
      const { hub } = solInCandidates[0];
      const h = hubs.get(hub)!;

      // Step 2: find user IN candidates within total window
      const candidatesUserIn = userIns.filter(
        (inn) => inn.seq > out.seq && inn.seq - out.seq <= windowTotalFromOut && inn.mint !== out.mint
      );
      dbg("User IN candidates", candidatesUserIn.map(i => ({
        seq: i.seq, mint: i.mint, amount: i.amount
      })));

      // Build pairs: each inn with the closest solOut around it
      const allPairs: Array<{ inn: TransferEdge; solOut: TransferEdge }> = [];
      for (const inn of candidatesUserIn) {
        const around = h.outEdges.filter((e) => Math.abs(e.seq - inn.seq) <= windowHubToUserIn);
        if (!around.length) continue;
        const closest = around.reduce((a, b) =>
          Math.abs(a.seq - inn.seq) <= Math.abs(b.seq - inn.seq) ? a : b
        );
        allPairs.push({ inn, solOut: closest });
      }
      dbg("All pairs SOL→token", allPairs.map(p => ({
        solOutSeq: p.solOut.seq, solOutAmt: p.solOut.amount,
        innSeq: p.inn.seq, innAmt: p.inn.amount, innMint: p.inn.mint
      })));

      // Step 3: determine upper bound for summing SOL IN
      let solUpperSeq: number | undefined = undefined;
      if (allPairs.length) {
        solUpperSeq = Math.max(...allPairs.map((p) => p.solOut.seq));
      } else {
        const firstSolOutAfterOut = h.outEdges.find((e) => e.seq > out.seq);
        if (firstSolOutAfterOut) solUpperSeq = firstSolOutAfterOut.seq;
      }
      dbg("SOL upper seq determined", { solUpperSeq });

      // Step 4: leg #1 (token → SOL)
      const inRange = (e: TransferEdge) =>
        e.seq > out.seq &&
        (solUpperSeq !== undefined
          ? e.seq <= solUpperSeq
          : e.seq - out.seq <= windowOutToSolIn);

      const solInEdges = h.inEdges.filter(inRange);
      const solInSum = solInEdges.reduce((acc, e) => acc + e.amount, 0);

      legs.push({
        soldMint: out.mint,
        soldAmount: out.amount,
        boughtMint: WSOL_MINT,
        boughtAmount: solInSum,
        path: solInEdges.concat([out]),
      });
      dbg("Leg created (token→SOL)", {
        soldMint: out.mint, soldAmount: out.amount, boughtAmount: solInSum
      });

      // Step 5: legs #2 (SOL → token) for each pair
      for (const { inn, solOut } of allPairs) {
        legs.push({
          soldMint: WSOL_MINT,
          soldAmount: solOut.amount,
          boughtMint: inn.mint,
          boughtAmount: inn.amount,
          path: [solOut, inn],
        });
        dbg("Leg created (SOL→token)", {
          solAmount: solOut.amount,
          boughtMint: inn.mint,
          boughtAmount: inn.amount,
          seq: { solOut: solOut.seq, inn: inn.seq },
        });
      }
    }

    // Deduplicate
    const uniq = new Map<string, SwapLeg>();
    for (const l of legs) {
      const k = `${l.soldMint}|${l.boughtMint}|${l.path.map((p) => p.seq).join("-")}`;
      if (!uniq.has(k)) uniq.set(k, l);
    }

    dbg("AggregatorHubStrategy result", { totalLegs: uniq.size });

    return [...uniq.values()];
  }
}
