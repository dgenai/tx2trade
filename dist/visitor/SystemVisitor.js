import { WSOL_MINT } from "../constants.js";
/**
 * SystemVisitor
 *
 * Handles Solana **System Program** instructions (`transfer`, `transferWithSeed`).
 * Converts native SOL transfers into synthetic WSOL edges so they can be
 * integrated into the unified swap/trade flow graph.
 */
export class SystemVisitor {
    /**
     * Check if this visitor supports the given instruction.
     * Matches SystemProgram by program name or programId.
     */
    supports(ix) {
        return ix?.program === "system" || ix?.programId === SystemVisitor.SYS_ID;
    }
    /**
     * Visit a SystemProgram instruction and push transfer edges into the context.
     *
     * Supported:
     * - transfer
     * - transferWithSeed
     *
     * @param ix  Parsed instruction
     * @param ctx Visit context (edge collector, logging, sequence counter)
     */
    visit(ix, ctx) {
        const log = ctx.log ?? ((..._a) => { });
        const p = ix?.parsed;
        if (!p)
            return;
        // Handle common transfer instructions
        if (p.type === "transfer" || p.type === "transferWithSeed") {
            const info = p.info ?? {};
            const source = info.source ?? info.fromPubkey ?? info.from ?? info.authority ?? undefined;
            const destination = info.destination ?? info.toPubkey ?? info.to ?? undefined;
            const lamports = Number(info.lamports ?? info.amount ?? info.difference ?? 0);
            if (!source || !destination)
                return;
            if (!Number.isFinite(lamports) || lamports <= 0)
                return;
            const amount = lamports / 1e9; // convert lamports → SOL
            // Push synthetic WSOL edge to unify with SPL-based flows
            ctx.pushEdge({
                seq: ctx.seq.v++,
                source,
                destination,
                mint: WSOL_MINT,
                amount,
                authority: source,
                programId: ix?.programId,
                depth: ctx.depth,
                decimals: 9
            });
            if (ctx.debug) {
                log("[SystemVisitor] transfer", {
                    source,
                    destination,
                    lamports,
                    amountSOL: amount,
                    depth: ctx.depth,
                });
            }
        }
        else if (ctx.debug) {
            log("[SystemVisitor] unsupported system instr", { type: p.type });
        }
    }
}
SystemVisitor.SYS_ID = "11111111111111111111111111111111"; // SystemProgram ID
//# sourceMappingURL=SystemVisitor.js.map