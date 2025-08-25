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
export type Interval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';
export type BinanceKlineTuple = [
    number,
    string,
    string,
    string,
    string,
    string,
    number,
    string,
    number,
    string,
    string,
    string
];
export interface Candlestick {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
    quoteAssetVolume: number;
    trades: number;
    takerBuyBaseAssetVolume: number;
    takerBuyQuoteAssetVolume: number;
}
export interface BinanceKlinesServiceOptions {
    market?: Market;
    baseUrlOverride?: string;
    requestTimeoutMs?: number;
    maxRetries?: number;
    minDelayMs?: number;
}
export interface FetchRangeParams {
    symbol: string;
    interval: Interval;
    startTimeMs: number;
    endTimeMs: number;
    limitPerCall?: number;
}
export declare class BinanceKlinesService {
    private baseUrl;
    private timeout;
    private retries;
    private minDelay;
    private endpointPath;
    constructor(opts?: BinanceKlinesServiceOptions);
    /**
     * Fetch all candlesticks for a given range, automatically paginated.
     */
    fetchKlinesRange(params: FetchRangeParams): Promise<Candlestick[]>;
    /**
     * Async generator if you prefer processing batch by batch.
     */
    iterateKlinesRange(params: FetchRangeParams): AsyncGenerator<Candlestick[], void, void>;
    private _mapTuple;
    private _getWithRetry;
    private _expBackoff;
    private _sleep;
}
/** Convert a Date/number/string into a UTC ms timestamp. */
export declare function toMsUTC(input: Date | number | string): number;
/** Example helper: fetch 1m klines for today in UTC. */
export declare function fetchToday1mSOL(): Promise<Candlestick[]>;
//# sourceMappingURL=BinanceKlinesService.d.ts.map