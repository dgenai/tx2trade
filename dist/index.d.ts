export { SolanaRpcClient } from "./services/SolanaRpcClient.js";
/**
 * Unified input format for tx2trade(), compatible with both CLI modes:
 *  - Direct signature list
 *  - Address mode with pagination + strict count validation
 */
export type Tx2TradeInput = {
    sigs?: string[];
    address?: string;
    total?: number;
    pageSize?: number;
    before?: string;
    until?: string;
    rpcEndpoint: string;
    debug?: boolean;
    windowTotalFromOut?: number;
    requireAuthorityUserForOut?: boolean;
};
/**
 * tx2trade()
 * ==========
 * Main pipeline used by the CLI:
 *  - Signature-mode or address-mode
 *  - Full transaction fetch with strict validation
 *  - Skip failed tx (meta.err)
 *  - Klines enrichment identical to CLI
 *  - Legs → Actions → Metadata enrichment
 *
 * Output: Array of enriched trade actions
 */
export declare function tx2trade(input: Tx2TradeInput): Promise<any[]>;
//# sourceMappingURL=index.d.ts.map