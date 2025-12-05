import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
import { WSOL_MINT } from "../types.js"; // or "../constants.js" depending on your project

export class AggregatorHubStrategy implements LegStrategy {
  name = "AggregatorHub";

  match(
    edges: TransferEdge[],
    userTokenAccounts: Set<string>,
    userWallets: string[],
    opts?: { debug?: boolean; log?: (...args: any[]) => void }
  ): SwapLeg[] {
    const debug = opts?.debug ?? false;
    const log = opts?.log ?? (() => {});
    const dbg = (...msg: any[]) => debug && log("[AggregatorHub]", ...msg);

    if (!edges.length) return [];

    const sorted = [...edges].sort((a, b) => a.seq - b.seq);

    const isUser = (addr?: string | null) =>
      !!addr && (userWallets.includes(addr) || userTokenAccounts.has(addr));

    const MIN = 1e-12;

    // ------------------------------------------------------------
    // 1) Build per-mint user↔pool flows
    //
    // For each mint, we compute:
    //   - out: user → pool
    //   - in : pool → user
    //
    // We only consider edges where *either* source or destination
    // involves the user (wallet or token account). All pure
    // internal router/pool edges are ignored here.
    // ------------------------------------------------------------
    type Flow = { in: number; out: number };
    const flows = new Map<string, Flow>();

    const reg = (mint: string) => {
      if (!flows.has(mint)) flows.set(mint, { in: 0, out: 0 });
      return flows.get(mint)!;
    };

    for (const e of sorted) {
      const srcU = isUser(e.source);
      const dstU = isUser(e.destination);

      if (!srcU && !dstU) continue; // ignore pure noise/router edges

      const f = reg(e.mint);

      if (srcU && !dstU) {
        // user -> pool
        f.out += e.amount;
      } else if (!srcU && dstU) {
        // pool -> user
        f.in += e.amount;
      }
    }

    const mintStats = [...flows.entries()]
      .map(([mint, f]) => ({ mint, ...f, net: f.in - f.out }))
      .filter(x => x.in > MIN || x.out > MIN);

    dbg("mintStats", mintStats);

    if (!mintStats.length) return [];

    // Track which mints appear anywhere in the edges (router + user)
    const allMintsInEdges = new Set<string>(sorted.map(e => e.mint));
    const userWallet = userWallets[0] ?? "";

    // Helper: is there a user-facing WSOL flow?
    const wsolUserFlow = mintStats.find(m => m.mint === WSOL_MINT);

    // Helper: estimate a WSOL pivot amount *from raw edges only*.
    // Used only in the trivial case (1 sold / 1 bought / no pivot)
    // when WSOL does not appear as a user mint.
    const estimateSolPivotFromEdges = (): number => {
      if (!allMintsInEdges.has(WSOL_MINT)) return 0;

      const solEdges = sorted.filter(e => e.mint === WSOL_MINT);
      if (!solEdges.length) return 0;

      const DUST = 1e-9;
      const filtered = solEdges.filter(e => Number(e.amount ?? 0) > DUST);
      if (!filtered.length) return 0;

      let max = 0;
      for (const e of filtered) {
        const v = Number(e.amount ?? 0);
        if (v > max) max = v;
      }
      return max;
    };

    // ------------------------------------------------------------
    // 2) Identify sold / bought / pivot mints
    //
    // - sold  : net out (user gives more than receives)
    // - bought: net in  (user receives more than gives)
    // - pivot : roughly in == out (intermediate asset for multi-leg)
    // ------------------------------------------------------------
    let sold = mintStats.filter(m => m.out > m.in + MIN);
    let bought = mintStats.filter(m => m.in > m.out + MIN);
    let pivot = mintStats.filter(
      m =>
        Math.abs(m.in - m.out) <= MIN &&
        m.in > MIN &&
        m.out > MIN
    );

    dbg("sold", sold, "bought", bought, "pivot", pivot);

    // ------------------------------------------------------------
    // 2.a Simple case: 1 sold, 1 bought
    //
    // Normally this is a single-leg trade: user sells one mint and
    // buys another.
    //
    // PATCH: if there is internal WSOL activity (in edges) but no
    // WSOL user-flow (no WSOL mint in mintStats), we treat this as
    // a TOKEN → WSOL → TOKEN trade and return TWO legs:
    //   legSell: TOKEN_sold → WSOL
    //   legBuy : WSOL      → TOKEN_bought
    //
    // This is only applied in this trivial case to avoid breaking
    // more complex routes like token → SOL → pivot token → SOL → token.
    // ------------------------------------------------------------
    if (sold.length === 1 && bought.length === 1) {
      const s = sold[0];
      const b = bought[0];

      const hasWSOLInEdges = allMintsInEdges.has(WSOL_MINT);
      const hasWSOLUserFlow = !!wsolUserFlow;

      // Only try WSOL decomposition if:
      //  - WSOL appears in raw edges, AND
      //  - WSOL is NOT already a user-facing mint (no mintStats entry).
      if (hasWSOLInEdges && !hasWSOLUserFlow) {
        const solPivot = estimateSolPivotFromEdges();
        const MIN_SOL_PIVOT = 1e-7;

        if (solPivot > MIN_SOL_PIVOT) {
          const legSell: SwapLeg = {
            soldMint: s.mint,
            soldAmount: s.out,
            boughtMint: WSOL_MINT,
            boughtAmount: solPivot,
            userWallet,
            path: sorted,
          };

          const legBuy: SwapLeg = {
            soldMint: WSOL_MINT,
            soldAmount: solPivot,
            boughtMint: b.mint,
            boughtAmount: b.in,
            userWallet,
            path: sorted,
          };

          dbg("WSOL pivot decomposition (TOKEN→WSOL→TOKEN)", {
            legSell,
            legBuy,
          });

          // Two legs:
          // - legSell -> will map to a SELL action (token -> SOL)
          // - legBuy  -> will map to a BUY  action (SOL  -> token)
          return [legSell, legBuy];
        }
      }

      // Default: single TOKEN → TOKEN leg (original behavior)
      return [
        {
          soldMint: s.mint,
          soldAmount: s.out,
          boughtMint: b.mint,
          boughtAmount: b.in,
          userWallet,
          path: sorted,
        },
      ];
    }

    // ------------------------------------------------------------
    // 3) Double-leg case with pivot (3 mints: sold, pivot, bought)
    //
    // Typical pattern:
    //   token A -> pivot (e.g. SOL or a stable)
    //   pivot   -> token B
    //
    // Here we split into two SwapLegs:
    //   leg1: A -> pivot
    //   leg2: pivot -> B
    // ------------------------------------------------------------
    if (
      sold.length === 1 &&
      bought.length === 1 &&
      pivot.length === 1
    ) {
      const s = sold[0];
      const b = bought[0];
      const p = pivot[0];

      const mid = Math.min(p.in, p.out);

      const leg1: SwapLeg = {
        soldMint: s.mint,
        soldAmount: s.out,
        boughtMint: p.mint,
        boughtAmount: mid,
        userWallet,
        path: sorted,
      };

      const leg2: SwapLeg = {
        soldMint: p.mint,
        soldAmount: mid,
        boughtMint: b.mint,
        boughtAmount: b.in,
        userWallet,
        path: sorted,
      };

      return [leg1, leg2];
    }

    // ------------------------------------------------------------
    // 4) Fallback: pick the strongest sold / bought flows
    //
    // This is used when we don't have a clear pivot, but we still
    // see at least one sold and one bought mint. We take the biggest
    // out-flow as "sold" and the biggest in-flow as "bought".
    //
    // Example: multiple mints touched, noisy routing, etc.
    // ------------------------------------------------------------
    if (sold.length >= 1 && bought.length >= 1) {
      sold.sort((a, b) => b.out - a.out);
      bought.sort((a, b) => b.in - a.in);

      const s = sold[0];
      const b = bought[0];

      return [
        {
          soldMint: s.mint,
          soldAmount: s.out,
          boughtMint: b.mint,
          boughtAmount: b.in,
          userWallet,
          path: sorted,
        },
      ];
    }

    // ------------------------------------------------------------
    // No meaningful trade detected
    // ------------------------------------------------------------
    return [];
  }
}
