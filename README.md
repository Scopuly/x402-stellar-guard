# @scopuly/x402-stellar-guard

[![CI](https://github.com/scopuly/x402-stellar-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/scopuly/x402-stellar-guard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40scopuly%2Fx402-stellar-guard)](https://www.npmjs.com/package/@scopuly/x402-stellar-guard)
[![license](https://img.shields.io/npm/l/%40scopuly%2Fx402-stellar-guard)](LICENSE)

Wallet-grade safety, policy, receipts, and conformance tooling for x402 v2 payments on Stellar.

Built and maintained by [Scopuly](https://scopuly.com). The package is based on the payment-safety boundaries implemented in Scopuly Mobile and its paired browser extension.

> Status: `0.1.0` public preview. The API is intentionally limited to Stellar `exact` payments with explicit user approval. This package has not received an independent security audit. Do not enable unattended Mainnet spending with this release.

## Why this exists

The x402 SDK creates and transports payment payloads. A production wallet still needs to decide whether an authorization is safe to sign. This package provides that missing wallet boundary:

- strict x402 v2 `PAYMENT-REQUIRED` parsing;
- current x402 v2 resource metadata (`serviceName`, `tags`, and `iconUrl`);
- clean HTTPS resource/origin binding;
- Stellar network, SEP-41 asset, recipient, amount, and fee-sponsorship policy;
- exact CAP-71/Soroban `transfer(from, to, amount)` decoding;
- byte-level binding of the authorization entry to the reviewed payment intent;
- payment-timeout-bound authorization expiry;
- hidden sub-invocation, replay, expiration, and budget protection;
- one-shot approval tokens;
- local receipt matching and recovery interfaces;
- guard and wallet conformance suites;
- a read-only endpoint inspector CLI.

The package never stores secret keys, signs autonomously, submits transactions, or operates a facilitator.

## Install

```bash
npm install @scopuly/x402-stellar-guard
```

Node.js 22 or newer is required. The package is ESM-only. Browser and hybrid-wallet runtimes need standard `fetch`, `crypto.getRandomValues`, `TextDecoder`, and storage-compatible APIs.

## Safe signing flow

```ts
import {
  ApprovalTokenStore,
  PaymentLedger,
  createDefaultGuardPolicy,
  guardAuthorizationEntry,
  guardPaymentRequired,
} from "@scopuly/x402-stellar-guard";

const policy = createDefaultGuardPolicy(); // Testnet on, Mainnet off

const intent = guardPaymentRequired(paymentRequiredHeader, {
  origin: window.location.origin,
  requestUrl: protectedResourceUrl,
  payer: activeAddress,
  network: "stellar:testnet",
}, {policy});

// Display intent.payTo, intent.amountDisplay, intent.asset, and intent.network.
await requestExplicitUserApproval(intent);

const review = guardAuthorizationEntry(authEntryXdr, networkPassphrase, intent, {
  currentLedger: latestLedgerSequence,
  maxLedgerWindow: policy.maxAuthorizationLedgerWindow,
  // Supply a live network estimate when available; the safe fallback is 5s.
  estimatedLedgerCloseSeconds,
});

const approvals = new ApprovalTokenStore();
const approvalToken = approvals.issue(intent.fingerprint);

// Consume immediately before the wallet signs.
if (!approvals.consume(approvalToken, intent.fingerprint)) {
  throw new Error("Fresh approval required");
}

const ledger = new PaymentLedger({storage: window.localStorage});
const reservation = ledger.reserve({intent, authorization: review});

try {
  const result = await wallet.signAuthEntry(authEntryXdr, {
    address: intent.payer,
    networkPassphrase,
  });
  ledger.authorize(reservation.id);
  return result;
} catch (error) {
  ledger.fail(reservation.id, "SIGNING_FAILED");
  throw error;
}
```

The application must re-run `guardAuthorizationEntry` immediately before signing. `currentLedger` and the ledger-close estimate must come from a trusted, fresh RPC strategy chosen by the wallet. Never trust values rendered by the dApp or values parsed before an asynchronous approval step.

## Mainnet policy

Mainnet is disabled by default. It requires both an enabled network and an exact HTTPS origin allowlist:

```ts
const policy = createDefaultGuardPolicy({
  pubnetEnabled: true,
  allowedOrigins: ["https://merchant.example"],
});
```

The 0.1.x built-in ceilings are intentionally conservative:

| Network | Per payment | Daily budget | Default |
| --- | ---: | ---: | --- |
| Stellar Testnet | 1,000 USDC | 1,000 USDC | Enabled |
| Stellar Mainnet | 1 USDC | 1 USDC | Disabled |

The per-payment ceiling is enforced by `guardPaymentRequired`; the daily budget is enforced when the application calls `PaymentLedger.reserve` before signing. These preview defaults are safety boundaries, not financial advice or a recommendation for unattended payments.

For a server-controlled kill switch, use `loadRestrictedGuardPolicy`. A remote policy may only reduce built-in limits and assets; it cannot expand them.

## Conformance

Run the reference guard suite locally:

```bash
npx --package @scopuly/x402-stellar-guard x402-stellar-guard conformance
```

Wallet conformance uses deterministic Testnet authorization requests and a disposable classic Ed25519 (`G...`) account. It requests signatures but never submits or settles them:

```ts
import {runWalletConformance} from "@scopuly/x402-stellar-guard/conformance";
import {createScopulyProviderAdapter} from "@scopuly/x402-stellar-guard/adapters/scopuly-provider";

const report = await runWalletConformance({
  adapter: createScopulyProviderAdapter(window.scopuly),
  currentLedger: latestTestnetLedger,
  confirmTestnetSigning: true,
});
```

The suite covers the legacy and CAP-71-compatible authorization-preimage boundaries used by Stellar SDK 16.x. It checks a safe transfer and rejects wrong account, hidden sub-invocation, cross-network asset, excessive amount, and expired authorization vectors. Run it only with a disposable Testnet account.

## CLI

```bash
# Non-paying HTTP inspection; the server still receives a GET request
npx --package @scopuly/x402-stellar-guard x402-stellar-guard inspect https://merchant.example/paid-api

# Decode a PAYMENT-REQUIRED header or a file
npx --package @scopuly/x402-stellar-guard x402-stellar-guard decode eyJ4NDAyVmVyc2lvbiI6Mi...

# Apply the default fail-closed policy
npx --package @scopuly/x402-stellar-guard x402-stellar-guard validate header.txt \
  --origin https://merchant.example \
  --request-url https://merchant.example/paid-api \
  --payer G...
```

## Package boundaries

- Main export: parser, policy, authorization guard, ledger, receipts, endpoint inspection.
- `@scopuly/x402-stellar-guard/conformance`: reference and wallet conformance runners.
- `@scopuly/x402-stellar-guard/adapters/scopuly-provider`: Scopuly Mobile/extension adapter.

See the [API reference](docs/API.md), [compatibility matrix](docs/COMPATIBILITY.md), [security model](docs/SECURITY_MODEL.md), [conformance specification](docs/CONFORMANCE.md), and [Scopuly integration status](docs/SCOPULY_INTEGRATION.md).

## Scope and non-goals

This package is a wallet-side guard, not an x402 client, facilitator, signer, settlement service, or replacement for `@x402/stellar`. It never accepts secret keys and does not establish on-chain finality. Application receipts in this package are a Scopuly safety extension, not a core x402 protocol type.

The default policy intentionally allows only the official Stellar USDC contracts. The Stellar x402 mechanism itself supports other SEP-41 tokens; applications can propose broader support in future reviewed releases.

## Protocol references

- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [Stellar exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md)
- [Stellar x402 documentation](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [SEP-41 token interface](https://stellar.org/protocol/sep-41)

## Development

```bash
npm ci --ignore-scripts
npm run release:check
npm pack --dry-run
```

Maintainers should follow the [repository setup](docs/REPOSITORY_SETUP.md) and [release checklist](docs/RELEASING.md). Publishing is performed with npm Trusted Publishing after the one-time package bootstrap.

## License

Apache-2.0. See [LICENSE](LICENSE).
