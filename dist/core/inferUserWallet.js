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
export function inferUserWallet(tx) {
    const keys = tx?.transaction?.message?.accountKeys ?? [];
    // Extract all signers from the transaction message
    const signers = keys
        .filter((k) => k?.signer)
        .map((k) => {
        if (typeof k === "string")
            return k;
        if (k?.pubkey?.toBase58)
            return k.pubkey.toBase58();
        if (k?.pubkey)
            return String(k.pubkey);
        return "";
    })
        .filter(Boolean);
    // Exclude system accounts and known program addresses
    const blacklist = new Set([
        "11111111111111111111111111111111", // System Program
        "ComputeBudget111111111111111111111111111111", // Compute Budget Program
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token Program
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Program
        "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // Memo Program
        "SysvarRent111111111111111111111111111111111", // Rent sysvar
        "SysvarC1ock11111111111111111111111111111111", // Clock sysvar
        "SysvarEpochSchedu1e11111111111111111111111", // Epoch Schedule sysvar
    ]);
    const humanSigners = signers.filter((s) => !blacklist.has(s));
    // Case 1: only one "human" signer -> that's the user
    if (humanSigners.length === 1) {
        return humanSigners[0];
    }
    // Case 2: try to match signer with token account owners
    const owners = new Set();
    const addOwner = (tb) => {
        for (const e of tb ?? [])
            if (e?.owner)
                owners.add(e.owner);
    };
    addOwner(tx?.meta?.preTokenBalances);
    addOwner(tx?.meta?.postTokenBalances);
    const matchByOwner = humanSigners.find((s) => owners.has(s));
    if (matchByOwner) {
        return matchByOwner;
    }
    // Case 3: try to match signer with authorities in instructions
    const authorities = new Set();
    const collect = (ix) => {
        const a = ix?.parsed?.info?.authority;
        if (a)
            authorities.add(a);
    };
    for (const ix of tx?.transaction?.message?.instructions ?? [])
        collect(ix);
    for (const inner of tx?.meta?.innerInstructions ?? []) {
        for (const ix of inner?.instructions ?? [])
            collect(ix);
    }
    const matchByAuth = humanSigners.find((s) => authorities.has(s));
    if (matchByAuth) {
        return matchByAuth;
    }
    // Fallback: return first human signer, or first signer in general
    const fallback = humanSigners[0] ?? signers[0] ?? "";
    return fallback;
}
/**
 * Extract ALL human wallets involved in a Solana transaction.
 *
 * Includes:
 *  - Signers
 *  - Owners from pre/post token balances
 *  - Authorities in SPL instructions
 *  - ATA creators (wallet field)
 *
 * Excludes:
 *  - Programs
 *  - Sysvars
 *  - Known PDAs
 */
export function inferUserWallets(tx) {
    const wallets = new Set();
    const accountKeys = tx?.transaction?.message?.accountKeys ?? [];
    function to58(k) {
        if (!k)
            return "";
        if (typeof k === "string")
            return k;
        if (k.toBase58)
            return k.toBase58();
        if (k.pubkey?.toBase58)
            return k.pubkey.toBase58();
        if (typeof k.pubkey === "string")
            return k.pubkey;
        return String(k.pubkey ?? "");
    }
    // -----------------------------
    // 1. Signers  (source de vérité)
    // -----------------------------
    const signers = new Set();
    for (const k of accountKeys) {
        if (k?.signer) {
            const w = to58(k);
            wallets.add(w);
            signers.add(w);
        }
    }
    // -----------------------------
    // 2. Owners  (mais uniquement s'ils sont signers)
    // -----------------------------
    const addOwner = (tb) => {
        for (const e of tb ?? []) {
            const o = e?.owner;
            if (o && signers.has(o))
                wallets.add(o);
        }
    };
    addOwner(tx?.meta?.preTokenBalances);
    addOwner(tx?.meta?.postTokenBalances);
    // -----------------------------
    // 3. ATA creations
    // -----------------------------
    function collectATA(ix) {
        if (ix?.parsed?.type === "create" || ix?.parsed?.type === "createIdempotent") {
            const w = ix.parsed?.info?.wallet;
            if (w && signers.has(w))
                wallets.add(w);
        }
    }
    for (const ix of tx?.transaction?.message?.instructions ?? [])
        collectATA(ix);
    for (const inner of tx?.meta?.innerInstructions ?? [])
        for (const ix of inner?.instructions ?? [])
            collectATA(ix);
    // -----------------------------
    // Remove programs/sysvars
    // -----------------------------
    const blacklist = new Set([
        "11111111111111111111111111111111",
        "ComputeBudget111111111111111111111111111111",
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
    ]);
    for (const w of [...wallets]) {
        if (!w || blacklist.has(w))
            wallets.delete(w);
    }
    return [...wallets];
}
//# sourceMappingURL=inferUserWallet.js.map