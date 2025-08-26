import { TokAccInfo, TransferEdge } from "../types.js";
export interface VisitContext {
    seq: {
        v: number;
    };
    depth: number;
    accountIndex: Map<string, TokAccInfo>;
    pushEdge: (e: TransferEdge) => void;
    noteAccount: (addr: string, info: Partial<TokAccInfo>) => void;
    debug?: boolean;
    log?: (...args: any[]) => void;
    groups?: Array<{
        index: number;
        startSeq: number;
        endSeq: number;
        outerProgramId?: string;
    }>;
}
export interface InstructionVisitor {
    supports(ix: any): boolean;
    visit(ix: any, ctx: VisitContext): void;
}
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
export declare function applyVisitors(tx: any, visitors: InstructionVisitor[], ctx: VisitContext): void;
//# sourceMappingURL=InstructionVisitor.d.ts.map