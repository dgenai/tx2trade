import { SolanaRpcClient } from "./SolanaRpcClient.js";
import { TokenMeta, TradeAction } from "../types.js";
/**
 * Service for fetching and enriching token metadata using the Metaplex Metadata program.
 *
 * Responsibilities:
 *  - Extract unique token mints from trade actions.
 *  - Query Metaplex metadata accounts from the blockchain.
 *  - Decode metadata (name, symbol, URI) using Borsh deserialization.
 *  - Enrich trade actions with the fetched metadata for better readability.
 */
export declare class MetaplexMetadataService {
    private rpc;
    constructor(rpc: SolanaRpcClient);
    /**
     * Extract a deduplicated list of token mints involved in the given actions.
     * Native SOL is excluded (since it does not have on-chain metadata).
     */
    getUniqueMints(actions: TradeAction[]): string[];
    /**
     * Fetch and decode Metaplex metadata for all unique mints appearing in trade actions.
     *
     * @param actions - Trade actions containing token addresses
     * @returns A mapping of mint address -> decoded metadata (name, symbol, uri)
     */
    fetchTokenMetadataMapFromActions(actions: TradeAction[]): Promise<Record<string, TokenMeta>>;
    /**
     * Enrich trade actions with token metadata (name, symbol, uri).
     * Handles both sold and bought tokens.
     *
     * - If token = native SOL, adds human-readable "SOL" metadata.
     * - If token exists in metadata map, merges its name/symbol/uri.
     * - If metadata not found, keeps action unchanged.
     *
     * @param actions - List of trade actions
     * @param metaMap - Mapping from mint address -> token metadata
     * @returns A new array of trade actions enriched with metadata
     */
    enrichActionsWithMetadata<T extends TradeAction>(actions: T[], metaMap: Record<string, TokenMeta>): T[];
}
//# sourceMappingURL=MetaplexMetadataService.d.ts.map