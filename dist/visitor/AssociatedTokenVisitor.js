export class AssociatedTokenVisitor {
    supports(ix) {
        return (ix?.program === "spl-associated-token-account" ||
            ix?.programId === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    }
    visit(ix, ctx) {
        const log = ctx.log ?? ((..._args) => { });
        const p = ix?.parsed;
        if (!p)
            return;
        if (p.type === "createIdempotent") {
            const a = p.info?.account;
            const w = p.info?.wallet;
            const m = p.info?.mint;
            if (a) {
                ctx.noteAccount(a, { owner: w, mint: m });
                if (ctx.debug) {
                    log("[AssociatedTokenVisitor] createIdempotent → noted account", {
                        account: a,
                        wallet: w,
                        mint: m,
                        depth: ctx.depth,
                    });
                }
            }
        }
        else if (ctx.debug) {
            log("[AssociatedTokenVisitor] Unsupported ATA instruction", {
                type: p.type,
                depth: ctx.depth,
            });
        }
    }
}
//# sourceMappingURL=AssociatedTokenVisitor.js.map