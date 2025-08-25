import { WSOL_MINT } from "../types.js";
import { findSolHubsByAuthority } from "../matching/utils.js";
export class AggregatorHubStrategy {
    constructor() {
        this.name = "AggregatorHub";
    }
    match(edges, userTokenAccounts, userWallet, opts) {
        const { windowOutToSolIn = 120, windowHubToUserIn = 120, windowTotalFromOut = 400, debug = true, log = (..._args) => { }, tags, } = opts ?? {};
        const dbg = (...args) => {
            if (debug)
                log("[AggregatorHub]", ...args);
        };
        const legs = [];
        // OUTs: user → hub (non-WSOL)
        const userOuts = edges.filter((e) => userTokenAccounts.has(e.source) &&
            e.authority === userWallet &&
            e.mint !== WSOL_MINT);
        // INs: hub → user (non-WSOL, authority ≠ user)
        const userIns = edges.filter((e) => userTokenAccounts.has(e.destination) &&
            e.authority !== userWallet &&
            e.mint !== WSOL_MINT);
        const hubs = findSolHubsByAuthority(edges, userWallet, { debug });
        dbg("Candidates collected", {
            totalEdges: edges.length,
            userOuts: userOuts.length,
            userIns: userIns.length,
            hubs: hubs.size,
        });
        if (!userOuts.length || !hubs.size)
            return [];
        for (const out of userOuts) {
            dbg("Processing user OUT", {
                seq: out.seq,
                source: out.source,
                mint: out.mint,
                amount: out.amount,
            });
            // Step 1: find SOL IN candidates after the user out (choose the earliest)
            const solInCandidates = [];
            for (const [hubAcc, h] of hubs) {
                const solIn = h.inEdges.find((e) => e.seq > out.seq && e.seq - out.seq <= windowOutToSolIn);
                if (solIn)
                    solInCandidates.push({ hub: hubAcc, solIn });
            }
            dbg("SOL IN candidates", solInCandidates.map((c) => ({
                hub: c.hub,
                seq: c.solIn.seq,
                amount: c.solIn.amount,
            })));
            if (!solInCandidates.length)
                continue;
            solInCandidates.sort((a, b) => (a.solIn.seq - out.seq) - (b.solIn.seq - out.seq));
            const { hub } = solInCandidates[0];
            const h = hubs.get(hub);
            // Step 2: find user IN candidates within total window
            const candidatesUserIn = userIns.filter((inn) => inn.seq > out.seq &&
                inn.seq - out.seq <= windowTotalFromOut &&
                inn.mint !== out.mint);
            dbg("User IN candidates", candidatesUserIn.map((i) => ({
                seq: i.seq,
                mint: i.mint,
                amount: i.amount,
            })));
            // Build pairs: each inn with ALL hub SOL outs around it (drop dust)
            const allPairs = [];
            for (const inn of candidatesUserIn) {
                let around = h.outEdges.filter((e) => Math.abs(e.seq - inn.seq) <= windowHubToUserIn);
                if (tags)
                    around = around.filter((e) => tags.get(e.seq) !== "dust");
                if (!around.length)
                    continue;
                allPairs.push({ inn, solOuts: around });
            }
            dbg("All pairs SOL→token", allPairs.map((p) => ({
                solOutSeqs: p.solOuts.map((s) => s.seq),
                solOutAmtSum: p.solOuts.reduce((a, s) => a + s.amount, 0),
                innSeq: p.inn.seq,
                innAmt: p.inn.amount,
                innMint: p.inn.mint,
            })));
            // Step 3: determine upper bound for summing SOL IN (token→WSOL)
            let solUpperSeq = undefined;
            if (allPairs.length) {
                solUpperSeq = Math.max(...allPairs.flatMap((p) => p.solOuts.map((s) => s.seq)));
            }
            else {
                const firstSolOutAfterOut = h.outEdges.find((e) => e.seq > out.seq);
                if (firstSolOutAfterOut)
                    solUpperSeq = firstSolOutAfterOut.seq;
            }
            dbg("SOL upper seq determined", { solUpperSeq });
            // Step 4: leg #1 (token → WSOL)
            const inRange = (e) => e.seq > out.seq &&
                (solUpperSeq !== undefined
                    ? e.seq <= solUpperSeq
                    : e.seq - out.seq <= windowOutToSolIn);
            let solInEdges = h.inEdges.filter(inRange);
            if (tags)
                solInEdges = solInEdges.filter((e) => tags.get(e.seq) !== "dust");
            const solInSum = solInEdges.reduce((acc, e) => acc + e.amount, 0);
            legs.push({
                soldMint: out.mint,
                soldAmount: out.amount,
                boughtMint: WSOL_MINT,
                boughtAmount: solInSum,
                path: solInEdges.concat([out]),
            });
            dbg("Leg created (token→SOL)", {
                soldMint: out.mint,
                soldAmount: out.amount,
                boughtAmount: solInSum,
            });
            // Step 5: legs #2 (WSOL → token) for each pair (sum all solOuts)
            for (const { inn, solOuts } of allPairs) {
                const soldAmount = solOuts.reduce((acc, e) => acc + e.amount, 0);
                legs.push({
                    soldMint: WSOL_MINT,
                    soldAmount,
                    boughtMint: inn.mint,
                    boughtAmount: inn.amount,
                    path: [...solOuts, inn],
                });
                dbg("Leg created (SOL→token)", {
                    solOutSeqs: solOuts.map((s) => s.seq),
                    solAmount: soldAmount,
                    boughtMint: inn.mint,
                    boughtAmount: inn.amount,
                    innSeq: inn.seq,
                });
            }
        }
        // Deduplicate
        const uniq = new Map();
        for (const l of legs) {
            const k = `${l.soldMint}|${l.boughtMint}|${l.path
                .map((p) => p.seq)
                .join("-")}`;
            if (!uniq.has(k))
                uniq.set(k, l);
        }
        dbg("AggregatorHubStrategy result", { totalLegs: uniq.size });
        return [...uniq.values()];
    }
}
//# sourceMappingURL=AggregatorHubStrategy.js.map