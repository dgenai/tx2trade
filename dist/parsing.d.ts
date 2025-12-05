export type ParsedAction = any;
export type ParsedTx = {
    sig: string;
    tx: any | null;
};
export type ParseOptions = {
    debug: boolean;
    windowTotalFromOut: number;
    requireAuthorityUserForOut: boolean;
};
/**
 * Parse a single Solana transaction into trade actions without market data.
 * Candles will be added later in a dedicated enrichment step.
 */
export declare function parseTransactionToActionsWithoutCandles(sig: string, tx: any, options: ParseOptions): {
    actions: ParsedAction[];
    blockTime: number | null;
};
//# sourceMappingURL=parsing.d.ts.map