import { SolanaRpcClient } from "./services/SolanaRpcClient.js";
import { MetaplexMetadataService } from "./services/MetaplexMetadataService.js";
import { buildActionsFromSignatures } from "./fromSignatures.js";
import { buildActionsFromAddress } from "./fromAddress.js";

export type Tx2TradeInput = {
  sigs?: string[];

  // Address mode
  address?: string;
  total?: number;
  pageSize?: number;
  before?: string;
  until?: string;

  // Plage de dates en mode address
  fromDate?: string; // ex: "2025-01-01" ou ISO
  toDate?: string;   // ex: "2025-01-31" ou ISO

  rpcEndpoint: string;

  debug?: boolean;
  windowTotalFromOut?: number;
  requireAuthorityUserForOut?: boolean;
};

export async function tx2trade(input: Tx2TradeInput) {
  const {
    sigs,
    address,
    total,
    pageSize,
    before,
    until,
    fromDate,
    toDate,
    rpcEndpoint,
    debug = false,
    windowTotalFromOut = 500,
    requireAuthorityUserForOut = true,
  } = input;

  if (!rpcEndpoint) {
    throw new Error("tx2trade: rpcEndpoint is required");
  }

  const rpc = new SolanaRpcClient({
    endpoint: rpcEndpoint,
    timeoutMs: 25_000,
    maxRetries: 3,
    retryBackoffMs: 3000,
    defaultCommitment: "confirmed",
    log: (...args: any[]) => console.log(...args),
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
  } else if (address) {
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
  } else {
    throw new Error("tx2trade: either sigs or address must be provided");
  }

  // At this point, actions already include candles data.
  // We only perform metadata enrichment here.
  const metaMap = await metaSvc.fetchTokenMetadataMapFromActions(actions);
  const enriched = metaSvc.enrichActionsWithMetadata(actions, metaMap);

  return enriched;
}
