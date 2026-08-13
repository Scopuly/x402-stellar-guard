# Repository setup

Complete this maintainer checklist immediately after creating the public GitHub repository.

## Repository metadata

- description: `Wallet safety, policy, receipts, and conformance tooling for x402 v2 payments on Stellar.`
- website: `https://scopuly.com`
- topics: `x402`, `stellar`, `soroban`, `wallet`, `payments`, `security`, `conformance`, `typescript`;
- default branch: `main`;
- enable Issues and Discussions only when maintainers are ready to respond.

## Security settings

1. Enable private vulnerability reporting.
2. Enable the dependency graph, Dependabot alerts, Dependabot security updates, secret scanning, and push protection where available.
3. Review GitHub's generated dependency graph after the first push.
4. Keep `support@scopuly.com` monitored for security reports.

## Branch and release protection

Protect `main` with a ruleset that requires pull requests, at least one approving review, resolved conversations, and the Node.js 22 and 24 CI checks. Block force pushes and branch deletion. Require signed commits only if every maintainer has a working signing setup.

Create an `npm` environment with required maintainer approval and allow deployments only from protected tags/releases. Then follow [RELEASING.md](RELEASING.md) for the initial npm bootstrap and Trusted Publisher setup.

## First push gate

Before pushing the initial branch:

```bash
npm ci --ignore-scripts
npm run release:check
npm audit --omit=dev
npm pack --dry-run
```

After the first push, confirm that CI is green before creating `v0.1.0`. Do not publish the npm package merely because the GitHub repository exists; package publication is a separate, deliberate release step.
