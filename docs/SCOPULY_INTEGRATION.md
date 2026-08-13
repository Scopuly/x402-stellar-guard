# Scopuly integration status

The safety model in this repository was derived from the x402 implementation paths present in Scopuly Mobile and the paired Scopuly browser extension.

## Existing Scopuly implementation basis

- Soroban authorization preimage parsing and network-ID validation;
- CAP-71 bound-address handling;
- direct SEP-41 `transfer(from, to, amount)` decoding;
- official Stellar USDC Testnet and Pubnet contract validation;
- sub-invocation, wrong signer, expiration, and amount-limit blocking;
- per-payment review UI and fresh PIN/biometric authorization;
- in-session signature replay prevention;
- persistent local payment ledger and daily spend limits;
- receipt matching, replay protection, and uncertain-settlement recovery;
- Scopuly Mobile injected provider and paired browser extension channels;
- bounded USDC x402 Mainnet flow in the application codebase.

## New public-kit surfaces

- generic TypeScript interfaces independent of Scopuly application state;
- fail-closed public package policy API;
- read-only endpoint inspector CLI;
- reusable guard and wallet conformance reports;
- a published Scopuly provider adapter.

These new surfaces are covered by this repository's unit, type, lint, and build checks. The provider adapter is also tested against the real Scopuly provider convention that reports `PUBLIC` or `TESTNET` plus an authoritative passphrase. They are not yet the import source used by the Scopuly application. A follow-up migration should replace the corresponding in-app modules with this npm package and run the complete Scopuly provider, extension, mobile, Testnet, and Mainnet acceptance matrix before removing the legacy copies.

No claim in this document substitutes for that end-to-end acceptance run. Source parity, package verification, production consumption, and live-network acceptance are separate release gates.
