#!/usr/bin/env ts-node

/**
 * CLI: parse Solana transactions into trade actions with enriched metadata.
 *
 * New (pagination):
 *  - --address mode supports fetching >1000 signatures via paginated calls.
 *  - Flags:
 *      --total <n>      Target total signatures to retrieve (default 3000)
 *      --pageSize <n>   Page size per RPC call, 1..1000 (default: min(1000, total))
 */

import clipboardy from "clipboardy";
import dotenv from "dotenv";
dotenv.config();

import { SolanaRpcClient } from "../src/services/SolanaRpcClient.js";
import { MetaplexMetadataService } from "../src/services/MetaplexMetadataService.js";

import { transactionToSwapLegs_SOLBridge } from "../src/core/transactionToSwapLegs.js";
import { legsToTradeActions } from "../src/core/actions.js";
import { inferUserWallet } from "../src/core/inferUserWallet.js";

import { ReportService } from "../src/services/ReportService.js";


type Commitment = "processed" | "confirmed" | "finalized";

// ---------- Simple flag parser ----------
type CliFlags = {
  sigs?: string[];
  address?: string;
  limit?: number;         // kept for backward compat (single page); prefer --total now
  total?: number;         // total signatures to fetch across pages
  pageSize?: number;      // per-page RPC size (max 1000)
  before?: string;
  until?: string;
  commitment?: Commitment;
  help?: boolean;
  report?: boolean | string;  // true or path
  out?: string;               // alias for the path

};

function parseArgs(argv: string[]): { flags: CliFlags; positionals: string[] } {
  const flags: CliFlags = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--sigs" || a === "-s") {
      const v = argv[++i];
      if (v) flags.sigs = v.split(",").map(s => s.trim()).filter(Boolean);
    } else if (a === "--address" || a === "-a") flags.address = argv[++i];
    else if (a === "--limit" || a === "-l") { const v = Number(argv[++i]); if (!Number.isNaN(v)) flags.limit = v; }
    else if (a === "--total") { const v = Number(argv[++i]); if (!Number.isNaN(v)) flags.total = v; }
    else if (a === "--pageSize") { const v = Number(argv[++i]); if (!Number.isNaN(v)) flags.pageSize = v; }
    else if (a === "--before") flags.before = argv[++i];
    else if (a === "--until") flags.until = argv[++i];
    else if (a === "--commitment" || a === "-c") {
      const v = argv[++i] as Commitment;
      if (v === "processed" || v === "confirmed" || v === "finalized") flags.commitment = v;
      else console.warn(`⚠️ Unknown commitment "${v}", ignoring.`);
    } else if (a === "--report") {
      // --report (bool) OU --report <chemin>
      const peek = argv[i + 1];
      if (peek && !peek.startsWith("-")) {
        flags.report = peek;
        i++;
      } else {
        flags.report = true;
      }
    } else if (a === "--out") {
      flags.out = argv[++i];
    } else if (a.startsWith("-")) {
      console.warn(`⚠️ Unknown flag "${a}", ignoring.`);
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}


function printHelp(): void {
  console.log(`
Usage:
  # Direct signatures (positional or --sigs)
  ts-node src/app/main.ts <sig1> [sig2 ...]
  ts-node src/app/main.ts --sigs sig1,sig2,sig3

  # Fetch by address (with pagination)
  ts-node src/app/main.ts --address <PUBKEY> [--total 3000] [--pageSize 1000] [--before <sig>] [--until <sig>] [--commitment confirmed]

Options:
  -s, --sigs         Comma-separated list of signatures
  -a, --address      Address to fetch signatures from
  -l, --limit        Single-page cap (max 1000). Prefer --total for pagination.
      --total        Total signatures to collect across pages (default: 3000)
      --pageSize     Page size per RPC call (1..1000). Default: min(1000, total)
      --before       Return signatures before this one (exclusive)
      --until        Return signatures until this one (inclusive)
  -c, --commitment   processed | confirmed | finalized (default: client setting)
  -h, --help         Show help
  --report [file]  Generate an HTML report (optional output path)
  --out <file>     Explicit output path for the report (overrides --report file)
`);
}

const debug = true;

// --------- Pagination helper ----------
async function fetchAllSignaturesWithPagination(
  rpc: SolanaRpcClient,
  address: string,
  opts: {
    total: number;                // total target to collect
    pageSize?: number;            // max 1000
    before?: string;
    until?: string;
    commitment?: Commitment;
  }
): Promise<string[]> {
  const totalTarget = Math.max(1, opts.total);
  const pageSize = Math.min(1000, Math.max(1, opts.pageSize ?? Math.min(1000, totalTarget)));
  let before = opts.before;
  const until = opts.until;
  const commitment = opts.commitment;

  const sigs: string[] = [];
  const seen = new Set<string>();

  while (sigs.length < totalTarget) {
    const remaining = totalTarget - sigs.length;
    const pageCap = Math.min(pageSize, remaining);

    const page = await rpc.getSignaturesForAddress(
      address,
      pageCap,
      before,
      until,
      commitment ?? "confirmed"
    );

    if (page.length === 0) break;

    for (const s of page) {
      if (!seen.has(s.signature)) {
        sigs.push(s.signature);
        seen.add(s.signature);
        if (sigs.length >= totalTarget) break;
      }
    }

    // Advance pagination anchor
    const last = page[page.length - 1]?.signature;
    if (!last || last === before) break; // no progress guard
    before = last;

    if (debug) console.log(`↪️  Pagination: collected ${sigs.length}/${totalTarget} (next before=${before})`);
  }

  return sigs;
}

async function main() {
  const RPC_ENDPOINT = process.env.RPC_ENDPOINT!;
  if (!RPC_ENDPOINT) throw new Error("RPC_ENDPOINT is missing");

  const { flags, positionals } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  // Decide input mode
  let sigs: string[] | undefined;

  if (flags.sigs?.length) {
    sigs = flags.sigs;
  } else if (positionals.length) {
    sigs = positionals;
  }

  const rpc = new SolanaRpcClient({
    endpoint: RPC_ENDPOINT,
    timeoutMs: 25_000,
    maxRetries: 3,
    retryBackoffMs: 300,
    defaultCommitment: "confirmed",
    log: (...args: any[]) => console.log(...args)
  });
  const metaSvc = new MetaplexMetadataService(rpc);

  
  // Address mode with pagination
  if (!sigs && flags.address) {
    // Backward-compat: if --limit provided without --total, treat it as total
    const total = Math.max(1, flags.total ?? flags.limit ?? 3000);
    const pageSize = flags.pageSize;

    if (debug) {
      console.log(
        `🔎 Fetching up to ${total} signatures for ${flags.address} ` +
        `(pageSize=${pageSize ?? Math.min(1000, total)}, commitment=${flags.commitment ?? "confirmed"})`
      );
    }

    sigs = await fetchAllSignaturesWithPagination(rpc, flags.address, {
      total,
      pageSize,
      before: flags.before,
      until: flags.until,
      commitment: flags.commitment,
    });

    if (debug) console.log(`📥 Retrieved ${sigs.length} signature(s) from address with pagination.`);
  }

  if (!sigs || sigs.length === 0) {
    printHelp();
    console.error("❌ No signatures provided and no address-based results. Nothing to do.");
    process.exit(1);
  }

  if (debug) console.log(`🔎 Processing ${sigs.length} transaction(s) from RPC: ${RPC_ENDPOINT}`);

  const allActions: any[] = [];

  // Batch TX fetch in chunks of 100
  for (let i = 0; i < sigs.length; i += 50) {
    const chunk = sigs.slice(i, i + 50);
    const txs = await rpc.getTransactionsParsedBatch(chunk, 0);

    for (let j = 0; j < txs.length; j++) {
      const tx = txs[j];
    //  clipboardy.writeSync(JSON.stringify(tx, null, 2));

      const sig = chunk[j];

      if (tx.meta.err) {
        if (debug) console.warn(`⚠️ Transaction failed: ${sig}`);
        continue;
      }

      if (!tx) {
        if (debug) console.warn(`⚠️ Transaction not found: ${sig}`);
        continue;
      }

      try {
        const userWallet = inferUserWallet(tx);
        if (debug) console.log("👤 Inferred wallet:", userWallet);

        const legs = transactionToSwapLegs_SOLBridge(tx, userWallet, {
          windowTotalFromOut: 500,
          requireAuthorityUserForOut: true,
          debug,
        });
        if (debug) console.log(`🔗 TX ${sig}: ${legs.length} legs`);

        const actions = legsToTradeActions(legs, {
          txHash: sig,
          wallet: userWallet,
          blockTime: tx.blockTime,
        });
        if (debug) console.log(`📊 TX ${sig}: ${actions.length} actions`);

        allActions.push(...actions);
      } catch (err) {
        console.error(`❌ Error parsing TX ${sig}:`, err);
      }
    }
  }

  if (debug) {
    console.log("\n📊 Aggregated trade actions across all transactions:");
    console.log(JSON.stringify(allActions, null, 2));
  }

  const metaMap = await metaSvc.fetchTokenMetadataMapFromActions(allActions);
  const enriched = metaSvc.enrichActionsWithMetadata(allActions, metaMap);

  if (debug) {
    console.log("\n🧬 Actions + metadata:");
    console.log(JSON.stringify(enriched, null, 2));

    console.log("Total RPC requests:", rpc.getRequestsCount());


  }

  // ----- REPORT (HTML) -----
const wantReport = !!flags.report;
if (wantReport) {
  const outFile =
    (typeof flags.report === "string" ? flags.report : undefined) ||
    flags.out ||
    "solana-trades-report.html";

  const report = new ReportService();
  await report.writeHtml(
    // Cast minimal si tes actions ont déjà ces champs
    enriched as any,
    { outFile, title: "Solana Trades Report" }
  );

  console.log(`📄 Report written to: ${outFile}`);
}

 /*  try {
   clipboardy.writeSync(JSON.stringify(enriched, null, 2));
    if (debug) console.log("📋 Results copied to clipboard.");
  } catch {
    if (debug) console.log("⚠️ Could not copy results to clipboard.");
  } */
}

main().catch((err) => {
  console.error("❌ Unhandled error in main():", err);
});
