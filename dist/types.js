export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export function num(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
}
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