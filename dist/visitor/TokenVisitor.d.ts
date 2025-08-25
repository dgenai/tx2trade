import { InstructionVisitor, VisitContext } from "./InstructionVisitor.js";
/**
 * Visitor for SPL Token instructions.
 *
 * Supports:
 *  - transfer / transferChecked
 *  - initializeAccount / initializeAccount3
 *  - closeAccount
 *
 * Behavior:
 *  - Transfers generate TransferEdge objects pushed into the context
 *  - Initialization enriches accountIndex with mint/decimals
 *  - Closing updates owner in accountIndex
 */
export declare class TokenVisitor implements InstructionVisitor {
    supports(ix: any): boolean;
    visit(ix: any, ctx: VisitContext): void;
}
//# sourceMappingURL=TokenVisitor.d.ts.map