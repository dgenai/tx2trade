import { TransferEdge, WSOL_MINT } from "../types.js";

export type SolHub = { account: string; inEdges: TransferEdge[]; outEdges: TransferEdge[] };

export function findSolHubsByAuthority(
  edges: TransferEdge[],
  userWallets: string[],
  opts?: { debug?: boolean; log?: (...args: any[]) => void }
): Map<string, SolHub> {
  const { debug = false } = opts ?? {};
  const log = opts?.log ?? ((...args: any[]) => { if (debug) console.debug("[findSolHubsByAuthority]", ...args); });

  const hubs = new Map<string, SolHub>();

  for (const e of edges) {
    if (e.mint !== WSOL_MINT) continue;
    if (!e.authority || userWallets.includes(e.authority ?? "")) continue; // aggregator/MM only

    log("Processing edge", e);

    // incoming to hub
    let hIn = hubs.get(e.destination);
    if (!hIn) hubs.set(e.destination, (hIn = { account: e.destination, inEdges: [], outEdges: [] }));
    hIn.inEdges.push(e);

    // outgoing from hub
    let hOut = hubs.get(e.source);
    if (!hOut) hubs.set(e.source, (hOut = { account: e.source, inEdges: [], outEdges: [] }));
    hOut.outEdges.push(e);
  }

  for (const [k, h] of [...hubs]) {
    if (!h.inEdges.length || !h.outEdges.length) {
      log(`Pruning hub ${k}, missing in/out edges`);
      hubs.delete(k);
    } else {
      h.inEdges.sort((a, b) => a.seq - b.seq);
      h.outEdges.sort((a, b) => a.seq - b.seq);
      log(`Final hub ${k}`, h);
    }
  }

  log(`Built ${hubs.size} hubs`);
  return hubs;
}
