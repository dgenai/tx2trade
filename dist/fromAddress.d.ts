import { SolanaRpcClient } from "./services/SolanaRpcClient.js";
import { TradeAction } from "./types.js";
type BuildFromAddressInput = {
    rpc: SolanaRpcClient;
    address: string;
    total?: number;
    pageSize?: number;
    before?: string;
    until?: string;
    fromDate?: string;
    toDate?: string;
    debug: boolean;
    windowTotalFromOut: number;
    requireAuthorityUserForOut: boolean;
};
export declare function buildActionsFromAddress(input: BuildFromAddressInput): Promise<TradeAction[]>;
export {};
//# sourceMappingURL=fromAddress.d.ts.map