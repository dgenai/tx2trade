import { setTimeout as delay } from "timers/promises";
/**
 * Lightweight JSON-RPC client for Solana.
 */
export class SolanaRpcClient {
    constructor(opts) {
        this.requestCount = 0;
        this.dbg = (...args) => {
            if (this.debug)
                this.log(`[SolanaRpcClient]`, ...args);
        };
        this.endpoint = opts.endpoint;
        this.timeoutMs = opts.timeoutMs ?? 30000;
        this.maxRetries = opts.maxRetries ?? 3;
        this.retryBackoffMs = opts.retryBackoffMs ?? 300;
        this.defaultCommitment = opts.defaultCommitment ?? "confirmed";
        // cohérent avec ton premier fichier
        this.debug = opts.debug ?? true;
        this.log = opts.log ?? (() => { });
    }
    getRequestsCount() {
        return this.requestCount;
    }
    resetRequestsCount() {
        this.requestCount = 0;
    }
    async post(body) {
        let attempt = 0;
        let lastErr;
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
            }
            catch (err) {
                lastErr = err;
                const message = err instanceof Error ? err.message : String(err);
                this.dbg("Error on attempt", attempt + 1, message);
                if (attempt === this.maxRetries)
                    break;
                const ms = this.retryBackoffMs * Math.pow(2, attempt);
                this.dbg("Retrying after backoff", ms, "ms");
                await delay(ms);
                attempt++;
            }
        }
        this.dbg("All retries failed", lastErr);
        throw lastErr;
    }
    async getTransactionsParsedBatch(signatures, maxSupportedTransactionVersion = 0) {
        this.dbg("Fetching parsed transactions batch", { count: signatures.length });
        const batch = signatures.map((sig, idx) => ({
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
        let results = await this.post(batch);
        if (results?.data && Array.isArray(results.data)) {
            this.dbg("Detected vendor-specific wrapper (data field)");
            results = results.data;
        }
        if (!Array.isArray(results))
            results = [results];
        const byId = new Map();
        for (const r of results) {
            if (r && typeof r.id === "number") {
                byId.set(r.id, r.result ?? null);
            }
        }
        const final = signatures.map((_, i) => byId.get(i) ?? null);
        this.dbg("Batch result assembled", { found: final.filter(Boolean).length });
        return final;
    }
    async getAccountsBase64(addresses, chunkSize = 100) {
        this.dbg("Fetching accounts (base64)", { total: addresses.length, chunkSize });
        const out = {};
        for (let i = 0; i < addresses.length; i += chunkSize) {
            const chunk = addresses.slice(i, i + chunkSize);
            this.dbg("Processing chunk", { from: i, to: i + chunk.length });
            try {
                const multiReq = {
                    jsonrpc: "2.0",
                    id: "gma",
                    method: "getMultipleAccounts",
                    params: [chunk, { encoding: "base64", commitment: this.defaultCommitment }],
                };
                const multiRes = await this.post(multiReq);
                if (multiRes?.result?.value && Array.isArray(multiRes.result.value)) {
                    multiRes.result.value.forEach((acc, idx) => {
                        out[chunk[idx]] = acc ?? null;
                    });
                    this.dbg("getMultipleAccounts success", { count: chunk.length });
                    continue;
                }
            }
            catch (err) {
                this.dbg("getMultipleAccounts failed, falling back", err);
            }
            const batch = chunk.map((addr, idx) => ({
                jsonrpc: "2.0",
                id: idx,
                method: "getAccountInfo",
                params: [addr, { encoding: "base64", commitment: this.defaultCommitment }],
            }));
            let results = await this.post(batch);
            if (!Array.isArray(results))
                results = [results];
            const byId = new Map();
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
    async getSignaturesForAddress(address, limit = 1000, before, until, commitment = this.defaultCommitment) {
        this.dbg("Fetching signatures for address", { address, limit, before, until });
        const params = [
            address,
            {
                limit,
                commitment,
            },
        ];
        if (before)
            params[1].before = before;
        if (until)
            params[1].until = until;
        const req = {
            jsonrpc: "2.0",
            id: "gsfa",
            method: "getSignaturesForAddress",
            params,
        };
        const res = await this.post(req);
        const result = res?.data?.result ?? res?.result;
        const out = Array.isArray(result) ? result : [];
        this.dbg("Signatures fetched", { count: out.length });
        return out;
    }
    async fetchAllSignaturesWithPagination(address, opts) {
        const totalTarget = Math.max(1, opts.total);
        const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? Math.min(100, totalTarget)));
        let before = opts.before;
        const until = opts.until;
        const commitment = opts.commitment;
        const sigs = [];
        const seen = new Set();
        while (sigs.length < totalTarget) {
            const remaining = totalTarget - sigs.length;
            const pageCap = Math.min(pageSize, remaining);
            const page = await this.getSignaturesForAddress(address, pageCap, before, until, commitment ?? "confirmed");
            if (page.length === 0)
                break;
            for (const s of page) {
                if (!seen.has(s.signature)) {
                    sigs.push(s.signature);
                    seen.add(s.signature);
                    if (sigs.length >= totalTarget)
                        break;
                }
            }
            // Advance pagination anchor
            const last = page[page.length - 1]?.signature;
            if (!last || last === before)
                break; // no progress guard
            before = last;
            this.dbg(`↪️  Pagination: collected ${sigs.length}/${totalTarget} (next before=${before})`);
        }
        return sigs;
    }
}
//# sourceMappingURL=SolanaRpcClient.js.map