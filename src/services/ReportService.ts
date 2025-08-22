// src/services/ReportService.ts
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { TradeAction } from "../types.js";

export type EnrichedAction = {
  txHash: string;
  wallet: string;
  blockTime?: number | null; // epoch seconds
  type: string;              // "BUY" | "SELL"
  amount?: number;
  tokenSymbol?: string;
  tokenMint?: string;
  tokenName?: string;

  // SOLD
  soldSymbol?: string;
  soldName?: string;
  soldAmount?: number;
  soldMint?: string;
  soldUsdPrice?: number;
  soldUsdAmount?: number;

  // BOUGHT
  boughtSymbol?: string;
  boughtName?: string;
  boughtAmount?: number;
  boughtMint?: string;
  boughtUsdPrice?: number;
  boughtUsdAmount?: number;
};

export type ReportOptions = {
  outFile?: string;
  title?: string;
};

/** Convertit un TradeAction vers EnrichedAction, en normalisant les nombres. */
function normalizeAction(input: TradeAction): EnrichedAction {
  const txHash = String(input.transactionHash ?? "");
  const wallet = String(input.walletAddress ?? "");
  const blockTime =
    input.transactionDate instanceof Date
      ? Math.floor(input.transactionDate.getTime() / 1000)
      : input.transactionDate
      ? Math.floor(new Date(input.transactionDate as any).getTime() / 1000)
      : null;

  const type = String(input.transactionType ?? "").toUpperCase();

  const sold = input.sold ?? ({} as TradeAction["sold"]);
  const bought = input.bought ?? ({} as TradeAction["bought"]);

  const toNum = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  };

  return {
    txHash,
    wallet,
    blockTime,
    type,

    // Champs "génériques" laissés vides (non présents dans TradeAction)
    amount: undefined,
    tokenSymbol: undefined,
    tokenName: undefined,
    tokenMint: undefined,

    // SOLD
    soldSymbol: sold.symbol,
    soldName: sold.name,
    soldAmount: toNum(sold.amount),
    soldMint: sold.address,
    soldUsdPrice: toNum(sold.unitPriceUsd),
    soldUsdAmount: toNum(sold.amountUsd),

    // BOUGHT
    boughtSymbol: bought.symbol,
    boughtName: bought.name,
    boughtAmount: toNum(bought.amount),
    boughtMint: bought.address,
    boughtUsdPrice: toNum(bought.unitPriceUsd),
    boughtUsdAmount: toNum(bought.amountUsd),
  };
}

export class ReportService {
  private esc(s: any): string {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private short(addr?: string, left = 4, right = 4): string {
    if (!addr) return "—";
    if (addr.length <= left + right + 1) return addr;
    return `${addr.slice(0, left)}…${addr.slice(-right)}`;
  }

  private fmtAmt(n?: number): string {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    // lisible et précis : jusqu'à 6 décimales
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  /** Affiche uniquement nom/symbole + bouton copier (copie le mint si dispo, sinon le symbole). */
  private tokenCell(symbol?: string, name?: string, mint?: string): string {
    const label = symbol || name || "—";
    const copyValue = mint || symbol || "";
    const copyBtn =
      copyValue
        ? `<button class="copy token-copy" data-copy="${this.esc(copyValue)}" title="Copier" aria-label="Copier">
             <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H8a2 2 0 0 0-2 2v2h2V3h8v8h2V3a2 2 0 0 0-2-2zm-3 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm0 12H5V9h8v10z"/></svg>
           </button>`
        : "";
    return `<span class="token"><span class="token-name">${this.esc(label)}</span>${copyBtn}</span>`;
  }

  generateHtml(_actions: TradeAction[], opts?: ReportOptions): string {
    const actions = _actions.map(normalizeAction);
    const title = opts?.title ?? "Solana Trades Report";

    // KPIs
    const totalActions = actions.length;
    const totalTx = new Set(actions.map((a) => a.txHash || "")).size;
    const typeCount = actions.reduce<Record<string, number>>((acc, a) => {
      const k = a.type || "(unknown)";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const perType = Object.entries(typeCount)
      .sort(([, va], [, vb]) => vb - va)
      .map(([k, v]) => `<span class="chip">${this.esc(k)}: ${v}</span>`)
      .join("");

    const fmtDate = (unix?: number | null) =>
      unix ? new Date(unix * 1000).toLocaleString() : "—";

    // Tri desc par date
    const sorted = [...actions].sort((a, b) => {
      const ta = a.blockTime ?? 0;
      const tb = b.blockTime ?? 0;
      if (ta !== tb) return tb - ta;
      return (a.txHash || "").localeCompare(b.txHash || "");
    });

    const rows = sorted
      .map((a) => {
        const when = fmtDate(a.blockTime);
        const solscanUrl = a.txHash
          ? `https://solscan.io/tx/${this.esc(a.txHash)}`
          : "#";

        const isBuy = (a.type || "").toUpperCase() === "BUY";

        // Champs calculés selon BUY/SELL
        const tokenHtml = isBuy
          ? this.tokenCell(a.boughtSymbol, a.boughtName, a.boughtMint)
          : this.tokenCell(a.soldSymbol, a.soldName, a.soldMint);

        const qty = isBuy ? a.boughtAmount : a.soldAmount;
        const unitPrice = isBuy ? a.boughtUsdPrice : a.soldUsdPrice;
        const totalUsd = isBuy ? a.soldUsdAmount : a.boughtUsdAmount;

        return `
        <tr>
          <td class="when">${this.esc(when)}</td>
          <td class="center">
            ${
              a.txHash
                ? `
            <a href="${solscanUrl}" target="_blank" rel="noopener noreferrer" class="icon-link" title="Open in Solscan" aria-label="Open in Solscan">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <defs>
                  <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0" stop-color="#7f5af0"/>
                    <stop offset="1" stop-color="#2ac3de"/>
                  </linearGradient>
                </defs>
                <path d="M12 2l7.8 4.5v10.9L12 22 4.2 17.4V6.5L12 2z" fill="url(#g)" opacity=".25"/>
                <path d="M7 9h10a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2zm0 4h10a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2z" fill="url(#g)"/>
              </svg>
            </a>`
                : "—"
            }
          </td>
          <td class="wallet">
            <span class="mono">${this.esc(this.short(a.wallet))}</span>
            ${
              a.wallet
                ? `<button class="copy" data-copy="${this.esc(
                    a.wallet
                  )}" title="Copy address" aria-label="Copy address">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H8a2 2 0 0 0-2 2v2h2V3h8v8h2V3a2 2 0 0 0-2-2zm-3 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm0 12H5V9h8v10z"/></svg>
            </button>`
                : ""
            }
          </td>
          <td class="types">
            <span class="pill ${this.esc(
              (a.type || "other").toLowerCase()
            )}">${this.esc(a.type || "—")}</span>
          </td>
          <td class="num">${this.esc(this.fmtAmt(qty))}</td>
          <td>${tokenHtml}</td>
          <td class="num">${this.esc(this.fmtAmt(unitPrice))}</td>
          <td class="num">${this.esc(this.fmtAmt(totalUsd))}</td>
        </tr>
      `;
      })
      .join("");

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${this.esc(title)}</title>
<style>
  :root {
    --bg: #0a0d14;
    --panel: rgba(18, 24, 38, 0.85);
    --muted: #8fa1b3;
    --text: #e6edf3;
    --accentA: #7f5af0; /* purple */
    --accentB: #2cb67d; /* teal */
    --accentC: #2ac3de; /* cyan */
    --border: rgba(127, 90, 240, 0.28);
    --line: #1c2435;
    --glow: 0 0 24px rgba(127, 90, 240, 0.35);
  }

  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:
    radial-gradient(1200px 600px at 20% -10%, rgba(127,90,240,0.18), transparent 60%),
    radial-gradient(900px 500px at 80% 10%, rgba(44,182,125,0.16), transparent 60%),
    var(--bg);
    color:var(--text);
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial;
  }

  .wrap { max-width: 1120px; margin: 36px auto; padding: 0 18px; }
  header { margin-bottom: 18px; }
  h1 { font-size: 22px; margin: 0 0 10px; letter-spacing: .2px; }

  /* KPI cards */
  .cards { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; margin: 12px 0 22px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 16px; box-shadow: var(--glow); }
  .kpi { font-size: 12px; color: var(--muted); display:flex; justify-content: space-between; align-items: baseline; }
  .kpi .v { display:block; color: var(--text); font-weight: 700; font-size: 18px; margin-top: 6px; }

  .chip { display:inline-flex; align-items:center; gap:6px; background: linear-gradient(135deg, rgba(127,90,240,.18), rgba(42,195,222,.18)); border: 1px solid rgba(127,90,240,.35); border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px; margin-right: 6px; box-shadow: 0 0 0 1px rgba(255,255,255,0.02) inset; }

  /* Table (one row per action) */
  .table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 20px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  thead th { position: sticky; top: 0; background: rgba(10,13,20,0.75); backdrop-filter: blur(6px); color: var(--muted); text-align: left; font-weight: 700; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  tbody td { padding: 12px 14px; border-bottom: 1px dashed var(--line); vertical-align: top; }
  tbody tr:hover { background: rgba(127, 90, 240, 0.06); }
  .center { text-align:center; }
  .when { white-space: nowrap; }
  .wallet { display:flex; align-items:center; gap:8px; }
  .wallet .copy { background: transparent; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 4px; color: var(--muted); cursor: pointer; transition: all .2s ease; }
  .wallet .copy:hover { color: var(--text); border-color: rgba(255,255,255,0.25); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
  .icon-link { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); transition: all .2s; }
  .icon-link:hover { border-color: rgba(255,255,255,0.25); box-shadow: var(--glow); }
  .muted { color: var(--muted); font-size: 12px; margin-left: 6px; }

  .pill { display:inline-flex; align-items:center; padding: 3px 8px; border-radius: 999px; font-weight: 700; font-size: 11px; letter-spacing:.02em; border: 1px solid rgba(127,90,240,.45); background: linear-gradient(135deg, rgba(127,90,240,.18), rgba(44,182,125,.18)); }
  .pill.buy  { border-color: rgba(44,182,125,.6); }
  .pill.sell { border-color: rgba(229,115,115,.6); }
  .pill.swap { border-color: rgba(42,195,222,.6); }
  .num { text-align:right; font-variant-numeric: tabular-nums; }

  .token { display:inline-flex; align-items:center; gap:8px; }
  .token .token-name { line-height: 1; }
  .token .copy.token-copy {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    padding: 2px;
    width: 22px;
    height: 22px;
    color: var(--muted);
    cursor: pointer;
    transition: all .2s ease;
  }
  .token .copy.token-copy:hover { color: var(--text); border-color: rgba(255,255,255,0.25); }

  footer { color: var(--muted); text-align:center; margin: 30px 0 10px; font-size: 12px; }

  @media (max-width: 1100px) {
    .wrap { padding: 0 12px; }
  }
  @media (max-width: 900px) {
    .cards { grid-template-columns: repeat(2, minmax(0,1fr)); }
  }
  @media (max-width: 760px) {
    thead th:nth-child(2) { display:none; }  /* hide Solscan icon column on small screens */
    tbody td:nth-child(2) { display:none; }
  }
  @media (max-width: 640px) {
    .cards { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${this.esc(title)}</h1>
      <div class="cards">
        <div class="card"><div class="kpi">Total Transactions <span class="v">${totalTx}</span></div></div>
        <div class="card"><div class="kpi">Total Actions <span class="v">${totalActions}</span></div></div>
        <div class="card"><div class="kpi">By Type <span class="v">${perType || "—"}</span></div></div>
      </div>
    </header>

    <div class="table-wrap">
      <table>
      <thead>
      <tr>
        <th>Date</th>
        <th class="center">Tx</th>
        <th>Wallet</th>
        <th>Type</th>
        <th class="num">Qty</th>
        <th>Token</th>
        <th class="num">Unit Price (USD)</th>
        <th class="num">Total (USD)</th>
      </tr>
      </thead>
        <tbody>
          ${rows || `<tr><td colspan="8">No actions.</td></tr>`}
        </tbody>
      </table>
    </div>

    <footer>Generated at ${new Date().toLocaleString()}</footer>
  </div>

  <script>
    // Copy to clipboard (event delegation) - JS pur
    document.addEventListener('click', function (e) {
      const target = e.target;
      const btn = target && target.closest ? target.closest('button.copy') : null;
      if (!btn) return;
      const text = btn.getAttribute('data-copy');
      if (!text) return;
      navigator.clipboard?.writeText(text).then(() => {
        btn.classList.add('ok');
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
        setTimeout(() => {
          btn.classList.remove('ok');
          btn.innerHTML = btn.classList.contains('token-copy')
            ? '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H8a2 2 0 0 0-2 2v2h2V3h8v8h2V3a2 2 0 0 0-2-2zm-3 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm0 12H5V9h8v10z"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H8a2 2 0 0 0-2 2v2h2V3h8v8h2V3a2 2 0 0 0-2-2zm-3 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm0 12H5V9h8v10z"/></svg>';
        }, 800);
      });
    }, { passive: true });
  </script>
</body>
</html>`;
    return html;
  }

  async writeHtml(actions: TradeAction[], opts?: ReportOptions): Promise<string> {
    const html = this.generateHtml(actions, opts);
    if (opts?.outFile) {
      await mkdir(dirname(opts.outFile), { recursive: true });
      await writeFile(opts.outFile, html, "utf8");
    }
    return html;
  }
}
