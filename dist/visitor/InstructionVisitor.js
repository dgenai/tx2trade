/**
 * Apply a sequence of InstructionVisitors to all instructions in a transaction.
 *
 * Steps:
 *  1) Traverse top-level instructions
 *  2) Traverse inner instructions (depth = 1)
 *  3) For each instruction, find the first visitor that supports it
 *     - If none match, fallback to the last visitor (usually NoopVisitor)
 *
 * Logging:
 *  - Controlled by ctx.debug / ctx.log
 */
export function applyVisitors(tx, visitors, ctx) {
    const log = ctx.log ?? ((..._args) => { });
    // Step 1: Top-level instructions
    for (const ix of tx?.transaction?.message?.instructions ?? []) {
        const v = visitors.find((vv) => vv.supports(ix)) ?? visitors[visitors.length - 1];
        log("Top-level instruction handled by", v.constructor?.name ?? "UnknownVisitor");
        v.visit(ix, ctx);
    }
    // Step 2: Inner instructions
    for (const inner of tx?.meta?.innerInstructions ?? []) {
        for (const ix of inner?.instructions ?? []) {
            ctx.depth = 1;
            const v = visitors.find((vv) => vv.supports(ix)) ?? visitors[visitors.length - 1];
            log("Inner instruction handled by", v.constructor?.name ?? "UnknownVisitor");
            v.visit(ix, ctx);
        }
    }
}
//# sourceMappingURL=InstructionVisitor.js.map