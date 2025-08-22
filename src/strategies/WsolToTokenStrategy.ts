import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge, WSOL_MINT } from "../types.js";

export class WsolToTokenStrategy implements LegStrategy {
  name = "WsolToToken";

  match(
    edges: TransferEdge[],
    userTokenAccounts: Set<string>,
    userWallet: string,
    opts?: {
      windowTotalFromOut?: number;  // max seq gap (before IN)
      windowSolAfterIn?: number;    // max seq gap (after IN)
      windowAroundIn?: number;      // NEW: symmetric window around IN
      debug?: boolean;
      log?: (...args: any[]) => void;
      tags?: Map<number, "fee" | "dust" | "normal">;
      minLamportsToSum?: number;    // threshold to ignore dust
    }
  ): SwapLeg[] {
    const {
      windowTotalFromOut = 400,
      windowSolAfterIn = 50,
      windowAroundIn, // if defined, overrides before/after with |seq(out)-seq(in)| <= windowAroundIn
      debug = true,
      log = () => {},
      tags,
      minLamportsToSum = 50_000,
    } = opts ?? {};

    // Internal debug logger
    const dbg = (...a: any[]) => { if (debug) log(`[${this.name}]`, ...a); };
    // Convert SOL to lamports (1e9 multiplier, rounded)
    const toLamports = (amt: number) => Math.round(amt * 1_000_000_000);

    // Candidate SOL outflows from user wallet
    const userSolOuts = edges.filter(
      (e) => e.mint === WSOL_MINT && e.authority === userWallet
    );

    // Candidate token inflows into user-owned accounts (authority ≠ userWallet to exclude self-transfers)
    const userTokenIns = edges.filter(
      (e) => e.mint !== WSOL_MINT && userTokenAccounts.has(e.destination) && e.authority !== userWallet
    );

    if (!userSolOuts.length || !userTokenIns.length) return [];

    const legs: SwapLeg[] = [];
    const usedIn = new Set<number>(); // avoid matching the same IN twice

    for (const inn of userTokenIns) {
      let candidates: TransferEdge[] = [];

      if (windowAroundIn !== undefined) {
        // Simple symmetric window around IN (preferred if configured)
        candidates = userSolOuts.filter(
          (out) => Math.abs(out.seq - inn.seq) <= windowAroundIn
        );
      } else {
        // Fallback: directional logic (before vs after)
        const before = userSolOuts.filter((out) => {
          const d = inn.seq - out.seq;
          return d > 0 && d <= windowTotalFromOut;
        });
        const after = userSolOuts.filter((out) => {
          const d = out.seq - inn.seq;
          return d > 0 && d <= windowSolAfterIn;
        });
        // Prefer "before" if present, else fallback to "after"
        candidates = before.length ? before : after;
      }

      if (!candidates.length || usedIn.has(inn.seq)) continue;

      // Filter out outs explicitly tagged as "fee" or "dust"
      if (tags) {
        candidates = candidates.filter((e) => {
          const t = tags.get(e.seq);
          return t !== "fee" && t !== "dust";
        });
      }

      // Prefer transferChecked edges if available (safer metadata)
      const checked = (candidates as any[]).filter((e) => e.kind === "transferChecked");
      if (checked.length) candidates = checked as any;

      // Drop residual dust values below minLamportsToSum
      const outsToSum = candidates.filter((e) => toLamports(e.amount) >= minLamportsToSum);

      // If nothing passes the threshold, fall back to the single largest out
      const setForSum =
        outsToSum.length
          ? outsToSum
          : candidates.length
            ? [candidates.reduce((a, b) => (a.amount >= b.amount ? a : b))]
            : [];

      if (!setForSum.length) continue;

      // Aggregate SOL outflow
      const soldAmount = setForSum.reduce((acc, e) => acc + e.amount, 0);

      // Build the swap leg
      legs.push({
        soldMint: WSOL_MINT,
        soldAmount,
        boughtMint: inn.mint,
        boughtAmount: inn.amount,
        path: [...setForSum, inn], // outs first, then in
      });

      // Mark this IN as consumed
      usedIn.add(inn.seq);

      dbg("Leg created", {
        inSeq: inn.seq,
        outs: setForSum.map((e) => ({ seq: e.seq, amt: e.amount })),
        soldAmount,
        boughtAmount: inn.amount,
      });
    }

    return legs;
  }
}
