import { InstructionVisitor, VisitContext } from "./InstructionVisitor.js";
/**
 * Fallback visitor.
 * Always supports any instruction, but does nothing.
 * Useful for ensuring that every instruction is at least "handled".
 */
export declare class NoopVisitor implements InstructionVisitor {
    supports(_ix: any): boolean;
    visit(ix: any, ctx: VisitContext): void;
}
//# sourceMappingURL=NoopVisitor.d.ts.map