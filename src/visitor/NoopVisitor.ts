import { InstructionVisitor, VisitContext } from "./InstructionVisitor.js";

/**
 * Fallback visitor.
 * Always supports any instruction, but does nothing.
 * Useful for ensuring that every instruction is at least "handled".
 */
export class NoopVisitor implements InstructionVisitor {
  supports(_ix: any) {
    return true; // always matches
  }

  visit(ix: any, ctx: VisitContext) {
    const log = ctx.log ?? ((..._args: any[]) => {});

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
