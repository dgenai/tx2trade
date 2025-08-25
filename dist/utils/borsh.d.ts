export declare function readU32LE(buf: Buffer, offset: number): number;
export declare function readBorshString(buf: Buffer, offset: number): {
    value: string;
    next: number;
};
export declare function decodeMetaplexMetadataBase64(b64: string): {
    name?: string;
    symbol?: string;
    uri?: string;
};
//# sourceMappingURL=borsh.d.ts.map