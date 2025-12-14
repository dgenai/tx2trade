export function blockTimeToDate(blockTime) {
    return new Date(blockTime * 1000);
}
export function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}
export function buildTradeWindows(blockTimesSec, intervalMs, beforeCandles = 30, afterCandles = 30) {
    const windows = blockTimesSec
        .filter(t => t > 0)
        .map(t => {
        const center = t * 1000;
        return {
            startMs: center - beforeCandles * intervalMs,
            endMs: center + afterCandles * intervalMs,
        };
    });
    return mergeWindows(windows);
}
function mergeWindows(windows) {
    if (windows.length === 0)
        return [];
    const sorted = windows.sort((a, b) => a.startMs - b.startMs);
    const merged = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        const cur = sorted[i];
        if (cur.startMs > last.endMs) {
            merged.push({ ...cur });
        }
        else {
            last.endMs = Math.max(last.endMs, cur.endMs);
        }
    }
    return merged;
}
//# sourceMappingURL=helpers.js.map