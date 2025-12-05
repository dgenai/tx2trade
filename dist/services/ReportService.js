// src/services/ReportService.ts
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
async function fetchTokenMetadataBatch(mints) {
    if (mints.length === 0)
        return {};
    const batchSize = 30;
    const results = {};
    for (let i = 0; i < mints.length; i += batchSize) {
        const chunk = mints.slice(i, i + batchSize);
        const url = "https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/" +
            chunk.join("%2C") +
            "?include=top_pools&include_composition=false";
        const res = await fetch(url);
        const json = await res.json();
        if (Array.isArray(json.data)) {
            for (const t of json.data) {
                const attrs = t.attributes;
                if (!attrs)
                    continue;
                results[attrs.address] = attrs.image_url || "";
            }
        }
    }
    return results;
}
function normalizeAction(input) {
    const txHash = String(input.transactionHash ?? "");
    const wallet = String(input.walletAddress ?? "");
    const blockTime = input.transactionDate instanceof Date
        ? Math.floor(input.transactionDate.getTime() / 1000)
        : input.transactionDate
            ? Math.floor(new Date(input.transactionDate).getTime() / 1000)
            : null;
    const type = String(input.transactionType ?? "").toUpperCase();
    const sold = input.sold ?? {};
    const bought = input.bought ?? {};
    const toNum = (v) => {
        if (typeof v === "number" && Number.isFinite(v))
            return v;
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
    esc(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
    short(addr, left = 4, right = 4) {
        if (!addr)
            return "—";
        if (addr.length <= left + right + 1)
            return addr;
        return `${addr.slice(0, left)}…${addr.slice(-right)}`;
    }
    fmtAmt(n) {
        if (typeof n !== "number" || !Number.isFinite(n))
            return "—";
        return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
    }
    tokenCell(symbol, name, mint) {
        const label = symbol || name || "—";
        const copyValue = mint || symbol || "";
        const copyBtn = copyValue
            ? `<button class="copy token-copy" data-copy="${this.esc(copyValue)}" title="Copier" aria-label="Copier">
             <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H8a2 2 0 0 0-2 2v2h2V3h8v8h2V3a2 2 0 0 0-2-2zm-3 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm0 12H5V9h8v10z"/></svg>
           </button>`
            : "";
        return `<span class="token"><span class="token-name">${this.esc(label)}</span>${copyBtn}</span>`;
    }
    async generateHtml(_actions, opts) {
        const actions = _actions.map(normalizeAction);
        const title = opts?.title ?? "Solana Trades Report";
        // KPIs
        const totalActions = actions.length;
        const totalTx = new Set(actions.map((a) => a.txHash || "")).size;
        const typeCount = actions.reduce((acc, a) => {
            const k = a.type || "(unknown)";
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
        }, {});
        const perType = Object.entries(typeCount)
            .sort(([, va], [, vb]) => vb - va)
            .map(([k, v]) => `<span class="chip">${this.esc(k)}: ${v}</span>`)
            .join("");
        const fmtDate = (unix) => unix ? new Date(unix * 1000).toLocaleString() : "—";
        const sorted = [...actions].sort((a, b) => {
            const ta = a.blockTime ?? 0;
            const tb = b.blockTime ?? 0;
            if (ta !== tb)
                return tb - ta;
            return (a.txHash || "").localeCompare(b.txHash || "");
        });
        // -----------------------------
        // TABLE rows
        // -----------------------------
        const rows = sorted
            .map((a) => {
            const when = fmtDate(a.blockTime);
            const solscanUrl = a.txHash
                ? `https://solscan.io/tx/${this.esc(a.txHash)}`
                : "#";
            const isBuy = (a.type || "").toUpperCase() === "BUY";
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
            ${a.txHash
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
                : "—"}
          </td>
          <td class="wallet">
            <span class="mono">${this.esc(this.short(a.wallet))}</span>
            ${a.wallet
                ? `<button class="copy" data-copy="${this.esc(a.wallet)}" title="Copy address" aria-label="Copy address">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H8a2 2 0 0 0-2 2v2h2V3h8v8h2V3a2 2 0 0 0-2-2zm-3 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm0 12H5V9h8v10z"/></svg>
            </button>`
                : ""}
          </td>
          <td class="types">
            <span class="pill ${this.esc((a.type || "other").toLowerCase())}">${this.esc(a.type || "—")}</span>
          </td>
          <td class="num">${this.esc(this.fmtAmt(qty))}</td>
          <td>${tokenHtml}</td>
          <td class="num">${this.esc(this.fmtAmt(unitPrice))}</td>
          <td class="num">${this.esc(this.fmtAmt(totalUsd))}</td>
        </tr>
      `;
        })
            .join("");
        const nodeMap = new Map();
        const linkMap = new Map();
        const registerNode = (mint, symbol, name, actionType, role) => {
            if (!mint)
                return;
            const key = mint;
            let node = nodeMap.get(key);
            if (!node) {
                node = {
                    id: key,
                    label: symbol || name || this.short(key),
                    symbol,
                    name,
                    totalCount: 0,
                    buyCount: 0,
                    sellCount: 0,
                    transferCount: 0,
                };
                nodeMap.set(key, node);
            }
            node.totalCount++;
            const t = actionType.toUpperCase();
            if (t === "BUY" && role === "bought")
                node.buyCount++;
            if (t === "SELL" && role === "sold")
                node.sellCount++;
            if (t === "TRANSFER" && role === "sold")
                node.transferCount++;
        };
        for (const a of actions) {
            const t = (a.type || "").toUpperCase();
            const soldMint = a.soldMint;
            const boughtMint = a.boughtMint;
            const soldAmount = a.soldAmount ?? 0;
            const boughtAmount = a.boughtAmount ?? 0;
            registerNode(soldMint, a.soldSymbol, a.soldName, t, "sold");
            registerNode(boughtMint, a.boughtSymbol, a.boughtName, t, "bought");
            if (soldMint && boughtMint) {
                const key = `${soldMint}__${boughtMint}__${t}`;
                let link = linkMap.get(key);
                if (!link) {
                    link = {
                        source: soldMint,
                        target: boughtMint,
                        type: t,
                        count: 0,
                        totalSoldAmount: 0,
                        totalBoughtAmount: 0,
                    };
                    linkMap.set(key, link);
                }
                link.count++;
                link.totalSoldAmount += soldAmount || 0;
                link.totalBoughtAmount += boughtAmount || 0;
            }
        }
        const mintList = Array.from(nodeMap.keys());
        const mintToIcon = await fetchTokenMetadataBatch(mintList);
        // Inject icons
        for (const n of nodeMap.values()) {
            n.icon = mintToIcon[n.id];
        }
        const graphNodes = Array.from(nodeMap.values());
        const graphLinks = Array.from(linkMap.values());
        function safeJson(obj) {
            return JSON.stringify(obj)
                .replace(/</g, "\\u003c")
                .replace(/>/g, "\\u003e")
                .replace(/&/g, "\\u0026")
                .replace(/\u2028/g, "\\u2028")
                .replace(/\u2029/g, "\\u2029");
        }
        const graphDataJson = safeJson({
            nodes: graphNodes,
            links: graphLinks,
        });
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

  /* Graph section */
  .graph-section { margin-bottom: 26px; }
  .graph-section h2 { margin: 0 0 4px; font-size: 18px; }
  .graph-section .muted { color: var(--muted); font-size: 12px; }
  #trade-graph {
    margin-top: 10px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background:
      radial-gradient(700px 400px at 10% 10%, rgba(127,90,240,0.12), transparent 60%),
      radial-gradient(700px 400px at 90% 90%, rgba(42,195,222,0.12), transparent 60%),
      radial-gradient(500px 300px at 50% 10%, rgba(44,182,125,0.10), transparent 60%);
    min-height: 360px;
    position: relative;
    overflow: hidden;
  }
  #trade-graph svg { width: 100%; height: 100%; display:block; }

  .graph-tooltip {
    position: absolute;
    pointer-events: none;
    background: rgba(15,23,42,0.95);
    border-radius: 10px;
    border: 1px solid rgba(148,163,184,0.5);
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text);
    box-shadow: 0 0 18px rgba(15,23,42,0.8);
    opacity: 0;
    transform: translate3d(0,0,0);
    transition: opacity .12s ease-out;
    z-index: 10;
  }
  .graph-tooltip .title { font-weight: 600; margin-bottom: 4px; }
  .graph-tooltip .line { display:flex; justify-content:space-between; gap:8px; }

  .link-line {
    stroke: rgba(148,163,184,0.6);
    stroke-opacity: 0.7;
  }
  .link-buy { stroke: rgba(44,182,125,0.9); }
  .link-sell { stroke: rgba(229,115,115,0.9); }
  .link-transfer { stroke: rgba(127,90,240,0.9); stroke-dasharray: 4 2; }

  .node-circle {
    fill: rgba(127,90,240,0.9);
    stroke: rgba(255,255,255,0.32);
    stroke-width: 1;
  }
  .node-label {
    fill: #e5e9f0;
    font-size: 11px;
    pointer-events: none;
    text-shadow:
      0 0 2px rgba(10,10,10,0.9),
      0 0 3px rgba(10,10,10,0.9);
  }

  
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
  .pill.transfer { border-color: rgba(127,90,240,.7); }

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

    <section class="graph-section">
      <h2>Token flow graph</h2>
      <p class="muted">
        Relations between <strong>sold</strong> and <strong>bought</strong> tokens (BUY / SELL). Transfers feed the per-token metrics.
      </p>
      <div id="trade-graph"></div>
      
    </section>

    

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



  

  <script src="https://d3js.org/d3.v7.min.js"></script>


  <script>
(function() {

const graphData = ${graphDataJson};

  const container = document.getElementById('trade-graph');
  if (!container || !graphData || !Array.isArray(graphData.nodes) || graphData.nodes.length === 0) {
    if (container) {
      container.innerHTML = '<div style="padding:12px; font-size:12px; color:var(--muted);">No token relationships to display.</div>';
    }
    return;
  }

  const width = container.clientWidth || 900;
  const height = container.clientHeight || 380;

  const svg = d3.select(container)
    .append('svg')
    .attr('viewBox', '0 0 ' + width + ' ' + height)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const nodes = graphData.nodes.map(d => Object.assign({}, d));
  const links = graphData.links.map(d => Object.assign({}, d));

  const maxCount = d3.max(nodes, d => d.totalCount) || 1;
  const sizeScale = d3.scaleSqrt().domain([1, maxCount]).range([10, 40]);

const linkWidth = d3.scaleLinear()
  .domain([1, d3.max(links, function(d){ return d.count; }) || 1])
  .range([0.7, 4]);

// LINKS directionnels
const link = svg.append("g")
  .attr("class", "links")
  .selectAll("line")
  .data(links)
  .enter()
  .append("line")
  .attr("stroke-width", function(d){ return linkWidth(d.count); })
  .attr("stroke", function(d){
    var t = (d.type || "").toUpperCase();
    if (t === "BUY") return "rgba(44,182,125,0.85)";   // vert
    if (t === "SELL") return "rgba(229,115,115,0.85)"; // rouge
    return "rgba(127,90,240,0.85)";
  });

// NODES
const node = svg.append("g")
  .attr("class", "nodes")
  .selectAll("g")
  .data(nodes)
  .enter()
  .append("g")
  .call(
    d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended)
  );

// clipPath circulaire
node.append("clipPath")
  .attr("id", function(d){ return "clip-" + d.id; })
  .append("circle")
  .attr("r", function(d){ return sizeScale(d.totalCount); });

// cercle de bordure
node.append("circle")
  .attr("class", "node-border")
  .attr("r", function(d){ return sizeScale(d.totalCount); })
  .attr("stroke", "rgba(255,255,255,0.6)")
  .attr("stroke-width", 2)
  .attr("fill", "none");

// image
node.append("image")
  .attr("href", function(d){ return d.icon || null; })
  .attr("x", function(d){ return -sizeScale(d.totalCount); })
  .attr("y", function(d){ return -sizeScale(d.totalCount); })
  .attr("width", function(d){ return sizeScale(d.totalCount) * 2; })
  .attr("height", function(d){ return sizeScale(d.totalCount) * 2; })
  .attr("clip-path", function(d){ return "url(#clip-" + d.id + ")"; })
  .attr("preserveAspectRatio", "xMidYMid slice");

// label
node.append("text")
  .attr("class", "node-label")
  .attr("text-anchor", "middle")
  .attr("dy", function(d){ return sizeScale(d.totalCount) + 12; })
  .text(function(d){
    if (d.symbol) return d.symbol;
    if (d.label) return d.label;
    if (d.id) return d.id.slice(0,4) + "…" + d.id.slice(-3);
    return "?";
  });

// TOOLTIP
const tooltip = document.createElement("div");
tooltip.className = "graph-tooltip";
container.appendChild(tooltip);

function showTooltip(evt, d){
  tooltip.innerHTML =
    '<div class="title">' + (d.symbol || d.name || d.id) + '</div>' +
    '<div class="line"><span>Total</span><span>' + (d.totalCount || 0) + '</span></div>' +
    '<div class="line"><span>Buys</span><span>' + (d.buyCount || 0) + '</span></div>' +
    '<div class="line"><span>Sells</span><span>' + (d.sellCount || 0) + '</span></div>' +
    '<div class="line"><span>Transfers</span><span>' + (d.transferCount || 0) + '</span></div>';

  var rect = container.getBoundingClientRect();
  tooltip.style.left = (evt.clientX - rect.left + 12) + "px";
  tooltip.style.top = (evt.clientY - rect.top + 12) + "px";
  tooltip.style.opacity = "1";
}

function hideTooltip(){
  tooltip.style.opacity = "0";
}

node.on("mouseenter", function(evt, d){ showTooltip(evt, d); });
node.on("mouseleave", function(){ hideTooltip(); });
node.on("mousemove", function(evt, d){ showTooltip(evt, d); });

// SIMULATION
const simulation = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(links).id(function(d){ return d.id; }).distance(130).strength(0.35))
  .force("charge", d3.forceManyBody().strength(-260))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(function(d){ return sizeScale(d.totalCount) + 6; }))
  .on("tick", ticked);

function ticked(){
  link
    .attr("x1", function(d){ return d.source.x; })
    .attr("y1", function(d){ return d.source.y; })
    .attr("x2", function(d){ return d.target.x; })
    .attr("y2", function(d){ return d.target.y; });

  node.attr("transform", function(d){
    return "translate(" + d.x + "," + d.y + ")";
  });
}

function dragstarted(evt, d){
  if (!evt.active) simulation.alphaTarget(0.2).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(evt, d){
  d.fx = evt.x;
  d.fy = evt.y;
}

function dragended(evt, d){
  if (!evt.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}


})();

// Copy to clipboard
document.addEventListener('click', function (e) {
  const target = e.target;
  const btn = target && target.closest ? target.closest('button.copy') : null;
  if (!btn) return;

  const text = btn.getAttribute('data-copy');
  if (!text) return;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => onCopied(btn));
  } else {
    onCopied(btn);
  }

  function onCopied(button) {
    button.classList.add('ok');
    button.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

    setTimeout(() => {
      button.classList.remove('ok');
      button.innerHTML = button.classList.contains('token-copy')
        ? '<svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H8a2 2 0 0 0-2 2v2h2V3h8v8h2V3a2 2 0 0 0-2-2zm-3 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm0 12H5V9h8v10z"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H8a2 2 0 0 0-2 2v2h2V3h8v8h2V3a2 2 0 0 0-2-2zm-3 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm0 12H5V9h8v10z"/></svg>';
    }, 800);
  }
}, { passive: true });
</script>

</body>
</html>`;
        return html;
    }
    async writeHtml(actions, opts) {
        const html = await this.generateHtml(actions, opts);
        if (opts?.outFile) {
            await mkdir(dirname(opts.outFile), { recursive: true });
            await writeFile(opts.outFile, html, "utf8");
        }
        return html;
    }
}
//# sourceMappingURL=ReportService.js.map