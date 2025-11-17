import { parentPort } from "node:worker_threads";
import { transactionToSwapLegs_SOLBridge } from "./transactionToSwapLegs.js";
if (!parentPort)
    throw new Error("This file must be run as a worker");
parentPort.on("message", (job) => {
    try {
        const legs = transactionToSwapLegs_SOLBridge("",job.tx, job.userWallet, {
            windowTotalFromOut: 500,
            requireAuthorityUserForOut: true,
            debug: job.debug,
        });
        parentPort.postMessage({ id: job.id, ok: true, legs });
    }
    catch (e) {
        parentPort.postMessage({
            id: job.id,
            ok: false,
            error: String(e?.message ?? e),
        });
    }
});
//# sourceMappingURL=parseTxworker.js.map