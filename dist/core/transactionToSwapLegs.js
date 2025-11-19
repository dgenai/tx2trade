import { buildEdgesAndIndex } from "../parsing/buildEdgesAndIndex.js";
import { extractUserTokenAccounts } from "../parsing/accountIndex.js";
import { AggregatorHubStrategy } from "../strategies/AggregatorHubStrategy.js";
import { TokenToTokenStrategy } from "../strategies/TokenToTokenStrategy.js";
import { WsolToTokenStrategy } from "../strategies/WsolToTokenStrategy.js";
import { TokenToWsolStrategy } from "../strategies/TokenToWsolStrategy.js";
import { WalletToWalletTokenTransferStrategy } from "../strategies/WalletToWalletTokenTransferStrategy.js";
import { ProxyVaultSwapStrategy } from "../strategies/ProxyVaultSwapStrategy.js";
import { WSOL_DECIMALS, WSOL_MINT } from "../constants.js";
import { pushUserSolDeltaEdge } from "../parsing/solDeltas.js";
// Local fallback for WSOL mint (import from your types if available)
// Convert an edge amount to lamports (only meaningful for WSOL)
function toLamports(e) {
    return e.mint === WSOL_MINT ? Math.round(e.amount * 10 ** WSOL_DECIMALS) : 0;
}
function sumSol(edges) {
    return edges.reduce((acc, e) => acc + e.amount, 0); // already in SOL units
}
// EdgeTag = "fee" | "dust" | "normal" | "tip"
export function tagEdgesForFeesDust(edges, userWallets, { minWsolLamports = 100000, dustRelPct = 0.005, clusterWindowSeq = 120, }) {
    const tags = new Map();
    const maxByMint = new Map();
    // -----------------------------------------
    // 1) Compute max flow per mint (same logic)
    // -----------------------------------------
    for (const e of edges) {
        maxByMint.set(e.mint, Math.max(maxByMint.get(e.mint) ?? 0, e.amount));
    }
    // -----------------------------------------
    // 2) Initial dust classification
    // -----------------------------------------
    for (const e of edges) {
        const isDustAbsWsol = e.mint === WSOL_MINT && toLamports(e) < minWsolLamports;
        const maxMint = maxByMint.get(e.mint) ?? 0;
        const isDustRel = maxMint > 0 && e.amount < maxMint * dustRelPct;
        tags.set(e.seq, isDustAbsWsol || isDustRel ? "dust" : "normal");
    }
    // ============================================================
    // 3) PER-WALLET fee/tip detection (this fixes your logic)
    // ============================================================
    for (const userWallet of userWallets) {
        // --- 3a: WSOL debits signed by THIS wallet ---
        const wsolUser = edges
            .filter(e => e.mint === WSOL_MINT && e.authority === userWallet)
            .sort((a, b) => a.seq - b.seq);
        // cluster fee pattern
        for (let i = 0; i < wsolUser.length; i++) {
            const a = wsolUser[i];
            const group = [];
            for (let j = i + 1; j < wsolUser.length; j++) {
                const b = wsolUser[j];
                if (b.seq - a.seq > 30)
                    break;
                const almostEqual = Math.abs(toLamports(b) - toLamports(a)) <= 10;
                if (almostEqual)
                    group.push(b);
            }
            if (group.length >= 2) {
                tags.set(a.seq, "fee");
                for (const g of group)
                    tags.set(g.seq, "fee");
            }
        }
        // --- 3b: Non-checked WSOL → tip/fee classification (per wallet) ---
        const wsolNonChecked = edges
            .filter((e) => e.mint === WSOL_MINT &&
            e.authority === userWallet &&
            e.checked === false)
            .sort((a, b) => a.seq - b.seq);
        const hasSignificantCheckedNearby = (baseSeq) => edges.some((e) => e.mint === WSOL_MINT &&
            e.authority === userWallet &&
            e.checked === true &&
            Math.abs(e.seq - baseSeq) <= 60 &&
            toLamports(e) >= 300000);
        for (const e of wsolNonChecked) {
            const lam = toLamports(e);
            if (hasSignificantCheckedNearby(e.seq)) {
                tags.set(e.seq, "fee");
            }
            else if (lam > 0 && lam <= 2000000) {
                tags.set(e.seq, "tip");
            }
            else if (lam > 0 && lam <= 10000000) {
                tags.set(e.seq, "fee");
            }
        }
        // --- 3c: WSOL clustering around token IN (per wallet) ---
        const tokenIns = edges
            .filter(e => e.mint !== WSOL_MINT && e.authority !== userWallet)
            .sort((a, b) => a.seq - b.seq);
        for (const inn of tokenIns) {
            const outs = edges.filter(e => e.mint === WSOL_MINT &&
                e.authority === userWallet &&
                Math.abs(e.seq - inn.seq) <= clusterWindowSeq);
            if (!outs.length)
                continue;
            let core = outs[0];
            for (const o of outs) {
                if (toLamports(o) > toLamports(core))
                    core = o;
            }
            tags.set(core.seq, "normal");
            for (const o of outs) {
                if (o.seq === core.seq)
                    continue;
                const cur = tags.get(o.seq);
                if (cur === "fee" || cur === "tip")
                    continue;
                const lam = toLamports(o);
                if (lam <= 2000000)
                    tags.set(o.seq, "tip");
                else
                    tags.set(o.seq, "fee");
            }
        }
        // --- 3d: small token sinks (per wallet) ---
        for (const e of edges) {
            if (e.mint === WSOL_MINT)
                continue;
            if (tags.get(e.seq) !== "normal")
                continue;
            const amount = e.amount;
            if (!Number.isFinite(amount) || amount <= 0)
                continue;
            const maxMint = maxByMint.get(e.mint) ?? 0;
            if (!(maxMint > 0))
                continue;
            const ratio = amount / maxMint;
            if (ratio > 0.02)
                continue;
            const destReceivesMint = edges.filter(ed => ed.destination === e.destination && ed.mint === e.mint);
            const destSendsMint = edges.filter(ed => ed.source === e.destination && ed.mint === e.mint);
            const isSink = destReceivesMint.length === 1 && destSendsMint.length === 0;
            const isUserPaying = e.authority === userWallet;
            if (isSink && isUserPaying) {
                tags.set(e.seq, "fee");
            }
        }
    }
    return tags;
}
export function attachFeesAndNetsToLegs({ tx, legs, edges, tags, userWallets, windowSeq = 200, }) {
    const LAMPORTS_PER_SOL = 1e9;
    const networkFee = Number(tx?.meta?.fee ?? 0) / LAMPORTS_PER_SOL;
    const isSolDelta = (e) => {
        const s = String(e.source ?? "");
        const d = String(e.destination ?? "");
        return (s.startsWith("sol:delta") ||
            d.startsWith("sol:delta") ||
            e.synthetic === true);
    };
    const forceClass = (e, t) => {
        const depth = e.depth ?? 0;
        if (depth === 0)
            return "tip";
        return t ?? "normal";
    };
    for (const leg of legs) {
        if (!leg.path?.length)
            continue;
        // *** Correction : chaque leg porte son propre userWallet ***
        const userWallet = leg.userWallet;
        if (!userWallet)
            continue; // sécurité
        const seqs = leg.path.map((p) => p.seq);
        const minSeq = Math.min(...seqs);
        const maxSeq = Math.max(...seqs);
        const isBuy = leg.soldMint === WSOL_MINT;
        const isSell = leg.boughtMint === WSOL_MINT;
        // WSOL debits signed by *this* user
        const wsolUserOuts = edges.filter((e) => e.mint === WSOL_MINT &&
            e.authority === userWallet && // ****** FIX ICI ******/
            !isSolDelta(e) &&
            e.seq >= minSeq - windowSeq &&
            e.seq <= maxSeq + windowSeq);
        let core = 0, router = 0, tip = 0;
        const fb = {
            core: [],
            router: [],
            tip: [],
        };
        if (isBuy) {
            for (const e of wsolUserOuts) {
                const t0 = tags.get(e.seq);
                const t = forceClass(e, t0);
                if (t === "tip") {
                    tip += e.amount;
                    fb.tip.push({ seq: e.seq, amount: e.amount });
                }
                else if (t === "fee") {
                    router += e.amount;
                    fb.router.push({ seq: e.seq, amount: e.amount });
                }
                else {
                    core += e.amount;
                    fb.core.push({ seq: e.seq, amount: e.amount });
                }
            }
            const transfersOnly = core + router + tip;
            leg.soldCore = core || undefined;
            leg.routerFees = router || undefined;
            leg.tip = tip || undefined;
            leg.networkFee = networkFee || undefined;
            leg.transfersOnly = transfersOnly || undefined;
            leg.soldAllIn = transfersOnly + networkFee || undefined;
        }
        else if (isSell) {
            for (const e of wsolUserOuts) {
                const t0 = tags.get(e.seq);
                const t = forceClass(e, t0);
                if (t === "tip") {
                    tip += e.amount;
                    fb.tip.push({ seq: e.seq, amount: e.amount });
                }
                else {
                    router += e.amount;
                    fb.router.push({ seq: e.seq, amount: e.amount });
                }
            }
            leg.soldCore = undefined;
            leg.routerFees = router || undefined;
            leg.tip = tip || undefined;
            leg.networkFee = networkFee || undefined;
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
export function transactionToSwapLegs_SOLBridge(sig, tx, userWallets, opts) {
    const { debug = opts.debug || false, windowOutToSolIn, windowHubToUserIn, windowTotalFromOut, requireAuthorityUserForOut, minWsolLamports = 100000, dustRelPct = 0.005, maxPasses = 6, windowAroundIn = 200, } = opts ?? {};
    const log = (...args) => {
        if (debug)
            console.debug("[txToLegs]", ...args);
    };
    if (!userWallets || userWallets.length === 0) {
        throw new Error("transactionToSwapLegs_SOLBridge requires userWallets[]");
    }
    // -------------------------------------------
    // 1) Build edges
    // -------------------------------------------
    const { edges } = buildEdgesAndIndex(tx, { debug });
    log("Edges built:", { count: edges.length });
    // -------------------------------------------
    // 2) Synthetic WSOL delta for ALL user wallets
    // -------------------------------------------
    pushUserSolDeltaEdge(tx, edges, userWallets);
    if (!edges.length)
        return [];
    // -------------------------------------------
    // 3) Collect ALL user-owned token accounts
    // -------------------------------------------
    const userTokenAccounts = extractUserTokenAccounts(tx, userWallets);
    for (const e of edges) {
        if (e.authority && userWallets.includes(e.authority)) {
            userTokenAccounts.add(e.source);
        }
    }
    for (const w of userWallets) {
        userTokenAccounts.add(w);
    }
    log("User token accounts:", { count: userTokenAccounts.size });
    // -------------------------------------------
    // 4) Tag fees/dust using MULTI-WALLET
    // -------------------------------------------
    const tags = tagEdgesForFeesDust(edges, userWallets, {
        minWsolLamports,
        dustRelPct,
    });
    // -------------------------------------------
    // 5) Strategy pipeline
    // -------------------------------------------
    const pipeline = [
        new AggregatorHubStrategy(),
        new ProxyVaultSwapStrategy(),
        new TokenToTokenStrategy(),
        new WsolToTokenStrategy(),
        new TokenToWsolStrategy(),
        new WalletToWalletTokenTransferStrategy(),
        //new AuthorityOnlyStrategy(),
    ];
    const commonOpts = {
        windowOutToSolIn,
        windowHubToUserIn,
        windowTotalFromOut,
        windowAroundIn,
        requireAuthorityUserForOut,
        debug,
        log: (...a) => log(...a),
        tags,
    };
    const used = new Set();
    const allLegs = [];
    // -------------------------------------------
    // 6) Iterative multi-pass
    // -------------------------------------------
    let pass = 0;
    let progress = true;
    while (progress && pass < maxPasses) {
        progress = false;
        pass++;
        log(`---- PASS ${pass} ----`);
        for (const strat of pipeline) {
            const name = strat.constructor?.name ?? "UnknownStrategy";
            let cleanEdges = edges.filter((e) => !used.has(e.seq) &&
                tags.get(e.seq) !== "fee" &&
                tags.get(e.seq) !== "tip");
            if (name === "AuthorityOnly") {
                cleanEdges = cleanEdges.filter((e) => tags.get(e.seq) !== "dust");
            }
            if (!cleanEdges.length)
                continue;
            log(`Trying strategy: ${name} on ${cleanEdges.length} edges`);
            // -------------------------------------------
            // STRAT.MATCH — NOW MULTI-WALLET
            // -------------------------------------------
            const legs = strat.match(cleanEdges, userTokenAccounts, userWallets, commonOpts) ??
                [];
            if (!legs.length) {
                log(`Strategy result: ${name} -> 0 legs`);
                continue;
            }
            // Accept legs without overlapping edges
            const accepted = [];
            for (const leg of legs) {
                const seqs = (leg.path ?? []).map((e) => e.seq);
                if (!seqs.length)
                    continue;
                if (seqs.some((s) => used.has(s)))
                    continue;
                accepted.push(leg);
                seqs.forEach((s) => used.add(s));
            }
            if (!accepted.length) {
                log(`Strategy ${name} produced legs but they overlapped; skipped.`);
                continue;
            }
            allLegs.push(...accepted);
            progress = true;
            log(`✔ ${name}: accepted ${accepted.length} leg(s) (total=${allLegs.length})`);
        }
    }
    console.log(`Done after ${pass} pass(es). Legs total: ${allLegs.length}`);
    // -------------------------------------------
    // 7) Fees / net computation for MULTI-WALLET
    // -------------------------------------------
    attachFeesAndNetsToLegs({
        tx,
        legs: allLegs,
        edges,
        tags,
        userWallets,
    });
    if (allLegs.length === 0) {
        console.log(`❌ No swap legs detected for this transaction: ${sig}`);
    }
    return allLegs;
}
//# sourceMappingURL=transactionToSwapLegs.js.map