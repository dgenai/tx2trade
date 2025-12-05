/**
 * BinanceKlinesService
 * ---------------------
 * Fetch Binance candlesticks (klines) with 1-minute (or other) granularity,
 * over any arbitrary time range, with automatic pagination, deduplication,
 * retry/backoff on 429/5xx, and conversion into typed objects.
 *
 *  Requirements: Node.js 18+ (native fetch) or install `undici`/`node-fetch`.
 *
 *  Usage example:
 *    const svc = new BinanceKlinesService({ market: 'spot' });
 *    const data = await svc.fetchKlinesRange({
 *      symbol: 'SOLUSDT',
 *      interval: '1m',
 *      startTimeMs: Date.UTC(2025, 0, 1, 0, 0, 0), // Jan 1, 2025 00:00:00 UTC
 *      endTimeMs:   Date.UTC(2025, 0, 2, 0, 0, 0)  // Jan 2, 2025 00:00:00 UTC
 *    });
 *    console.log('Candles:', data.length);
 */
const INTERVAL_MS = {
    '1m': 60000,
    '3m': 3 * 60000,
    '5m': 5 * 60000,
    '15m': 15 * 60000,
    '30m': 30 * 60000,
    '1h': 60 * 60000,
    '2h': 2 * 60 * 60000,
    '4h': 4 * 60 * 60000,
    '6h': 6 * 60 * 60000,
    '8h': 8 * 60 * 60000,
    '12h': 12 * 60 * 60000,
    '1d': 24 * 60 * 60000,
    '3d': 3 * 24 * 60 * 60000,
    '1w': 7 * 24 * 60 * 60000,
    '1M': 30 * 24 * 60 * 60000, // approximation
};
const BASE_URLS = {
    spot: 'https://api.binance.com',
    'usd-m-futures': 'https://fapi.binance.com',
};
export class BinanceKlinesService {
    constructor(opts = {}) {
        const market = opts.market ?? 'spot';
        this.baseUrl = opts.baseUrlOverride ?? BASE_URLS[market];
        this.endpointPath = market === 'spot' ? '/api/v3/klines' : '/fapi/v1/klines';
        this.timeout = opts.requestTimeoutMs ?? 30000;
        this.retries = opts.maxRetries ?? 5;
        this.minDelay = opts.minDelayMs ?? 200; // default 0.2s
    }
    /**
     * Fetch all candlesticks for a given range, automatically paginated.
     */
    async fetchKlinesRange(params) {
        const { symbol, interval, startTimeMs, endTimeMs } = params;
        const limit = Math.min(Math.max(params.limitPerCall ?? 1000, 1), 1000);
        if (!(interval in INTERVAL_MS)) {
            throw new Error(`Unsupported interval: ${interval}`);
        }
        if (endTimeMs <= startTimeMs) {
            return [];
        }
        console.log(`[BinanceKlinesService] Fetching ${symbol} ${interval} from ${new Date(startTimeMs).toISOString()} to ${new Date(endTimeMs).toISOString()}`);
        const out = [];
        let nextStart = startTimeMs;
        const step = INTERVAL_MS[interval];
        let callCount = 0;
        while (nextStart <= endTimeMs) {
            const search = new URLSearchParams({
                symbol,
                interval,
                startTime: String(nextStart),
                endTime: String(endTimeMs),
                limit: String(limit),
            });
            const url = `${this.baseUrl}${this.endpointPath}?${search.toString()}`;
            console.log(`[BinanceKlinesService] Requesting: ${url}`);
            const klines = await this._getWithRetry(url);
            callCount++;
            console.log(`[BinanceKlinesService] Batch #${callCount}: received ${klines?.length ?? 0} candles`);
            if (!Array.isArray(klines) || klines.length === 0) {
                console.log(`[BinanceKlinesService] No more data, stopping.`);
                break;
            }
            for (const k of klines) {
                const c = this._mapTuple(k);
                if (c.openTime > endTimeMs)
                    break;
                const last = out[out.length - 1];
                if (!last || last.openTime < c.openTime) {
                    out.push(c);
                }
            }
            const lastOpen = out[out.length - 1]?.openTime;
            if (lastOpen == null) {
                console.log(`[BinanceKlinesService] No last candle, stopping.`);
                break;
            }
            nextStart = lastOpen + step;
            if (klines.length < limit && nextStart > endTimeMs) {
                console.log(`[BinanceKlinesService] Reached end of range.`);
                break;
            }
            await this._sleep(this.minDelay);
        }
        console.log(`[BinanceKlinesService] Done. Total candles: ${out.length}`);
        return out;
    }
    /**
     * Async generator if you prefer processing batch by batch.
     */
    async *iterateKlinesRange(params) {
        const { symbol, interval, startTimeMs, endTimeMs } = params;
        const limit = Math.min(Math.max(params.limitPerCall ?? 1000, 1), 1000);
        if (!(interval in INTERVAL_MS))
            throw new Error(`Unsupported interval: ${interval}`);
        if (endTimeMs <= startTimeMs)
            return;
        let nextStart = startTimeMs;
        const step = INTERVAL_MS[interval];
        while (nextStart <= endTimeMs) {
            const search = new URLSearchParams({
                symbol, interval,
                startTime: String(nextStart),
                endTime: String(endTimeMs),
                limit: String(limit),
            });
            const url = `${this.baseUrl}${this.endpointPath}?${search.toString()}`;
            const klines = await this._getWithRetry(url);
            if (!Array.isArray(klines) || klines.length === 0)
                break;
            const batch = [];
            for (const k of klines) {
                const c = this._mapTuple(k);
                if (c.openTime > endTimeMs)
                    break;
                if (batch.length === 0 || batch[batch.length - 1].openTime < c.openTime) {
                    batch.push(c);
                }
            }
            if (batch.length === 0)
                break;
            yield batch;
            nextStart = batch[batch.length - 1].openTime + step;
            await this._sleep(this.minDelay);
        }
    }
    // --- Internals -----------------------------------------------------------
    _mapTuple(k) {
        return {
            openTime: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            closeTime: k[6],
            quoteAssetVolume: parseFloat(k[7]),
            trades: k[8],
            takerBuyBaseAssetVolume: parseFloat(k[9]),
            takerBuyQuoteAssetVolume: parseFloat(k[10]),
        };
    }
    async _getWithRetry(url, attempt = 0) {
        try {
            const ctrl = new AbortController();
            const id = setTimeout(() => ctrl.abort(), this.timeout);
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(id);
            if (res.status === 429 || res.status === 418 || res.status >= 500) {
                throw new HttpRetryableError(res.status, await safeText(res));
            }
            if (!res.ok) {
                const text = await safeText(res);
                throw new Error(`HTTP ${res.status}: ${text}`);
            }
            return (await res.json());
        }
        catch (err) {
            if (attempt >= this.retries)
                throw err;
            const backoff = this._expBackoff(attempt);
            await this._sleep(backoff);
            return this._getWithRetry(url, attempt + 1);
        }
    }
    _expBackoff(attempt) {
        // 400ms, 800ms, 1600ms, ... (slight jitter)
        const base = 400 * Math.pow(2, attempt);
        const jitter = Math.random() * 100;
        return base + jitter;
    }
    _sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
}
class HttpRetryableError extends Error {
    constructor(status, message) {
        super(message ?? `HTTP ${status}`);
        this.status = status;
        this.name = 'HttpRetryableError';
    }
}
async function safeText(res) {
    try {
        return await res.text();
    }
    catch {
        return '';
    }
}
// ---------------------------------------------------------------------------
// Helpers: convenient date parsing (optional)
// ---------------------------------------------------------------------------
/** Convert a Date/number/string into a UTC ms timestamp. */
export function toMsUTC(input) {
    if (typeof input === 'number')
        return input;
    if (input instanceof Date)
        return input.getTime();
    const t = Date.parse(input);
    if (Number.isNaN(t))
        throw new Error(`Invalid date: ${input}`);
    return t;
}
/** Example helper: fetch 1m klines for today in UTC. */
export async function fetchToday1mSOL() {
    const now = Date.now();
    const startUTC = new Date();
    startUTC.setUTCHours(0, 0, 0, 0);
    const svc = new BinanceKlinesService({ market: 'spot' });
    return svc.fetchKlinesRange({
        symbol: 'SOLUSDT',
        interval: '1m',
        startTimeMs: startUTC.getTime(),
        endTimeMs: now,
    });
}
//# sourceMappingURL=BinanceKlinesService.js.map