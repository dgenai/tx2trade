import { WSOL_MINT } from "../types.js";
export class AuthorityOnlyStrategy {
    constructor() {
        this.name = "AuthorityOnly";
    }
    match(edges, userTokenAccounts, userWallet, opts) {
        const { windowTotalFromOut = 400, debug = true, log = () => { } } = opts ?? {};
        const dbg = (...a) => { if (debug)
            log("[AuthorityOnly]", ...a); };
        const userSolOuts = edges.filter((e) => e.mint === WSOL_MINT && e.authority === userWallet);
        const tokenIns = edges.filter((e) => e.mint !== WSOL_MINT && userTokenAccounts.has(e.destination));
        if (!userSolOuts.length || !tokenIns.length)
            return [];
        const legs = [];
        const usedIn = new Set();
        for (const inn of tokenIns) {
            const cands = userSolOuts.filter((out) => out.seq < inn.seq && (inn.seq - out.seq) <= windowTotalFromOut);
            if (!cands.length || usedIn.has(inn.seq))
                continue;
            const bestOut = cands.reduce((a, b) => (a.amount >= b.amount ? a : b));
            legs.push({
                soldMint: WSOL_MINT,
                soldAmount: bestOut.amount,
                boughtMint: inn.mint,
                boughtAmount: inn.amount,
                path: [bestOut, inn],
            });
            usedIn.add(inn.seq);
        }
        const uniq = new Map();
        for (const leg of legs) {
            const key = `${leg.soldMint}|${leg.boughtMint}|${leg.path.map(p => p.seq).join("-")}`;
            if (!uniq.has(key))
                uniq.set(key, leg);
        }
        const result = [...uniq.values()];
        dbg("Final legs", result);
        return result;
    }
}
//# sourceMappingURL=AuthorityOnlyStrategy.js.map