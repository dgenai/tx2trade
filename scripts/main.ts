#!/usr/bin/env ts-node

import clipboardy from "clipboardy";
import dotenv from "dotenv";
dotenv.config();

import { Commitment } from "../src/services/SolanaRpcClient.js";
import { ReportService } from "../src/services/ReportService.js";
import { tx2trade, Tx2TradeInput } from "../src/index.js";

// ----------------------------------------------------------------------------
// CLI FLAGS
// ----------------------------------------------------------------------------
type CliFlags = {
  sigs?: string[];
  address?: string;
  limit?: number;
  total?: number;
  pageSize?: number;
  before?: string;
  until?: string;
  commitment?: Commitment;

  fromDate?: string; // (YYYY-MM-DD or ISO)
  toDate?: string;   // (YYYY-MM-DD or ISO)

  help?: boolean;
  report?: boolean | string;
  out?: string;
};

function parseArgs(argv: string[]): { flags: CliFlags; positionals: string[] } {
  const flags: CliFlags = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-h") {
      flags.help = true;
    } else if (a === "--sigs" || a === "-s") {
      const v = argv[++i];
      if (v) {
        flags.sigs = v.split(",").map(s => s.trim()).filter(Boolean);
      }
    } else if (a === "--address" || a === "-a") {
      flags.address = argv[++i];
    } else if (a === "--limit" || a === "-l") {
      const v = Number(argv[++i]);
      if (!Number.isNaN(v)) flags.limit = v;
    } else if (a === "--total") {
      const v = Number(argv[++i]);
      if (!Number.isNaN(v)) flags.total = v;
    } else if (a === "--pageSize") {
      const v = Number(argv[++i]);
      if (!Number.isNaN(v)) flags.pageSize = v;
    } else if (a === "--before") {
      flags.before = argv[++i];
    } else if (a === "--until") {
      flags.until = argv[++i];
    } else if (a === "--fromDate") {
      flags.fromDate = argv[++i];
    } else if (a === "--toDate") {
      flags.toDate = argv[++i];
    } else if (a === "--commitment" || a === "-c") {
      const v = argv[++i] as Commitment;
      if (v === "processed" || v === "confirmed" || v === "finalized") {
        flags.commitment = v;
      } else {
        console.warn(`⚠️ Unknown commitment "${v}", ignoring.`);
      }
    } else if (a === "--report") {
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
  ts-node src/app/main.ts <sig1> [sig2 ...]
  ts-node src/app/main.ts --sigs sig1,sig2,sig3
  ts-node src/app/main.ts --address <PUBKEY> [--total 3000] [--pageSize 1000] [--fromDate 2025-01-01] [--toDate 2025-01-31] ...

Flags:
  -s, --sigs
  -a, --address
  -l, --limit           (alias of --total)
      --total           number of actions to return (address mode) or cap (sigs mode)
      --pageSize        signatures per page in address mode
      --before          signature cursor (RPC before)
      --until           signature cursor (RPC until)
      --fromDate        start date for address mode (YYYY-MM-DD or ISO)
      --toDate          end date for address mode (YYYY-MM-DD or ISO)
  -c, --commitment      processed | confirmed | finalized
  -h, --help
  --report              optional HTML report (filename or boolean)
  --out                 output file for report (default: solana-trades-report.html)
`);
}

// ----------------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------------
async function main() {
  const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
  if (!RPC_ENDPOINT) throw new Error("RPC_ENDPOINT is missing");

  const { flags, positionals } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  // Determine signatures from flags or positionals
  const sigs: string[] | undefined =
    flags.sigs?.length ? flags.sigs : positionals.length ? positionals : undefined;

  // Build unified input for tx2trade()
  const input: Tx2TradeInput = {
    rpcEndpoint: RPC_ENDPOINT,

    sigs,
    address: flags.address,
    total: flags.total ?? flags.limit,
    pageSize: flags.pageSize,
    before: flags.before,
    until: flags.until,
    fromDate: flags.fromDate,
    toDate: flags.toDate,

    debug: false,
    windowTotalFromOut: 500,
    requireAuthorityUserForOut: true,
  };

  // No signatures + no address = invalid usage
  if (!input.sigs && !input.address) {
    printHelp();
    console.error("❌ No signatures provided and no --address specified.");
    process.exit(1);
  }

  console.time("⏱ Total parsing");

  let enriched: any[] = [];
  try {
    enriched = await tx2trade(input);
  } catch (err) {
    console.error("❌ Error inside tx2trade:", err);
    process.exit(1);
  }

  console.timeEnd("⏱ Total parsing");

  // Copy JSON result → clipboard
  try {
    const json = JSON.stringify(enriched, null, 2);
    await clipboardy.write(json);
    console.log(`📋 Copied ${enriched.length} actions to clipboard.`);
  } catch {
    console.warn("⚠️ Could not write to clipboard.");
  }

  // Optional HTML report
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

main().catch(err => {
  console.error("❌ Unhandled error in main():", err);
});
