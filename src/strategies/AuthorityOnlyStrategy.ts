import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge, WSOL_MINT } from "../types.js";

export class AuthorityOnlyStrategy implements LegStrategy {
    name = "AuthorityOnly";
  
    match(
      edges: TransferEdge[],
      userTokenAccounts: Set<string>,  
      userWallet: string,
      opts?: { windowTotalFromOut?: number; debug?: boolean; log?: (...args: any[]) => void }
    ): SwapLeg[] {
      const { windowTotalFromOut = 400, debug = true, log = () => {} } = opts ?? {};
      const dbg = (...a:any[]) => { if (debug) log("[AuthorityOnly]", ...a); };
  
      const userSolOuts = edges.filter(
        (e) => e.mint === WSOL_MINT && e.authority === userWallet
      );
  
      const tokenIns = edges.filter(
        (e) => e.mint !== WSOL_MINT && userTokenAccounts.has(e.destination)
      );
  
      if (!userSolOuts.length || !tokenIns.length) return [];
  
      const legs: SwapLeg[] = [];
      const usedIn = new Set<number>();
  
      for (const inn of tokenIns) {
        const cands = userSolOuts.filter(
          (out) => out.seq < inn.seq && (inn.seq - out.seq) <= windowTotalFromOut
        );
        if (!cands.length || usedIn.has(inn.seq)) continue;
  
        const bestOut = cands.reduce((a, b) => (a.amount >= b.amount ? a : b));
  
        legs.push({
          soldMint: WSOL_MINT,
          soldAmount: bestOut.amount,
          boughtMint: inn.mint,
          boughtAmount: inn.amount,
          path: [bestOut, inn],
        });
        usedIn.add(inn.seq);
      }
  
      const uniq = new Map<string, SwapLeg>();
      for (const leg of legs) {
        const key = `${leg.soldMint}|${leg.boughtMint}|${leg.path.map(p=>p.seq).join("-")}`;
        if (!uniq.has(key)) uniq.set(key, leg);
      }
      const result = [...uniq.values()];
      dbg("Final legs", result);
      return result;
    }
  }
  