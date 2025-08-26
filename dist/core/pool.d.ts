export declare class WorkerPool {
    private size;
    private workerPath;
    private workers;
    private idle;
    private queue;
    private nextId;
    constructor(size: number, workerPath: string);
    private spawnWorker;
    runJob(job: any): Promise<any>;
    private runNext;
    close(): Promise<void>;
}
//# sourceMappingURL=pool.d.ts.map