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
export declare function pushUserSolDeltaEdge(tx: any, edges: Edge[], userWallet: string, opts?: {
    dustLamports?: number;
}): void;
export {};
//# sourceMappingURL=solDeltas.d.ts.map