# Stellar x402 wallet conformance

The wallet conformance suite evaluates the signing boundary, not settlement. It generates fresh Testnet Soroban authorization preimages and calls the wallet's `signAuthEntry` interface. No signed authorization is submitted to an RPC server or facilitator.

## Requirements

- disposable classic Ed25519 (`G...`) Stellar Testnet account;
- wallet connected to Testnet;
- fresh Testnet ledger sequence supplied by the test host;
- explicit operator confirmation;
- standard 64-byte Ed25519 signature returned in Base64.

## Version 1 vectors

| ID | Expected | Invariant |
| --- | --- | --- |
| `safe-direct-transfer` | Sign | One atomic unit of Testnet USDC, one legacy-format transfer, fresh expiry |
| `bound-address-mismatch` | Reject | CAP-71 bound address and sender are not the selected wallet |
| `hidden-sub-invocation` | Reject | Root transfer contains an additional authorization |
| `cross-network-asset` | Reject | Pubnet USDC contract is presented on Testnet |
| `payment-limit` | Reject | Amount exceeds the reference wallet safety cap |
| `expired-authorization` | Reject | Expiration is not after the supplied current ledger |

A report passes only when every vector produces the expected result and the safe vector signature verifies against the selected address.

An unsafe vector passes only when the wallet rejects the `signAuthEntry` request. A fulfilled response, including a malformed or wrong-signer response, fails that vector. The generic adapter cannot prove why a rejected promise was rejected, so operators must not manually reject unsafe vectors merely to manufacture a passing report.

Version 1 verifies standard Ed25519 signatures and therefore does not grade `C...` smart accounts. A later conformance version may define contract-account verification semantics.

## Publishing reports

Reports contain the public Testnet address and timestamps. Do not publish them without the address owner's consent. A passing report is evidence for these vectors and package version only; it is not an audit or a guarantee of overall wallet security.
