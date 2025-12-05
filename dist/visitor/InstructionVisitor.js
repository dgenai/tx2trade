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
    // Fetch top-level instructions once
    const outers = tx?.transaction?.message?.instructions ?? [];
    // 1) TOP-LEVEL INSTRUCTIONS
    for (let ixIndex = 0; ixIndex < outers.length; ixIndex++) {
        const ix = outers[ixIndex];
        ctx.depth = 0;
        const v = visitors.find((vv) => vv.supports(ix)) ??
            visitors[visitors.length - 1];
        log("Top-level instruction handled by", v.constructor?.name ?? "UnknownVisitor");
        v.visit(ix, ctx);
    }
    // 2) INNER INSTRUCTION GROUPS
    ctx.groups = ctx.groups ?? [];
    for (const inner of tx?.meta?.innerInstructions ?? []) {
        const start = ctx.seq.v;
        ctx.depth = 1;
        ctx.currentIxIndex = inner.index; // <-- TAG inner group: use parent outer index
        for (const ix of inner?.instructions ?? []) {
            const v = visitors.find((vv) => vv.supports(ix)) ??
                visitors[visitors.length - 1];
            log("Inner instruction handled by", v.constructor?.name ?? "UnknownVisitor");
            v.visit(ix, ctx);
        }
        const end = ctx.seq.v;
        const outerIx = outers[inner.index];
        ctx.groups.push({
            index: inner.index,
            startSeq: start,
            endSeq: end,
            outerProgramId: outerIx?.programId,
        });
        ctx.depth = 0; // RESET IMPORTANTE
    }
}
//# sourceMappingURL=InstructionVisitor.js.map