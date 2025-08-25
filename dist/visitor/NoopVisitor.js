/**
 * Fallback visitor.
 * Always supports any instruction, but does nothing.
 * Useful for ensuring that every instruction is at least "handled".
 */
export class NoopVisitor {
    supports(_ix) {
        return true; // always matches
    }
    visit(ix, ctx) {
        const log = ctx.log ?? ((..._args) => { });
        if (ctx.debug) {
            log("[NoopVisitor] Ignoring instruction", {
                program: ix?.program,
                programId: ix?.programId,
                type: ix?.parsed?.type,
                depth: ctx.depth,
            });
        }
        // does nothing else
    }
}
//# sourceMappingURL=NoopVisitor.js.map