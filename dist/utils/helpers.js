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
//# sourceMappingURL=helpers.js.map