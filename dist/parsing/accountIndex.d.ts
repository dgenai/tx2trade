import { TokAccInfo } from "../types.js";
/**
 * Build a skeleton account index from pre/post token balances.
 *
 * Steps:
 *  1) Collect all transaction account keys as base58 strings
 *  2) Enrich accounts from preTokenBalances
 *  3) Enrich accounts from postTokenBalances
 *
 * Visitors later add more metadata (mint, decimals, owners).
 */
export declare function buildAccountIndexSkeleton(tx: any, opts?: {
    debug?: boolean;
}): Map<string, TokAccInfo>;
/**
 * Collect user-owned token accounts from a transaction.
 * Sources:
 *  1) Accounts in pre/post balances (owner == user)
 *  2) Accounts created/initialized in this transaction for user
 */
export declare function extractUserTokenAccounts(tx: any, userWallets: string[], opts?: {
    debug?: boolean;
}): Set<string>;
//# sourceMappingURL=accountIndex.d.ts.map