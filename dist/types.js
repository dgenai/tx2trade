// ──────────────────────────────────────────────────────────────────────────────
// File: src/types.ts
// Shared types and utilities for transaction parsing and trade reconstruction.
// ──────────────────────────────────────────────────────────────────────────────
// Known constant: Wrapped SOL mint
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
/**
 * Safe number conversion.
 * @param x Input value
 * @returns finite number or 0
 */
export function num(x) {
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
export function to58(x) {
    if (!x)
        return "";
    if (typeof x === "string")
        return x;
    if (x?.toBase58)
        return x.toBase58(); // PublicKey
    if (x?.pubkey)
        return to58(x.pubkey); // { pubkey: ... }
    return String(x);
}
//# sourceMappingURL=types.js.map