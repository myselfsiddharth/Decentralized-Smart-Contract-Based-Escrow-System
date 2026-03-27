# Decentralized Smart Contract-Based Escrow System

## Project Description
This project is an early-stage draft of a decentralized escrow system for freelancing transactions.  
It reduces trust dependency between a client and a freelancer by using a smart contract to hold funds until work is reviewed.

Traditional freelance workflows often rely on centralized intermediaries to prevent payment fraud or non-delivery of work.  
This system replaces that intermediary logic with transparent, on-chain rules so both parties can verify the transaction state at any time.

## System Overview
The escrow process is managed by an Ethereum-compatible smart contract:

1. A client and freelancer are assigned to an escrow agreement.
2. The client deposits the agreed payment into the contract.
3. The freelancer submits work (represented by a proof string such as an IPFS CID or hash).
4. The client either:
   - approves the work, releasing funds to the freelancer, or
   - rejects the work, triggering a refund to the client.

This workflow enables trustless settlement while keeping all status transitions visible on-chain.

## Tech Stack
- **Blockchain**: Ethereum-compatible chain (targeting Polygon as Layer-2)
- **Smart Contracts**: Solidity (`^0.8.20`)
- **Development Tooling**: Hardhat 
- **Wallet**: MetaMask
- **Frontend (future extension)**: React / Flutter placeholder

## Repository Structure
```text
.
├── contracts
│   └── Escrow.sol
├── interfaces
│   └── IEscrow.sol
└── README.md
```

## Dependencies and Setup (Draft)
### Prerequisites
- Node.js (LTS recommended)
- npm (bundled with Node.js)
- MetaMask browser extension
- Hardhat

### Basic Setup Steps
1. Clone this repository.
2. Install dependencies (when `package.json` is added):
   ```bash
   npm install
   ```
3. Initialize Hardhat in the project (if not already initialized):
   ```bash
   npx hardhat --init
   ```
4. Add network and wallet settings in `hardhat.config.*` and `.env` (for testnet deployment).

> Based on current Hardhat docs, typical local workflow uses `npx hardhat node` and network-specific deployment commands.

## How to Deploy and Use (Draft)
### Deploy (Local)
1. Start a local Hardhat node:
   ```bash
   npx hardhat node
   ```
2. Deploy the escrow contract using your deployment script/module.
3. Copy the deployed contract address for interactions.

### Deploy (Testnet / Polygon-Compatible)
1. Configure RPC URL and deployer private key in environment variables.
2. Set target network in Hardhat config (e.g., Polygon Amoy or another compatible testnet).
3. Run deployment command for that network.

### Simulated Usage Flow
1. **createEscrow**: define client, freelancer, and expected amount.
2. **depositFunds** (client): fund escrow with exact agreed value.
3. **submitWork** (freelancer): submit completion proof/reference.
4. **approveWork** (client): release funds to freelancer.
5. **rejectWork** (client): refund escrowed funds to client.

## Current Status
This is a first submission draft focused on:
- contract structure,
- workflow-aligned function signatures,
- access control checks,
- events and documentation comments.

Production features such as milestone escrow, arbitration, deadlines, signature-based approvals, and frontend integration are planned for later iterations.
