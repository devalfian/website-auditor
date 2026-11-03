# PageScope Claim Calibration (Spec C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PageScope stop implying it knows more than it does — a client-rendered page must report `unobservable` instead of a false pass, every report must declare what was and was not inspected, and `confidence` must finally determine whether a finding fails a build.

**Architecture:** Two additive layers on the existing pipeline. First, the collection layer gains a conservative `detectRendering()` judgement (two high-precision signals, no numeric thresholds) carried on `AuditSnapshot`. Second, the engine gains an `unobservable` status it alone may set, plus an `AuditCoverage` block from which `limitations` are derived instead of asserted. Rules never change behaviour: each declares `observation`, and only the two DOM-dependent rules are affected.

**Tech Stack:** TypeScript 5.9.3 (ESM), Node 22+, pnpm, parse5 8.1.0, undici 8.12.3, zod 4.6.7, commander 15.0.0, vitest 5.1.0, tsup 9.0.0.

**Spec:** `docs/superpowers/specs/2026-11-03-pagescope-claim-calibration-design.md`

## Global Constraints

- Node **>=22**, ESM only (`"type": "module"`). No CommonJS entry points.
- `SCHEMA_VERSION` becomes exactly `'2.0.0'`. The bump happens in Task 5; no task may bump it again.
- Status model is exactly `passed | failed | needs-review | not-applicable | unobservable | error`. `error` **and** `unobservable` are set only by the engine — never by a rule, enforced by `EvaluatedStatus`.
- Rule count stays **13**. `test/engine/audit.test.ts` asserts `toHaveLength(13)`; no task may change that number.
- Tests must never touch the internet. Fixtures are local HTML strings or files in `packages/core/fixtures/`.
- `allowPrivateNetworks` stays internal-only: never a CLI flag, config key, or public library option.
- CLI exit codes: `0` policy passed, `1` policy failed, `2` invalid input/config, `3` target not auditable.
- Never output a score, grade, or percentage.
- `confidence` means: `high` = direct reading of the served bytes; `medium` = depends on a convention the spec does not force; `low` = depends on a stated assumption PageScope cannot verify. Confidence is orthogonal to `severity` and to `status`.
- Prettier: no semicolons, single quotes, `printWidth: 100`, `trailingComma: all`. Files must be LF (`* text=auto eol=lf` in `.gitattributes`).
- On Windows, if `pnpm <script>` fails with `uname: command not found`, run the tool directly: `node node_modules/vitest/vitest.mjs run <path>`.

## Baseline

Verified 2026-11-03 before this plan was written: `vitest run` → **16 files, 145 tests, all passing**; `prettier --check .` → clean.

## File Structure

| File                                           | Responsibility                                    | Tasks         |
| ---------------------------------------------- | ------------------------------------------------- | ------------- |
| `packages/core/src/contracts/types.ts`         | All data contracts                                | 2, 3, 5, 6, 7 |
| `packages/core/src/contracts/report-schema.ts` | zod schema + `SCHEMA_VERSION`                     | 5, 6, 8       |
| `packages/core/src/collection/rendering.ts`    | **new** — conservative client-rendering judgement | 2             |
| `packages/core/src/collection/fetch.ts`        | attach `rendering` to the snapshot                | 4             |
| `packages/core/src/engine/limits.ts`           | **new** — `limitationsFor(coverage)`              | 7             |
| `packages/core/src/engine/audit.ts`            | `unobservable` branch, coverage assembly          | 5, 6, 8       |
| `packages/core/src/rules/*.ts`                 | 13 `observation` declarations                     | 3             |
| `packages/core/src/reporters/*.ts`             | print coverage and provenance                     | 6, 8          |
| `packages/core/src/index.ts`                   | public API surface                                | 7, 8          |
| `packages/cli/src/run.ts`                      | gate semantics, `--min-confidence`                | 1, 9          |
| `packages/cli/src/config.ts`                   | `minConfidence` key                               | 9             |
| `packages/cli/src/output.ts`                   | confidence, coverage line, gate line              | 9             |

Each task below ends with a commit. Tasks are ordered so that the repository compiles and every test passes at the end of each task.

---

### Task 1: A `needs-review` finding must not fail the build

Today `run.ts` gates on severity alone, so a `seo/robots-meta` finding that says _"PageScope cannot determine which applies here"_ fails CI. Fix that first: it is independent of everything else, and it is the one behavioural change that makes the gate **less** strict, so it must be visible early.

**Files:**

- Modify: `packages/cli/src/run.ts:216-222`
- Test: `packages/cli/test/cli.test.ts` (insert fixture after line 79, insert tests before line 144)

**Interfaces:**

- Consumes: `AuditResult.findings[].status` (`'failed' | 'needs-review'`), already set by `engine/audit.ts`.
- Produces: nothing new. Exit code `1` now requires at least one `status: 'failed'` finding at or above the `--fail-on` severity.

- [ ] **Step 1: Write the failing tests**

Insert this fixture immediately after the `highFinding` object literal in `packages/cli/test/cli.test.ts` (after its closing `}` on line 79):

```ts
const needsReviewFinding = {
  ruleId: 'seo/robots-meta',
  category: 'seo' as const,
  status: 'needs-review' as const,
  severity: 'medium' as const,
  confidence: 'medium' as const,
  title: 'Robots meta contains "noindex"',
  description: 'PageScope cannot determine whether this directive is intentional.',
  target: { url: 'https://example.com/' },
  evidence: [
    { kind: 'absence' as const, expected: 'blocking robots directives', scope: 'scanned <head>' },
  ],
  recommendation: 'Confirm the directive is intentional.',
  docsUrl: 'https://example.com/docs/rules/seo-robots-meta.md',
  fingerprint: 'bbbbbbbbbbbbbbbb',
}
```

Insert these two tests immediately before `it('returns 3 when the audit itself failed', ...)` in the `describe('run() with an injected audit')` block:

```ts
it('does not fail the gate on a needs-review finding', async () => {
  const code = await run(['https://example.com/', '--fail-on', 'medium'], {
    auditFn: async () => baseResult({ findings: [needsReviewFinding] }),
    out: sink,
  })
  expect(code).toBe(EXIT.OK)
})

it('still fails the gate on a failed finding at the same severity', async () => {
  const failed = { ...needsReviewFinding, status: 'failed' as const }
  const code = await run(['https://example.com/', '--fail-on', 'medium'], {
    auditFn: async () => baseResult({ findings: [failed] }),
    out: sink,
  })
  expect(code).toBe(EXIT.POLICY)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts`

Expected: the first new test fails with `expected 1 to be 0`, because the current gate counts the `needs-review` finding.

- [ ] **Step 3: Fix the gate**

In `packages/cli/src/run.ts`, replace:

```ts
const policyFindings = result.baseline
  ? result.findings.filter((finding) => finding.baseline === 'new')
  : result.findings
```

with:

```ts
// A finding that says "PageScope cannot determine which applies here" is not an
// assertion of breakage. Only `failed` findings may fail a build.
const policyFindings = (
  result.baseline
    ? result.findings.filter((finding) => finding.baseline === 'new')
    : result.findings
).filter((finding) => finding.status === 'failed')
```

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `node node_modules/vitest/vitest.mjs run`

Expected: 16 files, 147 tests, all passing (145 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/run.ts packages/cli/test/cli.test.ts
git commit -m "fix(cli): a needs-review finding must not fail the policy gate"
```

---

### Task 2: Detect client-side rendering, conservatively

Adds the judgement and its contract. Nothing consumes it yet, so this task cannot change any existing behaviour.

**Files:**

- Modify: `packages/core/src/contracts/types.ts` (insert two types after `HtmlDocument` on line 4)
- Create: `packages/core/src/collection/rendering.ts`
- Test: `packages/core/test/collection/rendering.test.ts`

**Interfaces:**

- Consumes: `findAll`, `byTagName`, `getAttr`, `getTextContent`, `snippetOf` and type `HtmlElement` from `collection/parse.js`; `Evidence`, `HtmlDocument` from `contracts/types.js`.
- Produces: `RenderingKind`, `interface RenderingAssessment { kind: RenderingKind; reason: string; evidence: Evidence[] }`, `detectRendering(document: HtmlDocument, html: string): RenderingAssessment`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/collection/rendering.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectRendering } from '../../src/collection/rendering.js'
import { parseHtml } from '../../src/collection/parse.js'

const assess = (html: string) => detectRendering(parseHtml(html), html)

describe('detectRendering', () => {
  it('treats an ordinary page as server-rendered and cites no evidence', () => {
    const result = assess(
      '<!doctype html><html><head><title>t</title></head><body><h1>Hi</h1><p>Body</p></body></html>',
    )
    expect(result.kind).toBe('server-rendered')
    expect(result.evidence).toEqual([])
    expect(result.reason).toContain('no client-side rendering signal')
  })

  it('detects an empty React mount point', () => {
    const result = assess(
      '<!doctype html><html><body><div id="root"></div><script src="/main.js"></script></body></html>',
    )
    expect(result.kind).toBe('client-rendered')
    expect(result.reason).toContain('"root"')
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]?.kind).toBe('html-snippet')
  })

  it('detects every mount point id in the list', () => {
    for (const id of ['root', 'app', '__next', '__nuxt', '___gatsby']) {
      const result = assess(`<!doctype html><html><body><div id="${id}"></div></body></html>`)
      expect(result.kind, `id=${id}`).toBe('client-rendered')
    }
  })

  it('detects an empty Angular root element', () => {
    const result = assess('<!doctype html><html><body><app-root></app-root></body></html>')
    expect(result.kind).toBe('client-rendered')
    expect(result.reason).toContain('app-root')
  })

  it('treats a mount point holding only whitespace as empty', () => {
    const result = assess('<!doctype html><html><body><div id="root">\n  \n</div></body></html>')
    expect(result.kind).toBe('client-rendered')
  })

  it('does not fire when the mount point already holds content', () => {
    const result = assess(
      '<!doctype html><html><body><div id="root"><h1>Server rendered</h1></div></body></html>',
    )
    expect(result.kind).toBe('server-rendered')
    expect(result.evidence).toEqual([])
  })

  it('does not fire on an unrelated empty div', () => {
    const result = assess('<!doctype html><html><body><div id="sidebar"></div></body></html>')
    expect(result.kind).toBe('server-rendered')
  })

  it('detects a noscript block that demands JavaScript', () => {
    const result = assess(
      '<!doctype html><html><body><noscript>You need to enable JavaScript to run this app.</noscript></body></html>',
    )
    expect(result.kind).toBe('client-rendered')
    expect(result.reason).toContain('<noscript>')
    expect(result.evidence).toHaveLength(1)
  })

  it('reports both signals when both fire', () => {
    const result = assess(
      '<!doctype html><html><body><div id="root"></div><noscript>Please enable JavaScript</noscript></body></html>',
    )
    expect(result.kind).toBe('client-rendered')
    expect(result.evidence).toHaveLength(2)
    expect(result.reason).toContain('"root"')
    expect(result.reason).toContain('<noscript>')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/collection/rendering.test.ts`

Expected: FAIL — `Failed to resolve import "../../src/collection/rendering.js"`.

- [ ] **Step 3: Add the contract types**

In `packages/core/src/contracts/types.ts`, insert immediately after the `HtmlDocument` type on line 4, before `export type Category`:

```ts
/**
 * Whether the served HTML is a faithful representation of what a user sees.
 * PageScope only reports 'client-rendered' when a specific signal proves it, so
 * a missed detection leaves the v0.1.0 behaviour unchanged.
 */
export type RenderingKind = 'server-rendered' | 'client-rendered'

export interface RenderingAssessment {
  kind: RenderingKind
  reason: string
  evidence: Evidence[]
}
```

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/collection/rendering.ts`:

```ts
import { findAll, byTagName, getAttr, getTextContent, snippetOf } from './parse.js'
import type { HtmlElement } from './parse.js'
import type { Evidence, HtmlDocument, RenderingAssessment } from '../contracts/types.js'

/**
 * Mount points these frameworks actually emit. A guessed identifier would be
 * evidence PageScope cannot stand behind, so the list stays short on purpose.
 */
const ROOT_IDS = new Set(['root', 'app', '__next', '__nuxt', '___gatsby'])
const ROOT_TAGS = new Set(['app-root'])

const JAVASCRIPT_DEMAND = /enable javascript|requires javascript|javascript is (disabled|required)/i

function hasElementChild(el: HtmlElement): boolean {
  return (el.childNodes ?? []).some(
    (child) => (child as { tagName?: unknown }).tagName !== undefined,
  )
}

function snippetEvidence(html: string, el: HtmlElement, expected: string): Evidence {
  const snippet = snippetOf(html, el)
  if (!snippet) {
    return {
      kind: 'absence',
      expected,
      scope: 'the element has no source location in the response',
    }
  }
  return {
    kind: 'html-snippet',
    snippet: snippet.snippet,
    line: snippet.line,
    column: snippet.column,
    truncated: snippet.truncated,
  }
}

/**
 * Two high-precision signals, no numeric thresholds. A page is called
 * client-rendered only when one of them fires; everything else stays
 * server-rendered, the same assumption v0.1.0 made.
 */
export function detectRendering(document: HtmlDocument, html: string): RenderingAssessment {
  const evidence: Evidence[] = []
  const reasons: string[] = []

  const emptyMount = findAll(document, (el) => {
    const id = (getAttr(el, 'id') ?? '').trim().toLowerCase()
    return ROOT_IDS.has(id) || ROOT_TAGS.has(el.tagName)
  }).find((el) => !hasElementChild(el))

  if (emptyMount) {
    const name = (getAttr(emptyMount, 'id') ?? emptyMount.tagName).trim()
    reasons.push(`the framework mount point "${name}" is empty`)
    evidence.push(snippetEvidence(html, emptyMount, `content inside the mount point "${name}"`))
  }

  const noscript = byTagName(document, 'noscript').find((el) =>
    JAVASCRIPT_DEMAND.test(getTextContent(el)),
  )

  if (noscript) {
    reasons.push('a <noscript> block asks the visitor to enable JavaScript')
    evidence.push(snippetEvidence(html, noscript, '<noscript> content that renders without JS'))
  }

  if (reasons.length === 0) {
    return {
      kind: 'server-rendered',
      reason: 'no client-side rendering signal was found in the served HTML',
      evidence: [],
    }
  }

  return { kind: 'client-rendered', reason: reasons.join('; '), evidence }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/collection/rendering.test.ts`

Expected: 9 tests pass.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add packages/core/src/contracts/types.ts packages/core/src/collection/rendering.ts packages/core/test/collection/rendering.test.ts
git commit -m "feat(core): detect client-rendered pages from two high-precision signals"
```

---

### Task 3: Every rule declares the representation it needs

Makes "what can this rule see without JavaScript?" a reviewable contract instead of tribal knowledge. No behaviour changes yet — nothing reads `observation`.

**Files:**

- Modify: `packages/core/src/contracts/types.ts` (add `ObservationSource`; add `observation` to `RuleDefinition`)
- Modify: `packages/core/src/rules/seo.ts` (6 insertions)
- Modify: `packages/core/src/rules/technical.ts` (3 insertions)
- Modify: `packages/core/src/rules/a11y.ts` (2 insertions)
- Modify: `packages/core/src/rules/security.ts` (2 insertions)
- Test: `packages/core/test/engine/registry.test.ts` (new)

**Interfaces:**

- Consumes: `RuleDefinition` from `contracts/types.js`.
- Produces: `ObservationSource = 'served-html' | 'rendered-dom' | 'http-headers'`; `RuleDefinition.observation: ObservationSource` (required).

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/engine/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { allRules } from '../../src/engine/registry.js'

const OBSERVATIONS = ['served-html', 'rendered-dom', 'http-headers']

describe('rule observation declarations', () => {
  it('declares a valid observation source for every rule', () => {
    for (const rule of allRules) {
      expect(OBSERVATIONS, `${rule.id} declares an unknown observation`).toContain(rule.observation)
    }
  })

  it('marks exactly the two DOM-dependent rules as needing the rendered DOM', () => {
    const renderedDom = allRules
      .filter((rule) => rule.observation === 'rendered-dom')
      .map((rule) => rule.id)
      .sort()
    expect(renderedDom).toEqual(['a11y/img-alt', 'seo/heading-structure'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/engine/registry.test.ts`

Expected: both tests FAIL — the first because `rule.observation` is `undefined` for every rule, the second because the filtered list is empty.

- [ ] **Step 3: Add the type**

In `packages/core/src/contracts/types.ts`, add after the `RenderingAssessment` interface added in Task 2:

```ts
/**
 * The minimum representation a rule needs to reach a conclusion.
 * 'served-html'  — the bytes the server sent are enough
 * 'rendered-dom' — needs the DOM after JavaScript has run
 * 'http-headers' — reads only the status line and response headers
 */
export type ObservationSource = 'served-html' | 'rendered-dom' | 'http-headers'
```

Then add one required field to `RuleDefinition`, immediately after `docsSlug: string`:

```ts
/** The minimum representation this rule needs; see ObservationSource. */
observation: ObservationSource
```

- [ ] **Step 4: Declare `observation` on all 13 rules**

In each file, insert the `observation` line immediately after the rule's `docsSlug:` line. Each `docsSlug` value is unique within its file, so the order of edits does not matter.

`packages/core/src/rules/seo.ts`:

| `docsSlug`                | insert                           |
| ------------------------- | -------------------------------- |
| `'seo-title'`             | `  observation: 'served-html',`  |
| `'seo-meta-description'`  | `  observation: 'served-html',`  |
| `'seo-canonical'`         | `  observation: 'served-html',`  |
| `'seo-robots-meta'`       | `  observation: 'served-html',`  |
| `'seo-open-graph'`        | `  observation: 'served-html',`  |
| `'seo-heading-structure'` | `  observation: 'rendered-dom',` |

`packages/core/src/rules/technical.ts`:

| `docsSlug`                  | insert                           |
| --------------------------- | -------------------------------- |
| `'technical-duplicate-id'`  | `  observation: 'served-html',`  |
| `'technical-meta-viewport'` | `  observation: 'served-html',`  |
| `'technical-http-status'`   | `  observation: 'http-headers',` |

`packages/core/src/rules/a11y.ts`:

| `docsSlug`         | insert                           |
| ------------------ | -------------------------------- |
| `'a11y-img-alt'`   | `  observation: 'rendered-dom',` |
| `'a11y-html-lang'` | `  observation: 'served-html',`  |

`packages/core/src/rules/security.ts`:

| `docsSlug`           | insert                           |
| -------------------- | -------------------------------- |
| `'security-https'`   | `  observation: 'http-headers',` |
| `'security-headers'` | `  observation: 'http-headers',` |

For example, `a11y.ts` rule one becomes:

```ts
export const imgAltRule: RuleDefinition = {
  id: 'a11y/img-alt',
  category: 'accessibility',
  title: 'Images declare an alt attribute',
  description: 'Reports <img> elements that have no alt attribute at all.',
  docsSlug: 'a11y-img-alt',
  observation: 'rendered-dom',
  appliesTo: () => true,
  evaluate: (snapshot) => {
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/engine/registry.test.ts`

Expected: 2 tests pass.

- [ ] **Step 6: Run the full suite, linf and typecheck**

Run: `pnpm typecheck; pnpm lint; node node_modules/vitest/vitest.mjs run`

Expected: typecheck exit 0, lint exit 0, 17 files and all tests passing.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/contracts/types.ts packages/core/src/rules packages/core/test/engine/registry.test.ts
git commit -m "feat(core): require every rule to declare the representation it observes"
```

---

### Task 4: The snapshot carries what we know about rendering

Wires `detectRendering` into the collection layer. Still no behaviour change — the engine ignores `rendering` until Task 5. Exactly three places construct an `AuditSnapshot` literal, verified by searching for `truncated: false`: `src/collection/fetch.ts:301`, `test/rules/helpers.ts:13`, `test/fixtures.test.ts:28`.

**Files:**

- Modify: `packages/core/src/contracts/types.ts` (`AuditSnapshot.rendering`)
- Modify: `packages/core/src/collection/fetch.ts:289-303`
- Modify: `packages/core/test/rules/helpers.ts`
- Test: `packages/core/test/fixtures.test.ts`

**Interfaces:**

- Consumes: `detectRendering` and `RenderingAssessment` (Tasks 2-3), `parseHtml` (`collection/parse.js`).
- Produces: `AuditSnapshot.rendering: RenderingAssessment` (required). Every `AuditSnapshot` in the codebase and in tests now carries it.

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe('fixtures', ...)` block in `packages/core/test/fixtures.test.ts`, and add `detectRendering` and `parseHtml` to its imports:

```ts
import { detectRendering } from '../src/collection/rendering.js'
import { parseHtml } from '../src/collection/parse.js'
```

```ts
it('neither fixture looks client-rendered', async () => {
  for (const name of ['index.html', 'clean.html']) {
    const html = await readFile(join(FIXTURES, name), 'utf8')
    const assessment = detectRendering(parseHtml(html), html)
    expect(assessment.kind, name).toBe('server-rendered')
    expect(assessment.evidence, name).toEqual([])
  }
})
```

`parseHtml` is already imported in that file — drop the duplicate import if so.

- [ ] **Step 2: Run the test to verify it passes immediately**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/fixtures.test.ts`

Expected: PASS. This test only guards against a future detection change misclassifying the fixtures; it is not what drives the rest of this task. The task's real failure is the typecheck in Step 3.

- [ ] **Step 3: Add the field to the snapshot contract**

In `packages/core/src/contracts/types.ts`, add to the `AuditSnapshot` interface, immediately after `document: HtmlDocument`:

```ts
/** Whether the served HTML is a faithful representation of what a user sees. */
rendering: RenderingAssessment
```

- [ ] **Step 4: Populate it in the collection layer**

In `packages/core/src/collection/fetch.ts`, add the import next to the existing `parse` import:

```ts
import { detectRendering } from './rendering.js'
```

Then replace the success return block (currently starting `return { ok: true, snapshot: {` at line 289) with:

```ts
const document = parseHtml(body.text)

return {
  ok: true,
  snapshot: {
    requestedUrl: rawUrl,
    finalUrl: current.toString(),
    httpStatus: response.statusCode,
    headers: summarizeHeaders(response.headers),
    redirectChain,
    html: body.text,
    document,
    rendering: detectRendering(document, body.text),
    // v1 aborts oversize responses instead of cutting them, so this is always
    // false today. The field exists so a future soft-limit mode needs no schema change.
    truncated: false,
  },
}
```

- [ ] **Step 5: Populate it in the shared test helper**

Replace `packages/core/test/rules/helpers.ts` with:

```ts
import { parseHtml } from '../../src/collection/parse.js'
import { detectRendering } from '../../src/collection/rendering.js'
import type { AuditSnapshot } from '../../src/contracts/types.js'

export function snapshotOf(html: string, overrides: Partial<AuditSnapshot> = {}): AuditSnapshot {
  const document = parseHtml(html)
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    headers: { headers: {}, cookieNames: [] },
    redirectChain: [],
    html,
    document,
    rendering: detectRendering(document, html),
    truncated: false,
    ...overrides,
  }
}

export const page = (head: string, body = ''): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`
```

Because `snapshotOf` now derives `rendering` from the HTML, every existing rule test keeps its v0.1.0 behaviour: `page()` output has no mount point and no demanding `<noscript>`, so it is always `server-rendered`.

- [ ] **Step 6: Populate it in the fixture test**

In `packages/core/test/fixtures.test.ts`, inside `auditFixture`, replace:

```ts
const snapshot = {
  requestedUrl: `https://example.com/${name}`,
  finalUrl: `https://example.com/${name}`,
  httpStatus: 200,
  headers: { headers, cookieNames: [] },
  redirectChain: [],
  html,
  document: parseHtml(html),
  truncated: false,
}
```

with:

```ts
const document = parseHtml(html)
const snapshot = {
  requestedUrl: `https://example.com/${name}`,
  finalUrl: `https://example.com/${name}`,
  httpStatus: 200,
  headers: { headers, cookieNames: [] },
  redirectChain: [],
  html,
  document,
  rendering: detectRendering(document, html),
  truncated: false,
}
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `pnpm typecheck; node node_modules/vitest/vitest.mjs run`

Expected: typecheck exit 0; 17 files and all tests passing.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/contracts/types.ts packages/core/src/collection/fetch.ts packages/core/test/rules/helpers.ts packages/core/test/fixtures.test.ts
git commit -m "feat(core): carry the rendering assessment on every audit snapshot"
```

---

### Task 5: `unobservable` — the status the engine owns

This is the behaviour change. `a11y/img-alt` on a client-rendered page stops saying "no `<img>` elements on the page" and starts saying it could not see the content.

**Files:**

- Modify: `packages/core/src/contracts/types.ts` (`RuleStatus`, `EvaluatedStatus`)
- Modify: `packages/core/src/contracts/report-schema.ts` (rules status enum, `SCHEMA_VERSION`)
- Modify: `packages/core/src/engine/audit.ts` (branch before `appliesTo`)
- Test: `packages/core/test/engine/audit.test.ts`
- Test: `packages/core/test/contracts/schema.test.ts`

**Interfaces:**

- Consumes: `rule.observation` (Task 3), `snapshot.rendering` (Task 4).
- Produces: `RuleStatus` includes `'unobservable'`; `EvaluatedStatus = Exclude<RuleStatus, 'unobservable' | 'error'>`; `SCHEMA_VERSION = '2.0.0'`. `RuleResult.status` is `EvaluatedStatus`, so a rule literally cannot return `'unobservable'`.

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/engine/audit.test.ts`, add this fixture at file scope immediately after the existing `const failingFetcher = ...` declaration:

```ts
const clientRendered = snapshotOf(
  '<!doctype html><html lang="en"><head><title>App</title></head><body><div id="root"></div></body></html>',
)
```

Then append these four tests inside `describe('audit', ...)`:

```ts
it('reports unobservable rather than a false pass on a client-rendered page', async () => {
  const result = await audit({ url: 'https://example.com/', fetcher: okFetcher(clientRendered) })
  const imgAlt = result.rules.find((summary) => summary.ruleId === 'a11y/img-alt')
  expect(imgAlt?.status).toBe('unobservable')
  expect(imgAlt?.findingCount).toBe(0)
  expect(imgAlt?.note).toContain('needs the rendered DOM')
  expect(imgAlt?.note).toContain('mount point')
})

it('does not pretend the subject was absent on a client-rendered page', async () => {
  const result = await audit({ url: 'https://example.com/', fetcher: okFetcher(clientRendered) })
  const imgAlt = result.rules.find((summary) => summary.ruleId === 'a11y/img-alt')
  expect(imgAlt?.note).not.toContain('no <img> elements')
})

it('still evaluates served-html rules on a client-rendered page', async () => {
  const result = await audit({ url: 'https://example.com/', fetcher: okFetcher(clientRendered) })
  const htmlLang = result.rules.find((summary) => summary.ruleId === 'a11y/html-lang')
  expect(htmlLang?.status).toBe('passed')
  const title = result.rules.find((summary) => summary.ruleId === 'seo/title')
  expect(title?.status).toBe('passed')
})

it('never lets unobservable carry findings and never marks the audit partial', async () => {
  const result = await audit({ url: 'https://example.com/', fetcher: okFetcher(clientRendered) })
  expect(result.status).toBe('completed')
  const unobservable = result.rules.filter((summary) => summary.status === 'unobservable')
  expect(unobservable.length).toBeGreaterThan(0)
  for (const summary of unobservable) expect(summary.findingCount).toBe(0)
  expect(result.errors).toEqual([])
})
```

In `packages/core/test/contracts/schema.test.ts`, append inside `describe('auditResultSchema', ...)`:

```ts
it('accepts an unobservable rule status', () => {
  const withUnobservable: AuditResult = {
    ...minimal,
    rules: [{ ruleId: 'a11y/img-alt', status: 'unobservable', findingCount: 0 }],
  }
  expect(auditResultSchema.parse(withUnobservable).rules[0]?.status).toBe('unobservable')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/engine/audit.test.ts packages/core/test/contracts/schema.test.ts`

Expected: the audit tests fail with `expected 'not-applicable' to be 'unobservable'`; the schema test fails because `'unobservable'` is not yet in the enum.

- [ ] **Step 3: Extend the status model**

In `packages/core/src/contracts/types.ts`, replace:

```ts
export type RuleStatus = 'passed' | 'failed' | 'needs-review' | 'not-applicable' | 'error'
export type EvaluatedStatus = Exclude<RuleStatus, 'error'>
```

with:

```ts
export type RuleStatus =
  'passed' | 'failed' | 'needs-review' | 'not-applicable' | 'unobservable' | 'error'

/**
 * Statuses a rule may return. 'unobservable' is excluded because it describes the
 * observation, not the rule's judgement: only the engine may decide that a page
 * could not be seen well enough to conclude anything.
 */
export type EvaluatedStatus = Exclude<RuleStatus, 'unobservable' | 'error'>
```

`RuleResult.status` already reads `EvaluatedStatus`, so nothing else changes there.

- [ ] **Step 4: Set the status in the engine**

In `packages/core/src/engine/audit.ts`, inside the `for (const rule of rules) {` loop, insert immediately before `if (!rule.appliesTo(snapshot)) {`:

```ts
if (rule.observation === 'rendered-dom' && snapshot.rendering.kind === 'client-rendered') {
  summaries.push({
    ruleId: rule.id,
    status: 'unobservable',
    findingCount: 0,
    note: `needs the rendered DOM; ${snapshot.rendering.reason}`,
  })
  continue
}
```

`assertResultInvariants` needs no change: `unobservable` is outside `producesFindings`, so it already falls into the existing `!producesFindings && findings.length > 0` guard.

- [ ] **Step 5: Update the schema and bump the major version**

In `packages/core/src/contracts/report-schema.ts`, change:

```ts
export const SCHEMA_VERSION = '2.0.0'
```

and extend the rules status enum inside `auditResultSchema`:

```ts
      status: z.enum([
        'passed',
        'failed',
        'needs-review',
        'not-applicable',
        'unobservable',
        'error',
      ]),
```

The `findings[]` status enum stays exactly `['failed', 'needs-review']`. An `unobservable` rule produces no finding, and the schema enforces that rather than trusting the engine.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `node node_modules/vitest/vitest.mjs run; pnpm typecheck`

Expected: 17 files and all tests passing; typecheck exit 0. If `baseline.test.ts` compares a version, it uses the `SCHEMA_VERSION` constant — never hard-code `2.0.0` in a test.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/contracts packages/core/src/engine/audit.ts packages/core/test/engine/audit.test.ts packages/core/test/contracts/schema.test.ts
git commit -m "feat(core): add the engine-owned unobservable status for client-rendered pages"
```

---

### Task 6: Every finding says which representation it came from

A JSON report must be readable a year later without the rule catalogue of that version. `observedFrom` puts the answer on the finding itself.

**Files:**

- Modify: `packages/core/src/contracts/types.ts` (`Finding.observedFrom`)
- Modify: `packages/core/src/contracts/report-schema.ts` (`findingSchema`)
- Modify: `packages/core/src/engine/audit.ts` (set it when building findings)
- Modify: `packages/core/src/reporters/markdown.ts` (`findingBlock`)
- Modify: `packages/core/src/reporters/html.ts` (finding header line)
- Test: `packages/core/test/contracts/schema.test.ts`, `packages/core/test/reporters/reporters.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**

- Consumes: `ObservationSource` (Task 3), `rule.observation`.
- Produces: `Finding.observedFrom: ObservationSource` (required). Every finding fixture in the test suite now carries it.

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/contracts/schema.test.ts`, add `observedFrom: 'served-html',` to the finding fixture inside `'accepts a finding with absence evidence and no location'`, then append:

```ts
it('rejects a finding without observedFrom', () => {
  const { schemaVersion: _v, ...rest } = minimal
  const withoutProvenance = {
    ...rest,
    schemaVersion: SCHEMA_VERSION,
    status: 'partial',
    findings: [
      {
        ruleId: 'seo/title',
        category: 'seo',
        status: 'failed',
        severity: 'high',
        confidence: 'high',
        title: 'Missing <title>',
        description: 'No <title> element was found inside <head>.',
        target: { url: 'https://example.com/' },
        evidence: [{ kind: 'absence', expected: '<title>', scope: 'scanned <head>' }],
        recommendation: 'Add a <title> element inside <head>.',
        docsUrl: 'https://example.com/docs/rules/seo-title.md',
        fingerprint: '0123456789abcdef',
      },
    ],
  }
  expect(() => auditResultSchema.parse(withoutProvenance)).toThrow()
})
```

In `packages/core/test/reporters/reporters.test.ts`, add `observedFrom: 'served-html',` to both findings in the `result` fixture (after their `confidence` line), then append:

```ts
describe('finding provenance', () => {
  it('states which representation produced each finding in every format', () => {
    expect(toMarkdownReport(result)).toContain('Observed from: served-html')
    expect(toHtmlReport(result)).toContain('from served-html')
    expect(JSON.parse(toJsonReport(result)).findings[0].observedFrom).toBe('served-html')
  })
})
```

In `packages/cli/test/cli.test.ts`, add `observedFrom: 'served-html' as const,` to `highFinding` and `observedFrom: 'served-html' as const,` to `needsReviewFinding`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/reporters/reporters.test.ts packages/core/test/contracts/schema.test.ts`

Expected: the provenance test fails on `Observed from: served-html` (the reporters do not print it yet); the schema rejection test throws for the wrong reason until Step 4 adds the field.

- [ ] **Step 3: Add the field to the contract**

In `packages/core/src/contracts/types.ts`, add to `Finding`, immediately after `docsUrl: string`:

```ts
/**
 * The representation this finding was derived from. Reports must be readable
 * without a ruleId -> observation lookup table from a particular PageScope version.
 */
observedFrom: ObservationSource
```

- [ ] **Step 4: Populate it and validate it**

In `packages/core/src/engine/audit.ts`, inside the `result.findings.map((draft): Finding => ({` object, add after `docsUrl: docsUrlFor(rule.docsSlug),`:

```ts
        observedFrom: rule.observation,
```

In `packages/core/src/contracts/report-schema.ts`, add to `findingSchema` after `docsUrl: z.string(),`:

```ts
  observedFrom: z.enum(['served-html', 'rendered-dom', 'http-headers']),
```

- [ ] **Step 5: Print it in the Markdown and HTML reporters**

In `packages/core/src/reporters/markdown.ts`, inside `findingBlock`, add one line after the `- Confidence:` line:

```ts
    `- Observed from: ${finding.observedFrom}`,
```

In `packages/core/src/reporters/html.ts`, change the finding metadata paragraph to:

```tsx
<p>
  <code>${escapeHtml(finding.ruleId)}</code> · ${escapeHtml(finding.category)} · status $
  {escapeHtml(finding.status)} · confidence ${escapeHtml(finding.confidence)} · from $
  {escapeHtml(finding.observedFrom)}
</p>
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `node node_modules/vitest/vitest.mjs run; pnpm typecheck`

Expected: 17 files and all tests passing; typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src packages/core/test packages/cli/test/cli.test.ts
git commit -m "feat(core): record the observation source on every finding"
```

---

### Task 7: Derive `limitations` from facts instead of asserting them

A pure function, fully testable on its own. Nothing consumes it yet.

**Files:**

- Modify: `packages/core/src/contracts/types.ts` (`NotInspected`, `AuditCoverage`)
- Create: `packages/core/src/engine/limits.ts`
- Test: `packages/core/test/engine/limits.test.ts`

**Interfaces:**

- Consumes: nothing at runtime.
- Produces: `type NotInspected = 'rendered-dom' | 'linked-pages' | 'wcag-conformance' | 'exploitability'`; `interface AuditCoverage`; `limitationsFor(coverage: AuditCoverage): string[]`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/engine/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { limitationsFor } from '../../src/engine/limits.js'
import type { AuditCoverage } from '../../src/contracts/types.js'

const coverage = (overrides: Partial<AuditCoverage> = {}): AuditCoverage => ({
  representation: 'served-html',
  rendering: 'server-rendered',
  renderingEvidence: [],
  rulesEvaluated: 13,
  unobservableRules: [],
  notInspected: ['rendered-dom', 'linked-pages', 'wcag-conformance', 'exploitability'],
  ...overrides,
})

describe('limitationsFor', () => {
  it('reproduces the three v0.1.0 sentences in their original order', () => {
    expect(limitationsFor(coverage())).toEqual([
      'JavaScript is not executed: only the raw HTML response is inspected.',
      'Only the single requested page is audited; links are not crawled.',
      'Automated checks cannot establish WCAG conformance or prove that a page is exploitable.',
    ])
  })

  it('adds a client-rendering sentence that v0.1.0 could never have produced', () => {
    const lines = limitationsFor(coverage({ rendering: 'client-rendered' }))
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('rendered client-side')
    expect(lines[1]).toContain('unobservable')
  })

  it('drops the crawling sentence once linked pages are inspected', () => {
    const lines = limitationsFor(
      coverage({ notInspected: ['rendered-dom', 'wcag-conformance', 'exploitability'] }),
    )
    expect(lines.join(' ')).not.toContain('links are not crawled')
  })

  it('drops the JavaScript sentence once the rendered DOM is inspected', () => {
    const lines = limitationsFor(
      coverage({
        representation: 'rendered-dom',
        notInspected: ['linked-pages', 'wcag-conformance', 'exploitability'],
      }),
    )
    expect(lines.join(' ')).not.toContain('JavaScript is not executed')
  })

  it('keeps the conformance sentence as long as it is still true', () => {
    const lines = limitationsFor(coverage({ notInspected: ['wcag-conformance'] }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('WCAG conformance')
  })

  it('returns no sentences when nothing is limited', () => {
    expect(limitationsFor(coverage({ notInspected: [] }))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/engine/limits.test.ts`

Expected: FAIL — `Failed to resolve import "../../src/engine/limits.js"`.

- [ ] **Step 3: Add the coverage contract**

In `packages/core/src/contracts/types.ts`, add after `ObservationSource`:

```ts
/** What an audit deliberately did not inspect. Machine-readable on purpose: a
 * future phase removes one entry and the matching limitation sentence disappears. */
export type NotInspected = 'rendered-dom' | 'linked-pages' | 'wcag-conformance' | 'exploitability'

export interface AuditCoverage {
  /** The representation that was actually read. */
  representation: 'served-html' | 'rendered-dom'
  /** Judgement about whether that representation is faithful to what a user sees. */
  rendering: RenderingKind
  /** Evidence behind the rendering judgement. Empty when nothing fired. */
  renderingEvidence: Evidence[]
  rulesEvaluated: number
  /** Rule ids the engine refused to conclude from this representation. */
  unobservableRules: string[]
  notInspected: NotInspected[]
}
```

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/engine/limits.ts`:

```ts
import type { AuditCoverage } from '../contracts/types.js'

/**
 * Turns coverage facts into the sentences a report prints. Nothing here is
 * asserted unconditionally: each line exists because a fact in `coverage`
 * makes it true.
 */
export function limitationsFor(coverage: AuditCoverage): string[] {
  const limitations: string[] = []
  const missing = (what: AuditCoverage['notInspected'][number]): boolean =>
    coverage.notInspected.includes(what)

  if (missing('rendered-dom')) {
    limitations.push('JavaScript is not executed: only the raw HTML response is inspected.')
  }

  if (coverage.rendering === 'client-rendered') {
    limitations.push(
      'This page appears to be rendered client-side; rules that need the rendered DOM reported `unobservable` rather than guessing.',
    )
  }

  if (missing('linked-pages')) {
    limitations.push('Only the single requested page is audited; links are not crawled.')
  }

  if (missing('wcag-conformance') || missing('exploitability')) {
    limitations.push(
      'Automated checks cannot establish WCAG conformance or prove that a page is exploitable.',
    )
  }

  return limitations
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/engine/limits.test.ts`

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/contracts/types.ts packages/core/src/engine/limits.ts packages/core/test/engine/limits.test.ts
git commit -m "feat(core): derive limitation sentences from audit coverage"
```

---

### Task 8: The result carries `coverage`; `LIMITATIONS` is deleted

The statically asserted `LIMITATIONS` array goes away. Every result now says what was inspected, and the limitation sentences come from that.

**Files:**

- Modify: `packages/core/src/contracts/types.ts` (`AuditResult.coverage`)
- Modify: `packages/core/src/contracts/report-schema.ts` (`coverageSchema`)
- Modify: `packages/core/src/engine/audit.ts` (delete `LIMITATIONS`, build coverage)
- Modify: `packages/core/src/index.ts` (exports)
- Modify: `packages/core/src/reporters/markdown.ts`, `packages/core/src/reporters/html.ts` (coverage section)
- Test: `packages/core/test/engine/audit.test.ts`, `packages/core/test/fixtures.test.ts`, `packages/core/test/contracts/schema.test.ts`, `packages/core/test/reporters/reporters.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**

- Consumes: `limitationsFor`, `AuditCoverage` (Task 7).
- Produces: `AuditResult.coverage: AuditCoverage` (required). `LIMITATIONS` is no longer exported; `limitationsFor` is exported instead.

- [ ] **Step 1: Update the test fixtures and write the failing tests**

In `packages/core/test/contracts/schema.test.ts`, add to `minimal` after `errors: [],`:

```ts
  coverage: {
    representation: 'served-html',
    rendering: 'server-rendered',
    renderingEvidence: [],
    rulesEvaluated: 1,
    unobservableRules: [],
    notInspected: ['rendered-dom', 'linked-pages', 'wcag-conformance', 'exploitability'],
  },
```

and append inside `describe('auditResultSchema', ...)`:

```ts
it('rejects a report without coverage', () => {
  const { coverage: _dropped, ...rest } = minimal
  expect(() => auditResultSchema.parse(rest)).toThrow()
})
```

In `packages/core/test/reporters/reporters.test.ts`, add to the `result` fixture after `errors: [...]`:

```ts
  coverage: {
    representation: 'served-html',
    rendering: 'client-rendered',
    renderingEvidence: [
      {
        kind: 'html-snippet',
        snippet: `<div id="root">${hostileTitle}</div>`,
        line: 9,
        column: 3,
        truncated: false,
      },
    ],
    rulesEvaluated: 3,
    unobservableRules: ['a11y/img-alt'],
    notInspected: ['rendered-dom', 'linked-pages', 'wcag-conformance', 'exploitability'],
  },
```

and append:

```ts
describe('coverage reporting', () => {
  it('prints a coverage section in all three formats', () => {
    expect(toMarkdownReport(result)).toContain('## Coverage')
    expect(toHtmlReport(result)).toContain('<h2>Coverage</h2>')
    expect(JSON.parse(toJsonReport(result)).coverage.unobservableRules).toEqual(['a11y/img-alt'])
  })

  it('escapes rendering evidence, which comes from the audited page', () => {
    expect(toHtmlReport(result)).not.toContain('<script')
    expect(toHtmlReport(result)).toContain('&lt;script&gt;')
    expect(toMarkdownReport(result)).toContain('### Rendering evidence')
  })
})
```

In `packages/cli/test/cli.test.ts`, add to `baseResult` after `errors: [],`:

```ts
  coverage: {
    representation: 'served-html' as const,
    rendering: 'server-rendered' as const,
    renderingEvidence: [],
    rulesEvaluated: 1,
    unobservableRules: [],
    notInspected: [
      'rendered-dom',
      'linked-pages',
      'wcag-conformance',
      'exploitability',
    ] as ('rendered-dom' | 'linked-pages' | 'wcag-conformance' | 'exploitability')[],
  },
```

In `packages/core/test/engine/audit.test.ts`, replace the import line

```ts
import { LIMITATIONS, audit } from '../../src/engine/audit.js'
```

with

```ts
import { audit } from '../../src/engine/audit.js'
import { limitationsFor } from '../../src/engine/limits.js'
```

and replace

```ts
expect(result.limitations).toEqual([...LIMITATIONS])
```

with

```ts
expect(result.limitations).toEqual(limitationsFor(result.coverage))
expect(result.coverage.representation).toBe('served-html')
expect(result.coverage.notInspected).toContain('linked-pages')
```

Then append inside `describe('audit', ...)`:

```ts
it('names the rules it could not observe and explains why in the limitations', async () => {
  const result = await audit({ url: 'https://example.com/', fetcher: okFetcher(clientRendered) })
  expect(result.coverage.rendering).toBe('client-rendered')
  expect([...result.coverage.unobservableRules].sort()).toEqual([
    'a11y/img-alt',
    'seo/heading-structure',
  ])
  expect(result.coverage.renderingEvidence).toHaveLength(1)
  expect(result.limitations.join(' ')).toContain('rendered client-side')
})

it('reports coverage even when the page could not be fetched', async () => {
  const result = await audit({ url: 'https://example.com/', fetcher: failingFetcher() })
  expect(result.coverage.rulesEvaluated).toBe(0)
  expect(result.coverage.unobservableRules).toEqual([])
  expect(result.limitations.length).toBeGreaterThan(0)
})
```

In `packages/core/test/fixtures.test.ts`, add to the `index.html` test:

```ts
expect(result.coverage.rendering).toBe('server-rendered')
expect(result.coverage.unobservableRules).toEqual([])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run packages/core/test/engine/audit.test.ts`

Expected: `Failed to resolve import "../../src/engine/limits.js"` is already resolved, but `result.coverage` is `undefined`, so every new assertion fails.

- [ ] **Step 3: Delete `LIMITATIONS` and build coverage in the engine**

In `packages/core/src/engine/audit.ts`, delete this block entirely:

```ts
export const LIMITATIONS: readonly string[] = [
  'JavaScript is not executed: only the raw HTML response is inspected.',
  'Only the single requested page is audited; links are not crawled.',
  'Automated checks cannot establish WCAG conformance or prove that a page is exploitable.',
]
```

Update the imports to:

```ts
import { fetchPage, type FetchOutcome } from '../collection/fetch.js'
import { SCHEMA_VERSION } from '../contracts/report-schema.js'
import { VERSION } from '../version.js'
import { applyBaseline, type BaselineFile } from './baseline.js'
import { fingerprintOf } from './fingerprint.js'
import { limitationsFor } from './limits.js'
import { selectRules } from './registry.js'
import type {
  AuditCoverage,
  AuditError,
  AuditResult,
  AuditSnapshot,
  Finding,
  FindingStatus,
  NotInspected,
  RuleDefinition,
  RuleExecutionSummary,
  RuleResult,
} from '../contracts/types.js'

/** Spec C reads served HTML only. Each later phase removes one entry. */
const NOT_INSPECTED: NotInspected[] = [
  'rendered-dom',
  'linked-pages',
  'wcag-conformance',
  'exploitability',
]
```

Replace `buildFailure` with a version that also emits coverage:

```ts
const buildFailure = (
  error: AuditError,
  finalUrl: string | null,
  redirectChain: string[],
): AuditResult => {
  const coverage: AuditCoverage = {
    representation: 'served-html',
    rendering: 'server-rendered',
    renderingEvidence: [],
    rulesEvaluated: 0,
    unobservableRules: [],
    notInspected: [...NOT_INSPECTED],
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    audit: finished(),
    target: { requestedUrl: request.url, finalUrl, httpStatus: null, redirectChain },
    status: 'failed',
    rules: rules.map((rule): RuleExecutionSummary => ({
      ruleId: rule.id,
      status: 'error',
      findingCount: 0,
      error,
    })),
    findings: [],
    errors: [error],
    environment: { pagescopeVersion: VERSION, node: process.versions.node },
    coverage,
    limitations: limitationsFor(coverage),
  }
}
```

Then, immediately before `const result: AuditResult = {`, insert:

```ts
const coverage: AuditCoverage = {
  representation: 'served-html',
  rendering: snapshot.rendering.kind,
  renderingEvidence: snapshot.rendering.evidence,
  rulesEvaluated: summaries.filter(
    (summary) => summary.status !== 'unobservable' && summary.status !== 'error',
  ).length,
  unobservableRules: summaries
    .filter((summary) => summary.status === 'unobservable')
    .map((summary) => summary.ruleId),
  notInspected: [...NOT_INSPECTED],
}
```

and inside `const result: AuditResult = {`, replace `limitations: [...LIMITATIONS],` with:

```ts
    coverage,
    limitations: limitationsFor(coverage),
```

- [ ] **Step 4: Add coverage to the contract and the schema**

In `packages/core/src/contracts/types.ts`, add to `AuditResult` immediately after `limitations: string[]`:

```ts
/** What this audit inspected, and what it deliberately did not. */
coverage: AuditCoverage
```

In `packages/core/src/contracts/report-schema.ts`, add a schema before `auditResultSchema`:

```ts
const coverageSchema = z.object({
  representation: z.enum(['served-html', 'rendered-dom']),
  rendering: z.enum(['server-rendered', 'client-rendered']),
  renderingEvidence: z.array(evidenceSchema),
  rulesEvaluated: z.number().int().nonnegative(),
  unobservableRules: z.array(z.string()),
  notInspected: z.array(
    z.enum(['rendered-dom', 'linked-pages', 'wcag-conformance', 'exploitability']),
  ),
})
```

and inside `auditResultSchema`, add `coverage: coverageSchema,` immediately before `limitations: z.array(z.string()),`.

- [ ] **Step 5: Render coverage in the Markdown reporter**

In `packages/core/src/reporters/markdown.ts`, immediately before `lines.push('## Limitations', '')`, insert:

```ts
lines.push('## Coverage', '')
lines.push(`- Representation: ${result.coverage.representation}`)
lines.push(`- Rendering: ${result.coverage.rendering}`)
lines.push(`- Rules evaluated: ${result.coverage.rulesEvaluated}`)
lines.push(
  `- Unobservable rules: ${
    result.coverage.unobservableRules.length > 0
      ? result.coverage.unobservableRules.join(', ')
      : 'none'
  }`,
)
lines.push(
  `- Not inspected: ${
    result.coverage.notInspected.length > 0 ? result.coverage.notInspected.join(', ') : 'nothing'
  }`,
)
lines.push('')
if (result.coverage.renderingEvidence.length > 0) {
  lines.push('### Rendering evidence', '')
  for (const evidence of result.coverage.renderingEvidence) {
    lines.push(evidenceBlock(evidence), '')
  }
}
```

- [ ] **Step 6: Render coverage in the HTML reporter**

In `packages/core/src/reporters/html.ts`, after the `limitations` constant declaration, add:

```ts
const coverage = `<h2>Coverage</h2>
<ul>
<li>Representation: <code>${escapeHtml(result.coverage.representation)}</code></li>
<li>Rendering: <code>${escapeHtml(result.coverage.rendering)}</code></li>
<li>Rules evaluated: ${result.coverage.rulesEvaluated}</li>
<li>Unobservable rules: ${
  result.coverage.unobservableRules.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ') ||
  'none'
}</li>
<li>Not inspected: ${
  result.coverage.notInspected.map((item) => `<code>${escapeHtml(item)}</code>`).join(', ') ||
  'nothing'
}</li>
</ul>
${result.coverage.renderingEvidence.map(evidenceHtml).join('\n')}`
```

and in the returned document, change the footer to:

```tsx
<footer>
  ${coverage}
  <h2>Limitations</h2>
  <ul>${limitations}</ul>
</footer>
```

Every dynamic value passes through `escapeHtml`, and the rendering evidence passes through `evidenceHtml`, which already escapes. The report still contains no JavaScript.

- [ ] **Step 7: Update the public API surface**

In `packages/core/src/index.ts`, replace:

```ts
export { audit, LIMITATIONS, type AuditRequest } from './engine/audit.js'
```

with:

```ts
export { audit, type AuditRequest } from './engine/audit.js'
export { limitationsFor } from './engine/limits.js'
```

- [ ] **Step 8: Run the full suite, typecheck, lint and format**

Run: `pnpm typecheck; pnpm lint; node node_modules/vitest/vitest.mjs run; npx prettier --check .`

Expected: typecheck exit 0; lint exit 0; 19 files and all tests passing; prettier clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src packages/core/test packages/cli/test/cli.test.ts
git commit -m "feat(core): report what was inspected and derive limitations from it"
```

---

### Task 9: `confidence` becomes consequential

It already exists, is already assigned honestly, and is printed in Markdown and HTML — but it is missing from the terminal summary and invisible to the gate. This task fixes both and adds `--min-confidence`.

**Files:**

- Modify: `packages/cli/src/config.ts` (`minConfidence`)
- Modify: `packages/cli/src/run.ts` (option, merge, gate predicate, reorder)
- Modify: `packages/cli/src/output.ts` (`renderSummary` signature, confidence, coverage line, gate line)
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**

- Consumes: `AuditResult.findings[].confidence`, `AuditResult.coverage`.
- Produces: `EXIT` unchanged. `renderSummary(result: AuditResult, gate?: { minConfidence: Confidence; excluded: number })`. CLI flag `--min-confidence <low|medium|high>`, default `low`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('run() with an injected audit')` in `packages/cli/test/cli.test.ts`:

```ts
const lowConfidenceFinding = { ...highFinding, confidence: 'medium' as const }

it('excludes a low-confidence finding from the gate when --min-confidence is high', async () => {
  captured.length = 0
  const code = await run(
    ['https://example.com/', '--fail-on', 'high', '--min-confidence', 'high'],
    { auditFn: async () => baseResult({ findings: [lowConfidenceFinding] }), out: sink },
  )
  expect(code).toBe(EXIT.OK)
  expect(captured.join('\n')).toContain('below --min-confidence high were not counted')
})

it('still fails the gate when the finding meets --min-confidence', async () => {
  const code = await run(
    ['https://example.com/', '--fail-on', 'high', '--min-confidence', 'high'],
    { auditFn: async () => baseResult({ findings: [highFinding] }), out: sink },
  )
  expect(code).toBe(EXIT.POLICY)
})

it('defaults --min-confidence to low, so nothing is excluded', async () => {
  const code = await run(['https://example.com/', '--fail-on', 'high'], {
    auditFn: async () => baseResult({ findings: [lowConfidenceFinding] }),
    out: sink,
  })
  expect(code).toBe(EXIT.POLICY)
})

it('exits 2 for an unknown --min-confidence value', async () => {
  const code = await run(['https://example.com/', '--min-confidence', 'bogus'], {
    auditFn: async () => baseResult(),
    out: sink,
  })
  expect(code).toBe(EXIT.USAGE)
})

it('prints confidence and coverage in the terminal summary', async () => {
  captured.length = 0
  await run(['https://example.com/', '--fail-on', 'high'], {
    auditFn: async () => baseResult({ findings: [highFinding] }),
    out: sink,
  })
  const summary = captured.join('\n')
  expect(summary).toContain('[confidence: high]')
  expect(summary).toContain('coverage: served-html (server-rendered)')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts`

Expected: the `--min-confidence` tests fail because the flag is unknown (exit `2` for the wrong reason), and the summary test fails because `[confidence:` is never printed.

- [ ] **Step 3: Accept `minConfidence` in the config file**

In `packages/cli/src/config.ts`, add to `configSchema` after `failOn`:

```ts
    minConfidence: z.enum(['low', 'medium', 'high']).optional(),
```

Because the schema is `.strict()`, an unknown key still exits `2` — do not relax that.

- [ ] **Step 4: Add the flag and read both dimensions in the gate**

At the top of `packages/cli/src/run.ts`, next to `SEVERITY_RANK`, add:

```ts
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const
type Confidence = keyof typeof CONFIDENCE_RANK
const CONFIDENCE_LEVELS: readonly Confidence[] = ['low', 'medium', 'high']

function isConfidence(value: string): value is Confidence {
  return (CONFIDENCE_LEVELS as readonly string[]).includes(value)
}
```

Register the option after `--fail-on`:

```ts
    .option('--min-confidence <level>', 'low | medium | high', 'low')
```

Add `minConfidence: string` to the `program.opts<{ ... }>()` type argument, then merge it with the config next to `failOn`:

```ts
const minConfidence = fromCli('minConfidence')
  ? options.minConfidence
  : (config.minConfidence ?? options.minConfidence)
```

Validate it next to the `--timeout` validation:

```ts
if (!isConfidence(minConfidence)) {
  out.error('--min-confidence must be one of low, medium, high\n')
  return EXIT.USAGE
}
```

- [ ] **Step 5: Reorder so the summary can report the gate**

The policy is currently computed after the report is written. Move the whole policy block above the `if (format === 'summary')` branch and replace it with:

```ts
const policyFindings = (
  result.baseline
    ? result.findings.filter((finding) => finding.baseline === 'new')
    : result.findings
).filter((finding) => finding.status === 'failed')

const countedFindings = policyFindings.filter(
  (finding) => CONFIDENCE_RANK[finding.confidence] >= CONFIDENCE_RANK[minConfidence],
)
const excludedByConfidence = policyFindings.length - countedFindings.length

const policyFailed =
  failOn !== 'none' &&
  countedFindings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn])
```

Then change the summary branch to:

```ts
  if (format === 'summary') {
    out.write(renderSummary(result, { minConfidence, excluded: excludedByConfidence }))
  } else if (options.out) {
```

The finding stays `status: 'failed'` in every report. Only the gate ignores it, and the summary says so.

- [ ] **Step 6: Report confidence, coverage and the gate in the terminal summary**

In `packages/cli/src/output.ts`, update the import and the signature:

```ts
import { sanitizeForTerminal } from '@pagescope/core'
import type { AuditResult, Confidence } from '@pagescope/core'
```

```ts
export interface GateSummary {
  minConfidence: Confidence
  /** Failed findings the gate did not count because their confidence was too low. */
  excluded: number
}

export function renderSummary(result: AuditResult, gate?: GateSummary): string {
```

Add two lines to the header array, after the `status:` line:

```ts
    `coverage: ${result.coverage.representation} (${result.coverage.rendering}) | ${
      result.coverage.rulesEvaluated
    }/${result.rules.length} rules evaluated${
      result.coverage.unobservableRules.length > 0
        ? ` | unobservable: ${result.coverage.unobservableRules.join(', ')}`
        : ''
    }`,
    `not inspected: ${result.coverage.notInspected.join(', ') || 'nothing'}`,
```

Change the finding line to include confidence:

```ts
lines.push(
  `  ${finding.severity.padEnd(8)} ${sanitizeForTerminal(finding.title)} (${finding.ruleId}) [confidence: ${finding.confidence}]`,
)
```

Insert the gate line immediately before `lines.push('', 'Limitations:')`:

```ts
if (gate && gate.excluded > 0) {
  lines.push(
    '',
    `gate: ${gate.excluded} failed finding${
      gate.excluded === 1 ? '' : 's'
    } below --min-confidence ${gate.minConfidence} were not counted`,
  )
}
```

- [ ] **Step 7: Run the full suite, typecheck, lint and format**

Run: `pnpm typecheck; pnpm lint; node node_modules/vitest/vitest.mjs run; npx prettier --check .`

Expected: typecheck exit 0; lint exit 0; 19 files and all tests passing; prettier clean.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src packages/cli/test/cli.test.ts
git commit -m "feat(cli): let confidence decide whether a finding fails the build"
```

---

### Task 10: Documentation and regenerated rule docs

The public claim has to match what the code now does. The rule docs are generated, so the generator is the only place to edit.

**Files:**

- Modify: `scripts/generate-rule-docs.mjs`
- Regenerate: `docs/rules/*.md` (13 files, via the generator)
- Modify: `README.md`, `docs/architecture.md`, `docs/contributing/adding-a-rule.md`, `CONTRIBUTING.md`

**Interfaces:**

- Consumes: `allRules` from the built `packages/core/dist/index.js`, which now carries `observation`.
- Produces: no code. The generator must run **after** `pnpm build`.

- [ ] **Step 1: Teach the generator about `unobservable` and observation sources**

In `scripts/generate-rule-docs.mjs`, replace the statuses list in the `render` template with:

```js
## Statuses

- \`passed\` — the rule ran and the condition held.
- \`failed\` — the rule ran and the condition did not hold.
- \`needs-review\` — used where the correct answer depends on intent PageScope cannot know.
- \`not-applicable\` — the rule does not apply to this page.
- \`unobservable\` — set by the engine when the page is rendered client-side and this rule needs the rendered DOM. A rule cannot return this status.
- \`error\` — set by the engine when the rule throws. A rule that did not run is never reported as passed.
```

Then add a new section to the template, immediately after the `## What this rule does not check` block:

```js
## Observation source

This rule declares \`observation: '${rule.observation}'\`.

${
  rule.observation === 'rendered-dom'
    ? 'It needs the DOM after JavaScript has run. On a page PageScope detects as client-rendered, it reports `unobservable` rather than guessing.'
    : 'It reaches a conclusion from the served response alone, so client-side rendering does not affect it.'
}
```

- [ ] **Step 2: Regenerate the rule documents**

Run: `pnpm build; node scripts/generate-rule-docs.mjs`

Expected: `wrote 13 rule documents to docs/rules`.

- [ ] **Step 3: Verify the generated docs**

Run: `git --no-pager diff --stat docs/rules`

Expected: 13 files changed.

Run: `Select-String -Path 'docs/rules/a11y-img-alt.md' -Pattern 'unobservable|rendered-dom'`

Expected: both strings present.

Run: `Select-String -Path 'docs/rules/seo-title.md' -Pattern 'served-html'`

Expected: `observation: 'served-html'` present.

- [ ] **Step 4: Update the README known limitations**

Replace the `## Known limitations` bullet list (currently lines 124-134) with:

```md
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

Detection is deliberately conservative. A single-page app that renders into a mount
point that already contains a placeholder is **not** detected, and behaves exactly as it
did in v0.1.0. PageScope only claims `client-rendered` when it can point at the element
that proves it.
```

- [ ] **Step 5: Document the gate behaviour in the README**

In the section documenting `--fail-on`, add:

```md
`--fail-on` counts only findings whose status is `failed`. A finding that says
"PageScope cannot determine which applies here" is `needs-review` and never fails a
build. This is a change in v0.2.0: previously `needs-review` findings also failed the
gate, which meant the report and the exit code disagreed.

`--min-confidence <low|medium|high>` (default `low`) additionally requires a finding to
be at least that confident before it counts. Findings below the threshold are still
reported as `failed`; they are only excluded from the exit code, and the summary says
how many were excluded:

    gate: 2 failed findings below --min-confidence high were not counted
```

- [ ] **Step 6: Update the architecture status table and coverage section**

In `docs/architecture.md`, add a row to the status model table after `not-applicable`:

```md
| `unobservable` | the rule could not observe enough of the page to conclude. **Only the engine sets this.** |
```

Then add a section after that table:

```md
### Coverage and derived limitations

`AuditResult.coverage` records what was read (`representation`), whether that
representation is faithful (`rendering`, backed by `renderingEvidence`), how many rules
reached a conclusion, which rules the engine refused to conclude (`unobservableRules`),
and what was deliberately not inspected (`notInspected`).

`limitations` is derived from it by `limitationsFor()` in `engine/limits.ts`. No sentence
is asserted unconditionally: removing an entry from `notInspected` removes its sentence.
Reporters still read `result.limitations` directly and never recalculate it.
```

- [ ] **Step 7: Document `observation` and confidence for contributors**

In `docs/contributing/adding-a-rule.md`, add this line to the rule sample after `docsSlug`:

```ts
  observation: 'served-html',
```

Add to the closing checklist:

```md
- [ ] `observation` is declared, and choosing `'rendered-dom'` comes with one sentence
      in the rule description explaining why
```

Append:

```md
## What `observation` means

- `'served-html'` — the bytes the server sent are enough.
- `'rendered-dom'` — the rule needs the DOM after JavaScript ran. On a page PageScope
  detects as client-rendered, the engine reports your rule as `unobservable` and never
  calls `evaluate`. Prefer this over guessing: a false pass is worse than an admitted gap.
- `'http-headers'` — the rule reads only the status line and response headers.

## What `confidence` means

- `high` — the conclusion is a direct reading of the served bytes; no assumption.
- `medium` — it depends on a convention the specification does not force.
- `low` — it depends on an assumption you state but cannot verify.

`confidence` is orthogonal to `severity` and to `status`. It decides whether the CI gate
counts a finding, and it is printed in the terminal summary, Markdown and HTML.
```

- [ ] **Step 8: Repeat the confidence definitions in `CONTRIBUTING.md`**

Append the "What `confidence` means" section from Step 7 verbatim, so a contributor reading only `CONTRIBUTING.md` still learns what the field means.

- [ ] **Step 9: Verify everything**

Run: `pnpm typecheck; pnpm lint; pnpm test; pnpm format:check; pnpm build`

Expected: all five exit 0, with 19 test files passing.

- [ ] **Step 10: Walk the spec's completion checklist**

Open `docs/superpowers/specs/2026-11-03-pagescope-claim-calibration-design.md` §14 and confirm every box, in particular:

- `a11y/img-alt` on a client-rendered page reports `unobservable` — covered by `test/engine/audit.test.ts`
- `a11y/img-alt` on `index.html` still reports `failed` — covered by `test/fixtures.test.ts`
- `result.limitations` always equals `limitationsFor(result.coverage)` — covered by `test/engine/audit.test.ts`
- `--fail-on high` ignores `needs-review` — covered by `packages/cli/test/cli.test.ts`
- `SCHEMA_VERSION` is `2.0.0` — covered by `test/contracts/schema.test.ts` via the constant

- [ ] **Step 11: Commit**

```bash
git add README.md CONTRIBUTING.md docs scripts/generate-rule-docs.mjs
git commit -m "docs: state the new claim boundaries and how confidence affects the gate"
```

---

## Notes for the executor

- **Do not** add a numeric threshold to `detectRendering`. The absence of thresholds is the design, not an oversight. If a test tempts you to add "body has fewer than N elements", stop and re-read §3.3 of the spec.
- **Do not** hard-code `'2.0.0'` in any test. Always compare against the `SCHEMA_VERSION` constant.
- **Do not** change the `toHaveLength(13)` rule assertion. This phase adds no rules.
- `packages/cli/test/cli.test.ts` spawns the built binary; its `beforeAll` already builds both packages. A stale `dist` is the usual cause of a confusing failure — delete `packages/*/dist` and re-run.
- Every string originating in the audited page must pass through `escapeHtml` (HTML) or `sanitizeForTerminal` (terminal/Markdown). `rendering.reason` reaches the terminal through `rule.note`, which `output.ts:53` already sanitises; `renderingEvidence` reaches the reports through the existing evidence renderers.
- Windows: if `pnpm <script>` fails with `uname: command not found`, run `node node_modules/vitest/vitest.mjs run` and `node node_modules/eslint/bin/eslint.js .` directly.

---
