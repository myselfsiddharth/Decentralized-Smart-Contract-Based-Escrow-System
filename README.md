# Decentralized Smart Contract-Based Escrow System

## Project Description:
This project is an early-stage draft of a decentralized escrow system for freelancing transactions.  
It reduces trust dependency between a client and a freelancer by using a smart contract to hold funds until work is reviewed.

Traditional freelance workflows often rely on centralized intermediaries to prevent payment fraud or non-delivery of work.  
This system replaces that intermediary logic with transparent and on-chain rules so both parties can verify the transaction state at any time.

On-chain flow:
1. Call `EscrowFactory.createEscrow(client, freelancer, amount)` → new `Escrow` at a fresh address.
2. Client calls `depositFunds()` with exact `amount` in the chain’s **native token** (on **Polygon PoS**, that is **POL** for gas and for this escrow’s payable amount).
3. Freelancer calls `submitWork(workReference)` (e.g. IPFS CID).
4. Client calls `approveWork()` to pay the freelancer **or** `rejectWork()` to refund.

## Tech Stack
- **Blockchain**: **[Polygon PoS](https://polygon.technology/polygon-pos)** (this project is configured for Polygon mainnet and **Polygon Amoy** testnet in `hardhat.config.js`)
- **Smart Contracts**: Solidity `^0.8.20`, OpenZeppelin `ReentrancyGuard`
- **Dev Tooling**: Hardhat + Ethers + Chai
- **Wallet**: MetaMask (or similar) on **Polygon Amoy** or **Polygon PoS** when deploying/interacting outside localhost
- **Web UI**: Vite + React + ethers v6 (`frontend/`)

## Web UI (MetaMask)

1. Deploy `EscrowFactory` on Polygon Amoy (or PoS) and copy its address.
2. From the repo root:
   ```bash
   cd frontend
   cp .env.example .env
   ```
   Set `VITE_FACTORY_ADDRESS` (and optional `VITE_CHAIN_ID`, default `80002`; supported values are `80002` for Polygon Amoy and `137` for Polygon PoS).
   Optionally set `VITE_DEFAULT_FREELANCER` to always prefill the freelancer field when you demo with the same second wallet.
   The app also **remembers** factory, escrow, amounts, and work reference in **browser localStorage** so fields stay filled between visits.
3. Install and run the dev server:
   ```bash
   npm install
   npm run dev
   ```
   Or from the repo root: `npm run dev:ui`
4. Open the printed URL (usually `http://localhost:5173`). Connect MetaMask, **Switch network** to match the UI target (Amoy `80002` or PoS `137`).
5. **Create escrow** (any wallet can call the factory). Then switch accounts:
   - **Client** → **Deposit** → **Approve** or **Reject**
   - **Freelancer** → **Submit work**

ABIs are copied from `artifacts/` into `frontend/src/abis/`. After you change Solidity, run `npm run compile` at the repo root and **re-copy** the JSON files, or copy manually:

```bash
copy artifacts\contracts\EscrowFactory.sol\EscrowFactory.json frontend\src\abis\
copy artifacts\contracts\Escrow.sol\Escrow.json frontend\src\abis\
```

(Build for static hosting: `npm run build:ui` from repo root, then serve `frontend/dist`.)

## Repository Structure
```text
.
├── contracts/
│   ├── Escrow.sol
│   └── EscrowFactory.sol
├── frontend/
│   ├── src/
│   └── package.json
├── interfaces/
│   └── IEscrow.sol
├── scripts/
│   └── deploy.js
├── test/
│   └── Escrow.test.js
├── .github/
│   └── workflows/
│       └── ci.yml
├── hardhat.config.js
├── .env.example
└── README.md
```

## Contract Workflow
- **Deploy**: `scripts/deploy.js` deploys **`EscrowFactory`** (not a single `Escrow`).
- **Indexing**: `EscrowFactory` emits `EscrowDeployed(escrow, client, freelancer, amount, escrowId)` for each new escrow.

Status progression (per `Escrow` instance):
- `Created` -> after factory calls `createEscrow` on that instance
- `Funded` -> after `depositFunds`
- `Completed` -> after `submitWork`
- `Approved` -> after `approveWork` and payment release
- `Refunded` -> after `rejectWork` and refund

Role and access rules:
- Only **`EscrowFactory`** (when deploying a new escrow) may call `Escrow.createEscrow` — random accounts cannot hijack initialization.
- Only client can `depositFunds`, `approveWork`, `rejectWork`
- Only freelancer can `submitWork`
- `approveWork` and `rejectWork` use OpenZeppelin **`nonReentrant`** for safe external transfers.

## Prerequisites
- Node.js (LTS)
- npm
- MetaMask (or another EVM wallet) with the **Polygon** network added — see [Add Polygon to MetaMask](https://polygon.technology/blog/how-to-add-polygon-to-metamask)

## Setup
```bash
npm install
```

Compile contracts:
```bash
npm run compile
```

Run tests:
```bash
npm test
```

## Local Deployment
Start local Hardhat node (terminal 1):
```bash
npm run node
```

Deploy **EscrowFactory** on localhost (terminal 2):
```bash
npm run deploy:local
```

You will log a factory address. Use it in Hardhat console or a small script to call `createEscrow` and obtain each new escrow address (see `EscrowDeployed` in the transaction receipt).

## Polygon deployment

All live networks below use the same `PRIVATE_KEY` in `.env` for the deployer account. Fund that account with **POL** (mainnet) or **testnet POL** (Amoy) for gas.

### Polygon Amoy (testnet — recommended for class)

- **Chain ID:** `80002`
- Copy `.env.example` to `.env` and set:
  - `POLYGON_AMOY_RPC_URL` (or legacy `AMOY_RPC_URL`)
  - `PRIVATE_KEY`

```bash
npm run deploy:amoy
```

Get test POL from an [Amoy faucet](https://faucet.polygon.technology/) (or search “Polygon Amoy faucet”).

### Polygon PoS (mainnet)

- **Chain ID:** `137`
- Set `POLYGON_RPC_URL` to a reliable RPC endpoint and fund the deployer with **POL**.

```bash
npm run deploy:polygon
```

Use only if you intend to spend real POL; for coursework, prefer **Amoy** or **localhost**.

## Simulated Usage Flow
After the factory is deployed:
1. `EscrowFactory.createEscrow(client, freelancer, amountWei)` — note the new escrow address from `EscrowDeployed`.
2. On **that** escrow: `depositFunds()` from client with exact `amount`.
3. `submitWork(workReference)` from freelancer.
4. `approveWork()` from client **or** `rejectWork()` from client.

### Class demo (local)
1. `npm run node` — keep running.
2. `npm run deploy:local` — copy the factory address.
3. Use MetaMask + Remix, or Hardhat console (`npx hardhat console --network localhost`), to call `createEscrow` then the escrow steps above.

### Class demo (Polygon Amoy)

1. Add **Polygon Amoy** to MetaMask (chain ID **80002** — use [chainlist.org](https://chainlist.org) or Polygon’s docs if needed).
2. Fund your wallet with test POL from a faucet.
3. Put `POLYGON_AMOY_RPC_URL` and `PRIVATE_KEY` in `.env`, then `npm run deploy:amoy` and use the factory address in Remix or a small UI on chain **80002**.

### Scripted class demo (Polygon Amoy)

If you also set **client and freelancer wallets** (separate private keys) in `.env`, you can run the full workflow end-to-end:

```bash
npm run demo:amoy
```

Required `.env` variables for this script:
- `FACTORY_ADDRESS`
- `CLIENT_PRIVATE_KEY`
- `FREELANCER_PRIVATE_KEY`
- `AMOUNT_ETH`
- `WORK_REFERENCE`
- `ACTION` (`approve` or `reject`)

## CI
GitHub Actions runs `npm ci`, compile, and tests on push/PR (see `.github/workflows/ci.yml`).

## Test Coverage
`test/Escrow.test.js` includes:
- factory deploy + `EscrowDeployed` event and `escrowCount`
- happy path (factory -> fund -> submit -> approve)
- refund path (factory -> fund -> submit -> reject)
- `createEscrow` callable only by the escrow’s factory
- role and state restriction tests
- input validation tests (zero addresses, zero amount, bad deposit, empty work reference)
- event emission checks for all workflow events

## Current Scope and Limitations
Current version is single-escrow-per-contract and focuses on core workflow integrity.

Not included yet:
- milestone-based escrow
- deadlines and auto-expiry
- arbitration/dispute resolution
- signature-based approvals
- production frontend integration
