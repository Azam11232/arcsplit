# ArcSplit security remediation report

**Audit date:** 2026-11-23

## Summary

- Contract address configuration is validated before application modules can access wallet actions. Configured Mainnet active/next, Mainnet legacy, and Testnet active/legacy addresses now reject malformed and zero addresses.
- Mainnet/Testnet selection and the configured contract values are unchanged. Invalid configuration throws during module initialization; an absent optional Mainnet active address remains unavailable to transaction handlers.
- Five unused Circle SDK dependencies were removed. The two Circle SDK packages imported by deployment scripts remain.
- Compatible lockfile patches were applied without a forced audit fix or new dependency override. Vitest was separately upgraded from 3.2.7 to 4.1.12, a major-version upgrade.
- No wallet was connected, no signature or transaction was requested, and no contract was deployed.

## Before/after audit counts

| Audit | Before remediation | After remediation |
|---|---:|---:|
| `npm audit --omit=dev` | 86 package findings: 60 High, 19 Moderate, 7 Low | 31 package findings: 19 High, 12 Moderate, 0 Low |
| `bun audit --production` on the tracked Bun dependency graph | 42 advisory entries | 4 advisory entries: 2 High, 2 Moderate |

These are not interchangeable counts. npm's report includes affected parent package rows, while Bun reports the vulnerable packages/advisories in `bun.lock`. The existing `package-lock.json` is untracked, predates the current manifest, and was not changed; npm's result still reflects that separate lock graph. In particular, npm continues to report `follow-redirects` 1.16.1 and Hono 4.13.13, while the tracked Bun lock resolves their patched versions. `npm audit fix --dry-run --omit=dev` could not resolve the npm graph because the optional `@solana/kit@5.5.1` peer requires TypeScript `^5.0.0` while the project declares TypeScript 7. No force or legacy-peer-dependency bypass was used.

## Dependency review and changes

The original npm report's direct vulnerable roots included `@circle-fin/adapter-viem-v2`, `@circle-fin/app-kit`, `@circle-fin/developer-controlled-wallets`, `@circle-fin/modular-wallets-core`, `@circle-fin/w3s-pw-web-sdk`, and `wagmi`. Their affected transitive paths included:

- Circle App Kit/adapter -> Anchor, Solana Web3, ethers, TOML, elliptic, and Zod.
- Circle passwordless wallet SDK -> Firebase -> gRPC and Undici, plus UUID.
- Modular wallets core -> Web3 and its Web3 subpackages.
- wagmi -> connectors -> MetaMask, WalletConnect/Reown, Coinbase CDP, query-string, UUID, and Zod.

The unused direct roots `@circle-fin/adapter-viem-v2`, `@circle-fin/app-kit`, `@circle-fin/modular-wallets-core`, `@circle-fin/user-controlled-wallets`, and `@circle-fin/w3s-pw-web-sdk` were removed after confirming there are no source or script imports. `@circle-fin/developer-controlled-wallets` and `@circle-fin/smart-contract-platform` remain because the deployment scripts use them.

Compatible updates applied in `bun.lock`:

- `follow-redirects` 1.16.1 -> 1.16.2
- `hono` 4.13.13 -> 4.13.16
- `postcss-selector-parser` 6.1.4 -> 6.1.5
- `qs` 6.16.0 -> 6.16.1
- Vite 6.4.4 -> 6.4.5

Vitest was upgraded from 3.2.7 to 4.1.12 as a major-version change. No new dependency overrides were introduced.

## Remaining production findings

The tracked Bun graph still reports these four advisories:

| Package and path | Advisory | Severity | Why it remains |
|---|---|---:|---|
| `decode-uri-component` 0.2.2 via wagmi -> `@wagmi/connectors` -> WalletConnect -> `query-string` 7.1.3 | [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) | High | The parent range resolves to vulnerable 0.2.x; a safe fix is outside that range. |
| `decode-uri-component` 0.2.2 via the same path | [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | Moderate | Same dependency constraint as above. |
| UUID 8.3.2 and 9.0.1 via wagmi -> connectors -> MetaMask SDK | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Moderate | The affected parents require UUID 8/9; the patched UUID 11 line is a major-version change. |
| Zod 3.x via Coinbase CDP/Reown wallet dependencies | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | High | The patched version is Zod 4.6.6; the affected parents constrain Zod to 3.x. The installed Zod 4.6.7 copy is patched. |

The npm report additionally marks `wagmi` and `@circle-fin/developer-controlled-wallets` as directly affected. Its suggested wagmi fix is 3.7.11 (a major upgrade from the current 2.19.5); its Circle wallet fix is 10.3.1 (a major-version downgrade from the current 10.8.x line). These were not applied. The remaining transitive npm rows are effects of those parent chains, not separate direct dependencies.

## Other audit findings

The latest full `bun audit`, including development dependencies, reports 5 advisories: 2 High, 2 Moderate, and 1 Low. The production-only audit reports 4 advisories: 2 High and 2 Moderate.

The additional Low advisory is `elliptic` 6.6.1 in the development dependency tree through `vite-plugin-node-polyfills` -> `node-stdlib-browser` -> `crypto-browserify` -> `create-ecdh`. The earlier report of 10 findings, including 2 Critical findings under Vitest/tinypool 3.x, is from the older dependency graph and should not be treated as the current audit result after the Vitest 4.1.12 upgrade.

## Production bundle reachability

The earlier source-map inspection reported that vulnerable leaf modules were absent from the emitted frontend chunks. A later inspection found Zod 3-style runtime code in the built bundle, so the earlier claim that vulnerable Zod 3 code was not bundled is not supported and is withdrawn.

The later bundle search found no direct matches for `decode-uri-component` or `query-string`. UUID-related matches were generic runtime/provider identifiers and do not establish whether the vulnerable npm UUID package is bundled. These searches do not prove exploitability or non-exploitability. The remaining dependency advisories are therefore disclosed rather than described as fully mitigated by tree-shaking.

## Validation

- `bun run test`: 187 passed across 19 test files.
- `bun run typecheck`: passed.
- `bun run build`: passed; Vite reported existing large-chunk and annotation warnings.
- Foundry tests: 39 passed, 0 failed.
- Targeted Oxlint: passed.
- `bun run typecheck:scripts` was also attempted and remains blocked by the pre-existing missing `@circlefin/compass-chains` import in `scripts/compass-deploy.ts`; that dependency was not added as part of this remediation.
