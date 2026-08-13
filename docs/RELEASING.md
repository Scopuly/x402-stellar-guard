# Releasing

Releases are maintainer-only. Never publish from an unreviewed working tree.

## Release gate

1. Update `version` in `package.json` and `package-lock.json`.
2. Update `CHANGELOG.md` and compatibility claims.
3. Run `npm ci --ignore-scripts` from a clean checkout.
4. Run `npm run release:check`.
5. Run `npm audit --omit=dev` and review the complete dependency tree.
6. Run `npm pack --dry-run` and verify that no tests, secrets, local data, or build configuration enter the tarball.
7. Create and push a signed `vX.Y.Z` tag only after CI passes.

The GitHub release tag must exactly equal `v` plus the version in `package.json`. Publishing a GitHub release triggers `.github/workflows/release.yml`.

## First npm publication

npm Trusted Publishing is configured per existing package, so the initial package creation may require a maintainer's interactive npm session and 2FA. If npm does not allow the trusted publisher to be registered before the package exists, publish the first version manually with provenance disabled for that bootstrap command only:

```bash
npm publish --access public --provenance=false
```

Run the bootstrap command only from the reviewed `v0.1.0` source. Immediately configure Trusted Publishing, then publish the matching GitHub release. The release workflow recognizes an already-published `0.1.0` as the one-time bootstrap and skips only that publish step; any later duplicate version fails closed. Do not add an npm automation token to GitHub.

## Trusted Publisher settings

Configure the package on npm with:

- provider: GitHub Actions;
- organization: `Scopuly`;
- repository: `x402-stellar-guard`;
- workflow filename: `release.yml`;
- environment: `npm`;
- allowed action: `npm publish`.

Protect the GitHub `npm` environment with required maintainer approval. After OIDC publishing works, set npm publishing access to require 2FA and disallow tokens. Trusted publishing generates provenance automatically for a public package published from a public repository.

## Post-release checks

Verify package files, README links, CLI version, and a clean install in a temporary project. For OIDC releases, also verify the npm provenance indicator. The manual `0.1.0` bootstrap is the documented exception and will not have provenance. Create matching GitHub release notes from `CHANGELOG.md`.
