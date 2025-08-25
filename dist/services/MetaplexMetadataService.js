import { PublicKey } from "@solana/web3.js";
import { decodeMetaplexMetadataBase64 } from "../utils/borsh.js";
import { METAPLEX_PROGRAM_ID, NATIVE_SOL } from "../constants.js";
/**
 * Derive the PDA (Program Derived Address) of a Metaplex metadata account for a given mint.
 *
 * @param mint - The mint address of the token
 * @returns The PDA of the corresponding metadata account (base58 string)
 */
function toMetadataPda(mint) {
    const mintPk = new PublicKey(mint);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mintPk.toBuffer()], METAPLEX_PROGRAM_ID);
    return pda.toBase58();
}
/**
 * Service for fetching and enriching token metadata using the Metaplex Metadata program.
 *
 * Responsibilities:
 *  - Extract unique token mints from trade actions.
 *  - Query Metaplex metadata accounts from the blockchain.
 *  - Decode metadata (name, symbol, URI) using Borsh deserialization.
 *  - Enrich trade actions with the fetched metadata for better readability.
 */
export class MetaplexMetadataService {
    constructor(rpc) {
        this.rpc = rpc;
    }
    /**
     * Extract a deduplicated list of token mints involved in the given actions.
     * Native SOL is excluded (since it does not have on-chain metadata).
     */
    getUniqueMints(actions) {
        const set = new Set();
        for (const a of actions) {
            const s = a.sold?.address;
            const b = a.bought?.address;
            if (s && s !== NATIVE_SOL)
                set.add(s);
            if (b && b !== NATIVE_SOL)
                set.add(b);
        }
        return [...set];
    }
    /**
     * Fetch and decode Metaplex metadata for all unique mints appearing in trade actions.
     *
     * @param actions - Trade actions containing token addresses
     * @returns A mapping of mint address -> decoded metadata (name, symbol, uri)
     */
    async fetchTokenMetadataMapFromActions(actions) {
        const mints = this.getUniqueMints(actions).filter((m) => m !== NATIVE_SOL);
        if (mints.length === 0)
            return {};
        // Derive PDAs for metadata accounts
        const pdas = mints.map(toMetadataPda);
        // Fetch accounts in batch (with RPC pagination limit of 100)
        const accounts = await this.rpc.getAccountsBase64(pdas, 100);
        const metaMap = {};
        for (let i = 0; i < mints.length; i++) {
            const mint = mints[i];
            const pda = pdas[i];
            const acc = accounts[pda];
            try {
                const dataTuple = acc?.data; // [base64, "base64"]
                const b64 = Array.isArray(dataTuple) ? dataTuple[0] : undefined;
                if (typeof b64 === "string") {
                    // Decode base64 Borsh metadata (Metaplex standard)
                    const { name, symbol, uri } = decodeMetaplexMetadataBase64(b64);
                    metaMap[mint] = { name, symbol, uri };
                }
                else {
                    metaMap[mint] = {}; // no metadata available
                }
            }
            catch {
                // Handle decoding errors gracefully
                metaMap[mint] = {};
            }
        }
        return metaMap;
    }
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
    enrichActionsWithMetadata(actions, metaMap) {
        return actions.map((a) => {
            var _a, _b, _c, _d;
            // Deep clone to avoid mutating original actions
            const out = JSON.parse(JSON.stringify(a));
            // Enrich sold token
            if (out.sold?.address) {
                const mint = out.sold.address;
                if (mint === NATIVE_SOL) {
                    (_a = out.sold).symbol ?? (_a.symbol = "SOL");
                    (_b = out.sold).name ?? (_b.name = "Solana");
                }
                else if (metaMap[mint]) {
                    const { name, symbol, uri } = metaMap[mint];
                    if (name)
                        out.sold.name = name;
                    if (symbol)
                        out.sold.symbol = symbol;
                    if (uri)
                        out.sold.uri = uri;
                }
            }
            // Enrich bought token
            if (out.bought?.address) {
                const mint = out.bought.address;
                if (mint === NATIVE_SOL) {
                    (_c = out.bought).symbol ?? (_c.symbol = "SOL");
                    (_d = out.bought).name ?? (_d.name = "Solana");
                }
                else if (metaMap[mint]) {
                    const { name, symbol, uri } = metaMap[mint];
                    if (name)
                        out.bought.name = name;
                    if (symbol)
                        out.bought.symbol = symbol;
                    if (uri)
                        out.bought.uri = uri;
                }
            }
            return out;
        });
    }
}
//# sourceMappingURL=MetaplexMetadataService.js.map