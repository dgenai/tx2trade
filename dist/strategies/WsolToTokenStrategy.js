import { WSOL_MINT } from "../types.js";
export class WsolToTokenStrategy {
    constructor() {
        this.name = "WsolToToken";
    }
    match(edges, userTokenAccounts, userWallet, opts) {
        const { windowTotalFromOut = 400, windowSolAfterIn = 50, debug = true, log = (..._args) => { }, } = opts ?? {};
        const dbg = (...args) => { if (debug)
            log(`[${this.name}]`, ...args); };
        dbg("Starting strategy with", edges.length, "edges");
        const userSolOuts = edges.filter((e) => e.mint === WSOL_MINT && e.authority === userWallet);
        const userTokenIns = edges.filter((e) => e.mint !== WSOL_MINT && userTokenAccounts.has(e.destination) && e.authority !== userWallet);
        dbg("Collected candidates", {
            userSolOuts: userSolOuts.length,
            userTokenIns: userTokenIns.length,
        });
        if (!userSolOuts.length || !userTokenIns.length) {
            dbg("No matching outs or ins, skipping");
            return [];
        }
        const legs = [];
        const usedIn = new Set();
        for (const inn of userTokenIns) {
            const before = userSolOuts.filter((out) => {
                const d = inn.seq - out.seq;
                return d > 0 && d <= windowTotalFromOut;
            });
            const after = userSolOuts.filter((out) => {
                const d = out.seq - inn.seq;
                return d > 0 && d <= windowSolAfterIn;
            });
            const candidates = before.length ? before : after;
            dbg("Candidates for inn", {
                innSeq: inn.seq,
                before: before.length,
                after: after.length,
                picked: candidates.length,
            });
            if (!candidates.length || usedIn.has(inn.seq))
                continue;
            const bestOut = candidates.reduce((a, b) => (a.amount >= b.amount ? a : b));
            legs.push({
                soldMint: WSOL_MINT,
                soldAmount: bestOut.amount,
                boughtMint: inn.mint,
                boughtAmount: inn.amount,
                path: [bestOut, inn],
            });
            usedIn.add(inn.seq);
            dbg("Leg created", {
                soldAmount: bestOut.amount,
                boughtAmount: inn.amount,
                outSeq: bestOut.seq,
                inSeq: inn.seq,
            });
        }
        dbg("Final legs", legs);
        return legs;
    }
}
//# sourceMappingURL=WsolToTokenStrategy.js.map