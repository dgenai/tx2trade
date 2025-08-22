import { SwapLeg, TradeAction, WSOL_MINT } from "../types.js";
import { blockTimeToDate } from "../utils/helpers.js";

/**
 * Retrieve the USD price of SOL at (or nearest to) a given block time.
 * 
 * - Primary: find the candle whose [openTime, closeTime) interval contains the timestamp.
 * - Fallback: pick the candle whose openTime is closest to the timestamp.
 */
function getSolPriceAt(candles: any[], blockTime: number): number | null {
  if (!candles || candles.length === 0) return null;

  const ts = Math.floor(blockTime / 60) * 60 * 1000; // round to start of minute (ms)

  const inRange = candles.find((c: any) => c.openTime <= ts && c.closeTime > ts);
  if (inRange) return Number(inRange.close);

  // fallback to nearest openTime if exact interval not found
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
 * - uses up to 18 decimals for small numbers (< 1)
 * - uses up to 6 decimals for larger numbers (>= 1)
 * - trims trailing zeros and any dangling decimal point
 */
function safeUsd(
    value: number | null | undefined,
    opts?: { maxSmallDecimals?: number; maxLargeDecimals?: number; minDecimals?: number }
  ): string {
    if (value == null || !Number.isFinite(value)) return "0";
  
    const { maxSmallDecimals = 18, maxLargeDecimals = 6, minDecimals = 0 } = opts ?? {};
    const abs = Math.abs(value);
  
    // Choose precision: more decimals for very small values
    const maxDecimals = abs >= 1 ? maxLargeDecimals : maxSmallDecimals;
  
    // Primary formatting path: toLocaleString avoids scientific notation
    let s = value.toLocaleString("en-US", {
      useGrouping: false,
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
    });
  
    // Fallback if some engine still emitted scientific notation
    if (/[eE]/.test(s)) {
      s = value.toFixed(maxDecimals);
    }
  
    // Trim trailing zeros and optional trailing dot
    s = s.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "").replace(/\.$/u, "");
  
    // Handle the edge case where value rounds to 0 with minDecimals=0
    if (s === "-0") s = "0";
  
    return s;
  }

/**
 * Convert swap legs into high-level trade actions, enriched with USD pricing.
 *
 * Pricing logic:
 *  - SOL ↔ Token swaps: 
 *      Use Binance candles to derive SOL/USD, then infer token/USD via ratio.
 *  - Token ↔ Token swaps:
 *      Cannot infer USD without external reference; values set to "0".
 *
 * Each trade action includes both sides of the swap with amount, unit price, and USD value.
 */
export function legsToTradeActions(
  legs: SwapLeg[],
  ctx: {
    txHash: string;
    wallet: string;
    blockTime: number;
    candles?: any[];     // Binance 1m candles
    debug?: boolean;
    log?: (...args: any[]) => void;
  }
): TradeAction[] {
  const { debug = false, candles = [] } = ctx;
  const log = ctx.log ?? ((...args: any[]) => { if (debug) console.debug("[legsToTradeActions]", ...args); });

  const actions: TradeAction[] = [];
  const txDate = blockTimeToDate(ctx.blockTime);

  // Retrieve SOL/USD price at the transaction time
  const solPrice = getSolPriceAt(candles, ctx.blockTime);

  for (const leg of legs) {
    log("Processing leg", leg);

    const soldAmt = Number(leg.soldAmount ?? 0);
    const boughtAmt = Number(leg.boughtAmount ?? 0);

    if (leg.soldMint === WSOL_MINT) {
      // Case: user spent SOL to acquire another token (BUY)
      const soldSolUnit = solPrice;
      const soldSolUsd = soldSolUnit ? soldAmt * soldSolUnit : null;

      // Derive token USD unit price from SOL spent / token amount
      const boughtTokenUnit = boughtAmt > 0 && soldSolUsd != null ? (soldSolUsd / boughtAmt) : null;
      const boughtTokenUsd = boughtTokenUnit != null ? boughtAmt * boughtTokenUnit : null;

      actions.push({
        transactionDate: txDate,
        transactionHash: ctx.txHash,
        transactionType: "buy",
        walletAddress: ctx.wallet,
        sold: {
          address: WSOL_MINT,
          symbol: "SOL",
          amount: soldAmt,
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
    } else if (leg.boughtMint === WSOL_MINT) {
      // Case: user sold a token to receive SOL (SELL)
      const boughtSolUnit = solPrice;
      const boughtSolUsd = boughtSolUnit ? boughtAmt * boughtSolUnit : null;

      // Derive sold token USD unit price from SOL received / sold amount
      const soldTokenUnit = soldAmt > 0 && boughtSolUsd != null ? (boughtSolUsd / soldAmt) : null;
      const soldTokenUsd = soldTokenUnit != null ? soldAmt * soldTokenUnit : null;

      actions.push({
        transactionDate: txDate,
        transactionHash: ctx.txHash,
        transactionType: "sell",
        walletAddress: ctx.wallet,
        sold: {
          address: leg.soldMint,
          amount: soldAmt,
          unitPriceUsd: safeUsd(soldTokenUnit),
          amountUsd: safeUsd(soldTokenUsd),
        },
        bought: {
          address: WSOL_MINT,
          symbol: "SOL",
          amount: boughtAmt,
          unitPriceUsd: safeUsd(boughtSolUnit),
          amountUsd: safeUsd(boughtSolUsd),
        },
      });
    } else {
      // Case: token-to-token swap (no direct SOL involvement)
      // Without SOL as reference, cannot infer USD value reliably.
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
  }

  log(`Built ${actions.length} actions`, actions);
  return actions;
}
