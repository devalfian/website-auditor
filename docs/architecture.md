# Architecture

## Two packages, one engine

```
packages/core   @pagescope/core   contracts · collection · engine · rules · reporters
packages/cli    pagescope         argument parsing · exit codes · file output
```

`@pagescope/core` is a library first. The CLI is a thin adapter: it parses flags, calls `audit()`, renders a report, and maps the result to an exit code. Nothing in `core` knows the CLI exists.

Browser-specific dependencies have no place here. v0.1.0 does not use a browser at all; if a browser adapter is added later it becomes a third package so that Chromium never becomes a dependency of the library.

## The pipeline

```
validateTarget → fetchPage → parseHtml → evaluate rules → aggregate → reporters
```

### Collection is separated from evaluation

`fetchPage` performs exactly one network operation, with limits, and returns either an `AuditSnapshot` or an `AuditError`. Rules then receive that snapshot.

Consequences that matter:

- Every rule is a pure function of a snapshot, so it is testable from an HTML string with no server and no network.
- A rule cannot quietly issue extra requests.
- Failure of the fetch is a first-class outcome, not an empty finding list.

### Status model

| Status           | Meaning                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| `passed`         | the rule ran and the condition held                                             |
| `failed`         | the rule ran and the condition did not hold                                     |
| `needs-review`   | the rule ran but the correct answer depends on intent PageScope cannot know     |
| `not-applicable` | the rule could not apply to this page (e.g. `img-alt` on a page with no images) |
| `error`          | the rule did not complete. **Only the engine sets this.**                       |

A rule that did not run must never be reported as `passed`. That is the single most important invariant in the codebase, enforced by `assertResultInvariants` in `engine/audit.ts`.

### Audit status

| Status      | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| `completed` | the page was fetched and every rule reported a status |
| `partial`   | the page was fetched but at least one rule crashed    |
| `failed`    | the page could not be fetched; no rules ran           |

`partial` still returns every finding from rules that did complete, and records the crash in `errors`.

## Data contracts

All contracts live in `packages/core/src/contracts/`. Reports are validated against a zod schema before serialisation, and carry `SCHEMA_VERSION` (`1.0.0`). Additive changes bump minor; breaking changes bump major.

Evidence is a discriminated union rather than a free-form string:

- `html-snippet` — exact source text with line and column
- `http-header` — a response header name and value
- `http-response` — status, final URL, redirect chain
- `measurement` — a counted or measured value
- `absence` — what was searched for and where, when nothing was found

`absence` exists so that "we looked and found nothing" can be stated honestly instead of being dressed up as a snippet.

## Reporters

All three reporters consume the same `AuditResult`. None of them recalculates findings.

- **JSON** — validated against the zod schema, always versioned
- **Markdown** — grouped by severity, snippets fenced
- **HTML** — a single self-contained file, no JavaScript, restrictive CSP meta, every dynamic value escaped

## Exit codes

| Code | Meaning                        |
| ---- | ------------------------------ |
| `0`  | audit completed, policy passed |
| `1`  | audit completed, policy failed |
| `2`  | invalid input or configuration |
| `3`  | target could not be audited    |

The policy gate is opt-in (`--fail-on` defaults to `none`) so that a first run does not fail a build by surprise.

## Deliberate omissions

No score, no database, no hosted service, no crawling, no browser. Each of those would change the security model or the promise of the tool, and none of them is needed to answer "is this page technically correct?".
