export type Commitment = "processed" | "confirmed" | "finalized";
export type SignatureInfo = {
    signature: string;
    slot: number;
    blockTime?: number | null;
    err?: any;
    memo: string | null;
};
export type RpcRequest = {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params?: any[];
};
export type RpcClientOptions = {
    endpoint: string;
    timeoutMs?: number;
    maxRetries?: number;
    retryBackoffMs?: number;
    defaultCommitment?: "processed" | "confirmed" | "finalized";
    debug?: boolean;
    log?: (...args: any[]) => void;
};
/**
 * Lightweight JSON-RPC client for Solana.
 */
export declare class SolanaRpcClient {
    private endpoint;
    private timeoutMs;
    private maxRetries;
    private retryBackoffMs;
    private defaultCommitment;
    private debug;
    private log;
    private requestCount;
    constructor(opts: RpcClientOptions);
    private dbg;
    getRequestsCount(): number;
    resetRequestsCount(): void;
    private post;
    getTransactionsParsedBatch(signatures: string[], maxSupportedTransactionVersion?: number): Promise<any[]>;
    getAccountsBase64(addresses: string[], chunkSize?: number): Promise<Record<string, any | null>>;
    getSignaturesForAddress(address: string, limit?: number, before?: string, until?: string, commitment?: "processed" | "confirmed" | "finalized"): Promise<SignatureInfo[]>;
    fetchAllSignaturesWithPagination(address: string, opts: {
        total: number;
        pageSize?: number;
        before?: string;
        until?: string;
        commitment?: Commitment;
        fromDate?: string;
        toDate?: string;
    }): Promise<string[]>;
    private hasTransfer;
}
//# sourceMappingURL=SolanaRpcClient.d.ts.map