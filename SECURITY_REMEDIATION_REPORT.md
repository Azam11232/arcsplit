# ArcSplit release candidate security report

**Audit date:** 2026-11-21
**Base:** `origin/main` at `854e988000ff1c863830cdc225fa56d47a075d8d`

## Summary

- The candidate uses the tracked `bun.lock`; the pre-existing untracked npm lockfile was not copied.
- Mainnet address validation and network-specific target selection are included. The production build was verified with the intended Mainnet and Testnet environment values.
- Vitest and `@vitest/mocker` are both 4.1.12. The previous Tinypool Critical advisories are no longer reported.
- Candidate-only Vercel response headers are prepared in `vercel.json`; Content Security Policy remains Report-Only.
- No additional production dependency security upgrades, blanket overrides, deployment, wallet connection, signature, or transaction occurred during candidate preparation. The previously reviewed manifest changes, including the receipt dependency, are preserved; declared Circle SDK packages are not used by the browser app's connection path.

## Isolated Wagmi 3 migration POC (2026-11-22)

This addendum records the final validation of the separate Wagmi 3 working copy. Historical 2026-11-21 candidate findings below are retained for context and are not the migration dependency audit.

- Wagmi is pinned to `3.7.11` and `@wagmi/connectors` to `8.2.4`. ConnectKit is removed, only the injected connector is configured, and the previous `viem` override is removed.
- `bun audit --production` reports no vulnerabilities across 89 production packages.
- The regenerated lockfile contains no `decode-uri-component`, no `uuid` package, and only `zod@4.6.7`; no WalletConnect, Coinbase Wallet SDK, or MetaMask Connect SDK package is installed. Connector package optional-peer metadata is not an installed dependency.
- All 164 application tests, both TypeScript checks, full Oxlint, and the production build pass. The build retains the large-chunk warning.
- Foundry build passed, all 57 tests passed (including 128,000 invariant calls), and `forge fmt --check` passed. Foundry emits non-fatal `require-revert-in-loop` warnings for existing contract validation loops.
- The final UI regression comparison preserves one-decimal truncation for Average Payment, all five navigation icon assignments, and no rendered Built with Arc watermark. Development supports both Arc networks; the production configuration is Mainnet-only.
- The local migration app responds with HTTP 200 on port 5174. Browser/extension interaction and screenshots were not performed because Chrome control was prohibited; therefore a real MetaMask connection and wallet-driven chain switch remain unverified.
- The live site still serves `/assets/index-BoXPqROg.js`. The bundle contains the previous Testnet backup `0xd90b75d07a2b592b0a01f0ac63d522f54ffd1ef2` and legacy Mainnet address `0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E`, but not the migration candidate's active Mainnet target `0xF13199D9bbf965eE10f41b531Ee4aa660bB54738` or active Testnet target `0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35`. It contains the Testnet chain ID and label, which does not by itself prove Testnet is offered in the production UI.
- The public response sends HSTS only. `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy-Report-Only` are absent even though `vercel.json` configures them and keeps CSP Report-Only.
- Vercel CLI, token, user auth file, and project link were unavailable. Manual authenticated access is required to inspect project/deployment settings and reconcile the live bundle and headers. No wallet was connected, no transaction was signed or submitted, and no contract or hosting changes were made.

## Historical pre-migration audit comparison (2026-11-21)

The initial npm audit reported 86 package findings (60 High, 19 Moderate, 7 Low) against the separate, untracked npm lock graph. The tracked Bun graph had 42 advisory entries before the earlier reviewed dependency remediation.

Current results from the candidate's tracked Bun graph:

| Audit | Current result |
|---|---|
| `bun audit --production` | 4 advisory entries: 2 High, 2 Moderate |
| `bun audit` | 5 findings: 2 High, 2 Moderate, 1 Low |

These counts are not directly comparable to the old npm result. The npm lockfile was deliberately excluded and is not authoritative for this Bun project.

## Historical candidate dependency advisories (superseded for the migration copy)

All remaining vulnerable leaf packages are transitive; none is declared directly in `package.json`.

| Package and installed version | Parent path | Advisory / patched version | Status and recommended remediation |
|---|---|---|---|
| `decode-uri-component@0.2.2` | `wagmi@2.19.5` -> `@wagmi/connectors@6.2.0` -> WalletConnect -> `query-string@7.1.3` -> `decode-uri-component` | [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f), High; [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), Moderate. `0.5.0` fixes the Moderate advisory; `0.5.1` is required for both. | `query-string` constrains the leaf to the old `0.2.x` range. Upgrade the WalletConnect/query-string parent chain when a compatible release is available; do not force a leaf override. |
| `uuid@8.3.2`, `uuid@9.0.1` | `wagmi@2.19.5` -> `@wagmi/connectors@6.2.0` -> MetaMask SDK tree, including `@metamask/sdk@0.33.1` | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), Moderate; patched in `11.1.1` (or corresponding patched later majors). | Parent ranges select UUID 8/9. Upgrade the MetaMask connector/SDK path compatibly and re-test wallet connection flows; UUID 11 is a major change for these parents. |
| `zod@3.25.76` | `@coinbase/cdp-sdk@1.58.0` -> `zod` | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), High; patched in Zod `4.6.6`. | The CDP SDK constrains Zod to 3.x. Upgrade the parent SDK when it supports patched Zod; the installed `zod@4.6.7` copy is patched but does not replace the vulnerable 3.x copies. |
| `zod@3.22.4` | `@reown/appkit-wallet@1.7.8` -> `zod` | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), High; patched in Zod `4.6.6`. | The parent constrains Zod to 3.x. Upgrade the Reown/AppKit parent when compatible; do not force Zod 4 into its current range. |
| `elliptic@6.6.1` (development-only) | `vite-plugin-node-polyfills@0.22.0` -> `node-stdlib-browser` -> `crypto-browserify` -> `create-ecdh` -> `elliptic` | [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84), Low; no patched version is published. | Development-only dependency. Remove or replace the polyfill chain if it is no longer needed, or monitor upstream for a fix. No override or speculative replacement was applied. |

The production advisory paths all enter through wallet connector dependencies. The vulnerable modules above were absent from the candidate's temporary production source maps, as was `elliptic`; this indicates they were tree-shaken from this build, not that the dependency graph is remediated. The temporary maps were not retained.

## Network and contract verification

- Arc Mainnet is the default configured network (chain ID `5042`); Arc Testnet remains available (chain ID `5042002`).
- The configured Mainnet transaction target is `0xF13199D9bbf965eE10f41b531Ee4aa660bB54738`. Legacy Mainnet `0xB7Ee9d819AA626F3ABA56ab3948bC56fa62f0E7E` remains in historical analytics and is not selected for new transactions.
- The Testnet transaction target is `0x0c4DC391c39641B5DEa9304454B99B37c9FFFb35`; it is selected independently by chain ID.
- The active Mainnet runtime matched the available compiled artifact after applying its immutable USDC constructor value. The active Testnet code contains the expected distribution selectors, but its complete runtime did not match the available artifact; exact Testnet source provenance remains unverified.
- New contract source and Foundry tests in this candidate were compiled and tested locally only. No contract was deployed.

## Historical build configuration and hosting findings

The release-candidate production build was run with public contract-address values only:

- `VITE_ARCSPLIT_ADDRESS` = legacy Mainnet address, retained for analytics.
- `VITE_ARCSPLIT_MAINNET_NEXT_ADDRESS` = active Mainnet address.
- `VITE_ARCSPLIT_MAINNET_USE_NEXT_ADDRESS` = `true`.
- `VITE_ARCSPLIT_TESTNET_ADDRESS` = active Testnet address.

No secrets were found in the emitted client bundle. The Vercel dashboard/environment was not changed. The final live-site inspection and authentication limitations are recorded in the migration addendum above.

Candidate-only Vercel configuration is now prepared in `vercel.json`. It sets HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Content-Type-Options: nosniff` for all routes. CSP is only `Content-Security-Policy-Report-Only`; no enforced CSP is configured. The initial policy allows the self-hosted app, inline styles used by the UI, Google Fonts CSS/font origins referenced by `index.html`, and the Arc Mainnet/Testnet RPC origins configured in `src/config.ts`. It does not allow Circle or wallet-connector service origins.

Connection review: the app configures wagmi's injected connector only. The Connect Wallet modal was opened in the local browser without selecting a wallet, and no external network requests were observed during reload/modal display. This did not verify RPC behavior after wallet connection. Circle package references are not used by the browser app's connection path; no Circle request was observed or found as a required browser endpoint. Arc explorer URLs are links for user navigation, not fetch/`connect-src` dependencies. Because no wallet was connected and production headers cannot be validated without deployment, the report-only policy still needs review against real browser CSP reports before any enforcement. The Vercel dashboard and production response headers were not changed.

## Historical release-candidate validation

- Frontend tests: 151 passed (including the two Vercel header configuration tests). The initial run without explicit target environment values had five config-dependent failures; rerunning with the candidate's Mainnet/Testnet target values passed all tests.
- Application TypeScript check: passed.
- Production build: passed with explicit target environment values; Rollup emitted existing annotation and large-chunk warnings.
- Foundry: 39 tests passed, including 128,000 invariant calls.
- Targeted Oxlint for network configuration/address validation tests: passed. A broader type-aware lint run is not clean; it reports multiple diagnostics, including `react(set-state-in-effect)` on pending-transaction recovery in `src/App.tsx`.
- Browser checks: Light Mode default and persisted Dark Mode verified; no horizontal overflow at 320, 390, 768, or 1280 px; reduced-motion animation and transition durations were `0.00001s`.
- Header-config preview: response headers were read from the candidate's `vercel.json`; the production build loaded successfully with CSP Report-Only, and the Connect Wallet modal rendered without observed CSP console violations or failed/external requests. No wallet was connected, so post-connection RPC behavior remains unverified.
- The production bundle contains both active Mainnet and active Testnet addresses; the legacy Mainnet address remains present for history/analytics. No contract address was changed.

## Historical release-candidate risks (superseded for the migration copy)

1. Four production advisory entries remain in transitive wallet dependencies, although the vulnerable leaf modules were not present in the examined production bundle.
2. The low-severity development-only `elliptic` advisory has no published patch.
3. Vercel must be configured with the required public contract target variables, particularly `VITE_ARCSPLIT_MAINNET_USE_NEXT_ADDRESS=true` and the active Testnet address, before publishing. No hosting settings were changed; the live bundle still selects legacy targets.
4. The live Vercel response is missing four requested security headers. Candidate configuration is prepared but not deployed; CSP must remain report-only until wallet-connected browser reports are reviewed.
5. Active Testnet source/runtime provenance is not fully verified.
