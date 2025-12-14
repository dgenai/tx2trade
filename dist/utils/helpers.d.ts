export declare function blockTimeToDate(blockTime: number): Date;
export declare function chunkArray<T>(arr: T[], size: number): T[][];
export declare function buildTradeWindows(blockTimesSec: number[], intervalMs: number, beforeCandles?: number, afterCandles?: number): {
    startMs: number;
    endMs: number;
}[];
//# sourceMappingURL=helpers.d.ts.map