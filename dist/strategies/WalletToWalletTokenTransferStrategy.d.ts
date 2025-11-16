import { LegStrategy } from "./LegStrategy.js";
import { SwapLeg, TransferEdge } from "../types.js";
/**
 * Strategy: detect SPL token transfers initiated by the user that
 * are sent to a sequence of intermediary "gateway" wallets.
 *
 * This captures multi-edge outbound flows that belong to the same
 * logical transfer (e.g. multiple send instructions produced by a router,
 * gateway, or service wallet).
 */
export declare class WalletToWalletTokenTransferStrategy implements LegStrategy {
    name: string;
    match(edges: TransferEdge[], userTokenAccounts: Set<string>, userWallet: string, opts: {
        debug?: boolean;
        log?: (...args: any[]) => void;
        tags?: Map<number, "fee" | "dust" | "normal" | "tip">;
        windowSeq?: number;
    }): SwapLeg[];
}
//# sourceMappingURL=WalletToWalletTokenTransferStrategy.d.ts.map