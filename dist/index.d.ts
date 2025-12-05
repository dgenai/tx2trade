export type Tx2TradeInput = {
    sigs?: string[];
    address?: string;
    total?: number;
    pageSize?: number;
    before?: string;
    until?: string;
    fromDate?: string;
    toDate?: string;
    rpcEndpoint: string;
    debug?: boolean;
    windowTotalFromOut?: number;
    requireAuthorityUserForOut?: boolean;
};
export declare function tx2trade(input: Tx2TradeInput): Promise<import("./types.js").TradeAction[]>;
//# sourceMappingURL=index.d.ts.map