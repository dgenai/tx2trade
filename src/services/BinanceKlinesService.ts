/**
 * BinanceKlinesService
 * ---------------------
 * Fetch Binance candlesticks (klines) with 1-minute (or other) granularity,
 * over any arbitrary time range, with automatic pagination, deduplication,
 * retry/backoff on 429/5xx, and conversion into typed objects.
 *
 * ⚙️ Requirements: Node.js 18+ (native fetch) or install `undici`/`node-fetch`.
 *
 * ✅ Usage example:
 *    const svc = new BinanceKlinesService({ market: 'spot' });
 *    const data = await svc.fetchKlinesRange({
 *      symbol: 'SOLUSDT',
 *      interval: '1m',
 *      startTimeMs: Date.UTC(2025, 0, 1, 0, 0, 0), // Jan 1, 2025 00:00:00 UTC
 *      endTimeMs:   Date.UTC(2025, 0, 2, 0, 0, 0)  // Jan 2, 2025 00:00:00 UTC
 *    });
 *    console.log('Candles:', data.length);
 */

export type Market = 'spot' | 'usd-m-futures';

export type Interval =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M';

const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '8h': 8 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
  '1M': 30 * 24 * 60 * 60_000, // approximation
};

const BASE_URLS: Record<Market, string> = {
  spot: 'https://api.binance.com',
  'usd-m-futures': 'https://fapi.binance.com',
};

// Binance kline tuple format (array):
// [
//   0 openTime, 1 open, 2 high, 3 low, 4 close, 5 volume,
//   6 closeTime, 7 quoteAssetVolume, 8 numberOfTrades,
//   9 takerBuyBaseAssetVolume, 10 takerBuyQuoteAssetVolume, 11 ignore
// ]
export type BinanceKlineTuple = [
  number, string, string, string, string, string,
  number, string, number, string, string, string
];

export interface Candlestick {
  openTime: number;              // ms epoch (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;             // ms epoch (UTC)
  quoteAssetVolume: number;
  trades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
}

export interface BinanceKlinesServiceOptions {
  market?: Market;               // 'spot' (default) or 'usd-m-futures'
  baseUrlOverride?: string;      // override base URL if needed
  requestTimeoutMs?: number;     // per-request timeout
  maxRetries?: number;           // max retries on 429/5xx
  minDelayMs?: number;           // min delay between requests to avoid rate limit
}

export interface FetchRangeParams {
  symbol: string;                // e.g., 'SOLUSDT'
  interval: Interval;            // e.g., '1m'
  startTimeMs: number;           // UTC ms
  endTimeMs: number;             // UTC ms (exclusive: last candle <= end)
  limitPerCall?: number;         // default 1000 (Binance max)
}

export class BinanceKlinesService {
  private baseUrl: string;
  private timeout: number;
  private retries: number;
  private minDelay: number;
  private endpointPath: string;

  constructor(opts: BinanceKlinesServiceOptions = {}) {
    const market: Market = opts.market ?? 'spot';
    this.baseUrl = opts.baseUrlOverride ?? BASE_URLS[market];
    this.endpointPath = market === 'spot' ? '/api/v3/klines' : '/fapi/v1/klines';
    this.timeout = opts.requestTimeoutMs ?? 30_000;
    this.retries = opts.maxRetries ?? 5;
    this.minDelay = opts.minDelayMs ?? 200; // default 0.2s
  }

  /**
   * Fetch all candlesticks for a given range, automatically paginated.
   */
  async fetchKlinesRange(params: FetchRangeParams): Promise<Candlestick[]> {
    const { symbol, interval, startTimeMs, endTimeMs } = params;
    const limit = Math.min(Math.max(params.limitPerCall ?? 1000, 1), 1000);

    if (!(interval in INTERVAL_MS)) {
      throw new Error(`Unsupported interval: ${interval}`);
    }
    if (endTimeMs <= startTimeMs) {
      return [];
    }

    console.log(`[BinanceKlinesService] Fetching ${symbol} ${interval} from ${new Date(startTimeMs).toISOString()} to ${new Date(endTimeMs).toISOString()}`);

    const out: Candlestick[] = [];
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

      const klines = await this._getWithRetry<BinanceKlineTuple[]>(url);
      callCount++;

      console.log(`[BinanceKlinesService] Batch #${callCount}: received ${klines?.length ?? 0} candles`);

      if (!Array.isArray(klines) || klines.length === 0) {
        console.log(`[BinanceKlinesService] No more data, stopping.`);
        break;
      }

      for (const k of klines) {
        const c = this._mapTuple(k);
        if (c.openTime > endTimeMs) break;
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
  async *iterateKlinesRange(params: FetchRangeParams): AsyncGenerator<Candlestick[], void, void> {
    const { symbol, interval, startTimeMs, endTimeMs } = params;
    const limit = Math.min(Math.max(params.limitPerCall ?? 1000, 1), 1000);

    if (!(interval in INTERVAL_MS)) throw new Error(`Unsupported interval: ${interval}`);
    if (endTimeMs <= startTimeMs) return;

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
      const klines = await this._getWithRetry<BinanceKlineTuple[]>(url);
      if (!Array.isArray(klines) || klines.length === 0) break;

      const batch: Candlestick[] = [];
      for (const k of klines) {
        const c = this._mapTuple(k);
        if (c.openTime > endTimeMs) break;
        if (batch.length === 0 || batch[batch.length - 1].openTime < c.openTime) {
          batch.push(c);
        }
      }

      if (batch.length === 0) break;
      yield batch;

      nextStart = batch[batch.length - 1].openTime + step;
      await this._sleep(this.minDelay);
    }
  }

  // --- Internals -----------------------------------------------------------

  private _mapTuple(k: BinanceKlineTuple): Candlestick {
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

  private async _getWithRetry<T>(url: string, attempt = 0): Promise<T> {
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
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= this.retries) throw err;
      const backoff = this._expBackoff(attempt);
      await this._sleep(backoff);
      return this._getWithRetry<T>(url, attempt + 1);
    }
  }

  private _expBackoff(attempt: number): number {
    // 400ms, 800ms, 1600ms, ... (slight jitter)
    const base = 400 * Math.pow(2, attempt);
    const jitter = Math.random() * 100;
    return base + jitter;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

class HttpRetryableError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpRetryableError';
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Helpers: convenient date parsing (optional)
// ---------------------------------------------------------------------------

/** Convert a Date/number/string into a UTC ms timestamp. */
export function toMsUTC(input: Date | number | string): number {
  if (typeof input === 'number') return input;
  if (input instanceof Date) return input.getTime();
  const t = Date.parse(input);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${input}`);
  return t;
}

/** Example helper: fetch 1m klines for today in UTC. */
export async function fetchToday1mSOL(): Promise<Candlestick[]> {
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
