export function blockTimeToDate(blockTime) {
    // blockTime est en secondes → on multiplie par 1000 pour passer en ms
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