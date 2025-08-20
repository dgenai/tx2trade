import { SwapLeg, TransferEdge } from "../types.js";
import { buildEdgesAndIndex } from "../parsing/buildEdgesAndIndex.js";
import { extractUserTokenAccounts } from "../parsing/accountIndex.js";
import { LegStrategy } from "../strategies/LegStrategy.js";
import { AggregatorHubStrategy } from "../strategies/AggregatorHubStrategy.js";
import { TokenToTokenStrategy } from "../strategies/TokenToTokenStrategy.js";
import { WsolToTokenStrategy } from "../strategies/WsolToTokenStrategy.js";
import { AuthorityOnlyStrategy } from "../strategies/AuthorityOnlyStrategy.js";
import { TokenToWsolStrategy } from "../strategies/TokenToWsolStrategy.js";

type Options = {
  /**
   * Tolerance windows used by strategies to reconcile flows and amounts.
   * Strategy implementations decide how to use these windows.
   */
  windowOutToSolIn?: number;
  windowHubToUserIn?: number;
  windowTotalFromOut?: number;

  /**
   * Kept for backward compatibility.
   * Some strategies may enforce that the user is the authority for "out" transfers.
   */
  requireAuthorityUserForOut?: boolean;

  /** Enable verbose, structured logs for debugging. */
  debug?: boolean;
};

/**
 * Convert a parsed Solana transaction into a sequence of "swap legs".
 *
 * High-level pipeline:
 *  1) Parse the transaction to low-level transfer edges.
 *  2) Infer the user's token accounts (from tx + explicit authority hits).
 *  3) Run a strategy pipeline; the first strategy that matches returns its legs.
 *  4) If no strategy matches, return an empty list.
 *
 * Notes:
 * - The pipeline order matters. Earlier strategies express stronger / more specific intent.
 * - `opts.*` windows are passed down to strategies; they decide how to use them.
 */
export function transactionToSwapLegs_SOLBridge(
  tx: any,
  userWallet: string,
  opts?: Options
): SwapLeg[] {
  const {
    debug = true,
    windowOutToSolIn,
    windowHubToUserIn,
    windowTotalFromOut,
    requireAuthorityUserForOut,
  } = opts ?? {};

  const log = (...args: any[]) => {
    if (debug) console.debug("[txToLegs]", ...args);
  };

  // 1) Build graph edges & indices from the transaction
  const { edges } = buildEdgesAndIndex(tx, { debug: opts?.debug });
    log("Edges built:", { count: edges.length });
  if (!edges.length) {
    log("No edges found. Returning empty legs.");
    return [];
  }

  // 2) Determine user token accounts from pre/post balances and authorities
  const userTokenAccounts = extractUserTokenAccounts(tx, userWallet);
  // If an edge authority equals the user, consider its source as "user-controlled"
  for (const e of edges) {
    if (e.authority === userWallet) userTokenAccounts.add(e.source);
  }
  log("User token accounts collected:", { count: userTokenAccounts.size });

  // 3) Strategy pipeline — order is important
  const pipeline: LegStrategy[] = [
    new AggregatorHubStrategy(),
    new TokenToTokenStrategy(),
    new WsolToTokenStrategy(),
    new AuthorityOnlyStrategy(),
    new TokenToWsolStrategy(),
  ];

  log("Options forwarded to strategies:", {
    windowOutToSolIn,
    windowHubToUserIn,
    windowTotalFromOut,
    requireAuthorityUserForOut,
  });

  // 4) Try strategies in order; first that returns legs wins
  for (const strat of pipeline) {
    const name = strat.constructor?.name ?? "UnknownStrategy";
    log(`Trying strategy: ${name}`);

    const legs = strat.match(edges, userTokenAccounts, userWallet, {
      windowOutToSolIn,
      windowHubToUserIn,
      windowTotalFromOut,
      requireAuthorityUserForOut,
      debug,
    });

    log(`Strategy result: ${name}`, { legs: legs.length });

    if (legs.length) {
      log(`✅ Matched strategy: ${name} -> returning ${legs.length} legs`);
      return legs;
    }
  }

  // 5) No strategy matched
  log("❗ No strategy matched. Returning empty legs.");
  return [];
}
