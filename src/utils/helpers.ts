export function blockTimeToDate(blockTime: number): Date {
    // blockTime est en secondes → on multiplie par 1000 pour passer en ms
    return new Date(blockTime * 1000);
  }



  export function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }