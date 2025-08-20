import { Connection } from "@solana/web3.js";
import { transactionToSwapLegs_SOLBridge } from "./core/transactionToSwapLegs.js";
import { legsToTradeActions } from "./core/actions.js";
import { inferUserWallet } from "./inferUserWallet.js";

type Tx2TradeOpts = {
  debug?: boolean;
  windowTotalFromOut?: number;
  requireAuthorityUserForOut?: boolean;
};

export async function tx2trade(sig: string, rpcEndpoint: string, opts: Tx2TradeOpts = {}) {
  const { debug = false, windowTotalFromOut = 500, requireAuthorityUserForOut = true } = opts;

  const connection = new Connection(rpcEndpoint, "confirmed");
  const tx = await connection.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) throw new Error(`Transaction not found: ${sig}`);

  const userWallet = inferUserWallet(tx);

  const legs = transactionToSwapLegs_SOLBridge(tx, userWallet, {
    windowTotalFromOut,
    requireAuthorityUserForOut,
    debug,
  });

  const actions = legsToTradeActions(legs, {
    txHash: sig,
    wallet: userWallet,
  });

  if (debug) {
    console.debug("tx2trade result", { actions, legsCount: legs.length });
  }

  return actions;
}
