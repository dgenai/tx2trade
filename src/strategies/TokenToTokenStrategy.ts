import { TransferEdge, SwapLeg } from "../types.js";
import { LegStrategy } from "./LegStrategy.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Set des stablecoins que tu considères comme "base currency"
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

function inferType(soldMint: string, boughtMint: string): "buy" | "sell" | "swap" {
  const soldStable = STABLES.has(soldMint);
  const boughtStable = STABLES.has(boughtMint);

  if (!soldStable && boughtStable) return "sell";
  if (soldStable && !boughtStable) return "buy";
  return "swap";
}

export class TokenToTokenStrategy implements LegStrategy {
  name = "TokenToTokenStrategy";

  match(
    edges: TransferEdge[],
    userTokenAccounts: Set<string>,
    userWallet: string,
    opts?: { debug?: boolean; log?: (...args: any[]) => void }
  ): SwapLeg[] {
    const {
      debug = true,
      log = (..._args: any[]) => {},
    } = opts ?? {};

    const dbg = (...args: any[]) => { if (debug) log(`[${this.name}]`, ...args); };

    dbg("Starting match with", edges.length, "edges");

    const netByMint = new Map<string, bigint>();

    for (const e of edges) {
      if (!userTokenAccounts.has(e.source) && !userTokenAccounts.has(e.destination)) continue;

      if (e.mint === WSOL_MINT) {
        dbg("Skipping WSOL edge", { seq: e.seq, mint: e.mint, amount: e.amount });
        continue; // ignore WSOL wrap/unwrap
      }

      let delta = netByMint.get(e.mint) ?? 0n;

      if (userTokenAccounts.has(e.source) && e.authority === userWallet) {
        delta -= BigInt(Math.trunc(e.amount));
        dbg("User sent out", { mint: e.mint, amount: e.amount, newDelta: delta });
      }

      if (userTokenAccounts.has(e.destination) && e.authority !== userWallet) {
        delta += BigInt(Math.trunc(e.amount));
        dbg("User received in", { mint: e.mint, amount: e.amount, newDelta: delta });
      }

      netByMint.set(e.mint, delta);
    }

    dbg("Net deltas per mint", Object.fromEntries(netByMint));

    const negatives = [...netByMint.entries()].filter(([_, d]) => d < 0n);
    const positives = [...netByMint.entries()].filter(([_, d]) => d > 0n);

    if (!negatives.length || !positives.length) {
      dbg("No valid legs found");
      return [];
    }

    const [soldMint, soldDelta] = negatives.reduce((a, b) =>
      -a[1] > -b[1] ? a : b
    );
    const [boughtMint, boughtDelta] = positives.reduce((a, b) =>
      b[1] > a[1] ? a : b
    );

    const inferredType = inferType(soldMint, boughtMint);

    dbg("Match found", {
      soldMint,
      soldAmount: Number(-soldDelta),
      boughtMint,
      boughtAmount: Number(boughtDelta),
      type: inferredType,
    });

    const legs: SwapLeg[] = [
      {
        soldMint,
        soldAmount: Number(-soldDelta),
        boughtMint,
        boughtAmount: Number(boughtDelta),
        path: [],
      },
    ];

    dbg("Returning legs", legs);
    return legs;
  }
}
