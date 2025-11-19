const SOL_MINT = "So11111111111111111111111111111111111111112";
export class ProxyVaultSwapStrategy {
    constructor() {
        this.name = "ProxyVaultSwap";
    }
    match(edges, userTokenAccounts, userWallets, opts) {
        const debug = opts?.debug ?? true;
        const log = opts?.log ?? (() => { });
        const dbg = (...a) => debug && log("[ProxyVaultSwap]", ...a);
        const legs = [];
        // STEP 1 — find token IN to USER
        const tokenIns = edges.filter(e => e.mint !== SOL_MINT &&
            userTokenAccounts.has(e.destination) &&
            e.amount > 0);
        if (!tokenIns.length)
            return [];
        for (const finalIn of tokenIns) {
            dbg("FINAL TOKEN IN =", finalIn);
            const seqIn = finalIn.seq;
            // STEP 2 — find SOL OUT before token-in
            const solOut = [...edges]
                .filter(e => e.mint === SOL_MINT &&
                e.seq < seqIn &&
                e.amount > 0)
                .sort((a, b) => b.seq - a.seq)[0];
            if (!solOut) {
                dbg("NO SOL OUT");
                continue;
            }
            dbg("SOL OUT =", solOut);
            // STEP 3 — find SOL IN before solOut
            const solIn = [...edges]
                .filter(e => e.mint === SOL_MINT &&
                e.seq < solOut.seq &&
                e.amount > 0)
                .sort((a, b) => b.seq - a.seq)[0];
            if (!solIn) {
                dbg("NO SOL IN");
                continue;
            }
            dbg("SOL IN =", solIn);
            // STEP 4 — find token OUT before solIn (any mint ≠ SOL)
            const tokenOut = [...edges]
                .filter(e => e.mint !== SOL_MINT &&
                e.seq < solIn.seq &&
                e.amount > 0)
                .sort((a, b) => b.seq - a.seq)[0];
            if (!tokenOut) {
                dbg("NO TOKEN OUT");
                continue;
            }
            dbg("TOKEN OUT =", tokenOut);
            // BUILD LEGS
            legs.push({
                soldMint: tokenOut.mint,
                soldAmount: tokenOut.amount,
                boughtMint: SOL_MINT,
                boughtAmount: solIn.amount,
                path: [tokenOut, solIn],
                userWallet: tokenOut.authority || ""
            });
            legs.push({
                soldMint: SOL_MINT,
                soldAmount: solOut.amount,
                boughtMint: finalIn.mint,
                boughtAmount: finalIn.amount,
                path: [solOut, finalIn],
                userWallet: tokenOut.authority || ""
            });
        }
        return legs;
    }
}
//# sourceMappingURL=ProxyVaultSwapStrategy.js.map