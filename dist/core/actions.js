import { WSOL_MINT } from "../types.js";
import { blockTimeToDate } from "../utils/helpers.js";
export function legsToTradeActions(legs, ctx) {
    const { debug = false } = ctx;
    const log = ctx.log ?? ((...args) => { if (debug)
        console.debug("[legsToTradeActions]", ...args); });
    const actions = [];
    log(`Starting with ${legs.length} legs`);
    const txDate = blockTimeToDate(ctx.blockTime);
    for (const leg of legs) {
        log("Processing leg", leg);
        if (leg.soldMint === WSOL_MINT) {
            log("Detected BUY (sold WSOL)");
            actions.push({
                transactionDate: txDate,
                transactionHash: ctx.txHash,
                transactionType: "buy",
                walletAddress: ctx.wallet,
                sold: { address: WSOL_MINT, symbol: "SOL", amount: leg.soldAmount },
                bought: { address: leg.boughtMint, amount: leg.boughtAmount },
            });
        }
        else if (leg.boughtMint === WSOL_MINT) {
            log("Detected SELL (bought WSOL)");
            actions.push({
                transactionDate: txDate,
                transactionHash: ctx.txHash,
                transactionType: "sell",
                walletAddress: ctx.wallet,
                sold: { address: leg.soldMint, amount: leg.soldAmount },
                bought: { address: WSOL_MINT, symbol: "SOL", amount: leg.boughtAmount },
            });
        }
        else {
            log("Detected TOKEN ↔ TOKEN swap");
            actions.push({
                transactionDate: txDate,
                transactionHash: ctx.txHash,
                transactionType: "buy",
                walletAddress: ctx.wallet,
                sold: { address: leg.soldMint, amount: leg.soldAmount },
                bought: { address: leg.boughtMint, amount: leg.boughtAmount },
            });
        }
    }
    log(`Built ${actions.length} actions`, actions);
    return actions;
}
//# sourceMappingURL=actions.js.map