/**
 * TokenToWsolStrategy
 * -------------------
 * Reconstructs swap legs where the user sells a fungible token (non-WSOL) and receives WSOL.
 *
 * Core idea
 * - We match by WSOL inflow: for each WSOL credit into a user wallet/ATA, we search nearby
 *   for the user's token debits (outs) that funded it.
 *
 * Windowing
 * - If `windowAroundIn` is provided, select outs with |seq(out) - seq(in)| <= windowAroundIn.
 * - Else, fall back to look-back only: out.seq < in.seq && (in.seq - out.seq) <= windowTotalFromOut.
 *
 * Tagging
 * - Edges tagged "fee" are excluded from OUT candidates.
 *
 * Modes
 * - aggregateOuts=false: pick the single biggest out.
 * - aggregateOuts=true : sum all outs in the window.
 */
import { WSOL_MINT } from "../types.js";
export class TokenToWsolStrategy {
    constructor() {
        this.name = "TokenToWsol";
    }
    match(edges, userTokenAccounts, userWallets, opts) {
        const { windowTotalFromOut = 400, windowAroundIn = 200, debug = false, log = () => { }, tags, aggregateOuts = false, } = opts ?? {};
        const dbg = (...a) => {
            if (debug)
                log(`[${this.name}]`, ...a);
        };
        // ---------------------
        // OUTS = user token debits (non-WSOL)
        // ---------------------
        const outs = edges
            .filter((e) => e.mint !== WSOL_MINT &&
            userTokenAccounts.has(e.source) &&
            userWallets.includes(e.authority ?? "") &&
            (tags?.get(e.seq) ?? "normal") !== "fee")
            .sort((a, b) => a.seq - b.seq);
        // ---------------------
        // INS = WSOL credits INTO user (wallet or ATA), not signed by user
        // ---------------------
        const ins = edges
            .filter((e) => e.mint === WSOL_MINT &&
            (userTokenAccounts.has(e.destination) ||
                userWallets.includes(e.destination ?? "")) &&
            !userWallets.includes(e.authority ?? ""))
            .sort((a, b) => a.seq - b.seq);
        dbg("candidates", { outs: outs.length, ins: ins.length });
        if (!outs.length || !ins.length)
            return [];
        const legs = [];
        const usedOut = new Set();
        for (const inn of ins) {
            // Try to resolve the receiving wallet for this WSOL inflow:
            // - if destination is a wallet address, use it
            // - if destination is only a token account, we would need an ATA→wallet map
            const receiverWallet = userWallets.find((w) => w === inn.destination) ??
                (userTokenAccounts.has(inn.destination ?? "") ? inn.destination ?? "" : "");
            // Without a receiver wallet, we cannot safely match in multi-wallet mode
            if (!receiverWallet) {
                dbg("Skip IN (cannot resolve receiver wallet)", {
                    inSeq: inn.seq,
                    destination: inn.destination,
                });
                continue;
            }
            let windowOuts;
            if (typeof windowAroundIn === "number") {
                // Symmetric window around the WSOL IN
                windowOuts = outs.filter((o) => {
                    if (usedOut.has(o.seq))
                        return false;
                    if (Math.abs(o.seq - inn.seq) > windowAroundIn)
                        return false;
                    return true;
                });
            }
            else {
                // Look-back window only
                windowOuts = outs.filter((o) => {
                    if (usedOut.has(o.seq))
                        return false;
                    if (o.seq >= inn.seq)
                        return false;
                    const d = inn.seq - o.seq;
                    return d <= windowTotalFromOut && o.authority === receiverWallet;
                });
            }
            if (!windowOuts.length) {
                dbg("No matching OUTs for IN", {
                    inSeq: inn.seq,
                    inAmount: inn.amount,
                    receiverWallet,
                });
                continue;
            }
            if (aggregateOuts) {
                // Sum all outs in the window
                const soldMint = windowOuts[0].mint;
                const total = windowOuts.reduce((sum, o) => {
                    usedOut.add(o.seq);
                    return sum + o.amount;
                }, 0);
                const userWallet = windowOuts.length > 0
                    ? windowOuts.reduce((a, b) => a.amount >= b.amount ? a : b).authority || ""
                    : receiverWallet;
                legs.push({
                    userWallet,
                    soldMint,
                    soldAmount: total,
                    boughtMint: WSOL_MINT,
                    boughtAmount: inn.amount,
                    path: [...windowOuts, inn],
                });
            }
            else {
                // Single biggest out
                const best = windowOuts.reduce((a, b) => a.amount >= b.amount ? a : b);
                usedOut.add(best.seq);
                legs.push({
                    userWallet: best.authority || receiverWallet,
                    soldMint: best.mint,
                    soldAmount: best.amount,
                    boughtMint: WSOL_MINT,
                    boughtAmount: inn.amount,
                    path: [best, inn],
                });
            }
        }
        dbg("legs", legs);
        return legs;
    }
}
//# sourceMappingURL=TokenToWsolStrategy.js.map