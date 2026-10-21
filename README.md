# ArcSplit

A non-custodial USDC payment-splitting app for Arc Mainnet.

ArcSplit lets users split a USDC payment across multiple wallet addresses. Users choose recipients and their shares, review the payout breakdown, approve the USDC transfer, and initiate distribution.

**Live app:** https://arcsplit-lyart.vercel.app  
**GitHub:** https://github.com/Azam11232/arcsplit

## Features

- **Non-custodial** — USDC is distributed directly to recipients through the contract.
- **Single distribution call** — split payments across up to 50 recipients.
- **Precise shares** — allocate shares in basis points; 10,000 bps equals 100%.
- **Input validation** — reject invalid addresses, duplicate recipients, zero amounts, and invalid share totals.
- **Explicit wallet approval** — review recipients and payout amounts before confirming transactions.
- **Contract tests** — includes unit, fuzz, and invariant tests.

## Deployments

### Arc Mainnet — Production

| Field | Value |
|---|---|
| Network | Arc Mainnet |
| Chain ID | `5042` |
| RPC | `https://rpc.mainnet.arc.io` |
| ArcSplit contract | `0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E` |
| USDC address | `0x3600000000000000000000000000000000000000` |
| Contract explorer | [View contract](https://explorer.arc.io/address/0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E) |
| Deployment transaction | [View transaction](https://explorer.arc.io/tx/0x7af469baa64714477b28c758b937373659b8aab84ca978f64905c7c9c8edb7e4) |
| Successful distribution | [View transaction](https://explorer.arc.io/tx/0x25a32ed2da537c19d73db25e856b554d2460257f939a1571b602e2da7f4de4b0) |

### Arc Testnet — Testing

| Field | Value |
|---|---|
| Network | Arc Testnet |
| Chain ID | `5042002` |
| ArcSplit contract | `0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2` |
| USDC address | `0x3600000000000000000000000000000000000000` |
| Contract explorer | [View contract](https://explorer.testnet.arc.io/address/0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2) |
| Deployment transaction | [View transaction](https://explorer.testnet.arc.io/tx/0xf3f008b84752edce1083d378c8b1901a5ff093c62ce950d0a8704c20665896dc) |

Arc uses USDC as its native gas token, so a separate ETH balance is not required for gas.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.x
- [Foundry](https://getfoundry.sh)
- A compatible browser wallet configured for Arc Mainnet or Arc Testnet
- USDC on the selected network

### Install and run

```bash
cp .env.example .env
bun install
bun run dev
```

The development server starts at `http://localhost:5173`.

The `.env.example` file contains the Mainnet contract address. The optional `VITE_ARCSPLIT_TESTNET_ADDRESS` variable can override the default Testnet contract address.

Never commit private keys, API secrets, or your actual `.env` file.

## Contract Commands

Compile the contracts:

```bash
bun run contracts:build
```

Run the contract tests:

```bash
bun run contracts:test
```

## How It Works

1. Connect your wallet to the intended Arc network.
2. Enter the total USDC amount.
3. Add recipient addresses and assign percentage shares totalling 100%.
4. Review the payout breakdown.
5. Approve the USDC transfer in your wallet.
6. Confirm the distribution transaction and check its status.

## Security

- No owner-controlled upgrade mechanism.
- `nonReentrant` protection on `distribute()`.
- `SafeERC20` for token transfers.
- Duplicate recipient detection, with a maximum of 50 recipients.
- Validation for zero addresses, amounts, shares, and invalid share totals.

Automated tests and static analysis help identify potential issues but do not guarantee the absence of vulnerabilities. Verify the contract address and network before approving transactions.

## Documentation

See [docs/README.md](docs/README.md) for the project architecture, basis-point reference, security checklist, and file structure.

## License

MIT
