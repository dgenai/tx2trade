// ──────────────────────────────────────────────────────────────────────────────
// File: src/types.ts
// ──────────────────────────────────────────────────────────────────────────────
export type TradeAction = {
    transactionHash: string;
    transactionType: "buy" | "sell";
    walletAddress: string;
    transactionDate:Date;
    sold: { address?: string; amount?: number; symbol?: string; name?: string; uri?: string; unitPriceUsd:string, amountUsd:string  };
    bought: { address?: string; amount?: number; symbol?: string; name?: string; uri?: string; unitPriceUsd:string, amountUsd:string  };
    };
    
    
    export interface TransferEdge {
    seq: number;
    source: string;
    destination: string;
    mint: string;
    amount: number; // UI units
    authority?: string;
    programId?: string;
    depth?: number; // 0 top-level, 1 inner
    }
    
    
    export interface SwapLeg {
    soldMint: string;
    soldAmount: number;
    boughtMint: string;
    boughtAmount: number;
    path: TransferEdge[];
    }
    
    
    export type TokAccInfo = { mint: string; decimals?: number; owner?: string };
    export type TokenMeta = { name?: string; symbol?: string; uri?: string };

    
    export const WSOL_MINT = "So11111111111111111111111111111111111111112";
    
    
    export function num(x: any): number {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
    }
    
    
    export function to58(x: any): string {
    if (!x) return "";
    if (typeof x === "string") return x;
    if (x?.toBase58) return x.toBase58(); // PublicKey
    if (x?.pubkey) return to58(x.pubkey); // { pubkey: ... }
    return String(x);
    }