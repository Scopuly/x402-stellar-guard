# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest 0.1.x | Yes |
| Older previews | No |

## Reporting

Please report suspected vulnerabilities privately to `support@scopuly.com` with the subject `x402 Stellar Guard security report`.

Include the affected version, impact, and a minimal Testnet reproduction. Do not include secret keys, seed phrases, raw Mainnet signatures, signed authorization entries, production bridge payloads, or personal payment history.

We aim to acknowledge a report within five business days. Please do not disclose an unresolved vulnerability publicly until a coordinated release is available.

## Scope

High-priority reports include authorization-to-intent bypasses, network or asset confusion, origin-binding bypasses, replay/budget failures, unsafe remote-policy expansion, receipt mismatches, and package publishing compromise.

The package is a local guard and does not operate a facilitator or custody keys. Vulnerabilities in third-party services should be reported to their operators unless this package makes the issue exploitable.

Good-faith research using generated Testnet accounts and without accessing other users' data is welcome. We will not pursue action against research that follows this policy and applicable law.
