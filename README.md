# PageScope

**Understand your website. Fix what matters.**

PageScope audits the technical and SEO correctness of a single page in seconds — **without a browser** — and turns each check into a finding with the evidence it was based on, plus a concrete suggestion for fixing it.

It ships as a CLI, a quality gate for CI, and a library you can import.

## Status: pre-release (not on npm yet)

This repository is at `v0.1.0`. The package names `pagescope` and `@pagescope/core` are **not published to npm yet**, so `npx pagescope` does not work today. Run it from source:

```bash
git clone https://github.com/devalfian/website-auditor.git
cd website-auditor
pnpm install
pnpm build
node packages/cli/dist/cli.js https://example.com
```

## Why another site auditor

Three things, and only three:

1. **No browser.** Chromium is not required, so a run takes about half a second and works on any CI runner. Performance and rendered-DOM checks are explicitly out of scope — Lighthouse does those better.
2. **Evidence, not a score.** Every finding carries the source location or the exact absence it was derived from. There is no grade, no percentage, and no invented evidence.
3. **Library, CLI and CI gate from one core.** `@pagescope/core` is the same code the CLI uses.

## What it checks

13 rules in v0.1.0. Each one documents what it does **not** check in `docs/rules/`.

| Rule                        | Severity | Checks                                                     |
| --------------------------- | -------- | ---------------------------------------------------------- |
| `seo/title`                 | high     | `<title>` exists and is non-empty                          |
| `seo/meta-description`      | medium   | `<meta name="description">` exists and is non-empty        |
| `seo/canonical`             | low      | `<link rel="canonical">` exists and is absolute            |
| `seo/robots-meta`           | medium   | reports `noindex`/`nofollow` for human review              |
| `seo/open-graph`            | low      | `og:title`, `og:description`, `og:image`, `og:url` present |
| `seo/heading-structure`     | medium   | no `<h1>`, multiple `<h1>`, or skipped heading levels      |
| `technical/duplicate-id`    | medium   | duplicate `id` attributes                                  |
| `technical/meta-viewport`   | medium   | `<meta name="viewport">` present                           |
| `technical/http-status`     | high     | final response is 2xx                                      |
| `a11y/img-alt`              | medium   | `<img>` elements with no `alt` attribute                   |
| `a11y/html-lang`            | medium   | `<html lang>` present and non-empty                        |
| `security/https`            | high     | final URL is served over HTTPS                             |
| `security/security-headers` | low      | HSTS, CSP, X-Content-Type-Options, Referrer-Policy present |

Severity means "how much is demonstrably broken", not "how alarming the category sounds". No rule in v0.1.0 uses `critical`.

## Example output

Real output, trimmed, from `node packages/cli/dist/cli.js https://example.com` on 2026-11-02:

```
PageScope — https://example.com
status: completed | findings: 5 | 516ms

[ok]   seo/title — title length: 14 characters
[fail] seo/meta-description
[fail] seo/canonical
[ok]   seo/robots-meta — no robots meta directive present
[fail] seo/open-graph
[fail] seo/heading-structure
[ok]   technical/duplicate-id — 0 unique ids
[ok]   technical/meta-viewport — viewport meta present
[ok]   technical/http-status — HTTP 200
[-]    a11y/img-alt — no <img> elements on the page
[ok]   a11y/html-lang — html lang="en"
[ok]   security/https — final URL is https://example.com/
[fail] security/security-headers
```

The `packages/core/fixtures/` pages are synthetic and exist so the rules can be demonstrated and tested. Any sample report in this repository comes from those fixtures, not from a customer site.

## Exit codes

| Code | Meaning                                          |
| ---- | ------------------------------------------------ |
| `0`  | Audit completed and the configured policy passed |
| `1`  | Audit completed but the policy failed            |
| `2`  | Invalid input or configuration                   |
| `3`  | The target could not be audited                  |

The gate is opt-in: `--fail-on` defaults to `none`, so a plain run never fails a build just because it found something.

`--fail-on` counts only findings whose status is `failed`. A finding that says "PageScope
cannot determine which applies here" is `needs-review` and never fails a build. This is a
change in v0.2.0: previously `needs-review` findings also failed the gate, which meant the
report and the exit code disagreed.

`--min-confidence <low|medium|high>` (default `low`) additionally requires a finding to be
at least that confident before it counts. Findings below the threshold are still reported
as `failed`; they are only excluded from the exit code, and the summary says how many were
excluded:

```
gate: 2 failed findings below --min-confidence high were not counted
```

```bash
node packages/cli/dist/cli.js https://example.com --fail-on high
node packages/cli/dist/cli.js https://example.com --format markdown --out report.md
node packages/cli/dist/cli.js https://example.com --format all --out reports/audit
```

## Baseline mode

A gate that fails on findings you already know about gets switched off within a week. Record the current state once, then fail only on what is new:

```bash
# record the current findings
node packages/cli/dist/cli.js https://example.com --write-baseline .pagescope-baseline.json

# later, in CI: only new findings can fail the build
node packages/cli/dist/cli.js https://example.com --baseline .pagescope-baseline.json --fail-on high
```

The summary reports `new`, `known` and `stale` counts. Knowingly:

- Findings that are in the baseline still appear in every report, marked `known`. Nothing is hidden.
- `--fail-on` applies only to `new` findings when a baseline is in use.
- `--write-baseline` exits `0` without evaluating the policy: recording state is not a verdict.
- Identity is a hash of the rule id plus a _semantic_ discriminator (a duplicated `id`, an image `src`), never a line number, so unrelated edits above a finding do not make the baseline forget it.
- Two findings from the same rule that share a discriminator collapse into one identity. Only two rules can produce several findings today, and both supply a discriminator.
- A baseline recorded for one page is not meaningful for another; `--rules` on a full baseline will report the other rules' entries as `stale`.

## Library

```ts
import { audit, toMarkdownReport } from '@pagescope/core'

const result = await audit({ url: 'https://example.com' })
console.log(result.status, result.findings.length)
console.log(toMarkdownReport(result))
```

## Known limitations

These are not TODOs — each one is a boundary the report states for itself. Every report
carries a `coverage` block listing exactly what was and was not inspected.

| Boundary                                                                                             | Why it exists                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No JavaScript execution.** Only the raw HTML response is inspected.                                | A browser would make the tool slower and unusable on bare CI runners. Rules that need the rendered DOM report `unobservable` on pages PageScope detects as client-rendered, instead of a false pass. |
| **One page per run.** Links are not crawled.                                                         | Crawling changes the security model and the promise of the tool. `coverage.notInspected` lists `linked-pages` until it ships.                                                                        |
| **No score.** Severity and status only.                                                              | A single number hides which findings are guesses.                                                                                                                                                    |
| **No WCAG conformance claim.**                                                                       | Automated checks cannot establish conformance, and `coverage.notInspected` always says so.                                                                                                           |
| **No exploitability claim.**                                                                         | A missing security header is reported as absent, nothing more.                                                                                                                                       |
| **No hosted service.**                                                                               | There is no public endpoint, by design.                                                                                                                                                              |
| **Private and reserved addresses are refused** at connect time, including IP literals and redirects. | Auditing `localhost` is impossible on purpose.                                                                                                                                                       |

Detection is deliberately conservative. A single-page app that renders into a mount point
that already contains a placeholder is **not** detected, and behaves exactly as it did in
v0.1.0. PageScope only claims `client-rendered` when it can point at the element that
proves it.

## Roadmap

Planned, not started: broken-link checking, a browser adapter for rendered-DOM audits, a web dashboard, and a hosting story with authentication. None of these exist in v0.1.0.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test          # 145 tests, no network access required
pnpm lint
pnpm build
```

> **Windows note:** if `pnpm <script>` fails with `uname: command not found`, your global `script-shell` points at a bash without coreutils. Either point `script-shell` at `cmd.exe`, or run the underlying tool directly, e.g. `node node_modules/vitest/vitest.mjs run`.

Architecture: `docs/architecture.md`. Security model and threat model: `docs/security/threat-model.md` and `SECURITY.md`.

## Contributing

See `CONTRIBUTING.md`. Adding a rule is a five-file change and does not require touching the engine.

## Licence

MIT — see `LICENSE`.
