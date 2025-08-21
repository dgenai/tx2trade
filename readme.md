# tx2trade

## Abstract

This project provides a modular framework to **analyze Solana transactions** and reconstruct user-level **trading actions** (buy/sell).  
It abstracts away the complexity of raw instructions by applying a visitor/inference pipeline that outputs clear, auditable trade actions.  

---

## Architecture

At a high level, the pipeline has three layers:

1. **Instruction Parsing**  
   Transaction instructions are scanned and normalized into a unified representation called **TransferEdges**.  
   These edges capture token movements, authorities, and sequence ordering.

2. **Inference & Strategies**  
   A set of strategies interprets edges to infer **SwapLegs** (atomic trade legs).  
   Examples:
   - SOL bridging via wrapped SOL accounts  
   - Token-to-Token swaps  
   - Aggregator or market maker routing  

   Strategies are applied in a defined order, and the first one that matches reconstructs the swap intent.

3. **Trade Action Synthesis**  
   Swap legs are finally converted into **TradeActions**:  
   - `buy` or `sell` relative to the user wallet  
   - With explicit amounts, token addresses, and the transaction hash  

This three-step model transforms raw blockchain data into actionable, structured insights.

---

## Components

- **Visitors**  
  - Parse Solana programs into normalized edges (e.g. SPL Token transfers, ATA creation).  
  - Easily extensible to support more programs.  

- **Strategies**  
  - Apply domain heuristics to detect swaps, hubs, and routing patterns.  
  - Encapsulate rules for Token-to-Token, SOL bridging, and aggregator-based flows.  

- **Utilities**  
  - Helpers to detect WSOL hubs, correlate edges, and simplify transaction graph analysis.  

- **Converters**  
  - Produce high-level **TradeActions** from low-level legs, suitable for end users or reporting.  

---

## Data Model

### TransferEdge
Represents a normalized movement of tokens within a transaction.

### SwapLeg
Represents one direction of a swap (sold → bought).

### TradeAction
Final user-facing action (`buy` or `sell`), enriched with wallet, amounts, and token metadata.

---

## Example Workflow

1. Fetch one or more parsed transactions from Solana RPC.  
2. Build the **edges and account index** using the visitor framework.  
3. Run the strategy pipeline to infer **swap legs**.  
4. Convert swap legs into **trade actions**.  

Example output:

```json
[
  {
    "transactionHash": "4nUq...x3a",
    "transactionType": "buy",
    "walletAddress": "9abC...xyz",
    "sold": { "address": "So11111111111111111111111111111111111111112", "symbol": "SOL", "name": "Solana", "amount": 1.25 },
    "bought": { "address": "EcMzzinq67zZmxxxAcSSvCuRVfabdyE4jRMxxzqPgVfz", "symbol": "GAIN",  "name": "GAIN", "uri": "https://ipfs.io/ipfs/QmUpgJo7a2uizgewvQa6iPGDr1jZrRhEGDumfKJE7ugFpC", "amount": 150.0 }
  }
]
```

## Usage

### CLI

```bash
RPC_ENDPOINT="https://api.mainnet-beta.solana.com" \
ts-node src/main.ts <TRANSACTION_SIGNATURE1> <TRANSACTION_SIGNATURE2> ...
```

This will:

* Fetch the transaction
* Analyze it
* Print the reconstructed trade actions in JSON

### Library
```ts
import { tx2trade } from "tx2trade";

const actions = await tx2trade(signatures, process.env.RPC_ENDPOINT!, {
  debug: true,
  windowTotalFromOut: 500,
  requireAuthorityUserForOut: true,
});

console.log(actions);
```


# License
MIT