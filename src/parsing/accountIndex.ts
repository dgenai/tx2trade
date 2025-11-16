import { TokAccInfo, WSOL_MINT, to58 } from "../types.js";

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
export function buildAccountIndexSkeleton(
  tx: any,
  opts?: { debug?: boolean }
): Map<string, TokAccInfo> {
  const { debug = false } = opts ?? {};
  const log = (...args: any[]) => { if (debug) console.debug("[buildAccountIndexSkeleton]", ...args); };

  const idx = new Map<string, TokAccInfo>();
  const keys: string[] = (tx?.transaction?.message?.accountKeys ?? []).map((k: any) => to58(k));

  log("Collected account keys", { count: keys.length });

  function addFromTB(tb: any) {
    for (const e of tb ?? []) {
      const addr = keys[e.accountIndex];
      if (!addr) continue;
      idx.set(addr, {
        mint: e.mint,
        decimals: e.uiTokenAmount?.decimals,
        owner: e.owner,
      });
      log("Indexed account from token balance", { addr, mint: e.mint, owner: e.owner });
    }
  }

  // Step 2 & 3: Enrich from pre/post token balances
  addFromTB(tx?.meta?.preTokenBalances);
  addFromTB(tx?.meta?.postTokenBalances);

  log("Completed skeleton index", { accounts: idx.size });
  return idx;
}

/** Known program IDs */
const TOKEN_PROGRAM_IDS = new Set<string>([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token (legacy)
  // "TokenzQdBNbLqRNZ3S5W8iY2h7RZ6kGkU5k",       // SPL Token-2022 (to add)
]);

const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * Add token accounts created/initialized within THIS transaction for a given user wallet.
 * Includes:
 *  - spl-token initializeAccount[2,3]
 *  - spl-associated-token-account create / createIdempotent
 */
function addFromTokenInitsAndAtaCreates(
  tx: any,
  userWallet: string,
  out: Set<string>,
  opts?: { debug?: boolean }
) {
  const { debug = false } = opts ?? {};
  const log = (...args: any[]) => { if (debug) console.debug("[addFromTokenInitsAndAtaCreates]", ...args); };

  const visitIx = (ix: any) => {
    if (!ix) return;
    const pid = typeof ix.programId === "string" ? ix.programId : ix.programId?.toString?.();
    const p = ix.parsed;
    if (!p) return;

    // spl-token initializeAccount*
    if (TOKEN_PROGRAM_IDS.has(pid) && p.type && String(p.type).startsWith("initializeAccount")) {
      const acc = p.info?.account;
      const owner = p.info?.owner;
      if (acc && owner === userWallet) {
        out.add(acc);
        log("Added initialized account", { acc });
      }
    }

    // spl-associated-token-account create / createIdempotent
    if (pid === ATA_PROGRAM_ID && (p.type === "create" || p.type === "createIdempotent")) {
      console.log(p.info?.account);
      const acc = p.info?.account;
      const wallet = p.info?.wallet;
        out.add(acc);
        log("Added ATA account", { acc });
      
    }
  };

  // Outer instructions
  for (const ix of tx?.transaction?.message?.instructions ?? []) visitIx(ix);
  // Inner instructions
  for (const inner of tx?.meta?.innerInstructions ?? []) {
    for (const ix of inner?.instructions ?? []) visitIx(ix);
  }
}

/**
 * Collect user-owned token accounts from a transaction.
 * Sources:
 *  1) Accounts in pre/post balances (owner == user)
 *  2) Accounts created/initialized in this transaction for user
 */
export function extractUserTokenAccounts(
  tx: any,
  userWallet: string,
  opts?: { debug?: boolean }
): Set<string> {
  const { debug = false } = opts ?? {};
  const log = (...args: any[]) => { if (debug) console.debug("[extractUserTokenAccounts]", ...args); };

  const keys: string[] = (tx?.transaction?.message?.accountKeys ?? []).map((k: any) => to58(k));
  const s = new Set<string>();

  const addFromTB = (tb: any) => {
    for (const e of tb ?? []) {
      if (e.owner === userWallet) {
        const addr = keys[e.accountIndex];
        if (addr) {
          s.add(addr);
          log("Added user-owned account from balances", { addr });
        }
      }
    }
  };


  // Step 1: Accounts present in pre/post balances
  addFromTB(tx?.meta?.preTokenBalances);
  addFromTB(tx?.meta?.postTokenBalances);

  // Step 2: Accounts created/initialized in this transaction
  addFromTokenInitsAndAtaCreates(tx, userWallet, s, { debug });

  
  
  log("Final user token accounts", { count: s.size });
  return s;
}
