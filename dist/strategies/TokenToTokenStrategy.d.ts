import { TransferEdge, SwapLeg } from "../types.js";
import { LegStrategy } from "./LegStrategy.js";
export declare class TokenToTokenStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallet: string, opts: {
        debug?: boolean;
        log?: (...args: any[]) => void;
    }): SwapLeg[];
}
//# sourceMappingURL=TokenToTokenStrategy.d.ts.map