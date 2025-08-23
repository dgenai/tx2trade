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
 * @param userWallet User wallet public key
 * @param opts       Options:
 *                     - dustLamports: ignore deltas below this threshold (default: 500)
 */
export function pushUserSolDeltaEdge(
  tx: any,
  edges: Edge[],
  userWallet: string,
  opts?: { dustLamports?: number }
) {
  const dustLamports = opts?.dustLamports ?? 500;

  const msg = tx?.transaction?.message;
  const meta = tx?.meta;
  if (!msg || !meta || !userWallet) return;

  // Index of the user wallet in accountKeys
  const keys = (msg.accountKeys ?? []).map(keyToString);
  const idx = keys.indexOf(userWallet);
  if (idx === -1) return;

  // Compute lamport delta for the user wallet
  const pre = meta.preBalances?.[idx] ?? 0;
  const post = meta.postBalances?.[idx] ?? 0;
  const deltaLamports = post - pre; // positive = SOL in, negative = SOL out
  if (deltaLamports === 0) return;

  // Compute lamports already represented as NSOL edges
  const alreadyCountedLamports = edges
    .filter(
      (e) =>
        e.mint === NSOL_MINT &&
        (e.source === userWallet || e.destination === userWallet)
    )
    .reduce((acc, e) => {
      const lamports = Math.round(e.amount * 1e9);
      return acc + (e.destination === userWallet ? +lamports : -lamports);
    }, 0);

  // Residual SOL delta after accounting for NSOL edges
  const residualLamports = deltaLamports - alreadyCountedLamports;
  if (Math.abs(residualLamports) <= dustLamports) return; // ignore dust-level deltas

  // Create synthetic edge
  const incoming = residualLamports > 0;
  const nextSeq =
    Math.max(-1, ...edges.map((e) => (typeof e.seq === "number" ? e.seq : -1))) + 1;

  edges.push({
    seq: nextSeq,
    source: incoming ? "sol:delta:sink" : userWallet,
    destination: incoming ? userWallet : "sol:delta:sink",
    mint: WSOL_MINT,
    amount: Math.abs(residualLamports) / 1e9, // convert lamports → SOL
    programId: SYS_ID,
    depth: 0,
    synthetic: true,
    kind: "solDelta",
  });
}
