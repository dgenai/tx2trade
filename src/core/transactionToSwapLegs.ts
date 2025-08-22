import { SwapLeg, TransferEdge } from "../types.js";
import { buildEdgesAndIndex } from "../parsing/buildEdgesAndIndex.js";
import { extractUserTokenAccounts } from "../parsing/accountIndex.js";
import { LegStrategy } from "../strategies/LegStrategy.js";
import { AggregatorHubStrategy } from "../strategies/AggregatorHubStrategy.js";
import { TokenToTokenStrategy } from "../strategies/TokenToTokenStrategy.js";
import { WsolToTokenStrategy } from "../strategies/WsolToTokenStrategy.js";
import { AuthorityOnlyStrategy } from "../strategies/AuthorityOnlyStrategy.js";
import { TokenToWsolStrategy } from "../strategies/TokenToWsolStrategy.js";
import { WSOL_DECIMALS, WSOL_MINT } from "../constants.js";

import { pushUserSolDeltaEdge } from "../parsing/solDeltas.js";


type Options = {
  // Tolerance windows used by strategies to reconcile flows and amounts.
  // Strategy implementations decide how to use these windows.
  windowOutToSolIn?: number;
  windowHubToUserIn?: number;
  windowTotalFromOut?: number;

  // Kept for backward compatibility.
  // Some strategies may enforce that the user is the authority for "out" transfers.
  requireAuthorityUserForOut?: boolean;

  // Enable verbose, structured logs for debugging.
  debug?: boolean;

  // --- new (optional) ---
  // Absolute anti-dust threshold for WSOL in lamports.
  minWsolLamports?: number;
  // Relative anti-dust threshold per mint (e.g. 0.005 = 0.5% of the largest flow for that mint).
  dustRelPct?: number;
  // Safety cap to stop iterating passes.
  maxPasses?: number;

  windowAroundIn?: number; 
};

// Simple tag for fees/dust filtering
type EdgeTag = "fee" | "dust" | "normal";

// Local fallback for WSOL mint (import from your types if available)


// Convert an edge amount to lamports (only meaningful for WSOL)
function toLamports(e: TransferEdge): number {
  return e.mint === WSOL_MINT ? Math.round(e.amount * 10 ** WSOL_DECIMALS) : 0;
}

// Minimal, robust fee/dust tagging.
// - Absolute WSOL dust threshold
// - Relative dust per mint based on the largest transfer for that mint
// - Small pattern for repeated WSOL user fees (same amounts in a tight window)
function tagEdgesForFeesDust(
  edges: TransferEdge[],
  userWallet: string,
  {
    minWsolLamports = 100_000, // ~0.0001 SOL
    dustRelPct = 0.005,        // 0.5% of the max flow per mint
  }: { minWsolLamports?: number; dustRelPct?: number }
): Map<number, EdgeTag> {
  const tags = new Map<number, EdgeTag>();
  const maxByMint = new Map<string, number>();

  for (const e of edges) {
    maxByMint.set(e.mint, Math.max(maxByMint.get(e.mint) ?? 0, e.amount));
  }

  // 1) absolute WSOL dust + relative dust per mint
  for (const e of edges) {
    const isDustAbsWsol = e.mint === WSOL_MINT && toLamports(e) < minWsolLamports;
    const maxMint = maxByMint.get(e.mint) ?? 0;
    const isDustRel = maxMint > 0 && e.amount < maxMint * dustRelPct;

    tags.set(e.seq, isDustAbsWsol || isDustRel ? "dust" : "normal");
  }

  // 2) repeated WSOL user fees: several nearly-equal WSOL outs signed by the user in a short window
  const wsolUser = edges
    .filter((e) => e.mint === WSOL_MINT && e.authority === userWallet)
    .sort((a, b) => a.seq - b.seq);

  for (let i = 0; i < wsolUser.length; i++) {
    const a = wsolUser[i];
    const group: TransferEdge[] = [];
    for (let j = i + 1; j < wsolUser.length; j++) {
      const b = wsolUser[j];
      if (b.seq - a.seq > 30) break; // tight window
      const almostEqual = Math.abs(toLamports(b) - toLamports(a)) <= 10; // ~few lamports
      if (almostEqual) group.push(b);
    }
    if (group.length >= 2) {
      tags.set(a.seq, "fee");
      for (const g of group) tags.set(g.seq, "fee");
    }
  }

    // 3) Heuristique: fee WSOL Jupiter = transfer "non-checked" autour d'un swap avec transferChecked

  const wsolNonChecked = edges
  .filter((e: any) => e.mint === WSOL_MINT && e.authority === userWallet && e.checked === false)
  .sort((a, b) => a.seq - b.seq);

// Repère s'il existe des outs WSOL checked significatifs dans une petite fenêtre
const hasSignificantCheckedNearby = (baseSeq: number) => {
  return edges.some((e: any) =>
    e.mint === WSOL_MINT &&
    e.authority === userWallet &&
    e.checked === true &&
    Math.abs(e.seq - baseSeq) <= 60 &&     // fenêtre serrée
    toLamports(e) >= 300_000                // >= 0.0003 SOL ≈ “vrai flux de swap”
  );
};

for (const e of wsolNonChecked) {
  if (hasSignificantCheckedNearby(e.seq)) {
    tags.set(e.seq, "fee");
  }
}

  return tags;
}

/**
 * New engine:
 * - multi-pass
 * - no short-circuit (do not return on first match)
 * - consume used edges so subsequent strategies don’t reuse them
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
    minWsolLamports = 100_000,
    dustRelPct = 0.005,
    maxPasses = 6,
    windowAroundIn = 200
  } = opts ?? {};

  const log = (...args: any[]) => {
    if (debug) console.debug("[txToLegs]", ...args);
  };

  // 1) Build edges from the transaction
  const { edges } = buildEdgesAndIndex(tx, { debug });
  log("Edges built:", { count: edges.length });

  pushUserSolDeltaEdge(tx, edges, userWallet);

  console.log("edges");
  console.dir(edges, {depth:null}); 


  if (!edges.length) return [];

  // 2) Collect user token accounts from balances + authorities
  const userTokenAccounts = extractUserTokenAccounts(tx, userWallet);
  for (const e of edges) {
    if (e.authority === userWallet) userTokenAccounts.add(e.source);
  }
  userTokenAccounts.add(userWallet);
  log("User token accounts:", { count: userTokenAccounts.size });

  // 3) Tag fees/dust so they don’t pollute strategies
  const tags = tagEdgesForFeesDust(edges, userWallet, {
    minWsolLamports,
    dustRelPct,
  });

  // 4) Strategy pipeline (order = priority)
  const pipeline: LegStrategy[] = [
    new AggregatorHubStrategy(),
    new TokenToTokenStrategy(),
    new WsolToTokenStrategy(),
    new TokenToWsolStrategy(),
    new AuthorityOnlyStrategy(),
  ];

  const commonOpts = {
    windowOutToSolIn,
    windowHubToUserIn,
    windowTotalFromOut,
    windowAroundIn,
    requireAuthorityUserForOut,
    debug,
    log: (...a: any[]) => log(...a),
    tags,

  };

  const used = new Set<number>(); // consumed edge seqs
  const allLegs: SwapLeg[] = [];

  // 5) Multi-pass until no progress
  let pass = 0;
  let progress = true;

  while (progress && pass < maxPasses) {
    progress = false;
    pass++;
    log(`---- PASS ${pass} ----`);

    for (const strat of pipeline) {
      const name = strat.constructor?.name ?? "UnknownStrategy";

       // Exclure 'fee' pour tout le monde
  let cleanEdges: TransferEdge[] = edges.filter(
    (e) => !used.has(e.seq) && tags.get(e.seq) !== "fee"
  );

  // Pour AuthorityOnly, exclure aussi la poussière
  if (name === "AuthorityOnly") {
    cleanEdges = cleanEdges.filter((e) => tags.get(e.seq) !== "dust");
  }

      if (!cleanEdges.length) continue;

      log(`Trying strategy: ${name} on ${cleanEdges.length} edges`);

      // Each strategy can return multiple legs
      const legs =
        strat.match(cleanEdges, userTokenAccounts, userWallet, commonOpts) ?? [];

      if (!legs.length) {
        log(`Strategy result: ${name} -> 0 legs`);
        continue;
      }

      // Accept only legs whose edges are all still free
      const accepted: SwapLeg[] = [];
      for (const leg of legs) {
        const seqs = (leg.path ?? []).map((e) => e.seq);
        if (seqs.length === 0) continue;
        if (seqs.some((s) => used.has(s))) continue;
        accepted.push(leg);
        seqs.forEach((s) => used.add(s));
      }

      if (!accepted.length) {
        log(`Strategy ${name} produced legs but all overlapped; skipped.`);
        continue;
      }

      allLegs.push(...accepted);
      progress = true;

      log(`✅ ${name}: accepted ${accepted.length} legs (total=${allLegs.length})`);
      // Do NOT short-circuit: let other strategies run in this pass,
      // then run another pass if there is still work to do.
    }
  }

  log(`Done after ${pass} pass(es). Legs total: ${allLegs.length}`);

  return allLegs;
}
