/**
 * Try to infer the "real" user wallet from a Solana transaction.
 *
 * Heuristics used:
 *  1. Collect all signers from the transaction.
 *  2. Remove program/system accounts (blacklist).
 *  3. If only one human signer remains, return it.
 *  4. Otherwise, check which signer appears as an owner in token balances.
 *  5. Otherwise, check which signer appears as an authority in instructions.
 *  6. Fallback to the first signer.
 */
export declare function inferUserWallet(tx: any): string;
//# sourceMappingURL=inferUserWallet.d.ts.map