# Compatibility

## Protocol baseline

The 0.1.0 review baseline is:

| Component | Supported baseline |
| --- | --- |
| x402 | Version 2 `PaymentRequired` |
| Scheme | `exact` on Stellar |
| Networks | `stellar:testnet`, `stellar:pubnet` |
| Assets | SEP-41 contracts; default policy allows official USDC only |
| Stellar SDK | 16.x |
| Runtime | ESM, Node.js 22+ or a modern browser/hybrid runtime |

The implementation was checked on 2026-08-13 against `@x402/stellar` 2.22.0 at upstream commit `4f587236e99928d05677ab63a0bafe6120dc1111` and the official Stellar exact-scheme specification at that commit.

This is a declared review baseline, not a promise that future minor versions of upstream packages cannot change behavior. CI should be rerun whenever `@stellar/stellar-sdk` resolves to a new version.

## Authorization formats

The guard accepts both Soroban authorization preimage envelope formats exposed by Stellar SDK 16.x:

- legacy `envelopeTypeSorobanAuthorization`;
- address-bound `envelopeTypeSorobanAuthorizationWithAddress` used by upgraded CAP-71 credentials.

Both formats must authorize exactly one SEP-41 transfer matching the frozen intent. When an address is embedded in the upgraded preimage, it must match the payer.

## Runtime requirements

Browser and hybrid environments must provide:

- `fetch` and `AbortController` for remote policy, receipt, and inspector APIs;
- `crypto.getRandomValues` for approval tokens;
- `TextDecoder` and `atob` for header parsing;
- a synchronous `StorageLike` implementation for `PaymentLedger`.

Network APIs are optional. Parsing, policy restriction, authorization inspection, approval tokens, and the local conformance suite do not make network requests.

## Explicit exclusions

Version 0.1.x does not support x402 v1, non-sponsored Stellar exact payments, classic Stellar payments, arbitrary Soroban calls, multiple transfers, `upto`, batch settlement, facilitator operation, smart-account signature verification in conformance v1, or authoritative on-chain finality checks.
