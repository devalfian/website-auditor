# Releasing

Two packages are published: `@pagescope/core` first, then `pagescope`. The CLI depends on the core package, so publishing them in the wrong order leaves a window where `npm install pagescope` resolves a missing version.

## Why `pnpm publish` and not `npm publish`

`packages/cli` depends on `"@pagescope/core": "workspace:*"`. npm cannot resolve that protocol and fails with `Unsupported URL Type "workspace:"`. pnpm rewrites workspace dependencies to the real version while packing. **Use `pnpm publish`.**

## Pre-flight

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

All six must pass, and CI on `main` must be green. Do not publish from a red commit.

```bash
npm pack --dry-run ./packages/core
npm pack --dry-run ./packages/cli
```

Check the tarball contents:

- `@pagescope/core` contains `dist/index.js`, `dist/index.d.ts`, `dist/index.js.map` and `package.json`.
- `pagescope` contains `dist/cli.js` and its map.
- Neither tarball contains source files, tests, fixtures, or `node_modules`.
- The version in both is identical and matches the git tag.

## Publish

```bash
npm login                       # once per machine
pnpm --filter @pagescope/core publish --access public
pnpm --filter pagescope publish --access public
```

`publishConfig.access: "public"` is set on the core package, so the first publish of the scoped package does not need an owner scope surprise.

## After publishing

```bash
npm view @pagescope/core version
npm view pagescope version
npx --yes pagescope@latest --version      # must print the released version
npx --yes pagescope@latest audit https://example.com
```

Then update `README.md`: the "Status: pre-release (not on npm yet)" section must be replaced with the real install instructions. Leaving it stale after publishing is the same class of error as claiming a feature that does not exist.

## Tagging

The `v0.1.0` tag was created before the package versions were aligned to `0.1.0`; it points at an earlier commit than the code carrying that version. Before the first npm release, decide one of:

- move the tag to the release commit (`git tag -f v0.1.0 <sha>` then `git push --force origin v0.1.0`), noting that rewriting a pushed tag is a shared-history operation; or
- leave `v0.1.0` where it is and tag the release commit `v0.1.1`.

Do not leave both the tag and the package version disagreeing without recording which is authoritative.

## Unpublishing

npm restricts unpublishing after 72 hours and forbids it once a package has dependents. Treat every publish as close to permanent: check the tarball with `--dry-run` first.
