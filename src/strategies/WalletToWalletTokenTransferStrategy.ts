import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge, WSOL_MINT } from "../types.js";

/**
 * Strategy: detect SPL token transfers initiated by the user that
 * are sent to a sequence of intermediary "gateway" wallets.
 *
 * This captures multi-edge outbound flows that belong to the same
 * logical transfer (e.g. multiple send instructions produced by a router,
 * gateway, or service wallet).
 */
export class WalletToWalletTokenTransferStrategy implements LegStrategy {
  name = "WalletToGatewayTransfer";

  match(
    edges: TransferEdge[],
    userTokenAccounts: Set<string>,
    userWallet: string,
    opts: {
      debug?: boolean;
      log?: (...args: any[]) => void;
      tags?: Map<number, "fee" | "dust" | "normal" | "tip">;
      windowSeq?: number; // window for clustering gateway edges
    }
  ): SwapLeg[] {
    const {
      debug = false,
      log = () => {},
      tags,
      windowSeq = 40, // reasonable default window for multiple gateway sends
    } = opts ?? {};

    const dbg = (...args: any[]) => {
      if (debug) log("[WalletToGatewayTransfer]", ...args);
    };

    const legs: SwapLeg[] = [];

    // Step 1: collect candidate user-out edges (excluding WSOL)
    const userOuts = edges.filter((e) =>
      tags?.get(e.seq) === "normal" &&
      e.authority === userWallet &&
      userTokenAccounts.has(e.source) &&
      !userTokenAccounts.has(e.destination) &&
      e.mint !== WSOL_MINT &&
      e.amount > 0
    );

    if (!userOuts.length) return [];

    dbg("User-out candidates", userOuts.map(e => ({
      seq: e.seq, mint: e.mint, amount: e.amount, to: e.destination
    })));

    // Step 2: group contiguous edges per mint within sequence window
    const visited = new Set<number>();

    for (const e of userOuts) {
      if (visited.has(e.seq)) continue;

      const cluster: TransferEdge[] = [e];
      visited.add(e.seq);

      // Cluster neighbors of same mint within seq window
      for (const other of userOuts) {
        if (visited.has(other.seq)) continue;
        if (other.mint !== e.mint) continue;

        if (Math.abs(other.seq - e.seq) <= windowSeq) {
          cluster.push(other);
          visited.add(other.seq);
        }
      }

      // Sort cluster by seq
      cluster.sort((a, b) => a.seq - b.seq);

      const totalAmount = cluster.reduce((acc, x) => acc + x.amount, 0);

      dbg("Gateway cluster detected", {
        mint: e.mint,
        totalAmount,
        seqs: cluster.map(x => x.seq),
        destinations: cluster.map(x => x.destination),
      });

      // Build the outbound leg
      const leg: SwapLeg = {
        soldMint: e.mint,
        soldAmount: totalAmount,
        boughtMint: "",
        boughtAmount: 0,
        path: cluster,
      };

      legs.push(leg);
    }

    dbg("Produced legs", { count: legs.length });

    return legs;
  }
}
