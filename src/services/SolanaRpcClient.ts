import { setTimeout as delay } from "timers/promises";

export type RpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any[];
};

export type RpcClientOptions = {
  endpoint: string;
  timeoutMs?: number;
  maxRetries?: number;      // Retries on network errors / 429 / 5xx
  retryBackoffMs?: number;  // Base backoff duration (ms), exponential growth
  defaultCommitment?: "processed" | "confirmed" | "finalized";
};

/**
 * Lightweight JSON-RPC client for Solana.
 *
 * Features:
 *  - Supports POST with timeout and exponential backoff retry logic.
 *  - Provides helpers for common RPC calls (getTransaction, getMultipleAccounts).
 *  - Handles both standard RPC responses and vendor-specific wrappers (e.g. Helius).
 *  - Ensures batch order is preserved when fetching multiple items.
 */
export class SolanaRpcClient {
  private endpoint: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryBackoffMs: number;
  private defaultCommitment: RpcClientOptions["defaultCommitment"];

  constructor(opts: RpcClientOptions) {
    this.endpoint = opts.endpoint;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBackoffMs = opts.retryBackoffMs ?? 300;
    this.defaultCommitment = opts.defaultCommitment ?? "confirmed";
  }

  /**
   * POST JSON body to the Solana RPC endpoint with timeout + retries.
   * Retries are triggered on network errors, HTTP 429, or 5xx responses.
   */
  private async post<T = any>(body: any): Promise<T> {
    let attempt = 0;
    let lastErr: any;

    while (attempt <= this.maxRetries) {
      try {
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
          // Retry on 429 or 5xx
          if (res.status >= 500 || res.status === 429) {
            throw new Error(`HTTP ${res.status}`);
          }
          // Non-retryable 4xx
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        return await res.json();
      } catch (err) {
        lastErr = err;
        if (attempt === this.maxRetries) break;

        // Exponential backoff before retry
        const ms = this.retryBackoffMs * Math.pow(2, attempt);
        await delay(ms);
        attempt++;
      }
    }

    throw lastErr;
  }

  /**
   * Batch fetch parsed transactions (jsonParsed) by signature.
   *
   * - Preserves order of input signatures.
   * - Handles vendor-specific wrappers (Helius, etc).
   * - Returns `null` for missing transactions.
   *
   * @param signatures - Transaction signatures
   * @param maxSupportedTransactionVersion - Upper bound for decoding versioned transactions
   */
  async getTransactionsParsedBatch(
    signatures: string[],
    maxSupportedTransactionVersion = 0
  ): Promise<any[]> {
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

    // Some providers (e.g. Helius) wrap batch responses in a `data` field
    if (results?.data && Array.isArray(results.data)) {
      results = results.data;
    }
    if (!Array.isArray(results)) results = [results];

    const byId = new Map<number, any>();
    for (const r of results) {
      if (r && typeof r.id === "number") {
        byId.set(r.id, r.result ?? null);
      }
    }
    return signatures.map((_, i) => byId.get(i) ?? null);
  }

  /**
   * Fetch multiple accounts in base64 encoding.
   *
   * Strategy:
   *  - Attempt `getMultipleAccounts` for a chunk of addresses.
   *  - If unsupported or fails, fallback to batching `getAccountInfo` calls.
   *
   * @param addresses - Account addresses
   * @param chunkSize - Max accounts per request (default: 100)
   * @returns Map of address -> account data (or null if not found)
   */
  async getAccountsBase64(
    addresses: string[],
    chunkSize = 100
  ): Promise<Record<string, any | null>> {
    const out: Record<string, any | null> = {};

    for (let i = 0; i < addresses.length; i += chunkSize) {
      const chunk = addresses.slice(i, i + chunkSize);

      // Preferred method: getMultipleAccounts
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
          continue; // skip fallback
        }
      } catch {
        // Fallback to individual batch below
      }

      // Fallback method: batch getAccountInfo
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
    }

    return out;
  }
}
