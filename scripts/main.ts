#!/usr/bin/env ts-node

/**
 * CLI Tool: Parse Solana transactions into structured trade actions,
 * enriched with token metadata and market data.
 *
 * Features:
 *  - Direct signature parsing (from arguments or --sigs).
 *  - Address mode with pagination (>1000 signatures supported).
 *  - Batch fetching of transactions, parsed after retrieval.
 *  - Optional HTML report generation.
 *  - Binance SOL/USDT 1m candles enrichment for blockTime ranges.
 *
 * Example:
 *   ts-node src/app/main.ts --address <PUBKEY> --total 3000 --pageSize 1000
 */

import clipboardy from "clipboardy";
import dotenv from "dotenv";
dotenv.config();

import { SolanaRpcClient, Commitment } from "../src/services/SolanaRpcClient.js";
import { MetaplexMetadataService } from "../src/services/MetaplexMetadataService.js";

import { transactionToSwapLegs_SOLBridge } from "../src/core/transactionToSwapLegs.js";
import { legsToTradeActions } from "../src/core/actions.js";
import { inferUserWallet } from "../src/core/inferUserWallet.js";

import { ReportService } from "../src/services/ReportService.js";
import { BinanceKlinesService } from "../src/services/BinanceKlinesService.js";

// ---------- CLI Flags definition ----------
type CliFlags = {
  sigs?: string[];              // Transaction signatures
  address?: string;             // Address to fetch signatures from
  limit?: number;               // Legacy single-page limit (prefer --total)
  total?: number;               // Total number of signatures to fetch
  pageSize?: number;            // RPC page size (max 1000)
  before?: string;              // Fetch signatures before this one
  until?: string;               // Fetch signatures until this one
  commitment?: Commitment;      // Solana commitment level
  help?: boolean;               // Show help
  report?: boolean | string;    // Generate HTML report (true or output path)
  out?: string;                 // Explicit output path (overrides report)
};

/**
 * Minimal flag parser.
 * Supports both long/short aliases and positional args.
 */
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
      // Support both `--report` (bool) and `--report <file>`
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

/**
 * Print CLI usage help.
 */
function printHelp(): void {
  console.log(`
Usage:
  # Direct signatures
  ts-node src/app/main.ts <sig1> [sig2 ...]
  ts-node src/app/main.ts --sigs sig1,sig2,sig3

  # Fetch by address (with pagination)
  ts-node src/app/main.ts --address <PUBKEY> [--total 3000] [--pageSize 1000] [--before <sig>] [--until <sig>] [--commitment confirmed]

Options:
  -s, --sigs         Comma-separated list of signatures
  -a, --address      Address to fetch signatures from
  -l, --limit        Single-page cap (legacy, max 1000). Prefer --total.
      --total        Total signatures across pages (default: 3000)
      --pageSize     RPC page size (1..1000). Default: min(1000, total)
      --before       Return signatures before this one
      --until        Return signatures until this one
  -c, --commitment   processed | confirmed | finalized
  -h, --help         Show help
  --report [file]    Generate an HTML report (optional path)
  --out <file>       Output path for report (overrides --report)
`);
}

const debug = true;

/**
 * Main execution flow.
 * - Parse CLI arguments
 * - Fetch signatures (direct or address mode with pagination)
 * - Batch-fetch transactions
 * - Parse into trade actions with candles + metadata
 * - Optionally output HTML report
 */
async function main() {
  const RPC_ENDPOINT = process.env.RPC_ENDPOINT!;
  if (!RPC_ENDPOINT) throw new Error("RPC_ENDPOINT is missing");

  const { flags, positionals } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  // ---- Determine input signatures ----
  let sigs: string[] | undefined;
  if (flags.sigs?.length) sigs = flags.sigs;
  else if (positionals.length) sigs = positionals;

  const rpc = new SolanaRpcClient({
    endpoint: RPC_ENDPOINT,
    timeoutMs: 25_000,
    maxRetries: 3,
    retryBackoffMs: 300,
    defaultCommitment: "confirmed",
    log: (...args: any[]) => console.log(...args),
  });
  const metaSvc = new MetaplexMetadataService(rpc);

  // ---- Address mode with pagination ----
  if (!sigs && flags.address) {
    const total = Math.max(1, flags.total ?? flags.limit ?? 3000);
    const pageSize = flags.pageSize;

    if (debug) {
      console.log(
        `🔎 Fetching up to ${total} signatures for ${flags.address} ` +
        `(pageSize=${pageSize ?? Math.min(1000, total)}, commitment=${flags.commitment ?? "confirmed"})`
      );
    }

    sigs = await rpc.fetchAllSignaturesWithPagination(flags.address, {
      total,
      pageSize,
      before: flags.before,
      until: flags.until,
      commitment: flags.commitment,
    });

    if (debug) console.log(`📥 Retrieved ${sigs.length} signature(s).`);
  }

  if (!sigs || sigs.length === 0) {
    printHelp();
    console.error("❌ No signatures provided and no address-based results.");
    process.exit(1);
  }

  if (debug) console.log(`🔎 Processing ${sigs.length} transaction(s) from RPC: ${RPC_ENDPOINT}`);

  // -------------------------------
  // 1) Fetch transactions in batch
  // -------------------------------
  const fetched: Array<{ sig: string; tx: any | null }> = [];
  const CHUNK = 50; // limit per batch to avoid RPC overload

  for (let i = 0; i < sigs.length; i += CHUNK) {
    const chunk = sigs.slice(i, i + CHUNK);
    const txs = await rpc.getTransactionsParsedBatch(chunk, 0);
    for (let j = 0; j < chunk.length; j++) {
      fetched.push({ sig: chunk[j], tx: txs[j] ?? null });
    }
  }

  // -------------------------------
  // 2) Retrieve SOL/USDT candles
  // -------------------------------
  const validBlockTimes = fetched
    .map(f => f.tx?.blockTime)
    .filter((t): t is number => typeof t === "number" && t > 0);

  let candles: any[] = [];
  if (validBlockTimes.length > 0) {
    const minBlockTime = Math.min(...validBlockTimes);
    const maxBlockTime = Math.max(...validBlockTimes);

    // Round to minute boundaries
    const startTimeMs = Math.floor(minBlockTime / 60) * 60 * 1000;
    const endTimeMs = (Math.floor(maxBlockTime / 60) + 1) * 60 * 1000;

    const svc = new BinanceKlinesService({ market: "spot" });
    candles = await svc.fetchKlinesRange({
      symbol: "SOLUSDT",
      interval: "1m",
      startTimeMs,
      endTimeMs,
    });

    if (debug) console.log(`📈 Binance returned ${candles.length} candles (1m).`);
  }

  // -------------------------------
  // 3) Parse into trade actions
  // -------------------------------
  const allActions: any[] = [];

  for (const { sig, tx } of fetched) {
    clipboardy.writeSync(JSON.stringify(tx, null, 2)); // Debug: copy raw tx to clipboard

    if (!tx) {
      if (debug) console.warn(`⚠️ Transaction not found: ${sig}`);
      continue;
    }
    if (tx.meta?.err) {
      if (debug) console.warn(`⚠️ Transaction failed: ${sig}`);
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
        candles,
      });
      if (debug) console.log(`📊 TX ${sig}: ${actions.length} actions`);

      allActions.push(...actions);
    } catch (err) {
      console.error(`❌ Error parsing TX ${sig}:`, err);
    }
  }

  // -------------------------------
  // 4) Enrich with metadata
  // -------------------------------
  const metaMap = await metaSvc.fetchTokenMetadataMapFromActions(allActions);
  const enriched = metaSvc.enrichActionsWithMetadata(allActions, metaMap);

  if (debug) {
    console.log("\n🧬 Actions + metadata:");
    console.log(JSON.stringify(enriched, null, 2));
    console.log("Total RPC requests:", rpc.getRequestsCount());
    console.log(`Total trades: ${enriched.length}`);
    console.log(`Total transactions: ${fetched.length}`);
  }

  // -------------------------------
  // 5) Generate report (optional)
  // -------------------------------
  if (flags.report) {
    const outFile =
      (typeof flags.report === "string" ? flags.report : undefined) ||
      flags.out ||
      "solana-trades-report.html";

    const report = new ReportService();
    await report.writeHtml(enriched as any, {
      outFile,
      title: "Solana Trades Report",
    });

    console.log(`📄 Report written to: ${outFile}`);
  }
}

// Entrypoint
main().catch((err) => {
  console.error("❌ Unhandled error in main():", err);
});
