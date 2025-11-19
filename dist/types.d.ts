/**
 * High-level trade action reconstructed from parsed transactions.
 * Represents a single buy/sell event with enriched token metadata.
 */
export type TradeAction = {
    transactionHash: string;
    transactionType: "buy" | "sell" | "transfer";
    walletAddress: string;
    transactionDate: Date;
    sold: {
        address?: string;
        amount?: number;
        symbol?: string;
        name?: string;
        uri?: string;
        unitPriceUsd: string;
        amountUsd: string;
        targetWallet?: string;
    };
    bought: {
        address?: string;
        amount?: number;
        symbol?: string;
        name?: string;
        uri?: string;
        unitPriceUsd: string;
        amountUsd: string;
    };
};
/**
 * Primitive transfer edge.
 * Represents a low-level token/SOL transfer detected in a transaction.
 */
export interface TransferEdge {
    seq: number;
    source: string;
    destination: string;
    mint: string;
    amount: number;
    decimals: number;
    authority?: string;
    programId?: string;
    depth?: number;
}
/**
 * Swap leg.
 * Represents a single logical "swap" reconstructed from multiple edges.
 */
export interface SwapLeg {
    soldMint: string;
    soldAmount: number;
    boughtMint: string;
    boughtAmount: number;
    path: TransferEdge[];
    targetWallet?: string;
    userWallet: string;
    soldCore?: number;
    routerFees?: number;
    tip?: number;
    transfersOnly?: number;
    networkFee?: number;
    rent?: number;
    soldAllIn?: number;
    feeBreakdown?: {
        router?: {
            seq: number;
            amount: number;
        }[];
        tip?: {
            seq: number;
            amount: number;
        }[];
        core?: {
            seq: number;
            amount: number;
        }[];
    };
}
/**
 * Lightweight token account info (as parsed from transaction state).
 */
export type TokAccInfo = {
    mint: string;
    decimals?: number;
    owner?: string;
};
/**
 * Minimal token metadata.
 * May be enriched from Metaplex or external sources.
 */
export type TokenMeta = {
    name?: string;
    symbol?: string;
    uri?: string;
};
export declare const WSOL_MINT = "So11111111111111111111111111111111111111112";
/**
 * Safe number conversion.
 * @param x Input value
 * @returns finite number or 0
 */
export declare function num(x: any): number;
/**
 * Convert various key-like objects to a base58 string.
 * Supports:
 *  - string (returns as-is)
 *  - PublicKey (calls toBase58)
 *  - objects with pubkey
 *  - other types (fallback: String(x))
 */
export declare function to58(x: any): string;
//# sourceMappingURL=types.d.ts.map