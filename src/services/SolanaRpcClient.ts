import { setTimeout as delay } from "timers/promises";

export type SignatureInfo = {
  signature: string;
  slot: number;
  blockTime?: number | null;
  err?: any;
  memo: string | null;
};

export type RpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any[];
};

export type RpcClientOptions = {
  endpoint: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  defaultCommitment?: "processed" | "confirmed" | "finalized";
  debug?: boolean;
  log?: (...args: any[]) => void;
};

/**
 * Lightweight JSON-RPC client for Solana.
 */
export class SolanaRpcClient {
  private endpoint: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryBackoffMs: number;
  private defaultCommitment: RpcClientOptions["defaultCommitment"];
  private debug: boolean;
  private log: (...args: any[]) => void;

  private requestCount = 0;

  constructor(opts: RpcClientOptions) {
    this.endpoint = opts.endpoint;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBackoffMs = opts.retryBackoffMs ?? 300;
    this.defaultCommitment = opts.defaultCommitment ?? "confirmed";

    // cohérent avec ton premier fichier
    this.debug = opts.debug ?? true;
    this.log = opts.log ?? (() => {});
  }

  private dbg = (...args: any[]) => {
    if (this.debug) this.log(`[SolanaRpcClient]`, ...args);
  };

  getRequestsCount() {
    return this.requestCount;
  }

  resetRequestsCount() {
    this.requestCount = 0;
  }


  private async post<T = any>(body: any): Promise<T> {
    let attempt = 0;
    let lastErr: any;

    while (attempt <= this.maxRetries) {
      try {
        this.requestCount++;
        
        this.dbg("POST attempt", attempt + 1, "of", this.maxRetries + 1, { body });

        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), this.timeoutMs);

        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(t);

        if (!res.ok) {
          this.dbg("Non-OK response", res.status);
          if (res.status >= 500 || res.status === 429) {
            throw new Error(`HTTP ${res.status}`);
          }
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = await res.json();
        this.dbg("Response received", { json });
        return json;
      } catch (err) {
        lastErr = err;
        this.dbg("Error on attempt", attempt + 1, err);

        if (attempt === this.maxRetries) break;

        const ms = this.retryBackoffMs * Math.pow(2, attempt);
        this.dbg("Retrying after backoff", ms, "ms");
        await delay(ms);
        attempt++;
      }
    }

    this.dbg("All retries failed", lastErr);
    throw lastErr;
  }

  async getTransactionsParsedBatch(
    signatures: string[],
    maxSupportedTransactionVersion = 0
  ): Promise<any[]> {
    this.dbg("Fetching parsed transactions batch", { count: signatures.length });

    const batch: RpcRequest[] = signatures.map((sig, idx) => ({
      jsonrpc: "2.0",
      id: idx,
      method: "getTransaction",
      params: [
        sig,
        {
          maxSupportedTransactionVersion,
          commitment: this.defaultCommitment,
          encoding: "jsonParsed",
        },
      ],
    }));

    let results: any = await this.post(batch);

    if (results?.data && Array.isArray(results.data)) {
      this.dbg("Detected vendor-specific wrapper (data field)");
      results = results.data;
    }
    if (!Array.isArray(results)) results = [results];

    const byId = new Map<number, any>();
    for (const r of results) {
      if (r && typeof r.id === "number") {
        byId.set(r.id, r.result ?? null);
      }
    }

    const final = signatures.map((_, i) => byId.get(i) ?? null);
    this.dbg("Batch result assembled", { found: final.filter(Boolean).length });
    return final;
  }

  async getAccountsBase64(
    addresses: string[],
    chunkSize = 100
  ): Promise<Record<string, any | null>> {
    this.dbg("Fetching accounts (base64)", { total: addresses.length, chunkSize });

    const out: Record<string, any | null> = {};

    for (let i = 0; i < addresses.length; i += chunkSize) {
      const chunk = addresses.slice(i, i + chunkSize);
      this.dbg("Processing chunk", { from: i, to: i + chunk.length });

      try {
        const multiReq: RpcRequest = {
          jsonrpc: "2.0",
          id: "gma",
          method: "getMultipleAccounts",
          params: [chunk, { encoding: "base64", commitment: this.defaultCommitment }],
        };
        const multiRes = await this.post<any>(multiReq);

        if (multiRes?.result?.value && Array.isArray(multiRes.result.value)) {
          multiRes.result.value.forEach((acc: any, idx: number) => {
            out[chunk[idx]] = acc ?? null;
          });
          this.dbg("getMultipleAccounts success", { count: chunk.length });
          continue;
        }
      } catch (err) {
        this.dbg("getMultipleAccounts failed, falling back", err);
      }

      const batch: RpcRequest[] = chunk.map((addr, idx) => ({
        jsonrpc: "2.0",
        id: idx,
        method: "getAccountInfo",
        params: [addr, { encoding: "base64", commitment: this.defaultCommitment }],
      }));

      let results: any = await this.post(batch);
      if (!Array.isArray(results)) results = [results];

      const byId = new Map<number, any>();
      for (const r of results) {
        if (r && typeof r.id === "number") {
          byId.set(r.id, r.result?.value ?? null);
        }
      }

      chunk.forEach((addr, idx) => (out[addr] = byId.get(idx) ?? null));
      this.dbg("Fallback getAccountInfo success", { count: chunk.length });
    }

    this.dbg("Final accounts result", { count: Object.keys(out).length });
    return out;
  }

  async getSignaturesForAddress(
    address: string,
    limit = 1000,
    before?: string,
    until?: string,
    commitment: "processed" | "confirmed" | "finalized" =
      this.defaultCommitment as "processed" | "confirmed" | "finalized"
  ): Promise<SignatureInfo[]> {
    this.dbg("Fetching signatures for address", { address, limit, before, until });

    const params: any = [
      address,
      {
        limit,
        commitment,
      },
    ];
    if (before) params[1].before = before;
    if (until) params[1].until = until;

    const req: RpcRequest = {
      jsonrpc: "2.0",
      id: "gsfa",
      method: "getSignaturesForAddress",
      params,
    };

    const res = await this.post<any>(req);
    const result = res?.data?.result ?? res?.result;

    const out = Array.isArray(result) ? (result as SignatureInfo[]) : [];
    this.dbg("Signatures fetched", { count: out.length });
    return out;
  }
}
