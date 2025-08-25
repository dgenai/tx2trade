export type EnrichedAction = {
    txHash: string;
    wallet: string;
    blockTime?: number | null;
    type: string;
    amount?: number;
    amountUsd?: number;
    tokenSymbol?: string;
    tokenMint?: string;
    tokenName?: string;
    soldSymbol?: string;
    soldAmount?: number;
    soldMint?: string;
    boughtSymbol?: string;
    boughtAmount?: number;
    boughtMint?: string;
};
export type ReportOptions = {
    outFile?: string;
    title?: string;
};
type AnyRec = Record<string, any>;
export declare class ReportService {
    private esc;
    private short;
    private fmtAmt;
    private tokenCell;
    generateHtml(_actions: AnyRec[], opts?: ReportOptions): string;
    writeHtml(actions: AnyRec[], opts?: ReportOptions): Promise<string>;
}
export {};
//# sourceMappingURL=ReportService.d.ts.map