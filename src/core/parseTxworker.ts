import { parentPort } from "node:worker_threads";
import { transactionToSwapLegs_SOLBridge } from "./transactionToSwapLegs.js";

if (!parentPort) throw new Error("This file must be run as a worker");

type Job = { id: number; tx: any; userWallets: string[]; debug?: boolean };

parentPort.on("message", (job: Job) => {
  try {
    const legs = transactionToSwapLegs_SOLBridge("",job.tx, job.userWallets, {
      windowTotalFromOut: 500,
      requireAuthorityUserForOut: true,
      debug: job.debug,
    });
    parentPort!.postMessage({ id: job.id, ok: true, legs });
  } catch (e: any) {
    parentPort!.postMessage({
      id: job.id,
      ok: false,
      error: String(e?.message ?? e),
    });
  }
});
