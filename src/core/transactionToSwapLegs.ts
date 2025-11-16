import { SwapLeg, TransferEdge } from "../types.js";
import { buildEdgesAndIndex } from "../parsing/buildEdgesAndIndex.js";
import { extractUserTokenAccounts } from "../parsing/accountIndex.js";
import { LegStrategy } from "../strategies/LegStrategy.js";
import { AggregatorHubStrategy } from "../strategies/AggregatorHubStrategy.js";
import { TokenToTokenStrategy } from "../strategies/TokenToTokenStrategy.js";
import { WsolToTokenStrategy } from "../strategies/WsolToTokenStrategy.js";
import { AuthorityOnlyStrategy } from "../strategies/AuthorityOnlyStrategy.js";
import { TokenToWsolStrategy } from "../strategies/TokenToWsolStrategy.js";
import { WalletToWalletTokenTransferStrategy } from "../strategies/WalletToWalletTokenTransferStrategy.js";
import { ProxyVaultSwapStrategy } from "../strategies/ProxyVaultSwapStrategy.js";

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
type EdgeTag = "fee" | "dust" | "normal" | "tip";

// Local fallback for WSOL mint (import from your types if available)


// Convert an edge amount to lamports (only meaningful for WSOL)
function toLamports(e: TransferEdge): number {
  return e.mint === WSOL_MINT ? Math.round(e.amount * 10 ** WSOL_DECIMALS) : 0;
}

function sumSol(edges: TransferEdge[]) {
  return edges.reduce((acc, e) => acc + e.amount, 0); // already in SOL units
}



// EdgeTag = "fee" | "dust" | "normal" | "tip"

function tagEdgesForFeesDust(
  edges: TransferEdge[],
  userWallet: string,
  {
    minWsolLamports = 100_000, // 0.0001 SOL
    dustRelPct = 0.005,        // 0.5% of max flow per mint
    clusterWindowSeq = 120,    // +- window to cluster WSOL outs around a token IN
  }: { minWsolLamports?: number; dustRelPct?: number; clusterWindowSeq?: number }
): Map<number, EdgeTag> {
  const tags = new Map<number, EdgeTag>();
  const maxByMint = new Map<string, number>();

  for (const e of edges) {
    maxByMint.set(e.mint, Math.max(maxByMint.get(e.mint) ?? 0, e.amount));
  }

  for (const e of edges) {
    const isDustAbsWsol = e.mint === WSOL_MINT && toLamports(e) < minWsolLamports;
    const maxMint = maxByMint.get(e.mint) ?? 0;
    const isDustRel = maxMint > 0 && e.amount < maxMint * dustRelPct;
    tags.set(e.seq, isDustAbsWsol || isDustRel ? "dust" : "normal");
  }

  const wsolUser = edges
    .filter(e => e.mint === WSOL_MINT && e.authority === userWallet)
    .sort((a, b) => a.seq - b.seq);

  for (let i = 0; i < wsolUser.length; i++) {
    const a = wsolUser[i];
    const group: TransferEdge[] = [];
    for (let j = i + 1; j < wsolUser.length; j++) {
      const b = wsolUser[j];
      if (b.seq - a.seq > 30) break;
      const almostEqual = Math.abs(toLamports(b) - toLamports(a)) <= 10;
      if (almostEqual) group.push(b);
    }
    if (group.length >= 2) {
      tags.set(a.seq, "fee");
      for (const g of group) tags.set(g.seq, "fee");
    }
  }

  const wsolNonChecked = edges
    .filter((e: any) => e.mint === WSOL_MINT && e.authority === userWallet && e.checked === false)
    .sort((a, b) => a.seq - b.seq);

  const hasSignificantCheckedNearby = (baseSeq: number) =>
    edges.some((e: any) =>
      e.mint === WSOL_MINT &&
      e.authority === userWallet &&
      e.checked === true &&
      Math.abs(e.seq - baseSeq) <= 60 &&
      toLamports(e) >= 300_000 // >= 0.0003 SOL
    );

  for (const e of wsolNonChecked) {
    const lam = toLamports(e);
    if (hasSignificantCheckedNearby(e.seq)) {
      tags.set(e.seq, "fee");
    } else if (lam > 0 && lam <= 2_000_000) {
      tags.set(e.seq, "tip"); // <= 0.002 SOL
    } else if (lam > 0 && lam <= 10_000_000) {
      tags.set(e.seq, "fee"); // 0.002–0.01 SOL
    }
  }

  const tokenIns = edges
    .filter(e => e.mint !== WSOL_MINT && e.authority !== userWallet) 
    .sort((a, b) => a.seq - b.seq);

  for (const inn of tokenIns) {
    const outs = edges.filter(
      e =>
        e.mint === WSOL_MINT &&
        e.authority === userWallet &&
        Math.abs(e.seq - inn.seq) <= clusterWindowSeq
    );
    if (!outs.length) continue;


    let core = outs[0];
    for (const o of outs) {
      if (toLamports(o) > toLamports(core)) core = o;
    }
    tags.set(core.seq, "normal");


    for (const o of outs) {
      if (o.seq === core.seq) continue;
      const cur = tags.get(o.seq);
      if (cur === "fee" || cur === "tip") continue;
      const lam = toLamports(o);
      if (lam <= 2_000_000) tags.set(o.seq, "tip");
      else tags.set(o.seq, "fee");
    }
  }


  for (const e of edges) {
    if (e.mint === WSOL_MINT) continue;                 
    if (tags.get(e.seq) !== "normal") continue;         

    const amount = e.amount;
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const maxMint = maxByMint.get(e.mint) ?? 0;
    if (!(maxMint > 0)) continue;

    const ratio = amount / maxMint;
    if (ratio > 0.02) continue;                         

    const destReceivesMint = edges.filter(
      ed => ed.destination === e.destination && ed.mint === e.mint
    );
    const destSendsMint = edges.filter(
      ed => ed.source === e.destination && ed.mint === e.mint
    );

    const isSink = destReceivesMint.length === 1 && destSendsMint.length === 0;
    const isUserPaying = e.authority === userWallet;

    if (isSink && isUserPaying) {
      tags.set(e.seq, "fee");
    }
  }

  return tags;
}



function attachFeesAndNetsToLegs({
  tx, legs, edges, tags, userWallet, windowSeq = 200,
}: {
  tx: any;
  legs: SwapLeg[];
  edges: TransferEdge[];
  tags: Map<number, "fee" | "dust" | "normal" | "tip">;
  userWallet: string;
  windowSeq?: number;
}): void {
  const LAMPORTS_PER_SOL = 1e9;
  const networkFee = Number(tx?.meta?.fee ?? 0) / LAMPORTS_PER_SOL;

  const isSolDelta = (e: TransferEdge) => {
    const s = String((e as any).source ?? "");
    const d = String((e as any).destination ?? "");
    return s.startsWith("sol:delta") || d.startsWith("sol:delta") || (e as any).synthetic === true;
  };

  const forceClass = (e: TransferEdge, t?: "fee"|"dust"|"normal"|"tip") => {
    const depth = (e as any).depth ?? 0;
    if (depth === 0) return "tip";
    return t ?? "normal";
  };

  for (const leg of legs) {
    if (!leg.path?.length) continue;

    const seqs = leg.path.map(p => p.seq);
    const minSeq = Math.min(...seqs);
    const maxSeq = Math.max(...seqs);

    const isBuy  = leg.soldMint   === WSOL_MINT; // SOL -> token
    const isSell = leg.boughtMint === WSOL_MINT; // token -> SOL

    const wsolUserOuts = edges.filter((e: TransferEdge) =>
      e.mint === WSOL_MINT &&
      e.authority === userWallet &&        
      !isSolDelta(e) &&                    
      e.seq >= (minSeq - windowSeq) &&
      e.seq <= (maxSeq + windowSeq)
    );

    let core = 0, router = 0, tip = 0;
    const fb = {
      core:   [] as {seq:number; amount:number}[],
      router: [] as {seq:number; amount:number}[],
      tip:    [] as {seq:number; amount:number}[],
    };

    if (isBuy) {
      for (const e of wsolUserOuts) {
        const t0 = tags.get(e.seq);
        const t  = forceClass(e, t0);
        if (t === "tip")        { tip    += e.amount; fb.tip.push({seq:e.seq, amount:e.amount}); }
        else if (t === "fee")   { router += e.amount; fb.router.push({seq:e.seq, amount:e.amount}); }
        else /* normal */       { core   += e.amount; fb.core.push({seq:e.seq, amount:e.amount}); }
      }

      const transfersOnly = core + router + tip;

      leg.soldCore      = core || undefined;
      leg.routerFees    = router || undefined;
      leg.tip           = tip || undefined;
      leg.networkFee    = networkFee || undefined;
      leg.transfersOnly = transfersOnly || undefined;
      leg.soldAllIn     = (transfersOnly + networkFee) || undefined;

    } else if (isSell) {
    
      for (const e of wsolUserOuts) {
        const t0 = tags.get(e.seq);
        const t  = forceClass(e, t0);
        if (t === "tip")      { tip    += e.amount; fb.tip.push({seq:e.seq, amount:e.amount}); }
        else /* fee/normal */ { router += e.amount; fb.router.push({seq:e.seq, amount:e.amount}); }
      }

      leg.soldCore   = undefined;
      leg.routerFees = router || undefined;
      leg.tip        = tip || undefined;
      leg.networkFee = networkFee || undefined;
      // (optional) (leg as any).grossSol = Number(leg.boughtAmount ?? 0) + router + tip + networkFee;
    }

    if (fb.core.length || fb.router.length || fb.tip.length) {
      leg.feeBreakdown = fb;
    }
  }
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
  const { edges, accountIndex } = buildEdgesAndIndex(tx, { debug });
  

  log("Edges built:", { count: edges.length });

  pushUserSolDeltaEdge(tx, edges, userWallet);




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
  new AggregatorHubStrategy(),       // 1 : match AMM Jupiter / pump
  new ProxyVaultSwapStrategy(),      // 2 : match vault authority swap
  new TokenToTokenStrategy(),        // 3 : simple token-to-token
  new WsolToTokenStrategy(),         // 4 : WSOL → Token
  new TokenToWsolStrategy(),         // 5 : Token → WSOL
  new WalletToWalletTokenTransferStrategy(), // 6 : transfer direct
  new AuthorityOnlyStrategy(),       // 7 : fallback
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

      let cleanEdges: TransferEdge[] = edges.filter(
        (e: TransferEdge) => !used.has(e.seq) && tags.get(e.seq) !== "fee" && tags.get(e.seq) !== "tip"
      );

  

  // exclude dust for AuthorityOnly
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

  attachFeesAndNetsToLegs({
    tx,
    legs: allLegs,
    edges,
    tags,
    userWallet,
  });

  return allLegs;
}
