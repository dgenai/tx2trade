import { buildAccountIndexSkeleton } from "./accountIndex.js";
import { applyVisitors } from "../visitor/InstructionVisitor.js";
import { TokenVisitor } from "../visitor/TokenVisitor.js";
import { AssociatedTokenVisitor } from "../visitor/AssociatedTokenVisitor.js";
import { NoopVisitor } from "../visitor/NoopVisitor.js";
import { SystemVisitor } from "../visitor/SystemVisitor.js";
/**
 * Build the transfer edges and account index from a parsed Solana transaction.
 *
 * Steps:
 *  1) Initialize containers
 *  2) Prepare VisitContext
 *  3) Apply instruction visitors (Token, ATA, Noop)
 *  4) Sort edges by sequence and return
 */
export function buildEdgesAndIndex(tx, opts) {
    const { debug = false } = opts ?? {};
    const log = (...args) => { if (debug)
        console.debug("[buildEdgesAndIndex]", ...args); };
    // Step 1: containers
    const edges = [];
    const accountIndex = buildAccountIndexSkeleton(tx, { debug: true });
    log("Initialized account index", { size: accountIndex.size });
    // Step 2: VisitContext
    const ctx = {
        seq: { v: 0 },
        depth: 0,
        currentIxIndex: 1,
        accountIndex,
        pushEdge: (e) => {
            // push edge normally
            edges.push(e);
            if (opts?.debug)
                console.debug("[Edge pushed]", e);
        },
        noteAccount: (addr, info) => {
            const cur = accountIndex.get(addr) ?? { mint: "", decimals: undefined, owner: undefined };
            const merged = { ...cur, ...info };
            accountIndex.set(addr, merged);
            if (opts?.debug)
                console.debug("[Account updated]", { addr, merged });
        },
        debug: opts?.debug,
        log: (...args) => { if (opts?.debug)
            console.debug("[Visitor]", ...args); },
    };
    // Step 3: apply visitors
    const visitors = [
        new TokenVisitor(),
        new AssociatedTokenVisitor(),
        new SystemVisitor(),
        new NoopVisitor(),
    ];
    log("Applying visitors");
    applyVisitors(tx, visitors, ctx);
    // Step 4: finalize
    edges.sort((a, b) => a.seq - b.seq);
    log("Completed", { edges: edges.length, accounts: accountIndex.size });
    return { edges, accountIndex };
}
//# sourceMappingURL=buildEdgesAndIndex.js.map