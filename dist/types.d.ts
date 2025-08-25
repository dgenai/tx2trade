export type TradeAction = {
    transactionHash: string;
    transactionType: "buy" | "sell";
    walletAddress: string;
    transactionDate: Date;
    sold: {
        address?: string;
        amount?: number;
        symbol?: string;
        name?: string;
        uri?: string;
    };
    bought: {
        address?: string;
        amount?: number;
        symbol?: string;
        name?: string;
        uri?: string;
    };
};
export interface TransferEdge {
    seq: number;
    source: string;
    destination: string;
    mint: string;
    amount: number;
    authority?: string;
    programId?: string;
    depth?: number;
}
export interface SwapLeg {
    soldMint: string;
    soldAmount: number;
    boughtMint: string;
    boughtAmount: number;
    path: TransferEdge[];
}
export type TokAccInfo = {
    mint: string;
    decimals?: number;
    owner?: string;
};
export type TokenMeta = {
    name?: string;
    symbol?: string;
    uri?: string;
};
export declare const WSOL_MINT = "So11111111111111111111111111111111111111112";
export declare function num(x: any): number;
export declare function to58(x: any): string;
//# sourceMappingURL=types.d.ts.map