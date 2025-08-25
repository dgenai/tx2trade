import { buildEdgesAndIndex } from "../parsing/buildEdgesAndIndex.js";
import { extractUserTokenAccounts } from "../parsing/accountIndex.js";
import { AggregatorHubStrategy } from "../strategies/AggregatorHubStrategy.js";
import { TokenToTokenStrategy } from "../strategies/TokenToTokenStrategy.js";
import { WsolToTokenStrategy } from "../strategies/WsolToTokenStrategy.js";
import { AuthorityOnlyStrategy } from "../strategies/AuthorityOnlyStrategy.js";
import { TokenToWsolStrategy } from "../strategies/TokenToWsolStrategy.js";
// Local fallback for WSOL mint (import from your types if available)
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const WSOL_DECIMALS = 9;
// Convert an edge amount to lamports (only meaningful for WSOL)
function toLamports(e) {
    return e.mint === WSOL_MINT ? Math.round(e.amount * 10 ** WSOL_DECIMALS) : 0;
}
// Minimal, robust fee/dust tagging.
// - Absolute WSOL dust threshold
// - Relative dust per mint based on the largest transfer for that mint
// - Small pattern for repeated WSOL user fees (same amounts in a tight window)
function tagEdgesForFeesDust(edges, userWallet, { minWsolLamports = 100000, // ~0.0001 SOL
dustRelPct = 0.005, // 0.5% of the max flow per mint
 }) {
    const tags = new Map();
    const maxByMint = new Map();
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
        const group = [];
        for (let j = i + 1; j < wsolUser.length; j++) {
            const b = wsolUser[j];
            if (b.seq - a.seq > 30)
                break; // tight window
            const almostEqual = Math.abs(toLamports(b) - toLamports(a)) <= 10; // ~few lamports
            if (almostEqual)
                group.push(b);
        }
        if (group.length >= 2) {
            tags.set(a.seq, "fee");
            for (const g of group)
                tags.set(g.seq, "fee");
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
export function transactionToSwapLegs_SOLBridge(tx, userWallet, opts) {
    const { debug = true, windowOutToSolIn, windowHubToUserIn, windowTotalFromOut, requireAuthorityUserForOut, minWsolLamports = 100000, dustRelPct = 0.005, maxPasses = 6, } = opts ?? {};
    const log = (...args) => {
        if (debug)
            console.debug("[txToLegs]", ...args);
    };
    // 1) Build edges from the transaction
    const { edges } = buildEdgesAndIndex(tx, { debug });
    log("Edges built:", { count: edges.length });
    if (!edges.length)
        return [];
    // 2) Collect user token accounts from balances + authorities
    const userTokenAccounts = extractUserTokenAccounts(tx, userWallet);
    for (const e of edges) {
        if (e.authority === userWallet)
            userTokenAccounts.add(e.source);
    }
    log("User token accounts:", { count: userTokenAccounts.size });
    // 3) Tag fees/dust so they don’t pollute strategies
    const tags = tagEdgesForFeesDust(edges, userWallet, {
        minWsolLamports,
        dustRelPct,
    });
    // 4) Strategy pipeline (order = priority)
    const pipeline = [
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
        requireAuthorityUserForOut,
        debug,
        log: (...a) => log(...a),
        tags,
    };
    const used = new Set(); // consumed edge seqs
    const allLegs = [];
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
            let cleanEdges = edges.filter((e) => !used.has(e.seq) && tags.get(e.seq) !== "fee");
            // Pour AuthorityOnly, exclure aussi la poussière
            if (name === "AuthorityOnly") {
                cleanEdges = cleanEdges.filter((e) => tags.get(e.seq) !== "dust");
            }
            if (!cleanEdges.length)
                continue;
            log(`Trying strategy: ${name} on ${cleanEdges.length} edges`);
            // Each strategy can return multiple legs
            const legs = strat.match(cleanEdges, userTokenAccounts, userWallet, commonOpts) ?? [];
            if (!legs.length) {
                log(`Strategy result: ${name} -> 0 legs`);
                continue;
            }
            // Accept only legs whose edges are all still free
            const accepted = [];
            for (const leg of legs) {
                const seqs = (leg.path ?? []).map((e) => e.seq);
                if (seqs.length === 0)
                    continue;
                if (seqs.some((s) => used.has(s)))
                    continue;
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
//# sourceMappingURL=transactionToSwapLegs.js.map