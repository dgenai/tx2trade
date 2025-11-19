// ──────────────────────────────────────────────────────────────────────────────
// File: src/types.ts
// Shared types and utilities for transaction parsing and trade reconstruction.
// ──────────────────────────────────────────────────────────────────────────────

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
  seq: number;         // Sequence index (transaction order)
  source: string;      // Sender address
  destination: string; // Receiver address
  mint: string;        // Token mint (WSOL for native SOL)
  amount: number;      // Amount in UI units (not lamports)
  decimals: number;
  authority?: string;  // Authority of the transfer (if available)
  programId?: string;  // Program responsible for the transfer
  depth?: number;      // Call depth (0 = top-level, 1 = inner)
}

/**
 * Swap leg.
 * Represents a single logical "swap" reconstructed from multiple edges.
 */
export interface SwapLeg {
  // Core swap assets
  soldMint: string;
  soldAmount: number;
  boughtMint: string;
  boughtAmount: number;
  path: TransferEdge[];
  targetWallet?: string,
  userWallet: string,
  
  // Decomposed SOL flows (in SOL units)
  soldCore?: number;       // Core SOL outflow (bonding curve only)
  routerFees?: number;     // Router/aggregator fees
  tip?: number;            // Jito/priority tips
  transfersOnly?: number;  // Core + routerFees + tip

  networkFee?: number;     // Meta.fee (SOL)
  rent?: number;           // Rent for ATA creation, etc.
  soldAllIn?: number;      // transfersOnly + networkFee + rent

  // Optional breakdown for debugging/analytics
  feeBreakdown?: {
    router?: { seq: number; amount: number }[];
    tip?: { seq: number; amount: number }[];
    core?: { seq: number; amount: number }[];
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

// Known constant: Wrapped SOL mint
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Safe number conversion.
 * @param x Input value
 * @returns finite number or 0
 */
export function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert various key-like objects to a base58 string.
 * Supports:
 *  - string (returns as-is)
 *  - PublicKey (calls toBase58)
 *  - objects with pubkey
 *  - other types (fallback: String(x))
 */
export function to58(x: any): string {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (x?.toBase58) return x.toBase58(); // PublicKey
  if (x?.pubkey) return to58(x.pubkey); // { pubkey: ... }
  return String(x);
}
