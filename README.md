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
- **PDF payment receipts** — download a receipt for a distribution after its on-chain receipt is reverified.
- **Payment analytics** — view wallet- and network-scoped totals, recipients, averages, and weekly/monthly charts from receipt-verified on-chain distributions.
- **Contract tests** — includes unit, fuzz, and invariant tests.

Analytics scan the configured ArcSplit contract's `Distributed` and `RecipientPayout` events from its
deployment block through the current chain head. Each event is matched by log index to a successful
transaction receipt, and the receipt's block hash is checked against the canonical block. Its payout count
and sum must reconcile with the distribution event; multiple distributions in one transaction remain
separate records. Chart dates use verified block timestamps. Log scans use 10,000-block pages and split
further when an RPC rejects a range; historical analytics require RPC support for historical contract-code
and event-log queries. An incomplete scan is reported as an error, never as complete analytics.

For faster repeat visits, a complete receipt-verified snapshot and its block/hash checkpoint are stored in
browser storage under a key scoped to chain, contract, and connected payer. The saved checkpoint is checked
against the current canonical chain before use; a normal Refresh scans only the blocks after it. Full rescan
starts again at the deployment block. A checkpoint is replaced only after all event, receipt, timestamp, and
final canonical-head checks succeed, so an interrupted scan cannot be presented or persisted as complete.
Invalid or reorganized checkpoints trigger a full scan, and the interface identifies cached results while an
incremental refresh is in progress.

Browser history is preserved and deduplicated against verified on-chain transactions by transaction hash.
Unmatched local records remain visible separately and are excluded from on-chain totals. Reverted calls do
not leave contract logs, so historical reverts cannot be discovered by this scan; locally saved failed
attempts are not counted as on-chain analytics.

## Deployments

### Arc Mainnet — Production

| Field | Value |
|---|---|
| Network | Arc Mainnet |
| Chain ID | `5042` |
| RPC | `https://rpc.mainnet.arc.io` |
| ArcSplit contract | `0xF13199D9bbf965eE10f41b531Ee4aa660bB54738` |
| USDC address | `0x3600000000000000000000000000000000000000` |
| Contract explorer | [View contract](https://explorer.arc.io/address/0xF13199D9bbf965eE10f41b531Ee4aa660bB54738) |
| Deployment transaction | [View transaction](https://explorer.arc.io/tx/0xfe620c35da883b5b99aa5f0eccf8312af5afc2bdaa12d143e75d4850c0d24881) |
| Successful distribution | [View transaction](https://explorer.arc.io/tx/0x25a32ed2da537c19d73db25e856b554d2460257f939a1571b602e2da7f4de4b0) |

### Arc Testnet — Testing

| Field | Value |
|---|---|
| Network | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| ArcSplit contract | `0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35` |
| USDC address | `0x3600000000000000000000000000000000000000` |
| Contract explorer | [View contract](https://explorer.testnet.arc.io/address/0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35) |
| Deployment transaction | [View transaction](https://explorer.testnet.arc.io/tx/0x7dcc2ce15f1738c5d6db7ecf48ca344cd9fe162053ede5f32e1fff49d5368a8e) |

Previously reported Testnet address, retained for history only (not deployed; no bytecode):
`0xA0c4dC391c39641B5dEa9304454B99b37c9FFb35`.

Previous Testnet deployment retained as a backup/reference:
`0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2`
([contract](https://explorer.testnet.arc.io/address/0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2),
[deployment transaction](https://explorer.testnet.arc.io/tx/0xf3f008b84752edce1083d378c8b1901a5ff093c62ce950d0a8704c20665896dc)).

Arc uses USDC as its native gas token, so a separate ETH balance is not required for gas.

#### MetaMask Testnet deployment

For a new Testnet deployment, run `bun run contracts:build`, start `bun run dev`, and open
`http://localhost:5173/__testnet-deployment`. The page is development-only. It requires a connected wallet
already on Arc Testnet, successful gas estimation, a separate on-page approval, and MetaMask's transaction
confirmation. It does not request private keys, switch networks, or send distributions.

The deployment review page remains available for future Testnet deployments. The previous address is retained
in `ARC_TESTNET_DEPLOYMENT.previousContractAddress` as a reference and collision check; the current frontend
default and `.env.example` use the verified address above. Leave the Mainnet configuration untouched.

#### Mainnet candidate deployment review

For the prepared Mainnet candidate, run `bun run contracts:build`, start `bun run dev`, and open
`http://localhost:5173/__mainnet-deployment`. This development-only page uses the compiled Foundry artifact,
requires Arc Mainnet (chain ID 5042), and checks the existing contract and predicted deployment address before
showing the gas estimate. It only permits the expected deployer
`0xBCCb7750dE26b1A1AC3a18cE08Be01eCd4094c6C` and requires a separate on-page approval followed by confirmation
in MetaMask or OKX; it never requests a private key or switches networks. This flow does not change
`VITE_ARCSPLIT_ADDRESS`.
The active Mainnet contract is already F131. This review page is only for a separately authorized future deployment; it does not deploy or activate the existing contract.

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


The application uses the verified ArcSplit Mainnet contract at
`0xF13199D9bbf965eE10f41b531Ee4aa660bB54738` for Mainnet transactions.
The former Mainnet contract at `0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E`
is retained for historical analytics. Mainnet contract addresses are defined
in `src/utils/arcsplit.ts`, not through `.env.example`.

`VITE_ARCSPLIT_TESTNET_ADDRESS` can optionally override the configured
Testnet contract address.


Never commit private keys, API secrets, or your actual `.env` file.

#### Prepared Mainnet deployment

`contracts/script/DeployArcSplitMainnet.s.sol` is a separate Foundry deployment script with a hard chain-ID
guard for `5042` and the registered Mainnet USDC constructor address. The script deploys the current
`contracts/ArcSplit.sol` source using the repository's Solidity `0.8.28` compiler configuration. The frontend selects F131 through the source-level `ARCSPLIT_MAINNET_USE_NEXT_ADDRESS` setting in `src/utils/arcsplit.ts`. The environment variable `VITE_ARCSPLIT_MAINNET_USE_NEXT_ADDRESS` is not read by the application. The former Mainnet contract
remains in analytics scanning for history. The isolated Foundry profile and prepared RPC alias are both
`arc_mainnet`. Do not run the script unless a separate deployment is explicitly authorized.

#### Contract compatibility and source provenance


The verified Mainnet contract at
`0xF13199D9bbf965eE10f41b531Ee4aa660bB54738` supports both
`distribute(address[],uint256[],uint256)` and
`distributeFixedAmounts(address[],uint256[])`. The fixed-amount method
transfers each validated amount exactly. Both methods use `SafeERC20`
and `nonReentrant`, enforce the 50-recipient limit, reject zero and
duplicate recipients, and emit the same payout and distribution events.




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
