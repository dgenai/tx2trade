import { InstructionVisitor, VisitContext } from "./InstructionVisitor.js";
import { WSOL_MINT, NSOL_MINT } from "../constants.js";


export class SystemVisitor implements InstructionVisitor {
  private static SYS_ID = "11111111111111111111111111111111";

  supports(ix: any) {
    return ix?.program === "system" || ix?.programId === SystemVisitor.SYS_ID;
  }

  visit(ix: any, ctx: VisitContext) {
    const log = ctx.log ?? ((..._a: any[]) => {});
    const p = ix?.parsed;
    if (!p) return;

    // On couvre les cas courants
    if (p.type === "transfer" || p.type === "transferWithSeed") {
      const info = p.info ?? {};
      const source =
        info.source ?? info.fromPubkey ?? info.from ?? info.authority ?? undefined;
      const destination =
        info.destination ?? info.toPubkey ?? info.to ?? undefined;
      const lamports =
        Number(info.lamports ?? info.amount ?? info.difference ?? 0);

      if (!source || !destination) return;
      if (!Number.isFinite(lamports) || lamports <= 0) return;

      const amount = lamports / 1e9; // SOL

      ctx.pushEdge({
        seq: ctx.seq.v++,
        source,
        destination,
        mint: WSOL_MINT,
        amount,
        authority: source,
        programId: ix?.programId,
        depth: ctx.depth,
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
    } else if (ctx.debug) {
      log("[SystemVisitor] unsupported system instr", { type: p.type });
    }
  }
}
