import { SolanaRpcClient } from "./services/SolanaRpcClient.js";
import { MetaplexMetadataService } from "./services/MetaplexMetadataService.js";
import { buildActionsFromSignatures } from "./fromSignatures.js";
import { buildActionsFromAddress } from "./fromAddress.js";
export async function tx2trade(input) {
    const { sigs, address, total, pageSize, before, until, fromDate, toDate, rpcEndpoint, debug = false, windowTotalFromOut = 500, requireAuthorityUserForOut = true, } = input;
    if (!rpcEndpoint) {
        throw new Error("tx2trade: rpcEndpoint is required");
    }
    const rpc = new SolanaRpcClient({
        endpoint: rpcEndpoint,
        timeoutMs: 25000,
        maxRetries: 3,
        retryBackoffMs: 3000,
        defaultCommitment: "confirmed",
        log: (...args) => console.log(...args),
    });
    const metaSvc = new MetaplexMetadataService(rpc);
    let actions;
    if (sigs && sigs.length > 0) {
        // Signature mode
        actions = await buildActionsFromSignatures({
            rpc,
            signatures: sigs,
            debug,
            windowTotalFromOut,
            requireAuthorityUserForOut,
        });
    }
    else if (address) {
        // Address mode (with optional total & date range)
        actions = await buildActionsFromAddress({
            rpc,
            address,
            total,
            pageSize,
            before,
            until,
            fromDate,
            toDate,
            debug,
            windowTotalFromOut,
            requireAuthorityUserForOut,
        });
    }
    else {
        throw new Error("tx2trade: either sigs or address must be provided");
    }
    // At this point, actions already include candles data.
    // We only perform metadata enrichment here.
    const metaMap = await metaSvc.fetchTokenMetadataMapFromActions(actions);
    const enriched = metaSvc.enrichActionsWithMetadata(actions, metaMap);
    return enriched;
}
//# sourceMappingURL=index.js.map