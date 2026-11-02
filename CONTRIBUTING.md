# Contributing to PageScope

Thanks for considering a contribution. This project optimises for two things: **evidence** and **contributor experience**. A change that makes findings less trustworthy will be rejected even if it adds features.

## Prerequisites

- Node.js 22 or newer
- pnpm 11

## Setup

```bash
git clone https://github.com/devalfian/website-auditor.git
cd website-auditor
pnpm install
pnpm test
```

`pnpm install` will ask you to approve the `esbuild` install script; `tsup` cannot build without it. The approval is recorded in `pnpm-workspace.yaml`.

## Commands

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `pnpm test`         | Runs the whole suite. No test touches the network. |
| `pnpm typecheck`    | `tsc --noEmit` for each package                    |
| `pnpm lint`         | ESLint, flat config                                |
| `pnpm format:check` | Prettier check                                     |
| `pnpm build`        | Bundles both packages with tsup                    |
| `pnpm verify`       | All of the above, in order                         |

> **Windows:** if a pnpm script fails with `uname: command not found`, your global `script-shell` points at a bash without coreutils. Set `script-shell` to `cmd.exe`, or invoke the tool directly: `node node_modules/vitest/vitest.mjs run`.

## Repository layout

```
packages/core   @pagescope/core — contracts, collection, engine, rules, reporters
packages/cli    pagescope — argument parsing, exit codes, file output
docs/           architecture, threat model, one document per rule
examples/       a copy-pasteable GitHub Actions workflow
```

Rules never perform network access and never parse HTML. The engine fetches once and hands each rule a snapshot. Keep it that way: a rule that does its own fetching is not testable offline and will be rejected.

## Adding a rule

A complete walkthrough lives in [`docs/contributing/adding-a-rule.md`](docs/contributing/adding-a-rule.md). In short:

1. Add the rule to the right module in `packages/core/src/rules/` (`seo.ts`, `technical.ts`, `a11y.ts`, `security.ts`).
2. Give it a `docsSlug` and write `docs/rules/<slug>.md`.
3. Add it to that module's exported array.
4. Write the test in `packages/core/test/rules/`.
5. Run `pnpm verify`.

The rule documents in `docs/rules/` are generated from the registered rules so their titles cannot drift from the code:

```bash
pnpm build
node scripts/generate-rule-docs.mjs
```

The generator fills in the rule id, description and reference link. The "What this rule does not check" paragraph is hand-written per rule in `scripts/generate-rule-docs.mjs` — update it there when a rule's limits change.

If you add a rule to the registry, `packages/core/test/engine/audit.test.ts` will fail until you update the expected rule count. That failure is intentional: it forces a contributor to notice that the public rule list changed.

## What a good finding looks like

- **Evidence is what was observed.** A snippet with a line and column, a response header, or an explicit statement of what was searched for and not found.
- **Never invent evidence.** "Missing title" must not include a fabricated `<title>` tag.
- **Status matches reality.** `passed` means the check ran and passed. A rule that could not run is `error`, and only the engine may set that.
- **Ambiguity is `needs-review`, not `failed`.** A `noindex` page may be intentional. Multiple `<h1>` is valid HTML5.
- **Do not overclaim.** No WCAG conformance, no "this page is vulnerable", no "this will improve your ranking".

## Pull requests

- Keep the diff focused; unrelated refactors belong in their own PR.
- Tests are required for behaviour changes, and they must run offline.
- If you change `Finding`, `AuditResult`, an exit code or the public API, say so in the PR template.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not open public issues for security problems. See [SECURITY.md](SECURITY.md).
