export function readU32LE(buf, offset) {
    return buf.readUInt32LE(offset);
}
export function readBorshString(buf, offset) {
    const len = readU32LE(buf, offset);
    const start = offset + 4;
    const end = start + len;
    const str = buf.slice(start, end).toString("utf8").replace(/\0+$/, "");
    return { value: str, next: end };
}
export function decodeMetaplexMetadataBase64(b64) {
    const out = {};
    const buf = Buffer.from(b64, "base64");
    let o = 0;
    if (buf.length < 1 + 32 + 32 + 4)
        return out;
    o += 1; // key
    o += 32; // updateAuthority
    o += 32; // mint
    let r = readBorshString(buf, o);
    out.name = r.value;
    o = r.next;
    r = readBorshString(buf, o);
    out.symbol = r.value;
    o = r.next;
    r = readBorshString(buf, o);
    out.uri = r.value;
    o = r.next;
    return out;
}
//# sourceMappingURL=borsh.js.map