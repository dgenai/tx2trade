import { SolanaRpcClient } from "./services/SolanaRpcClient.js";
import { TradeAction } from "./types.js";
type BuildFromSignaturesInput = {
    rpc: SolanaRpcClient;
    signatures: string[];
    debug: boolean;
    windowTotalFromOut: number;
    requireAuthorityUserForOut: boolean;
};
export declare function buildActionsFromSignatures(input: BuildFromSignaturesInput): Promise<TradeAction[]>;
export {};
//# sourceMappingURL=fromSignatures.d.ts.map