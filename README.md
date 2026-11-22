# ArcSplit

A non-custodial USDC payment-splitting app for Arc Mainnet.

ArcSplit lets users split a USDC payment across multiple wallet addresses. Users choose recipients and their shares, review the payout breakdown, approve the USDC transfer, and initiate distribution.

**Existing public site (not updated by this migration):** https://arcsplit-lyart.vercel.app
**GitHub:** https://github.com/Azam11232/arcsplit

> This Wagmi 3 migration is an isolated, undeployed candidate. The existing public site may serve a different build and does not establish that this candidate is production-ready.

## Features

- **Non-custodial** — USDC is distributed directly to recipients through the contract.
- **Single distribution call** — split payments across up to 50 recipients.
- **Precise shares** — allocate shares in basis points; 10,000 bps equals 100%.
- **Fixed-amount splits** — allocate exact USDC amounts to each recipient.
- **Recipient and split libraries** — save recipients and reusable split templates in the browser.
- **Transaction history** — keep wallet-scoped transaction records and distinguish local records from verified chain data.
- **Input validation** — reject invalid addresses, duplicate recipients, zero amounts, and invalid share totals.
- **Explicit wallet approval** — review recipients and payout amounts before confirming transactions.
- **PDF payment receipts** — download a receipt for a distribution after its on-chain receipt is reverified.
- **Payment analytics** — view wallet- and network-scoped totals, recipients, averages, and weekly/monthly charts from receipt-verified on-chain distributions.
- **Light and dark themes** — light mode is the default, with a persistent dark-mode preference.
- **Responsive, reduced-motion-aware UI** — product animations respect the user's reduced-motion preference.
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

### Arc Mainnet — Configured candidate target

| Field | Value |
|---|---|
| Network | Arc Mainnet |
| Chain ID | `5042` |
| RPC | `https://rpc.mainnet.arc.io` |
| Active ArcSplit contract | `0xF13199D9bbf965eE10f41b531Ee4aa660bB54738` |
| Legacy contract (history only) | `0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E` |
| USDC address | `0x3600000000000000000000000000000000000000` |
| Active contract explorer | [View contract](https://explorer.arc.io/address/0xF13199D9bbf965eE10f41b531Ee4aa660bB54738) |
| Legacy contract explorer | [View contract](https://explorer.arc.io/address/0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E) |

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

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.x
- [Foundry](https://getfoundry.sh)
- A compatible browser wallet; local development supports Arc Mainnet and Arc Testnet, while production builds expose Arc Mainnet only
- USDC on the selected network

### Install and run

```bash
cp .env.example .env
bun install
bun run dev
```

The development server starts at `http://localhost:5173`.

The `.env.example` file keeps `VITE_ARCSPLIT_ADDRESS` on the existing Mainnet contract and sets
`VITE_ARCSPLIT_MAINNET_NEXT_ADDRESS` to the verified next deployment. Mainnet analytics continue scanning both
the historical and newly activated contracts. `VITE_ARCSPLIT_MAINNET_USE_NEXT_ADDRESS` is now `true`, so Mainnet
allowance reads, approval spenders, and distribution calls target the verified next contract.
`VITE_ARCSPLIT_TESTNET_ADDRESS` remains independent.

Never commit private keys, API secrets, or your actual `.env` file.

#### Contract compatibility and source provenance

The active Mainnet contract exposes both `distribute(address[],uint256[],uint256)` and
`distributeFixedAmounts(address[],uint256[])`. The legacy Mainnet contract remains available for historical
analytics only; new Mainnet transactions use the active contract. Both active network configurations are
selected by chain ID and are validated independently.

The available compiled artifact reproduces the active Mainnet runtime after substituting its immutable USDC
address. The active Testnet contract has deployed bytecode and exposes the expected distribution selectors,
but its complete runtime has not been matched to the available artifact; treat exact Testnet source provenance
as unverified. Do not deploy or redeploy a contract as part of this release.

## Contract Commands

Compile the contracts:

```bash
bun run contracts:build
```

Run the contract tests:

```bash
bun run contracts:test
```

### Testnet Deployment Workflow

The Foundry script is restricted to Arc Testnet (chain ID `5042002`) and the specified Testnet USDC
constructor address. It rejects both previous Testnet addresses and requires exactly one configured Foundry
signer whose address matches `ARCSPLIT_TESTNET_DEPLOYER`.

Use the same `--rpc-url "$ARC_TESTNET_RPC_URL"` for preflight, broadcast, and receipt verification. The
script's RPC reads use Foundry's current fork URL, so gas estimation and broadcasting share the endpoint
selected by that flag.

The `run()` function's bytecode and `InvalidRecipient` checks are local Foundry simulations. A deployment is
not verified until the separate `verifyReceipt(bytes32)` step finds a successful mined receipt, checks its
sender and deployed bytecode through live RPC reads, and passes the `InvalidRecipient` fork simulations.
Do not activate or configure a new address unless this separate verification succeeds.

After separate deployment approval, set `ARC_TESTNET_RPC_URL`, `FOUNDRY_ACCOUNT`,
`ARCSPLIT_TESTNET_DEPLOYER`, and `ARCSPLIT_TESTNET_DEPLOY_CONFIRM=true`. Run the deployment with
`forge script contracts/script/DeployArcSplitTestnet.s.sol:DeployArcSplitTestnet --rpc-url "$ARC_TESTNET_RPC_URL" --account "$FOUNDRY_ACCOUNT" --broadcast`.
Wait for Foundry to report the mined transaction receipt, then run
`forge script contracts/script/DeployArcSplitTestnet.s.sol:DeployArcSplitTestnet --sig "verifyReceipt(bytes32)" "$DEPLOY_TX_HASH" --rpc-url "$ARC_TESTNET_RPC_URL"`.
The second command is the required live verification step; use the transaction hash from the successful
deployment receipt. Do not treat the first command's simulation output as deployment verification.

`vm.startBroadcast()` does not open MetaMask. This workflow uses a Foundry CLI-configured signer; if deployment
must use the existing MetaMask browser wallet, a separate wallet-connected deployment workflow is required.
No MetaMask deployment UI is included here.

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
