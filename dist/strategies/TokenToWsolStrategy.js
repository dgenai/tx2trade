import { WSOL_MINT } from "../types.js";
export class TokenToWsolStrategy {
    constructor() {
        this.name = "TokenToWsol";
    }
    match(edges, userTokenAccounts, userWallet, opts) {
        const { windowTotalFromOut = 400, debug = true, log = (..._args) => { }, } = opts ?? {};
        const dbg = (...args) => { if (debug)
            log(`[${this.name}]`, ...args); };
        dbg("Starting strategy with", edges.length, "edges");
        const userTokenOuts = edges.filter((e) => e.mint !== WSOL_MINT &&
            userTokenAccounts.has(e.source) &&
            e.authority === userWallet);
        const userSolIns = edges.filter((e) => e.mint === WSOL_MINT &&
            userTokenAccounts.has(e.destination) &&
            e.authority !== userWallet);
        dbg("Collected candidates", {
            userTokenOuts: userTokenOuts.length,
            userSolIns: userSolIns.length,
        });
        if (!userTokenOuts.length || !userSolIns.length) {
            dbg("No matching token outs or SOL ins, skipping");
            return [];
        }
        const legs = [];
        const usedIn = new Set();
        for (const out of userTokenOuts) {
            const candidates = userSolIns.filter((inn) => inn.seq > out.seq && inn.seq - out.seq <= windowTotalFromOut);
            dbg("Candidates for out", { outSeq: out.seq, count: candidates.length });
            if (!candidates.length)
                continue;
            const bestIn = candidates.reduce((a, b) => a.amount >= b.amount ? a : b);
            if (usedIn.has(bestIn.seq))
                continue;
            legs.push({
                soldMint: out.mint,
                soldAmount: out.amount,
                boughtMint: WSOL_MINT,
                boughtAmount: bestIn.amount,
                path: [out, bestIn],
            });
            usedIn.add(bestIn.seq);
            dbg("Leg created", {
                soldMint: out.mint,
                soldAmount: out.amount,
                boughtAmount: bestIn.amount,
                outSeq: out.seq,
                inSeq: bestIn.seq,
            });
        }
        dbg("Final legs", legs);
        return legs;
    }
}
//# sourceMappingURL=TokenToWsolStrategy.js.map