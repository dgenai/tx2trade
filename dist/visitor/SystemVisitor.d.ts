import { InstructionVisitor, VisitContext } from "./InstructionVisitor.js";
/**
 * SystemVisitor
 *
 * Handles Solana **System Program** instructions (`transfer`, `transferWithSeed`).
 * Converts native SOL transfers into synthetic WSOL edges so they can be
 * integrated into the unified swap/trade flow graph.
 */
export declare class SystemVisitor implements InstructionVisitor {
    private static SYS_ID;
    /**
     * Check if this visitor supports the given instruction.
     * Matches SystemProgram by program name or programId.
     */
    supports(ix: any): boolean;
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
    visit(ix: any, ctx: VisitContext): void;
}
//# sourceMappingURL=SystemVisitor.d.ts.map