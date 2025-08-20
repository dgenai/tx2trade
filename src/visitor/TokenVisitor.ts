import { InstructionVisitor, VisitContext } from "./InstructionVisitor.js";
import { WSOL_MINT, num } from "../types.js";

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
export class TokenVisitor implements InstructionVisitor {
  supports(ix: any) {
    return (
      ix?.program === "spl-token" ||
      ix?.programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    );
  }

  visit(ix: any, ctx: VisitContext) {
    const log = ctx.log ?? ((..._args: any[]) => {});
    const p = ix?.parsed;
    if (!p) return;

    // Step 1: Handle transfers
    if (p.type === "transfer" || p.type === "transferChecked") {
      const info = p.info ?? {};
      const source = info.source;
      const destination = info.destination;
      if (!source || !destination) return;

      let mint: string | undefined =
        info.mint ??
        ctx.accountIndex.get(source)?.mint ??
        ctx.accountIndex.get(destination)?.mint;
      if (!mint) return;

      const decimals =
        ctx.accountIndex.get(source)?.decimals ??
        ctx.accountIndex.get(destination)?.decimals ??
        (mint === WSOL_MINT ? 9 : undefined);

      const amount: number =
        num(info?.tokenAmount?.uiAmount) ||
        (info?.amount != null
          ? decimals != null
            ? Number(info.amount) / Math.pow(10, decimals)
            : Number(info.amount)
          : 0);

      ctx.pushEdge({
        seq: ctx.seq.v++,
        source,
        destination,
        mint,
        amount,
        authority: info.authority,
        programId: ix?.programId,
        depth: ctx.depth,
      });

      if (ctx.debug) {
        log("[TokenVisitor] Transfer", {
          source,
          destination,
          mint,
          amount,
          authority: info.authority,
          depth: ctx.depth,
        });
      }
    }

    // Step 2: Handle initializeAccount / initializeAccount3
    if (p.type === "initializeAccount" || p.type === "initializeAccount3") {
      const a = p.info?.account;
      const m = p.info?.mint;
      if (a && m) {
        ctx.noteAccount(a, {
          mint: m,
          decimals: m === WSOL_MINT ? 9 : ctx.accountIndex.get(a)?.decimals,
        });

        if (ctx.debug) {
          log("[TokenVisitor] Initialize account", { account: a, mint: m });
        }
      }
    }

    // Step 3: Handle closeAccount
    if (p.type === "closeAccount") {
      const a = p.info?.account;
      const owner = p.info?.owner;
      if (a && owner) {
        ctx.noteAccount(a, { owner });

        if (ctx.debug) {
          log("[TokenVisitor] Close account", { account: a, newOwner: owner });
        }
      }
    }
  }
}
