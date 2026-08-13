# Contributing

Thanks for helping improve Stellar x402 wallet safety. Contributions are welcome through focused issues and pull requests.

## Development

Requirements: Node.js 22+ and npm 11+.

```bash
npm ci --ignore-scripts
npm run check
npm run check:package
npm pack --dry-run
```

## Pull requests

1. Open an issue before changing protocol behavior, security policy, public API, or persisted data.
2. Keep one concern per pull request.
3. Use generated Testnet-only accounts and fixtures.
4. Add a regression test for every behavior change.
5. Update API, compatibility, and security documentation when behavior changes.
6. Explain the security impact and failure mode in the pull request.
7. Keep the default policy fail-closed. Any change that expands Mainnet authority requires explicit maintainer review and a security rationale.

Commits should be clear and reviewable. There is no contributor license agreement or sign-off requirement for 0.1.x; contributions are accepted under the repository's Apache-2.0 license.

For vulnerabilities, do not open an issue or pull request. Follow [SECURITY.md](SECURITY.md).

Never commit credentials, signatures, production authorization entries, or identifiable receipts.
