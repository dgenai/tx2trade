import { TradeAction } from "../types.js";
export type EnrichedAction = {
    txHash: string;
    wallet: string;
    blockTime?: number | null;
    type: string;
    amount?: number;
    tokenSymbol?: string;
    tokenMint?: string;
    tokenName?: string;
    soldSymbol?: string;
    soldName?: string;
    soldAmount?: number;
    soldMint?: string;
    soldUsdPrice?: number;
    soldUsdAmount?: number;
    boughtSymbol?: string;
    boughtName?: string;
    boughtAmount?: number;
    boughtMint?: string;
    boughtUsdPrice?: number;
    boughtUsdAmount?: number;
};
export type ReportOptions = {
    outFile?: string;
    title?: string;
};
export declare class ReportService {
    private esc;
    private short;
    private fmtAmt;
    private tokenCell;
    generateHtml(_actions: TradeAction[], opts?: ReportOptions): Promise<string>;
    writeHtml(actions: TradeAction[], opts?: ReportOptions): Promise<string>;
}
//# sourceMappingURL=ReportService.d.ts.map