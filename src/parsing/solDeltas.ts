// solDelta.ts
import { WSOL_MINT,NSOL_MINT } from "../constants.js";

const SYS_ID = "11111111111111111111111111111111"; // SystemProgram

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

function keyToString(k: any): string {
  return typeof k === "string" ? k : (k?.pubkey ?? String(k));
}

/**
 * Ajoute un edge "synthétique" pour le delta SOL du wallet utilisateur,
 * si ce delta n'est pas déjà entièrement expliqué par des edges NSOL existants.
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

  const keys = (msg.accountKeys ?? []).map(keyToString);
  const idx = keys.indexOf(userWallet);
  if (idx === -1) return;

  const pre = meta.preBalances?.[idx] ?? 0;
  const post = meta.postBalances?.[idx] ?? 0;
  const deltaLamports = post - pre; // + => entrée SOL, - => sortie SOL
  if (deltaLamports === 0) return;

  // Ce que tes edges comptent déjà en NSOL pour ce wallet
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

  const residualLamports = deltaLamports - alreadyCountedLamports;
  if (Math.abs(residualLamports) <= dustLamports) return; // ignore la poussière

  const incoming = residualLamports > 0;
  const nextSeq =
    Math.max(-1, ...edges.map((e) => (typeof e.seq === "number" ? e.seq : -1))) +
    1;

  edges.push({
    seq: nextSeq,
    source: incoming ? "sol:delta:sink" : userWallet,
    destination: incoming ? userWallet : "sol:delta:sink",
    mint: WSOL_MINT,
    amount: Math.abs(residualLamports) / 1e9,
    programId: SYS_ID,
    depth: 0,
  });
}
