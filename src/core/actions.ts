import { SwapLeg, TradeAction, WSOL_MINT } from "../types.js";
import { blockTimeToDate } from "../utils/helpers.js";

/**
 * Retrieve the USD price of SOL at (or nearest to) a given block time.
 */
function getSolPriceAt(candles: any[], blockTime: number): number | null {
  if (!candles || candles.length === 0) return null;

  const ts = Math.floor(blockTime / 60) * 60 * 1000; // round to minute start (ms)

  const inRange = candles.find((c: any) => c.openTime <= ts && c.closeTime > ts);
  if (inRange) return Number(inRange.close);

  // fallback to nearest openTime
  let nearest = candles[0];
  let best = Math.abs(nearest.openTime - ts);
  for (let i = 1; i < candles.length; i++) {
    const d = Math.abs(candles[i].openTime - ts);
    if (d < best) {
      best = d;
      nearest = candles[i];
    }
  }
  return nearest ? Number(nearest.close) : null;
}

/**
 * Formats a numeric value as a plain decimal string (no scientific notation).
 */
function safeUsd(
  value: number | null | undefined,
  opts?: { maxSmallDecimals?: number; maxLargeDecimals?: number; minDecimals?: number }
): string {
  if (value == null || !Number.isFinite(value)) return "0";

  const { maxSmallDecimals = 18, maxLargeDecimals = 6, minDecimals = 0 } = opts ?? {};
  const abs = Math.abs(value);

  const maxDecimals = abs >= 1 ? maxLargeDecimals : maxSmallDecimals;

  let s = value.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  });

  if (/[eE]/.test(s)) s = value.toFixed(maxDecimals);

  s = s.replace(/(\.\d*?[1-9])0+$/u, "$1")
       .replace(/\.0+$/u, "")
       .replace(/\.$/u, "");

  if (s === "-0") s = "0";

  return s;
}

/**
 * Convert swap legs into high-level trade actions, enriched with USD pricing.
 */
export function legsToTradeActions(
  legs: SwapLeg[],
  ctx: {
    txHash: string;
    wallet: string;
    blockTime: number;
    candles?: any[];
    debug?: boolean;
    log?: (...args: any[]) => void;
  }
): TradeAction[] {
  const { debug = false, candles = [] } = ctx;
  const log = ctx.log ?? ((...args: any[]) => {
    if (debug) console.debug("[legsToTradeActions]", ...args);
  });

  const actions: TradeAction[] = [];
  const txDate = blockTimeToDate(ctx.blockTime);
  const solPrice = getSolPriceAt(candles, ctx.blockTime);

  for (const leg of legs) {
    log("Processing leg", leg);

    const soldAmt = Number(leg.soldAmount ?? 0);
    const boughtAmt = Number(leg.boughtAmount ?? 0);

    // Fees
    const router = Number(leg.routerFees ?? 0);
    const tip = Number(leg.tip ?? 0);
    const network = Number(leg.networkFee ?? 0);
    const rent = Number(leg.rent ?? 0);

    // -------------------------------------------------------------------------
    // --- TRANSFER-OUT --------------------------------------------------------
    // -------------------------------------------------------------------------
    // This leg was produced by WalletToGatewayTransferStrategy:
    // - soldMint:   token sent by the user
    // - soldAmount: amount
    // - boughtMint: "" (intentionally empty)
    // - boughtAmount: 0
   if (boughtAmt === 0 && !leg.boughtMint && soldAmt > 0) {
  actions.push({
    transactionDate: txDate,
    transactionHash: ctx.txHash,
    transactionType: "transfer",
    walletAddress: ctx.wallet,

    sold: {
      address: leg.soldMint,
      amount: soldAmt,
      unitPriceUsd: "0",
      amountUsd: "0",
    },

    bought: {
      ...(leg.targetWallet && { targetWallet: leg.targetWallet }),
      unitPriceUsd: "0",
      amountUsd: "0",
    },
  });

  continue;
}


    // -------------------------------------------------------------------------
    // BUY (SOL → token)
    // -------------------------------------------------------------------------
    if (leg.soldMint === WSOL_MINT) {
      const coreSol = Number(leg.soldCore ?? soldAmt);
      const soldSolUnit = solPrice;
      const soldSolUsd = soldSolUnit ? coreSol * soldSolUnit : null;

      const boughtTokenUnit =
        boughtAmt > 0 && soldSolUsd != null
          ? soldSolUsd / boughtAmt
          : null;

      const boughtTokenUsd =
        boughtTokenUnit != null ? boughtAmt * boughtTokenUnit : null;

      actions.push({
        transactionDate: txDate,
        transactionHash: ctx.txHash,
        transactionType: "buy",
        walletAddress: ctx.wallet,

        sold: {
          address: WSOL_MINT,
          symbol: "SOL",
          amount: coreSol,
          unitPriceUsd: safeUsd(soldSolUnit),
          amountUsd: safeUsd(soldSolUsd),
        },

        bought: {
          address: leg.boughtMint,
          amount: boughtAmt,
          unitPriceUsd: safeUsd(boughtTokenUnit),
          amountUsd: safeUsd(boughtTokenUsd),
        },
      });

      continue;
    }

    // -------------------------------------------------------------------------
    // SELL (token → SOL)
    // -------------------------------------------------------------------------
    if (leg.boughtMint === WSOL_MINT) {
      const netSol = boughtAmt;
      const grossSol = netSol + router + tip + network + rent;

      const solUnit = solPrice;

      const boughtSolUsdNet = solUnit ? netSol * solUnit : null;
      const soldTokenUsdGross = solUnit ? grossSol * solUnit : null;

      const soldTokenUnit =
        soldAmt > 0 && soldTokenUsdGross != null
          ? soldTokenUsdGross / soldAmt
          : null;

      actions.push({
        transactionDate: txDate,
        transactionHash: ctx.txHash,
        transactionType: "sell",
        walletAddress: ctx.wallet,

        sold: {
          address: leg.soldMint,
          amount: soldAmt,
          unitPriceUsd: safeUsd(soldTokenUnit),
          amountUsd: safeUsd(soldTokenUsdGross),
        },

        bought: {
          address: WSOL_MINT,
          symbol: "SOL",
          amount: netSol,
          unitPriceUsd: safeUsd(solUnit),
          amountUsd: safeUsd(boughtSolUsdNet),
        },
      });

      continue;
    }

    // -------------------------------------------------------------------------
    // TOKEN ↔ TOKEN swap (no pricing)
    // -------------------------------------------------------------------------
    actions.push({
      transactionDate: txDate,
      transactionHash: ctx.txHash,
      transactionType: "buy",
      walletAddress: ctx.wallet,

      sold: {
        address: leg.soldMint,
        amount: soldAmt,
        unitPriceUsd: "0",
        amountUsd: "0",
      },

      bought: {
        address: leg.boughtMint,
        amount: boughtAmt,
        unitPriceUsd: "0",
        amountUsd: "0",
      },
    });
  }

  log(`Built ${actions.length} actions`, actions);
  return actions;
}
