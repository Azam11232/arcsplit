# ArcSplit

A beginner-friendly, non-custodial USDC payment-splitting app on [Arc Testnet](https://arc.io).

Split a USDC payment across multiple wallet addresses in one transaction. No fees. No admin key. Your USDC goes directly from you to the recipients.

---

## Features

- **Non-custodial** — the contract never holds funds; USDC flows atomically from payer to recipients
- **Single transaction** — one `distribute()` call splits to up to 50 recipients
- **Basis-point precision** — shares in bps (10,000 = 100%), last recipient gets any integer-division remainder
- **Safety first** — `ReentrancyGuard`, `SafeERC20`, custom errors for every invalid input
- **Full test suite** — 23 Foundry tests: unit, fuzz (256 runs), and invariant (128,000 calls)
- **Three-step UI** — Amount → Recipients → Review, with explicit Approve + Distribute flow

---

## Deployed Contract (Arc Testnet)

| Field | Value |
|---|---|
| Contract address | `0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2` |
| Network | Arc Testnet |
| Chain ID | `5042002` |
| USDC address | `0x3600000000000000000000000000000000000000` |
| Explorer | [View on Arcscan](https://explorer.testnet.arc.io/address/0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2) |
| Deploy tx | [0xf3f008b84...](https://explorer.testnet.arc.io/tx/0xf3f008b84752edce1083d378c8b1901a5ff093c62ce950d0a8704c20665896dc) |

On Arc, USDC is the native gas token — no separate ETH needed for gas fees.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.x
- [Foundry](https://getfoundry.sh)
- A browser wallet (MetaMask, etc.) configured for Arc Testnet
- Testnet USDC — get some from the **Get test USDC** button in [Arc Studio](https://studio.arc.io)

### Install & run

```bash
cp .env.example .env   # pre-filled with the live testnet contract address
bun install
bun run dev            # starts at http://localhost:5173
```

---

## Contract Commands

```bash
# Compile
bun run contracts:build    # forge build

# Test (unit + fuzz + invariant)
bun run contracts:test     # forge test -v
```

---

## How It Works

1. **Connect** your wallet (Arc Testnet).
2. **Step 1 — Amount**: enter USDC amount to split.
3. **Step 2 — Recipients**: add wallet addresses, assign basis-point shares (must total 10,000 bps = 100%). Use "Split equally" to divide evenly.
4. **Step 3 — Review**: confirm payout breakdown → **Approve USDC** (tx 1) → **Distribute Now** (tx 2).

---

## Security

- No owner, no fees, no upgrade mechanism
- `nonReentrant` on `distribute()`
- `SafeERC20` for all token transfers
- Duplicate recipient detection (O(n²), max 50 recipients)
- Zero address, zero amount, zero share, invalid total — all revert with named custom errors
- Slither static analysis: zero actionable findings
- Independent security review at balanced severity: no Critical or High findings

---

## Documentation

Full architecture, basis-points reference, security checklist, and file structure:
**[docs/README.md](docs/README.md)**

---

## License

MIT
