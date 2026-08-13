# API reference

This reference describes the public API of `@scopuly/x402-stellar-guard` 0.1.x. The package is ESM-only and does not sign or submit payments.

## Main entry point

Import these APIs from `@scopuly/x402-stellar-guard`.

### Payment requirements

`parsePaymentRequired(input)` parses bounded JSON, Base64, or Base64URL x402 v2 `PaymentRequired` data. It validates required field types and preserves current `ResourceInfo` metadata. It does not select or authorize a payment.

`guardPaymentRequired(input, context, options?)` selects exactly one supported Stellar `exact` requirement and returns an immutable `GuardedPaymentIntent`.

Required context:

- `origin`: requesting HTTPS origin;
- `payer`: selected Stellar `G...` or `C...` address;
- `requestUrl`: strongly recommended exact protected-resource URL;
- `network`: required when more than one Stellar requirement matches.

Options accept a `GuardPolicy` and an explicit localhost exception for local development. Never enable the localhost exception in production.

### Policy

`createDefaultGuardPolicy(options?)` returns a Testnet-enabled, Mainnet-disabled policy for the official Stellar USDC contracts.

`restrictGuardPolicy(candidate, basePolicy?, now?)` intersects a candidate policy with a trusted local base. It cannot enable a base-disabled network, add an origin or asset, increase limits, lengthen the authorization window, or disable required fee sponsorship.

`loadRestrictedGuardPolicy(url, options?)` loads bounded JSON over clean HTTPS with redirects disabled, then applies `restrictGuardPolicy`. Treat availability failures as fail-closed.

### Soroban authorization

`inspectDirectTokenTransfer({invocation, networkPassphrase, assets})` decodes one SEP-41 `transfer(from, to, amount)` invocation. It reports issues and rejects nested authorization semantics.

`guardAuthorizationEntry(authEntry, networkPassphrase, intent, options)` binds a padded Base64 Soroban authorization preimage to a previously reviewed intent.

Options:

- `currentLedger`: required fresh ledger sequence;
- `maxLedgerWindow`: optional local ceiling, never above the built-in ceiling;
- `estimatedLedgerCloseSeconds`: optional live estimate, default `5`.

The allowed expiry is the smaller of the local ledger-window ceiling and `ceil(intent.maxTimeoutSeconds / estimatedLedgerCloseSeconds)`.

`authorizationPayloadHash(authEntry, networkPassphrase)` returns the 32-byte payload hash used for SEP-43 Ed25519 auth-entry signing.

### Explicit approval

`new ApprovalTokenStore(options?)` creates an in-memory store for random, expiring, one-use tokens. `issue(fingerprint)` creates a token and `consume(token, fingerprint)` atomically validates and removes it.

This mechanism binds application state; it does not replace wallet PIN, biometric, passkey, or hardware authentication.

### Payment ledger

`new PaymentLedger({storage, keyPrefix?, recordLimit?})` requires a synchronous `StorageLike` adapter. Browser `localStorage` is used only when available.

Key operations:

- `reserve({intent, authorization, serviceName?, now?})` persists that authorization fingerprint in a separate replay journal and reserves budget before signing;
- `authorize(id)` records a successful signature;
- `markSubmitted(id)` records facilitator submission;
- `fail(id, errorCode?)` records a terminal local failure;
- `attachReceipt(receipt, context)` metadata-matches an application receipt and persists its ID in a replay journal;
- `getDailySummary(network, payer, limit)` reports counted spend;
- `list()` returns validated local records and fails closed if stored history is corrupted;
- `clear({includeDailySpend?, includeReplayJournal?})` clears history by default and removes budget or anti-replay state only when explicitly requested.

An attempted fingerprint is never reusable while this package's storage remains intact, including after a local failure or history rotation; retry with a newly generated authorization entry and nonce. Authorization and receipt replay journals fail closed if corrupted or if their 10,000-entry safety bound is reached. Only `clear({includeReplayJournal: true})` explicitly removes them. Storage prevents accidental replay and enforces a local budget only while its integrity and persistence hold. It is not tamper-evident.

Ledger transitions are checked: `signing → authorized → submitted`, with receipt-driven terminal or unresolved states. Repeated `authorize`/`markSubmitted` calls in their current state are idempotent; invalid downgrades and changing `delivered` to `failed` are rejected.

### Receipts and inspection

`createHttpsReceiptResolver(options)` creates a bounded, redirect-blocked HTTPS JSON resolver with an exact origin allowlist.

`recoverPendingReceipts(options)` retries records that already have a receipt identifier and an unresolved local state. Resolver errors are returned as unchanged records.

`inspectX402Endpoint(url, options?)` performs one non-paying `GET`, expects HTTP 402, parses the `PAYMENT-REQUIRED` header, and reports Stellar `exact` requirements. The remote server still observes and handles that request. Do not expose it as an unrestricted server-side proxy.

### Errors and utilities

All expected guard failures extend `X402GuardError` and expose `code` and `details`. Specialized classes are `PaymentRequiredError`, `AuthorizationGuardError`, `PolicyError`, `PaymentLedgerError`, and `ConformanceError`.

Utility exports include atomic formatting/validation, canonical JSON hashing, Stellar address checks, safe URL normalization, and network/passphrase conversion.

## Conformance entry point

Import from `@scopuly/x402-stellar-guard/conformance`.

`runGuardConformance(now?)` runs deterministic local safety vectors.

`runWalletConformance(options)` invokes a wallet adapter on Testnet vectors. Version 1 requires a disposable classic Ed25519 `G...` account, explicit confirmation, and a fresh ledger sequence. It never submits a transaction.

## Scopuly provider adapter

Import `createScopulyProviderAdapter` from `@scopuly/x402-stellar-guard/adapters/scopuly-provider`.

The adapter accepts the real Scopuly provider network names (`PUBLIC`, `TESTNET`) and CAIP-2 aliases, verifies the authoritative network passphrase, requests account access, and exposes the generic `StellarWalletAdapter` interface.
