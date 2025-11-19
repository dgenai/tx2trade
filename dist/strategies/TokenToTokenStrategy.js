import { STABLES, WSOL_MINT } from "../constants.js";
function inferType(soldMint, boughtMint) {
    const soldStable = STABLES.has(soldMint);
    const boughtStable = STABLES.has(boughtMint);
    if (!soldStable && boughtStable)
        return "sell";
    if (soldStable && !boughtStable)
        return "buy";
    return "swap";
}
export class TokenToTokenStrategy {
    constructor() {
        this.name = "TokenToTokenStrategy";
    }
    match(edges, userTokenAccounts, userWallets, opts) {
        const { debug = opts.debug || false, log = (..._args) => { }, } = opts ?? {};
        const dbg = (...args) => { if (debug)
            log(`[${this.name}]`, ...args); };
        dbg("Starting match with", edges.length, "edges");
        const netByMint = new Map();
        // ---------- 1) Compute net deltas per mint ----------
        for (const e of edges) {
            const isUserEdge = userTokenAccounts.has(e.source) ||
                userTokenAccounts.has(e.destination) ||
                userWallets.includes(e.authority ?? "");
            // Skip edges that clearly do not involve the user at all
            if (!isUserEdge) {
                continue;
            }
            // WSOL is handled by a dedicated SOL strategy (WsolToToken)
            if (e.mint === WSOL_MINT) {
                dbg("Skipping WSOL edge", { seq: e.seq, mint: e.mint, amount: e.amount });
                continue;
            }
            let delta = netByMint.get(e.mint) ?? 0n;
            // Outflow: user sends tokens OUT
            //
            // We consider it an outflow if:
            // - the source is a user-owned token account, OR
            // - the authority is one of the user wallets (direct approval).
            const isUserOut = userTokenAccounts.has(e.source) ||
                userWallets.includes(e.authority ?? "");
            if (isUserOut) {
                delta -= BigInt(Math.trunc(e.amount));
                dbg("User sent out", {
                    seq: e.seq,
                    mint: e.mint,
                    amount: e.amount,
                    newDelta: delta,
                });
            }
            // Inflow: user receives tokens IN.
            // We only trust the destination ATA as "user-owned".
            const isUserIn = userTokenAccounts.has(e.destination);
            if (isUserIn) {
                delta += BigInt(Math.trunc(e.amount));
                dbg("User received in", {
                    seq: e.seq,
                    mint: e.mint,
                    amount: e.amount,
                    newDelta: delta,
                });
            }
            netByMint.set(e.mint, delta);
        }
        dbg("Net deltas per mint", Object.fromEntries(netByMint));
        const negatives = [...netByMint.entries()].filter(([_, d]) => d < 0n);
        const positives = [...netByMint.entries()].filter(([_, d]) => d > 0n);
        if (!negatives.length || !positives.length) {
            dbg("No valid legs found");
            return [];
        }
        // Largest negative balance → main sold mint
        const [soldMint, soldDelta] = negatives.reduce((a, b) => -a[1] > -b[1] ? a : b);
        // Largest positive balance → main bought mint
        const [boughtMint, boughtDelta] = positives.reduce((a, b) => b[1] > a[1] ? a : b);
        const inferredType = inferType(soldMint, boughtMint);
        dbg("Match found", {
            soldMint,
            soldAmount: Number(-soldDelta),
            boughtMint,
            boughtAmount: Number(boughtDelta),
            type: inferredType,
        });
        // ---------- 2) Rebuild path for this swap ----------
        //
        // We collect:
        // - all user outflows for soldMint
        // - all user inflows for boughtMint
        // and sort them by seq.
        const path = [];
        for (const e of edges) {
            if (e.mint === WSOL_MINT)
                continue; // kept out of this strategy
            const isSoldOut = e.mint === soldMint &&
                (userTokenAccounts.has(e.source) ||
                    userWallets.includes(e.authority ?? ""));
            const isBoughtIn = e.mint === boughtMint &&
                userTokenAccounts.has(e.destination);
            if (isSoldOut || isBoughtIn) {
                path.push(e);
            }
        }
        path.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        dbg("Path edges", path.map(e => ({
            seq: e.seq,
            mint: e.mint,
            amount: e.amount,
            src: e.source,
            dst: e.destination,
        })));
        // ---------- 3) Infer user wallet ----------
        //
        // Prefer a sold edge with a user authority (direct approval),
        // otherwise fall back to the first user wallet if any.
        const soldEdgeForWallet = path.find((e) => e.mint === soldMint &&
            userWallets.includes(e.authority ?? "")) ?? path.find((e) => e.mint === soldMint &&
            userTokenAccounts.has(e.source));
        const userWallet = (soldEdgeForWallet && userWallets.find((w) => w === soldEdgeForWallet.authority)) ||
            userWallets[0] ||
            "";
        const legs = [
            {
                soldMint,
                soldAmount: Number(-soldDelta),
                boughtMint,
                boughtAmount: Number(boughtDelta),
                path,
                userWallet,
            },
        ];
        dbg("Returning legs", legs);
        return legs;
    }
}
//# sourceMappingURL=TokenToTokenStrategy.js.map