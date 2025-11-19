// solDelta.ts
import { WSOL_MINT, NSOL_MINT } from "../constants.js";

const SYS_ID = "11111111111111111111111111111111"; // SystemProgram ID

// ----------------------------------
// Edge type (transfer or synthetic delta)
// ----------------------------------
type Edge = {
  seq: number;
  source: string;
  destination: string;
  mint: string;
  amount: number;
  programId?: string;
  depth?: number;
  synthetic?: boolean;
  kind?: string;
};

/**
 * Normalize account key to string.
 * Supports raw strings, objects with pubkey, or other representations.
 */
function keyToString(k: any): string {
  return typeof k === "string" ? k : (k?.pubkey ?? String(k));
}

/**
 * Push a **synthetic WSOL edge** representing the *residual SOL delta* 
 * of the user wallet, if this delta is not already fully explained 
 * by NSOL edges present in the transaction.
 *
 * Why?
 * - Solana transactions may alter native SOL balances without emitting
 *   explicit SPL-NSOL edges (e.g., SystemProgram transfers).
 * - To reconcile trade flows, we synthesize an equivalent WSOL edge.
 *
 * Behavior:
 * - Compares pre/post lamports of the user account.
 * - Subtracts NSOL edges already counted.
 * - Pushes a synthetic WSOL edge only if a non-negligible residual delta remains.
 *
 * @param tx         Parsed Solana transaction
 * @param edges      Existing edges (to be augmented)
 * @param userWallets User wallet public keys
 * @param opts       Options:
 *                     - dustLamports: ignore deltas below this threshold (default: 500)
 */
export function pushUserSolDeltaEdge(
  tx: any,
  edges: Edge[],
  userWallets: string[],
  opts?: { dustLamports?: number }
) {
  const dustLamports = opts?.dustLamports ?? 500;

  const msg = tx?.transaction?.message;
  const meta = tx?.meta;
  if (!msg || !meta || !userWallets?.length) return;

  const keys = (msg.accountKeys ?? []).map(keyToString);

  for (const userWallet of userWallets) {
    const idx = keys.indexOf(userWallet);
    if (idx === -1) continue;

    const pre = meta.preBalances?.[idx] ?? 0;
    const post = meta.postBalances?.[idx] ?? 0;
    const deltaLamports = post - pre;
    if (deltaLamports === 0) continue;

    // lamports déjà représentés via NSOL
    const alreadyCountedLamports = edges
      .filter(e =>
        e.mint === NSOL_MINT &&
        (e.source === userWallet || e.destination === userWallet)
      )
      .reduce((acc, e) => {
        const lamports = Math.round(e.amount * 1e9);
        return acc + (e.destination === userWallet ? lamports : -lamports);
      }, 0);

    const residualLamports = deltaLamports - alreadyCountedLamports;
    if (Math.abs(residualLamports) <= dustLamports) continue;

    const nextSeq =
      Math.max(-1, ...edges.map(e => (typeof e.seq === "number" ? e.seq : -1))) + 1;

    edges.push({
      seq: nextSeq,
      source: residualLamports > 0 ? "sol:delta:sink" : userWallet,
      destination: residualLamports > 0 ? userWallet : "sol:delta:sink",
      mint: WSOL_MINT,
      amount: Math.abs(residualLamports) / 1e9,
      programId: SYS_ID,
      depth: 0,
      synthetic: true,
      kind: "solDelta",
    });
  }
}

