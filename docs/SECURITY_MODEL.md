# Security model

## Trust boundaries

The resource server and dApp are untrusted until every payment field is validated. The facilitator is trusted only to verify and settle the exact authorization the wallet signed. RPC responses are untrusted inputs and must not replace a fresh ledger/finality strategy chosen by the integrating wallet.

The user trusts the wallet UI, key custody, configured policy, and persistent anti-replay storage.

## Enforced invariants

The public preview accepts only:

- x402 version 2;
- scheme `exact`;
- `stellar:testnet` or explicitly enabled `stellar:pubnet`;
- clean HTTPS origins and resource URLs;
- a resource URL on the requesting origin;
- policy-allowed SEP-41 contracts;
- positive atomic integer amounts under both per-payment and daily limits;
- fee-sponsored requirements when the policy requires them;
- one root Soroban `transfer(from, to, amount)` invocation;
- no sub-invocations;
- payer, recipient, asset, and amount exactly matching the frozen reviewed intent;
- an authorization expiry bounded by both policy and `maxTimeoutSeconds`;
- a CAP-71 bound address matching the payer when present.

## Fail-closed behavior

Mainnet is disabled in the default policy. A policy fetched from a server can reduce permissions but cannot add assets, increase limits, disable sponsored-fee enforcement, or extend the authorization window beyond the built-in policy.

If persistent anti-replay storage is unavailable, `PaymentLedger` construction fails. Separate bounded authorization and receipt replay journals survive normal payment-history rotation and fail closed if corrupted or full. Persisted records and daily spend are validated again when read and fail closed if incomplete or corrupt. If the current ledger cannot be verified, authorization guarding fails. If selection is ambiguous, the caller must select a network before continuing.

Remote policy and receipt loaders use bounded response bodies, clean HTTPS URLs, blocked redirects, exact origin allowlists, and timeouts.

## Approval and signing

`ApprovalTokenStore` holds only in-memory, random, expiring, one-use tokens bound to an intent fingerprint. It is not a replacement for PIN, biometric, passkey, or hardware-wallet authorization. The integrating wallet performs strong user authentication and issues the token only after the exact intent is displayed.

The package intentionally does not accept a secret key or expose a signing helper.

## Receipts

Receipts are accepted only when origin, payer, recipient, network, asset, amount, and creation time match a local authorization. A delivered or settled receipt requires a 32-byte transaction hash. Receipt resolvers enforce exact HTTPS origin allowlists and blocked redirects.

The receipt model is a Scopuly application safety extension. It is not the core x402 `SettlementResponse` schema and does not independently prove on-chain finality.

## Residual risks

- The caller is responsible for a trusted, fresh ledger sequence and ledger-close estimate.
- `PaymentLedger` is not tamper-evident. Explicitly clearing anti-replay/budget state or externally replacing valid storage with a different valid snapshot can reset local history; wallets should use their protected storage layer where available.
- `PaymentLedger` uses synchronous read-modify-write storage and does not coordinate independent tabs or processes. Integrators must serialize signing through a single wallet authority.
- Resource descriptions, icons, tags, errors, and extension payloads are untrusted display metadata. Render them as text and never auto-fetch an icon or execute extension data without a separate policy.
- The endpoint inspector can make outbound HTTPS requests and must not be exposed as an unrestricted server-side proxy.
- The package has not received an independent security audit.

## Not yet supported

- unattended or background auto-approval;
- arbitrary Soroban contract calls;
- classic Stellar payments;
- multiple token transfers;
- client-paid fees;
- `upto`, channels, or batch settlement;
- facilitator operation;
- authoritative on-chain finality verification inside this library.

## Reporting vulnerabilities

Follow [SECURITY.md](../SECURITY.md). Never attach secret keys, signed Mainnet authorization entries, raw bridge payloads, or user-identifying receipts to a public issue.
