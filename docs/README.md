# ArcSplit

A beginner-friendly, non-custodial USDC payment-splitting app on Arc Testnet.

---

## What It Does

ArcSplit lets you split a USDC payment across multiple wallet addresses in one transaction. You set the total amount and assign a percentage share to each recipient. The app:

1. Asks you to **approve** the ArcSplit contract to spend your USDC.
2. Calls **distribute()**, which atomically pulls USDC from your wallet and sends the correct share to each recipient.

No fees. No custody. No admin key. Your USDC never sits in the contract — it goes directly from you to the recipients.

---

## Architecture

```
Browser wallet (payer)
  │
  ├─ USDC.approve(ArcSplit, totalAmount)    ← Step 1
  │
  └─ ArcSplit.distribute(recipients, sharesBps, totalAmount)  ← Step 2
         │
         ├─ USDC.transferFrom(payer → contract)
         ├─ USDC.transfer(recipients[0], amount0)
         ├─ USDC.transfer(recipients[1], amount1)
         └─ USDC.transfer(recipients[n], remainder)   ← last gets dust
```

### Smart Contract (`contracts/ArcSplit.sol`)

- **Single function**: `distribute(address[] recipients, uint256[] sharesBps, uint256 totalAmount)`
- **Shares**: basis points (100 bps = 1%), must sum to exactly **10,000 bps = 100%**
- **Dust handling**: the final recipient gets the remainder from integer division, so the total always equals `totalAmount`
- **Reentrancy protection**: OpenZeppelin `ReentrancyGuard`
- **Safe transfers**: OpenZeppelin `SafeERC20`
- **Validations**: zero amount, array length mismatch, too many recipients (>50), zero address, duplicate addresses, zero share, shares ≠ 100%
- **No owner, no fees, no upgrade mechanism**

### Frontend (`src/`)

- React + TypeScript + Vite
- wagmi v2 + ConnectKit for wallet connection
- Three-step wizard: Amount → Recipients → Review
- Real onchain balance and allowance reads
- Explicit two-transaction flow (approve + distribute) with per-step status

---

## Setup

### Prerequisites

- [Bun](https://bun.sh) 1.x
- [Foundry](https://getfoundry.sh) (for contract compilation and tests)
- A browser wallet (MetaMask, etc.) with Arc Testnet configured
- Testnet USDC — use the **Get test USDC** button in Arc Studio's sidebar

### Install & Run

```bash
bun install
bun run dev
```

The app runs at `http://localhost:5173`.

### Compile Contracts

```bash
bun run contracts:build   # forge build
```

### Run Tests

```bash
bun run contracts:test    # forge test -v
```

### Deploy the Contract

The contract takes the USDC address as a constructor argument. For Arc Testnet:

```
USDC address: 0x3600000000000000000000000000000000000000
Chain ID:     5042002
```

After deploying, add the contract address to your `.env`:

```
VITE_ARCSPLIT_ADDRESS=0x<your deployed address>
```

Then restart the dev server (`bun run dev`) so Vite picks up the new env variable.

---

## How to Use ArcSplit

1. **Connect** your wallet in the header.
2. **Step 1 — Amount**: Enter how much USDC to split. Click Continue.
3. **Step 2 — Recipients**: Add wallet addresses. Assign basis-point shares (must total 10,000 bps = 100%). Click "Split equally" to divide evenly. Click Review.
4. **Step 3 — Review**: Confirm the payout breakdown. Click **Approve USDC** (wallet prompt 1). After confirmation, click **Distribute Now** (wallet prompt 2). Done.

---

## Basis Points Explained

| Percentage | Basis Points |
|------------|-------------|
| 100% | 10,000 bps |
| 50% | 5,000 bps |
| 33.33% | 3,333 bps |
| 25% | 2,500 bps |
| 10% | 1,000 bps |
| 1% | 100 bps |

The last recipient always receives any leftover from integer division (at most a few 0.000001 USDC), so the total distributed always equals the approved amount.

---

## Security Review Checklist

This contract was reviewed at the **balanced** level (Critical + High findings) before deployment.

| Check | Status |
|-------|--------|
| No reentrancy vulnerability | Guarded by `nonReentrant` |
| No owner / admin key | No privileged roles |
| No fee extraction | No fee logic |
| No custody of user funds | USDC flows payer → contract → recipients atomically |
| No undistributed dust | Last recipient gets remainder |
| Duplicate recipients blocked | O(n²) loop check, max 50 recipients |
| Zero-address recipients blocked | Explicit check |
| Zero shares blocked | Explicit check |
| Share total enforced exactly | Reverts if ≠ 10,000 bps |
| Safe ERC-20 transfers | `SafeERC20.safeTransferFrom` / `safeTransfer` |
| Integer overflow protection | Solidity ^0.8 built-in overflow checks |
| Slither static analysis | Zero actionable findings |
| Automated unit tests | 23/23 passing (fuzz + invariant) |
| Not deployed to mainnet | Testnet only — review before any mainnet use |

**Important:** This is a testnet implementation for learning. Before deploying to mainnet or handling real funds:
- Obtain an independent professional security audit
- Verify the USDC address for your target chain from official Circle docs
- Test thoroughly on testnet with your actual use case
- Understand that mainnet transactions are irreversible

---

## File Structure

```
contracts/
  ArcSplit.sol              — The smart contract
  test/
    ArcSplit.t.sol          — Foundry unit, fuzz, and invariant tests

src/
  App.tsx                   — Three-step wizard shell
  components/
    StepIndicator.tsx       — Progress indicator
    AmountStep.tsx          — Step 1: amount entry + balance
    RecipientsStep.tsx      — Step 2: recipient management
    ReviewStep.tsx          — Step 3: approve + distribute
  hooks/
    useUsdcBalance.ts       — Live USDC balance reader
    useUsdcAllowance.ts     — Live allowance reader
  utils/
    arcsplit.ts             — Contract ABI, addresses, helpers

docs/
  README.md                 — This file
```

---

## Deployed Contract (Arc Testnet)

This contract is live on Arc Testnet and can be used immediately with testnet USDC.

| Field | Value |
|---|---|
| Contract address | `0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2` |
| Network | Arc Testnet (chain ID 5042002) |
| Explorer | [View on Arcscan](https://explorer.testnet.arc.io/address/0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2) |
| Deploy tx | [`0xf3f008b84...`](https://explorer.testnet.arc.io/tx/0xf3f008b84752edce1083d378c8b1901a5ff093c62ce950d0a8704c20665896dc) |
| Deployed | 2026-10-19 |
| Constructor arg | USDC `0x3600000000000000000000000000000000000000` |

The `.env.example` file in this repo has `VITE_ARCSPLIT_ADDRESS` pre-filled with the address above. Copy it to `.env` and run `bun run dev` to use the live contract immediately.

To get testnet USDC, use the **Get test USDC** button in Arc Studio's sidebar, or ask on the Arc Discord.

---

## Chain & Token Details

| Item | Value |
|------|-------|
| Network | Arc Testnet |
| Chain ID | 5042002 |
| USDC address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | 6 |
| Explorer | https://explorer.testnet.arc.io |

On Arc, USDC is the native gas token. You pay gas fees in USDC — no separate ETH or other gas token needed.

---

## License

MIT
