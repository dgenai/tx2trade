import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
export class WorkerPool {
    constructor(size, workerPath) {
        this.size = size;
        this.workerPath = workerPath;
        this.workers = [];
        this.idle = [];
        this.queue = [];
        this.nextId = 0;
        for (let i = 0; i < size; i++) {
            this.spawnWorker();
        }
    }
    spawnWorker() {
        const w = new Worker(this.workerPath, { workerData: null });
        w.on("message", (msg) => {
            const pending = this.queue.find(q => q.job.id === msg.id);
            if (!pending)
                return;
            this.queue = this.queue.filter(q => q !== pending);
            this.idle.push(w);
            if (msg.ok)
                pending.resolve(msg.legs);
            else
                pending.reject(new Error(msg.error));
            this.runNext();
        });
        w.on("error", err => {
            console.error("Worker error:", err);
        });
        this.workers.push(w);
        this.idle.push(w);
    }
    runJob(job) {
        return new Promise((resolve, reject) => {
            job.id = this.nextId++;
            this.queue.push({ job, resolve, reject });
            this.runNext();
        });
    }
    runNext() {
        if (this.queue.length === 0)
            return;
        if (this.idle.length === 0)
            return;
        const w = this.idle.pop();
        const { job } = this.queue[0];
        w.postMessage(job);
    }
    async close() {
        await Promise.all(this.workers.map(w => w.terminate()));
    }
}
//# sourceMappingURL=pool.js.map