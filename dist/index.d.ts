/**
 * Options for customizing transaction-to-trade parsing.
 */
type Tx2TradeOpts = {
    debug?: boolean;
    windowTotalFromOut?: number;
    requireAuthorityUserForOut?: boolean;
};
export { SolanaRpcClient } from "./services/SolanaRpcClient.js";
/**
 * Convert a list of Solana transaction signatures into enriched trade actions.
 * Now:
 *  1) Fetch ALL transactions in batches
 *  2) Parse AFTER everything is fetched
 *  3) Enrich with Metaplex metadata
 */
export declare function tx2trade(sigs: string[], rpcEndpoint: string, opts?: Tx2TradeOpts): Promise<any[]>;
//# sourceMappingURL=index.d.ts.map