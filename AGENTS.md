# ArcSplit

> Built with Arc Studio - money-powered apps in minutes

A non-custodial USDC payment-splitting app on Arc Testnet. The payer approves a USDC amount, then distributes it atomically to multiple recipients by basis-point shares in a single contract call.

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Deployed Contracts

| Contract | Network | Address | Explorer |
|---|---|---|---|
| ArcSplit | Arc Testnet | 0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2 | https://explorer.testnet.arc.io/address/0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2 |

- Constructor arg: USDC `0x3600000000000000000000000000000000000000`
- Deployed: 2026-10-19
- Tx: `0xf3f008b84752edce1083d378c8b1901a5ff093c62ce950d0a8704c20665896dc`

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
