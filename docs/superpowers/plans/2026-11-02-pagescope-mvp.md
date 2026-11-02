# PageScope v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build PageScope v1 — an offline-testable website audit library and CLI that turns HTTP + HTML checks into evidence-backed findings, severity-gated CI exit codes, and JSON/Markdown/HTML reports.

**Architecture:** Two pnpm workspace packages. `@pagescope/core` holds contracts (types + zod schemas), the collection layer (undici fetch with a connect-time SSRF guard, parse5 parsing), the rule engine, 13 rules, and 3 reporters — all exported as a pure library. `pagescope` is a thin CLI that maps flags to `audit()` and exit codes. Rules never touch the network: the engine fetches once, then hands each rule an `AuditSnapshot`.

**Tech Stack:** TypeScript 5.9.3 (ESM), Node 22, pnpm, parse5 8.1.0, undici 8.12.3, zod 4.6.7, commander 15.0.0, vitest 5.1.0, tsup 9.0.0.

## Global Constraints

- Node **>=22** (`engines`), ESM only (`"type": "module"`), no CommonJS entry points.
- Exact dependency versions: `parse5@8.1.0`, `undici@8.12.3`, `zod@4.6.7`, `commander@15.0.0`, `typescript@5.9.3`, `vitest@5.1.0`, `tsup@9.0.0`, `@types/node@^22`.
- Product name **PageScope**; npm package `pagescope`; library package `@pagescope/core`; bin `pagescope`.
- `SCHEMA_VERSION = '1.0.0'`; every report carries `schemaVersion`.
- Status model is exactly `passed | failed | needs-review | not-applicable | error`; `error` is set **only** by the engine.
- No score, no grade, no percentage anywhere in output.
- Every code path that reaches the network must refuse private/reserved destinations at **connect time**, not by parsing the hostname.
- Tests must never touch the internet. Fixtures are local HTML strings or a local `node:http` server on `127.0.0.1`.
- `allowPrivateNetworks` is internal-only: never exposed through CLI flags, config files, or the public library API.
- CLI exit codes: `0` policy passed, `1` policy failed, `2` invalid input/config, `3` target not auditable.
- Documentation written for this project is English; this plan is written in English so contributor-facing instructions can be pasted into docs unchanged.

---

## File Structure

```
website-auditor/
  package.json                        root scripts + devDeps (private)
  pnpm-workspace.yaml
  tsconfig.base.json
  vitest.config.ts
  .gitignore
  .github/workflows/ci.yml
  examples/github-actions/audit.yml
  packages/core/
    package.json
    tsconfig.json
    tsup.config.ts
    src/index.ts                      public API surface
    src/contracts/types.ts            all data contracts
    src/contracts/report-schema.ts    zod schema + SCHEMA_VERSION
    src/contracts/config.ts           config file schema
    src/collection/ip-guard.ts        isBlockedAddress + createGuardedLookup
    src/collection/fetch.ts           fetchPage → FetchOutcome
    src/collection/parse.ts           parseHtml + tree helpers (findAll, attr, text, loc, snippet)
    src/engine/registry.ts            rule list + lookup by id
    src/engine/audit.ts               audit() lifecycle
    src/rules/seo.ts                  6 SEO rules
    src/rules/technical.ts            3 technical rules
    src/rules/a11y.ts                 2 accessibility rules
    src/rules/security.ts             2 security rules
    src/reporters/json.ts
    src/reporters/markdown.ts
    src/reporters/html.ts
    src/reporters/escape.ts           escapeHtml + sanitizeForTerminal
    test/contracts/schema.test.ts
    test/collection/ip-guard.test.ts
    test/collection/fetch.test.ts
    test/collection/parse.test.ts
    test/engine/audit.test.ts
    test/rules/*.test.ts              one file per rule module
    test/reporters/*.test.ts
    fixtures/index.html               demo page with deliberate findings
    fixtures/clean.html               page with zero findings
  packages/cli/
    package.json
    tsconfig.json
    tsup.config.ts
    src/cli.ts                        commander wiring + bin shebang
    src/run.ts                        run(argv) → exit code (testable)
    src/output.ts                     file writing + terminal rendering
    test/cli.test.ts                  spawns built dist/cli.js
  docs/architecture.md
  docs/security/threat-model.md
  docs/rules/*.md                     13 rule docs
  docs/contributing/adding-a-rule.md
  README.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  LICENSE
```

### Task 1: Workspace, tooling, and first green test

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsup.config.ts`, `packages/core/src/index.ts`
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/tsup.config.ts`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `@pagescope/core` exporting `VERSION: string`; workspace commands `pnpm -r typecheck`, `pnpm test`, `pnpm -r build`.

- [ ] **Step 1: Create the workspace files**

`package.json` (root):

```json
{
  "name": "pagescope-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "verify": "pnpm typecheck && pnpm lint && pnpm test && pnpm build"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Tests resolve the workspace package from source so `pnpm test` works on a
      // fresh clone, before anything has been built.
      '@pagescope/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
})
```

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
coverage/
.pagescope-tmp/
```

- [ ] **Step 2: Install dev dependencies and commit the lockfile**

Run: `pnpm add -Dw typescript@5.9.3 vitest@5.1.0 tsup@9.0.0 @types/node@^22 eslint prettier typescript-eslint @eslint/js`
Expected: `package.json` gains a `devDependencies` block, `pnpm-lock.yaml` is created.

- [ ] **Step 3: Create the core package manifest and configs**

`packages/core/package.json`:

```json
{
  "name": "@pagescope/core",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "parse5": "8.1.0",
    "undici": "8.12.3",
    "zod": "4.6.7"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

`packages/core/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  sourcemap: true,
})
```

`packages/core/src/index.ts`:

```ts
export const VERSION = '0.0.0'
```

- [ ] **Step 4: Create the CLI package manifest and configs**

`packages/cli/package.json`:

```json
{
  "name": "pagescope",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "bin": { "pagescope": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@pagescope/core": "workspace:*",
    "commander": "15.0.0"
  },
  "devDependencies": {
    "@pagescope/core": "workspace:*"
  }
}
```

`packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "baseUrl": ".",
    "paths": { "@pagescope/core": ["../core/src/index.ts"] }
  },
  "include": ["src/**/*.ts"]
}
```

`packages/cli/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  clean: true,
  target: 'node22',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
})
```

- [ ] **Step 5: Write the failing smoke test**

`packages/core/test/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

describe('workspace', () => {
  it('exposes a version string from @pagescope/core', () => {
    expect(VERSION).toBe('0.0.0')
  })
})
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm install` then `pnpm test`
Expected: 1 test file, 1 test passed.

- [ ] **Step 7: Run typecheck and build**

Run: `pnpm typecheck` then `pnpm build`
Expected: both exit 0; `packages/core/dist/index.js` and `packages/cli/dist/cli.js` exist.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace with core and cli packages"
```

---

### Task 2: Data contracts — types and zod report schema

**Files:**
- Create: `packages/core/src/contracts/types.ts`
- Create: `packages/core/src/contracts/report-schema.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/contracts/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type used by all later tasks — `RuleStatus`, `Category`, `Severity`, `Confidence`, `FindingStatus`, `AuditStatus`, `AuditErrorCode`, `AuditError`, `HeadersSummary`, `Evidence`, `Patch`, `FindingDraft`, `RuleResult`, `AuditSnapshot`, `RuleDefinition`, `Finding`, `RuleExecutionSummary`, `AuditResult`; plus `SCHEMA_VERSION` and `auditResultSchema`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/contracts/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, auditResultSchema } from '../../src/contracts/report-schema.js'
import type { AuditResult } from '../../src/contracts/types.js'

const minimal: AuditResult = {
  schemaVersion: SCHEMA_VERSION,
  audit: {
    startedAt: '2026-11-02T00:00:00.000Z',
    finishedAt: '2026-11-02T00:00:01.000Z',
    durationMs: 1000,
  },
  target: {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    redirectChain: [],
  },
  status: 'completed',
  rules: [{ ruleId: 'seo/title', status: 'passed', findingCount: 0 }],
  findings: [],
  errors: [],
  environment: { pagescopeVersion: '0.0.0', node: process.versions.node },
  limitations: ['JavaScript is not executed; only the raw HTML response is inspected.'],
}

describe('auditResultSchema', () => {
  it('accepts a minimal completed audit', () => {
    expect(auditResultSchema.parse(minimal)).toEqual(minimal)
  })

  it('rejects a report without schemaVersion', () => {
    const { schemaVersion: _dropped, ...rest } = minimal
    expect(() => auditResultSchema.parse(rest)).toThrow()
  })

  it('rejects an unknown status value', () => {
    expect(() => auditResultSchema.parse({ ...minimal, status: 'done' })).toThrow()
  })

  it('accepts a finding with absence evidence and no location', () => {
    const withFinding: AuditResult = {
      ...minimal,
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
          evidence: [
            {
              kind: 'absence',
              expected: '<title> inside <head>',
              scope: 'scanned <head> (14 nodes)',
            },
          ],
          recommendation: 'Add a <title> element inside <head>.',
          docsUrl: 'https://github.com/devalfian/website-auditor/blob/main/docs/rules/seo-title.md',
        },
      ],
    }
    expect(auditResultSchema.parse(withFinding).findings).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/test/contracts/schema.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts/report-schema.js`.

- [ ] **Step 3: Write `packages/core/src/contracts/types.ts`**

```ts
import type { Document } from 'parse5'

export type Category = 'seo' | 'technical' | 'security' | 'accessibility'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Confidence = 'high' | 'medium' | 'low'
export type RuleStatus = 'passed' | 'failed' | 'needs-review' | 'not-applicable' | 'error'
export type EvaluatedStatus = Exclude<RuleStatus, 'error'>
export type FindingStatus = 'failed' | 'needs-review'
export type AuditStatus = 'completed' | 'partial' | 'failed'

export type AuditErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'BLOCKED_ADDRESS'
  | 'DNS_FAILURE'
  | 'FETCH_TIMEOUT'
  | 'TOO_MANY_REDIRECTS'
  | 'RESPONSE_TOO_LARGE'
  | 'NON_HTML_RESPONSE'
  | 'RULE_CRASH'

export interface AuditError {
  code: AuditErrorCode
  message: string
  ruleId?: string
}

export interface HeadersSummary {
  /** Lower-cased header names. `set-cookie` values are removed; see cookieNames. */
  headers: Record<string, string>
  /** Cookie names only — never their values. */
  cookieNames: string[]
}

export type Evidence =
  | { kind: 'html-snippet'; snippet: string; line: number; column: number; truncated: boolean }
  | { kind: 'http-header'; name: string; value: string }
  | { kind: 'http-response'; status: number; finalUrl: string; redirectChain: string[] }
  | { kind: 'measurement'; label: string; value: string | number; unit?: string }
  | { kind: 'absence'; expected: string; scope: string }

export interface Patch {
  kind: 'insert' | 'replace'
  target: 'html' | 'http-headers'
  before?: string
  after: string
  /** false when `after` is a template the engine cannot fill in reliably. */
  exact: boolean
}

export interface FindingDraft {
  severity: Severity
  confidence: Confidence
  title: string
  description: string
  evidence: Evidence[]
  recommendation: string
  location?: { line: number; column: number }
  patch?: Patch
}

export interface RuleResult {
  status: EvaluatedStatus
  findings: FindingDraft[]
  note?: string
}

export interface AuditSnapshot {
  requestedUrl: string
  finalUrl: string
  httpStatus: number
  headers: HeadersSummary
  redirectChain: string[]
  html: string
  document: Document
  /** true when the response body exceeded the size limit and was cut. */
  truncated: boolean
}

export interface RuleDefinition {
  id: string
  category: Category
  title: string
  description: string
  docsSlug: string
  appliesTo: (snapshot: AuditSnapshot) => boolean
  evaluate: (snapshot: AuditSnapshot) => RuleResult
}

export interface Finding extends FindingDraft {
  ruleId: string
  category: Category
  status: FindingStatus
  target: { url: string }
  docsUrl: string
}

export interface RuleExecutionSummary {
  ruleId: string
  status: RuleStatus
  findingCount: number
  note?: string
  error?: AuditError
}

export interface AuditResult {
  schemaVersion: string
  audit: { startedAt: string; finishedAt: string; durationMs: number }
  target: {
    requestedUrl: string
    finalUrl: string | null
    httpStatus: number | null
    redirectChain: string[]
  }
  status: AuditStatus
  rules: RuleExecutionSummary[]
  findings: Finding[]
  errors: AuditError[]
  environment: { pagescopeVersion: string; node: string }
  limitations: string[]
}
```

- [ ] **Step 4: Write `packages/core/src/contracts/report-schema.ts`**

```ts
import { z } from 'zod'

export const SCHEMA_VERSION = '1.0.0'

const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('html-snippet'),
    snippet: z.string(),
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({ kind: z.literal('http-header'), name: z.string(), value: z.string() }),
  z.object({
    kind: z.literal('http-response'),
    status: z.number().int(),
    finalUrl: z.string(),
    redirectChain: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('measurement'),
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    unit: z.string().optional(),
  }),
  z.object({ kind: z.literal('absence'), expected: z.string(), scope: z.string() }),
])

const findingSchema = z.object({
  ruleId: z.string().min(1),
  category: z.enum(['seo', 'technical', 'security', 'accessibility']),
  status: z.enum(['failed', 'needs-review']),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  confidence: z.enum(['high', 'medium', 'low']),
  title: z.string().min(1),
  description: z.string().min(1),
  target: z.object({ url: z.string() }),
  location: z.object({ line: z.number().int(), column: z.number().int() }).optional(),
  evidence: z.array(evidenceSchema).min(1),
  recommendation: z.string().min(1),
  docsUrl: z.string(),
  patch: z
    .object({
      kind: z.enum(['insert', 'replace']),
      target: z.enum(['html', 'http-headers']),
      before: z.string().optional(),
      after: z.string(),
      exact: z.boolean(),
    })
    .optional(),
})

const auditErrorSchema = z.object({
  code: z.enum([
    'INVALID_URL',
    'UNSUPPORTED_PROTOCOL',
    'BLOCKED_ADDRESS',
    'DNS_FAILURE',
    'FETCH_TIMEOUT',
    'TOO_MANY_REDIRECTS',
    'RESPONSE_TOO_LARGE',
    'NON_HTML_RESPONSE',
    'RULE_CRASH',
  ]),
  message: z.string(),
  ruleId: z.string().optional(),
})

export const auditResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  audit: z.object({
    startedAt: z.string(),
    finishedAt: z.string(),
    durationMs: z.number().nonnegative(),
  }),
  target: z.object({
    requestedUrl: z.string(),
    finalUrl: z.string().nullable(),
    httpStatus: z.number().int().nullable(),
    redirectChain: z.array(z.string()),
  }),
  status: z.enum(['completed', 'partial', 'failed']),
  rules: z.array(
    z.object({
      ruleId: z.string(),
      status: z.enum(['passed', 'failed', 'needs-review', 'not-applicable', 'error']),
      findingCount: z.number().int().nonnegative(),
      note: z.string().optional(),
      error: auditErrorSchema.optional(),
    }),
  ),
  findings: z.array(findingSchema),
  errors: z.array(auditErrorSchema),
  environment: z.object({ pagescopeVersion: z.string(), node: z.string() }),
  limitations: z.array(z.string()),
})
```

- [ ] **Step 5: Export the contracts**

`packages/core/src/index.ts`:

```ts
export const VERSION = '0.0.0'

export * from './contracts/types.js'
export { SCHEMA_VERSION, auditResultSchema } from './contracts/report-schema.js'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/contracts/schema.test.ts`
Expected: 4 tests passed.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add data contracts and versioned report schema"
```

---

### Task 3: HTML parsing with source locations

**Files:**
- Create: `packages/core/src/collection/parse.ts`
- Test: `packages/core/test/collection/parse.test.ts`

**Interfaces:**
- Consumes: `parse5@8.1.0`.
- Produces: `parseHtml(html: string): HtmlDocument`, `findAll`, `byTagName(root, name)`, `getAttr(el, name)`, `getTextContent(node)`, `getHead(root)`, `locationOf(el)`, `snippetOf(html, el, maxChars?)`.

- [ ] **Step 1: Confirm the exported parse5 type names before writing code**

Run:

```bash
grep -n "export type\|export declare" packages/core/node_modules/parse5/dist/index.d.ts
```

Expected: the file re-exports the tree adapter types. Use `DefaultTreeAdapterMap` to derive node types:

```ts
type HtmlDocument = DefaultTreeAdapterMap['document']
type HtmlElement = DefaultTreeAdapterMap['element']
type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlChildNode = DefaultTreeAdapterMap['childNode']
```

If `packages/core/src/contracts/types.ts` fails to resolve `Document` from `parse5`, replace that import with:

```ts
import type { DefaultTreeAdapterMap } from 'parse5'
export type HtmlDocument = DefaultTreeAdapterMap['document']
```

and change `document: Document` to `document: HtmlDocument` in `AuditSnapshot`. Do this now, before continuing — do not leave a type error behind.

- [ ] **Step 2: Write the failing test**

`packages/core/test/collection/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  byTagName,
  findAll,
  getAttr,
  getHead,
  getTextContent,
  locationOf,
  parseHtml,
  snippetOf,
} from '../../src/collection/parse.js'

describe('parseHtml', () => {
  it('finds elements by tag name', () => {
    const doc = parseHtml('<html><head><title>Hi</title></head><body><img src="a.png"></body></html>')
    expect(byTagName(doc, 'title')).toHaveLength(1)
    expect(byTagName(doc, 'img')).toHaveLength(1)
    expect(byTagName(doc, 'video')).toHaveLength(0)
  })

  it('reports a source location for explicitly written elements', () => {
    const doc = parseHtml('<html><head><title>Hi</title></head><body></body></html>')
    const [title] = byTagName(doc, 'title')
    const location = locationOf(title!)
    expect(location).toBeDefined()
    expect(location!.line).toBeGreaterThan(0)
    expect(location!.column).toBeGreaterThan(0)
  })

  it('has no source location for nodes the parser inserted implicitly', () => {
    const doc = parseHtml('<html><body><table><tr><td>x</td></tr></table></body></html>')
    const [tbody] = byTagName(doc, 'tbody')
    expect(tbody).toBeDefined()
    expect(locationOf(tbody!)).toBeUndefined()
  })

  it('returns the raw source snippet of an element', () => {
    const html = '<html><head><title>Hello there</title></head></html>'
    const [title] = byTagName(parseHtml(html), 'title')
    const snippet = snippetOf(html, title!)
    expect(snippet?.snippet).toBe('<title>Hello there</title>')
    expect(snippet?.truncated).toBe(false)
  })

  it('truncates long snippets and flags them', () => {
    const html = `<html><head><title>${'x'.repeat(400)}</title></head></html>`
    const [title] = byTagName(parseHtml(html), 'title')
    const snippet = snippetOf(html, title!, 50)
    expect(snippet?.snippet.length).toBe(50)
    expect(snippet?.truncated).toBe(true)
  })

  it('reads attributes case-insensitively and text content', () => {
    const doc = parseHtml('<html><body><img SRC="a.png" alt="A cat"><p>Hello <b>world</b></p></body></html>')
    const [img] = byTagName(doc, 'img')
    expect(getAttr(img!, 'src')).toBe('a.png')
    expect(getAttr(img!, 'alt')).toBe('A cat')
    expect(getAttr(img!, 'title')).toBeUndefined()
    const [p] = byTagName(doc, 'p')
    expect(getTextContent(p!).trim()).toBe('Hello world')
  })

  it('finds head and reports absence when there is no head element', () => {
    expect(getHead(parseHtml('<html><head><title>x</title></head></html>'))).toBeDefined()
    expect(getHead(parseHtml('just text'))).toBeDefined() // parser always synthesises <head>
  })

  it('collects nodes matching a predicate', () => {
    const doc = parseHtml('<html><body><input id="a"><input id="b"><p id="c"></p></body></html>')
    const withId = findAll(doc, (el) => getAttr(el, 'id') !== undefined)
    expect(withId.map((el) => getAttr(el, 'id'))).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/test/collection/parse.test.ts`
Expected: FAIL — cannot resolve `../../src/collection/parse.js`.

- [ ] **Step 4: Write `packages/core/src/collection/parse.ts`**

```ts
import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

export type HtmlDocument = DefaultTreeAdapterMap['document']
export type HtmlElement = DefaultTreeAdapterMap['element']
export type HtmlNode = DefaultTreeAdapterMap['node']
export type HtmlChildNode = DefaultTreeAdapterMap['childNode']

export function parseHtml(html: string): HtmlDocument {
  return parse(html, { sourceCodeLocationInfo: true })
}

function childrenOf(node: HtmlNode | HtmlDocument): HtmlChildNode[] {
  return (node as { childNodes?: HtmlChildNode[] }).childNodes ?? []
}

export function isElement(node: HtmlChildNode): node is HtmlElement {
  return (node as { tagName?: unknown }).tagName !== undefined
}

export function findAll(
  root: HtmlDocument | HtmlNode,
  predicate: (el: HtmlElement) => boolean,
): HtmlElement[] {
  const out: HtmlElement[] = []
  const visit = (node: HtmlDocument | HtmlNode): void => {
    for (const child of childrenOf(node)) {
      if (isElement(child)) {
        if (predicate(child)) out.push(child)
        visit(child)
      } else if ((child as { childNodes?: unknown }).childNodes !== undefined) {
        visit(child as unknown as HtmlNode)
      }
    }
  }
  visit(root)
  return out
}

export function byTagName(root: HtmlDocument | HtmlNode, tagName: string): HtmlElement[] {
  const wanted = tagName.toLowerCase()
  return findAll(root, (el) => el.tagName === wanted)
}

export function getAttr(el: HtmlElement, name: string): string | undefined {
  const wanted = name.toLowerCase()
  return el.attrs.find((attr) => attr.name.toLowerCase() === wanted)?.value
}

export function getTextContent(node: HtmlNode | HtmlChildNode): string {
  const value = (node as { value?: unknown }).value
  if (typeof value === 'string') return value
  return childrenOf(node as HtmlNode)
    .map((child) => getTextContent(child))
    .join('')
}

export function getHead(root: HtmlDocument): HtmlElement | undefined {
  return byTagName(root, 'head')[0]
}

export function locationOf(el: HtmlElement): { line: number; column: number } | undefined {
  const loc = el.sourceCodeLocation
  if (!loc) return undefined
  return { line: loc.startLine, column: loc.startCol }
}

export interface Snippet {
  snippet: string
  line: number
  column: number
  truncated: boolean
}

export function snippetOf(html: string, el: HtmlElement, maxChars = 200): Snippet | undefined {
  const loc = el.sourceCodeLocation
  if (!loc) return undefined
  const { startOffset, endOffset } = loc as typeof loc & {
    startOffset?: number
    endOffset?: number
  }
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || endOffset <= startOffset) {
    return undefined
  }
  const raw = html.slice(startOffset, endOffset)
  const truncated = raw.length > maxChars
  return {
    snippet: truncated ? raw.slice(0, maxChars) : raw,
    line: loc.startLine,
    column: loc.startCol,
    truncated,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/collection/parse.test.ts`
Expected: 8 tests passed. If the "implicitly inserted node" test fails, `sourceCodeLocation` is behaving differently from the parse5 documentation — stop and record the observed shape in the test file comment rather than deleting the assertion.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): parse HTML with parse5 and expose source locations"
```

---

### Task 4: Connect-time address guard (the SSRF boundary)

**Files:**
- Create: `packages/core/src/collection/ip-guard.ts`
- Test: `packages/core/test/collection/ip-guard.test.ts`

**Interfaces:**
- Consumes: `node:dns`, `node:net`.
- Produces: `isBlockedAddress(address: string): boolean` and `createGuardedLookup({ allowPrivateNetworks }: { allowPrivateNetworks: boolean })`, which returns a `lookup` function compatible with `net.connect`/`undici` connector options. Rejections use error code `EBLOCKEDADDRESS`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/collection/ip-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createGuardedLookup, isBlockedAddress } from '../../src/collection/ip-guard.js'

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
    '2001:db8::1',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([
    '93.184.216.34',
    '1.1.1.1',
    '172.32.0.1',
    '2606:2800:220:1:248:1893:25c8:1946',
    '::ffff:93.184.216.34',
  ])('allows the public address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })

  it('blocks anything it cannot parse', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
    expect(isBlockedAddress('')).toBe(true)
    expect(isBlockedAddress('1.2.3')).toBe(true)
  })

  it('strips an IPv6 zone index before checking', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true)
  })
})

const resolve = (
  lookup: ReturnType<typeof createGuardedLookup>,
  hostname: string,
): Promise<{ error: NodeJS.ErrnoException | null; address: string; family?: number }> =>
  new Promise((resolvePromise) => {
    lookup(hostname, {}, (error, address, family) => {
      resolvePromise({ error: error as NodeJS.ErrnoException | null, address: String(address), family })
    })
  })

describe('createGuardedLookup', () => {
  it('rejects a hostname that resolves to loopback', async () => {
    const { error } = await resolve(createGuardedLookup({ allowPrivateNetworks: false }), 'localhost')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('EBLOCKEDADDRESS')
  })

  it('allows loopback when the internal escape hatch is enabled', async () => {
    const { error, address } = await resolve(createGuardedLookup({ allowPrivateNetworks: true }), 'localhost')
    expect(error).toBeNull()
    expect(['127.0.0.1', '::1']).toContain(address)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/test/collection/ip-guard.test.ts`
Expected: FAIL — cannot resolve `../../src/collection/ip-guard.js`.

- [ ] **Step 3: Write the address classification helpers**

`packages/core/src/collection/ip-guard.ts` (part 1):

```ts
import { lookup as dnsLookup } from 'node:dns'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isIPv4, isIPv6 } from 'node:net'

/** IPv4 ranges that must never be contacted by an auditor. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, includes cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function v4ToBytes(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    bytes.push(value)
  }
  return bytes
}

function v4ToInt(ip: string): number | null {
  const bytes = v4ToBytes(ip)
  if (!bytes) return null
  return ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0
}

function inV4Range(ipInt: number, base: string, bits: number): boolean {
  const baseInt = v4ToInt(base)
  if (baseInt === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

function isBlockedV4(ip: string): boolean {
  const ipInt = v4ToInt(ip)
  if (ipInt === null) return true
  return BLOCKED_V4.some(([base, bits]) => inV4Range(ipInt, base, bits))
}

function expandIpv6(input: string): number[] | null {
  let ip = input
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)

  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':')
    if (lastColon === -1) return null
    const v4 = v4ToBytes(ip.slice(lastColon + 1))
    if (!v4) return null
    const high = ((v4[0]! << 8) | v4[1]!).toString(16)
    const low = ((v4[2]! << 8) | v4[3]!).toString(16)
    ip = `${ip.slice(0, lastColon + 1)}${high}:${low}`
  }

  const halves = ip.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === undefined || halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1]!.split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 && missing !== 0) return null
  if (missing < 0) return null

  const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
  if (groups.length !== 8) return null

  const bytes: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    const value = Number.parseInt(group, 16)
    bytes.push((value >> 8) & 0xff, value & 0xff)
  }
  return bytes
}
```

- [ ] **Step 4: Add the classifier and the guarded lookup**

Append to `packages/core/src/collection/ip-guard.ts`:

```ts
export function isBlockedAddress(address: string): boolean {
  const candidate = address.trim()
  if (candidate === '') return true

  if (isIPv4(candidate)) return isBlockedV4(candidate)

  const withoutZone = candidate.includes('%') ? candidate.slice(0, candidate.indexOf('%')) : candidate
  if (!isIPv6(withoutZone)) return true

  const bytes = expandIpv6(candidate)
  if (!bytes) return true

  const zeroPrefix = (length: number): boolean => bytes.slice(0, length).every((byte) => byte === 0)
  const tailAsV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`

  if (bytes.every((byte) => byte === 0)) return true // ::
  if (zeroPrefix(15) && bytes[15] === 1) return true // ::1
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) return isBlockedV4(tailAsV4) // IPv4-mapped
  if (zeroPrefix(12)) return isBlockedV4(tailAsV4) // deprecated IPv4-compatible
  if ((bytes[0]! & 0xfe) === 0xfc) return true // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true // fe80::/10 link local
  if (bytes[0] === 0xff) return true // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true // 2001:db8::/32
  return false
}

export interface GuardedLookupOptions {
  /** Internal only. Never wire this to a CLI flag or config key. */
  allowPrivateNetworks: boolean
  /** Internal, used only by tests: permit these exact addresses even when allowPrivateNetworks is false. */
  allowAddresses?: readonly string[]
}

export type GuardedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

export function createGuardedLookup(
  options: GuardedLookupOptions,
): (hostname: string, lookupOptions: LookupOptions | number | GuardedLookupCallback, callback?: GuardedLookupCallback) => void {
  return (hostname, lookupOptions, callback) => {
    const done = (typeof lookupOptions === 'function' ? lookupOptions : callback) as GuardedLookupCallback
    const wantsAll = typeof lookupOptions === 'object' && lookupOptions !== null && lookupOptions.all === true

    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        done(error, '', 0)
        return
      }
      const resolved = addresses as LookupAddress[]
      if (resolved.length === 0) {
        done(Object.assign(new Error(`No addresses found for ${hostname}`), { code: 'ENOTFOUND' }), '', 0)
        return
      }

      const blocked = resolved.find(
        (entry) =>
          !options.allowPrivateNetworks &&
          !options.allowAddresses?.includes(entry.address) &&
          isBlockedAddress(entry.address),
      )
      if (blocked) {
        done(
          Object.assign(
            new Error(
              `Refusing to connect to ${hostname}: ${blocked.address} is a private, loopback, or reserved address`,
            ),
            { code: 'EBLOCKEDADDRESS' },
          ),
          '',
          0,
        )
        return
      }

      if (wantsAll) {
        done(null, resolved)
        return
      }
      const first = resolved[0]!
      done(null, first.address, first.family)
    })
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/collection/ip-guard.test.ts`
Expected: all tests passed (21 blocked addresses, 5 allowed addresses, 3 unparsable inputs, 1 zone index, 2 lookup tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. If `dnsLookup` overload resolution complains about `{ all: true, verbatim: true }`, annotate the callback parameters as `(error: NodeJS.ErrnoException | null, addresses: LookupAddress[])`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): block private and reserved addresses at connect time"
```

---

### Task 5: HTTP collection layer

**Files:**
- Create: `packages/core/src/version.ts`
- Create: `packages/core/src/collection/fetch.ts`
- Modify: `packages/core/src/contracts/types.ts` (add `NETWORK_ERROR` to `AuditErrorCode`)
- Modify: `packages/core/src/contracts/report-schema.ts` (add `NETWORK_ERROR` to the error enum)
- Modify: `packages/core/src/index.ts` (re-export `VERSION` from `version.ts`)
- Test: `packages/core/test/collection/fetch.test.ts`

**Interfaces:**
- Consumes: `createGuardedLookup` (Task 4), `parseHtml` (Task 3), `AuditSnapshot`/`AuditError` (Task 2).
- Produces: `validateTarget(raw): { ok: true; url: URL } | { ok: false; error: AuditError }`, `fetchPage(rawUrl, options?): Promise<FetchOutcome>` where `FetchOutcome = { ok: true; snapshot: AuditSnapshot } | { ok: false; error: AuditError; finalUrl: string | null; redirectChain: string[] }`, plus `FetchOptions { timeoutMs?, maxBytes?, maxRedirects?, allowPrivateNetworks?, allowAddresses? }` and the constants `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_REDIRECTS`.

- [ ] **Step 1: Verify the undici dispatcher option shape before writing the client**

This is the one spec assumption flagged as unverified. Settle it empirically:

```bash
node -e "const u=require('undici');const a=new u.Agent({connect:{lookup:(h,o,cb)=>cb(Object.assign(new Error('guard ran'),{code:'EBLOCKEDADDRESS'}),'',0)}});u.request('http://example.com',{dispatcher:a}).then(()=>console.log('NOT INTERCEPTED')).catch(e=>console.log('INTERCEPTED:',e.code||e.message)).finally(()=>a.close())"
```

Expected: `INTERCEPTED: EBLOCKEDADDRESS`.

If it prints `NOT INTERCEPTED`, the `connect.lookup` passthrough is not working as assumed. In that case use `node:https`/`node:http` with the same `lookup` passed directly in the request options instead, changing only the `request` call inside `fetchPage` — the guard, redirect loop, size limit, and tests all stay identical.

Record the observed output in the commit message body. Do not proceed on an assumption.

- [ ] **Step 2: Add `NETWORK_ERROR` to the error code union**

In `packages/core/src/contracts/types.ts`, add `| 'NETWORK_ERROR'` to the `AuditErrorCode` union (a generic transport failure such as `ECONNREFUSED` or `ECONNRESET` does not honestly map to `DNS_FAILURE`).

In `packages/core/src/contracts/report-schema.ts`, add `'NETWORK_ERROR',` to the `z.enum([...])` inside `auditErrorSchema`.

- [ ] **Step 3: Create the version module**

`packages/core/src/version.ts`:

```ts
export const VERSION = '0.0.0'
```

Then in `packages/core/src/index.ts`, replace `export const VERSION = '0.0.0'` with `export { VERSION } from './version.js'`. Update `packages/core/test/smoke.test.ts` to import from `../src/version.js`.

- [ ] **Step 4: Write the failing test**

`packages/core/test/collection/fetch.test.ts`:

```ts
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { fetchPage, validateTarget } from '../../src/collection/fetch.js'

const ALLOW_LOOPBACK = { allowPrivateNetworks: false, allowAddresses: ['127.0.0.1'] as const }

async function withServer(
  handler: RequestListener,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('validateTarget', () => {
  it('accepts http and https URLs', () => {
    expect(validateTarget('https://example.com/').ok).toBe(true)
    expect(validateTarget('http://example.com/a?b=1').ok).toBe(true)
  })

  it.each(['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'rejects %s',
    (input) => {
      const result = validateTarget(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(['INVALID_URL', 'UNSUPPORTED_PROTOCOL']).toContain(result.error.code)
    },
  )

  it('rejects URLs carrying credentials', () => {
    const result = validateTarget('https://user:pass@example.com/')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_URL')
  })
})

describe('fetchPage', () => {
  it('returns a snapshot for an HTML page', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' })
        res.end('<html><head><title>Hello</title></head><body><p>hi</p></body></html>')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.snapshot.httpStatus).toBe(200)
        expect(outcome.snapshot.finalUrl).toBe(`${base}/`)
        expect(outcome.snapshot.html).toContain('<title>Hello</title>')
        expect(outcome.snapshot.headers.headers['x-frame-options']).toBe('DENY')
        expect(outcome.snapshot.truncated).toBe(false)
      },
    )
  })

  it('records cookie names but never cookie values', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/html',
          'set-cookie': ['session=super-secret-token; HttpOnly', 'theme=dark'],
        })
        res.end('<html><head><title>t</title></head></html>')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.snapshot.headers.cookieNames).toEqual(['session', 'theme'])
        expect(JSON.stringify(outcome.snapshot.headers)).not.toContain('super-secret-token')
      },
    )
  })

  it('follows a redirect and records the chain', async () => {
    await withServer(
      (req, res) => {
        if (req.url === '/') {
          res.writeHead(302, { location: '/final' })
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><head><title>final</title></head></html>')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.snapshot.redirectChain).toEqual([`${base}/final`])
        expect(outcome.snapshot.finalUrl).toBe(`${base}/final`)
      },
    )
  })

  it('blocks a loopback target when the guard is fully enabled', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html></html>')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, { allowPrivateNetworks: false })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('BLOCKED_ADDRESS')
      },
    )
  })

  it('blocks a redirect that points at a private address', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('BLOCKED_ADDRESS')
        expect(outcome.redirectChain).toHaveLength(1)
      },
    )
  })

  it('refuses more than five redirects', async () => {
    await withServer(
      (req, res) => {
        const step = Number(new URL(req.url ?? '/', 'http://x').pathname.replace('/', '') || '0')
        res.writeHead(302, { location: `/${step + 1}` })
        res.end()
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/0`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('TOO_MANY_REDIRECTS')
      },
    )
  })

  it('aborts an oversized body instead of buffering it', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(`<html><body>${'a'.repeat(4000)}</body></html>`)
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, { ...ALLOW_LOOPBACK, maxBytes: 1024 })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('RESPONSE_TOO_LARGE')
      },
    )
  })

  it('times out when the server never responds', async () => {
    await withServer(
      () => {
        /* never respond */
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, { ...ALLOW_LOOPBACK, timeoutMs: 300 })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('FETCH_TIMEOUT')
      },
    )
  })

  it('rejects a non-HTML response', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end('%PDF-1.4')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('NON_HTML_RESPONSE')
      },
    )
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/test/collection/fetch.test.ts`
Expected: FAIL — cannot resolve `../../src/collection/fetch.js`.

- [ ] **Step 6: Write the collection client (part 1 — validation and header redaction)**

`packages/core/src/collection/fetch.ts`:

```ts
import { Agent, request } from 'undici'
import { createGuardedLookup } from './ip-guard.js'
import { parseHtml } from './parse.js'
import { VERSION } from '../version.js'
import type { AuditError, AuditSnapshot, HeadersSummary } from '../contracts/types.js'

export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_MAX_REDIRECTS = 5

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const HTML_CONTENT_TYPE = /text\/html|application\/xhtml\+xml/i

export interface FetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** Internal only. Never wire this to a CLI flag, config key, or public API. */
  allowPrivateNetworks?: boolean
  /** Internal only, tests use it to permit 127.0.0.1 while keeping everything else blocked. */
  allowAddresses?: readonly string[]
}

export type FetchOutcome =
  | { ok: true; snapshot: AuditSnapshot }
  | { ok: false; error: AuditError; finalUrl: string | null; redirectChain: string[] }

export type TargetValidation = { ok: true; url: URL } | { ok: false; error: AuditError }

export function validateTarget(raw: string): TargetValidation {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: { code: 'INVALID_URL', message: `Not a valid absolute URL: ${raw}` } }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_PROTOCOL',
        message: `Unsupported protocol "${url.protocol}"; only http and https can be audited`,
      },
    }
  }

  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      error: { code: 'INVALID_URL', message: 'URLs containing credentials are not accepted' },
    }
  }

  return { ok: true, url }
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

function toAuditError(error: unknown): AuditError {
  const message = error instanceof Error ? error.message : String(error)
  switch (codeOf(error)) {
    case 'EBLOCKEDADDRESS':
      return { code: 'BLOCKED_ADDRESS', message }
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { code: 'DNS_FAILURE', message }
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_ABORTED':
    case 'ABORT_ERR':
      return { code: 'FETCH_TIMEOUT', message }
    default:
      return { code: 'NETWORK_ERROR', message }
  }
}

function summarizeHeaders(raw: Record<string, string | string[] | undefined>): HeadersSummary {
  const headers: Record<string, string> = {}
  const cookieNames: string[] = []

  for (const [rawName, rawValue] of Object.entries(raw)) {
    if (rawValue === undefined) continue
    const name = rawName.toLowerCase()

    if (name === 'set-cookie') {
      const cookies = Array.isArray(rawValue) ? rawValue : [rawValue]
      for (const cookie of cookies) {
        const cookieName = cookie.split('=')[0]?.trim()
        if (cookieName) cookieNames.push(cookieName)
      }
      continue
    }

    if (name === 'authorization') continue
    headers[name] = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue
  }

  return { headers, cookieNames }
}
```

- [ ] **Step 7: Write the collection client (part 2 — redirect loop and limits)**

Append to `packages/core/src/collection/fetch.ts`:

```ts
type BoundedBody = { text: string } | { tooLarge: true }

async function readBodyBounded(
  body: AsyncIterable<Uint8Array> & { destroy?: () => void },
  maxBytes: number,
): Promise<BoundedBody> {
  const chunks: Uint8Array[] = []
  let total = 0

  for await (const chunk of body) {
    total += chunk.byteLength
    if (total > maxBytes) {
      body.destroy?.()
      return { tooLarge: true }
    }
    chunks.push(chunk)
  }

  return { text: Buffer.concat(chunks).toString('utf8') }
}

export async function fetchPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchOutcome> {
  const validation = validateTarget(rawUrl)
  if (!validation.ok) {
    return { ok: false, error: validation.error, finalUrl: null, redirectChain: [] }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  const dispatcher = new Agent({
    connect: {
      lookup: createGuardedLookup({
        allowPrivateNetworks: options.allowPrivateNetworks ?? false,
        ...(options.allowAddresses ? { allowAddresses: options.allowAddresses } : {}),
      }),
    },
  })

  const redirectChain: string[] = []
  let current = validation.url
  const deadline = Date.now() + timeoutMs

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        return {
          ok: false,
          error: { code: 'FETCH_TIMEOUT', message: `Audit exceeded the ${timeoutMs}ms budget` },
          finalUrl: current.toString(),
          redirectChain,
        }
      }

      let response: Awaited<ReturnType<typeof request>>
      try {
        response = await request(current, {
          dispatcher,
          method: 'GET',
          maxRedirections: 0,
          signal: AbortSignal.timeout(remaining),
          headers: {
            'user-agent': `pagescope/${VERSION}`,
            accept: 'text/html,application/xhtml+xml',
          },
        })
      } catch (error) {
        return {
          ok: false,
          error: toAuditError(error),
          finalUrl: current.toString(),
          redirectChain,
        }
      }

      const location = response.headers.location

      if (REDIRECT_STATUSES.has(response.statusCode) && typeof location === 'string') {
        await response.body.dump()
        const next = new URL(location, current)
        redirectChain.push(next.toString())

        if (hop === maxRedirects) {
          return {
            ok: false,
            error: {
              code: 'TOO_MANY_REDIRECTS',
              message: `More than ${maxRedirects} redirects`,
            },
            finalUrl: next.toString(),
            redirectChain,
          }
        }

        const nextValidation = validateTarget(next.toString())
        if (!nextValidation.ok) {
          return {
            ok: false,
            error: nextValidation.error,
            finalUrl: next.toString(),
            redirectChain,
          }
        }

        current = nextValidation.url
        continue
      }

      const contentType = response.headers['content-type']
      const looksLikeHtml =
        typeof contentType !== 'string' || HTML_CONTENT_TYPE.test(contentType)

      if (!looksLikeHtml) {
        await response.body.dump()
        return {
          ok: false,
          error: {
            code: 'NON_HTML_RESPONSE',
            message: `Expected HTML but received "${String(contentType)}"`,
          },
          finalUrl: current.toString(),
          redirectChain,
        }
      }

      const body = await readBodyBounded(response.body, maxBytes)
      if ('tooLarge' in body) {
        return {
          ok: false,
          error: {
            code: 'RESPONSE_TOO_LARGE',
            message: `Response body exceeded the ${maxBytes} byte limit`,
          },
          finalUrl: current.toString(),
          redirectChain,
        }
      }

      return {
        ok: true,
        snapshot: {
          requestedUrl: rawUrl,
          finalUrl: current.toString(),
          httpStatus: response.statusCode,
          headers: summarizeHeaders(response.headers),
          redirectChain,
          html: body.text,
          document: parseHtml(body.text),
          truncated: false,
        },
      }
    }

    return {
      ok: false,
      error: { code: 'TOO_MANY_REDIRECTS', message: `More than ${maxRedirects} redirects` },
      finalUrl: current.toString(),
      redirectChain,
    }
  } finally {
    await dispatcher.close()
  }
}
```

`truncated` stays `false` in v1: oversize responses abort with `RESPONSE_TOO_LARGE` rather than being cut, and the field exists so a future soft-limit mode can set it without a schema change. Say exactly that in the code comment next to the property.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/collection/fetch.test.ts`
Expected: 13 tests passed. If the "blocks a redirect that points at a private address" test fails because hop 1 was never reached, confirm `allowAddresses` was passed through — that test is the reason the option exists.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add -A
git commit -m "feat(core): add HTTP collection layer with redirect and size guards" -m "undici connect.lookup probe output: <paste the exact line printed in Step 1>"
```

---

### Task 6: Rule helpers plus the first two SEO rules

**Files:**
- Create: `packages/core/src/rules/shared.ts`
- Create: `packages/core/src/rules/seo.ts`
- Create: `packages/core/test/rules/helpers.ts`
- Test: `packages/core/test/rules/seo-title.test.ts`, `packages/core/test/rules/seo-meta-description.test.ts`

**Interfaces:**
- Consumes: `parse.ts` helpers (Task 3), `RuleDefinition`/`RuleResult` (Task 2).
- Produces: `findMeta(snapshot, attribute, value)`, `elementEvidence(snapshot, el)`, `locationProps(el)`, `headScope(snapshot)`, `docsUrlFor(slug)`, `snapshotOf(html, overrides?)` test helper, and `seoRules: RuleDefinition[]` (grown by Task 7).

- [ ] **Step 1: Write the test helper**

`packages/core/test/rules/helpers.ts`:

```ts
import { parseHtml } from '../../src/collection/parse.js'
import type { AuditSnapshot } from '../../src/contracts/types.js'

export function snapshotOf(html: string, overrides: Partial<AuditSnapshot> = {}): AuditSnapshot {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    headers: { headers: {}, cookieNames: [] },
    redirectChain: [],
    html,
    document: parseHtml(html),
    truncated: false,
    ...overrides,
  }
}

export const page = (head: string, body = ''): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`
```

- [ ] **Step 2: Write the failing tests for `seo/title` and `seo/meta-description`**

`packages/core/test/rules/seo-title.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { titleRule } from '../../src/rules/seo.js'
import { page, snapshotOf } from './helpers.js'

describe('seo/title', () => {
  it('passes when a non-empty title exists', () => {
    const result = titleRule.evaluate(snapshotOf(page('<title>Acme widgets</title>')))
    expect(result.status).toBe('passed')
    expect(result.findings).toHaveLength(0)
    expect(result.note).toContain('12')
  })

  it('fails with absence evidence when there is no title', () => {
    const result = titleRule.evaluate(snapshotOf(page('<meta charset="utf-8">')))
    expect(result.status).toBe('failed')
    const [finding] = result.findings
    expect(finding?.severity).toBe('high')
    expect(finding?.evidence[0]).toEqual({
      kind: 'absence',
      expected: '<title> inside <head>',
      scope: 'scanned <head> (1 nodes)',
    })
    expect(finding?.patch?.exact).toBe(false)
    expect(finding?.evidence.some((item) => item.kind === 'html-snippet')).toBe(false)
  })

  it('fails when the title is whitespace only', () => {
    const result = titleRule.evaluate(snapshotOf(page('<title>   </title>')))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.title).toBe('<title> is empty')
    expect(result.findings[0]?.location).toBeDefined()
  })

  it('does not invent a title to make the report look complete', () => {
    const result = titleRule.evaluate(snapshotOf(page('')))
    expect(result.findings[0]?.patch?.after).toContain('{{')
  })
})
```

`packages/core/test/rules/seo-meta-description.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { metaDescriptionRule } from '../../src/rules/seo.js'
import { page, snapshotOf } from './helpers.js'

describe('seo/meta-description', () => {
  it('passes when a non-empty description exists', () => {
    const result = metaDescriptionRule.evaluate(
      snapshotOf(page('<meta name="description" content="All about widgets.">')),
    )
    expect(result.status).toBe('passed')
  })

  it('fails when the description is missing', () => {
    const result = metaDescriptionRule.evaluate(snapshotOf(page('<title>t</title>')))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('medium')
  })

  it('fails when the description is present but empty', () => {
    const result = metaDescriptionRule.evaluate(
      snapshotOf(page('<meta name="description" content="">')),
    )
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.evidence[0]?.kind).toBe('html-snippet')
  })

  it('never claims a ranking impact', () => {
    const result = metaDescriptionRule.evaluate(snapshotOf(page('')))
    const text = JSON.stringify(result.findings).toLowerCase()
    expect(text).not.toContain('ranking')
    expect(text).not.toContain('rank higher')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/rules`
Expected: FAIL — cannot resolve `../../src/rules/seo.js`.

- [ ] **Step 4: Write the shared rule helpers**

`packages/core/src/rules/shared.ts`:

```ts
import { findAll, getAttr, getHead, locationOf, snippetOf } from '../collection/parse.js'
import type { HtmlElement, HtmlNode } from '../collection/parse.js'
import type { AuditSnapshot, Evidence } from '../contracts/types.js'

export const DOCS_BASE = 'https://github.com/devalfian/website-auditor/blob/main/docs/rules'

export function docsUrlFor(slug: string): string {
  return `${DOCS_BASE}/${slug}.md`
}

export function countDescendants(node: HtmlNode | { childNodes?: HtmlNode[] }): number {
  const children = (node as { childNodes?: HtmlNode[] }).childNodes ?? []
  let total = children.length
  for (const child of children) total += countDescendants(child)
  return total
}

export function headScope(snapshot: AuditSnapshot): string {
  const head = getHead(snapshot.document)
  return `scanned <head> (${head ? countDescendants(head) : 0} nodes)`
}

export function findMeta(
  snapshot: AuditSnapshot,
  attribute: 'name' | 'property',
  value: string,
): HtmlElement | undefined {
  const head = getHead(snapshot.document)
  if (!head) return undefined
  const wanted = value.toLowerCase()
  return findAll(
    head,
    (el) => el.tagName === 'meta' && (getAttr(el, attribute) ?? '').toLowerCase() === wanted,
  )[0]
}

export function elementEvidence(snapshot: AuditSnapshot, el: HtmlElement): Evidence {
  const snippet = snippetOf(snapshot.html, el)
  if (!snippet) {
    return {
      kind: 'absence',
      expected: `<${el.tagName}> snippet`,
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

export function locationProps(el: HtmlElement): { location?: { line: number; column: number } } {
  const location = locationOf(el)
  return location ? { location } : {}
}
```

- [ ] **Step 5: Write the two rules**

`packages/core/src/rules/seo.ts`:

```ts
import { findAll, getHead, getTextContent } from '../collection/parse.js'
import { elementEvidence, findMeta, headScope, locationProps } from './shared.js'
import type { RuleDefinition } from '../contracts/types.js'

export const titleRule: RuleDefinition = {
  id: 'seo/title',
  category: 'seo',
  title: 'Page declares a non-empty <title>',
  description: 'Checks that <head> contains a <title> element with non-empty text.',
  docsSlug: 'seo-title',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const head = getHead(snapshot.document)
    const title = head ? findAll(head, (el) => el.tagName === 'title')[0] : undefined

    if (!title) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'high',
            confidence: 'high',
            title: 'Missing <title> element',
            description:
              'The document has no <title> element inside <head>. Browsers and search result listings use it as the page title.',
            evidence: [
              { kind: 'absence', expected: '<title> inside <head>', scope: headScope(snapshot) },
            ],
            recommendation:
              'Add a <title> element inside <head> describing this specific page, and keep it unique across pages.',
            patch: {
              kind: 'insert',
              target: 'html',
              after: '<title>{{page title}}</title>',
              exact: false,
            },
          },
        ],
      }
    }

    const text = getTextContent(title).trim()
    if (text === '') {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'high',
            confidence: 'high',
            title: '<title> is empty',
            description: 'The <title> element exists but contains only whitespace.',
            evidence: [elementEvidence(snapshot, title)],
            recommendation: 'Put a descriptive page title inside the <title> element.',
            ...locationProps(title),
            patch: {
              kind: 'replace',
              target: 'html',
              before: '<title></title>',
              after: '<title>{{page title}}</title>',
              exact: false,
            },
          },
        ],
      }
    }

    return { status: 'passed', findings: [], note: `title length: ${text.length} characters` }
  },
}

export const metaDescriptionRule: RuleDefinition = {
  id: 'seo/meta-description',
  category: 'seo',
  title: 'Page declares a non-empty meta description',
  description: 'Checks for <meta name="description"> with non-empty content inside <head>.',
  docsSlug: 'seo-meta-description',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const meta = findMeta(snapshot, 'name', 'description')

    if (!meta) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'medium',
            confidence: 'high',
            title: 'Missing meta description',
            description:
              'No <meta name="description"> element was found in <head>. This rule verifies presence only and makes no claim about search ranking effects.',
            evidence: [
              {
                kind: 'absence',
                expected: '<meta name="description"> inside <head>',
                scope: headScope(snapshot),
              },
            ],
            recommendation:
              'Add <meta name="description" content="..."> describing the page in one or two sentences.',
            patch: {
              kind: 'insert',
              target: 'html',
              after: '<meta name="description" content="{{page summary}}">',
              exact: false,
            },
          },
        ],
      }
    }

    const content = (
      meta.attrs.find((attr) => attr.name.toLowerCase() === 'content')?.value ?? ''
    ).trim()

    if (content === '') {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'medium',
            confidence: 'high',
            title: 'Meta description is empty',
            description:
              'A <meta name="description"> element exists but its content attribute is empty or missing.',
            evidence: [elementEvidence(snapshot, meta)],
            recommendation:
              'Set the content attribute to a one or two sentence summary of the page.',
            ...locationProps(meta),
            patch: {
              kind: 'replace',
              target: 'html',
              before: '<meta name="description" content="">',
              after: '<meta name="description" content="{{page summary}}">',
              exact: false,
            },
          },
        ],
      }
    }

    return {
      status: 'passed',
      findings: [],
      note: `description length: ${content.length} characters`,
    }
  },
}

export const seoRules: RuleDefinition[] = [titleRule, metaDescriptionRule]
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run packages/core/test/rules`
Expected: 8 tests passed.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add -A
git commit -m "feat(core): add title and meta description rules with shared evidence helpers"
```

---

### Task 7: Remaining SEO rules — canonical, robots, Open Graph, headings

**Files:**
- Modify: `packages/core/src/rules/seo.ts`
- Test: `packages/core/test/rules/seo-rest.test.ts`

**Interfaces:**
- Consumes: `findMeta`, `elementEvidence`, `headScope`, `locationProps` (Task 6).
- Produces: `canonicalRule`, `robotsMetaRule`, `openGraphRule`, `headingStructureRule`; `seoRules` grows to 6 entries.

- [ ] **Step 1: Write the failing test**

`packages/core/test/rules/seo-rest.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  canonicalRule,
  headingStructureRule,
  openGraphRule,
  robotsMetaRule,
} from '../../src/rules/seo.js'
import { page, snapshotOf } from './helpers.js'

describe('seo/canonical', () => {
  it('passes for an absolute canonical URL', () => {
    const result = canonicalRule.evaluate(
      snapshotOf(page('<link rel="canonical" href="https://example.com/pricing">')),
    )
    expect(result.status).toBe('passed')
    expect(result.note).toContain('https://example.com/pricing')
  })

  it('fails when the canonical link is missing', () => {
    const result = canonicalRule.evaluate(snapshotOf(page('')))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('low')
    expect(result.findings[0]?.evidence[0]?.kind).toBe('absence')
  })

  it('fails when the canonical href is relative', () => {
    const result = canonicalRule.evaluate(
      snapshotOf(page('<link rel="canonical" href="/pricing">')),
    )
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.title).toContain('not absolute')
  })

  it('fails when the canonical href is empty', () => {
    const result = canonicalRule.evaluate(snapshotOf(page('<link rel="canonical" href="">')))
    expect(result.status).toBe('failed')
  })
})

describe('seo/robots-meta', () => {
  it('passes when there is no robots meta', () => {
    const result = robotsMetaRule.evaluate(snapshotOf(page('')))
    expect(result.status).toBe('passed')
    expect(result.note).toContain('no robots meta')
  })

  it('passes for index,follow', () => {
    const result = robotsMetaRule.evaluate(
      snapshotOf(page('<meta name="robots" content="index, follow">')),
    )
    expect(result.status).toBe('passed')
  })

  it('returns needs-review rather than failed for noindex', () => {
    const result = robotsMetaRule.evaluate(
      snapshotOf(page('<meta name="robots" content="noindex, nofollow">')),
    )
    expect(result.status).toBe('needs-review')
    expect(result.findings[0]?.status).toBeUndefined()
    expect(result.findings[0]?.title).toContain('noindex')
    expect(result.findings[0]?.evidence[0]?.kind).toBe('html-snippet')
  })
})

describe('seo/open-graph', () => {
  it('passes when all four properties exist', () => {
    const result = openGraphRule.evaluate(
      snapshotOf(
        page(
          '<meta property="og:title" content="t"><meta property="og:description" content="d">' +
            '<meta property="og:image" content="https://example.com/a.png">' +
            '<meta property="og:url" content="https://example.com/">',
        ),
      ),
    )
    expect(result.status).toBe('passed')
  })

  it('reports exactly which properties are missing', () => {
    const result = openGraphRule.evaluate(
      snapshotOf(page('<meta property="og:title" content="t">')),
    )
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('low')
    const measurement = result.findings[0]?.evidence.find((item) => item.kind === 'measurement')
    expect(measurement).toEqual({
      kind: 'measurement',
      label: 'missing Open Graph properties',
      value: 'og:description, og:image, og:url',
    })
  })
})

describe('seo/heading-structure', () => {
  it('passes for a single h1 followed by h2', () => {
    const result = headingStructureRule.evaluate(
      snapshotOf(page('', '<h1>Title</h1><h2>Section</h2>')),
    )
    expect(result.status).toBe('passed')
    expect(result.note).toContain('2 headings')
  })

  it('fails when there is no h1', () => {
    const result = headingStructureRule.evaluate(snapshotOf(page('', '<h2>Section</h2>')))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.evidence[0]?.kind).toBe('absence')
  })

  it('returns needs-review for two h1 elements', () => {
    const result = headingStructureRule.evaluate(
      snapshotOf(page('', '<h1>One</h1><h1>Two</h1>')),
    )
    expect(result.status).toBe('needs-review')
    expect(result.findings[0]?.title).toContain('Multiple')
  })

  it('returns needs-review when a heading level is skipped', () => {
    const result = headingStructureRule.evaluate(
      snapshotOf(page('', '<h1>Title</h1><h3>Skipped h2</h3>')),
    )
    expect(result.status).toBe('needs-review')
    expect(result.findings[0]?.title).toContain('h1 to h3')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/test/rules/seo-rest.test.ts`
Expected: FAIL — `canonicalRule` is not exported.

- [ ] **Step 3: Add the canonical and robots rules**

Append to `packages/core/src/rules/seo.ts` (and extend the imports at the top to `import { findAll, getAttr, getHead, getTextContent } from '../collection/parse.js'`, plus `import type { AuditSnapshot, RuleDefinition } from '../contracts/types.js'` and `import type { HtmlElement } from '../collection/parse.js'`):

```ts
function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function canonicalLink(snapshot: AuditSnapshot): HtmlElement | undefined {
  const head = getHead(snapshot.document)
  if (!head) return undefined
  return findAll(head, (el) => {
    if (el.tagName !== 'link') return false
    const rel = (getAttr(el, 'rel') ?? '').toLowerCase().split(/\s+/)
    return rel.includes('canonical')
  })[0]
}

export const canonicalRule: RuleDefinition = {
  id: 'seo/canonical',
  category: 'seo',
  title: 'Page declares an absolute canonical URL',
  description: 'Checks for <link rel="canonical"> with an absolute href inside <head>.',
  docsSlug: 'seo-canonical',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const link = canonicalLink(snapshot)

    if (!link) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'low',
            confidence: 'high',
            title: 'Missing canonical URL',
            description:
              'No <link rel="canonical"> element was found in <head>. PageScope reports the absence of the declaration; it cannot know which URL should be canonical for this site.',
            evidence: [
              {
                kind: 'absence',
                expected: '<link rel="canonical"> inside <head>',
                scope: headScope(snapshot),
              },
            ],
            recommendation:
              'Declare the preferred absolute URL for this page with <link rel="canonical" href="...">.',
            patch: {
              kind: 'insert',
              target: 'html',
              after: '<link rel="canonical" href="{{absolute page URL}}">',
              exact: false,
            },
          },
        ],
      }
    }

    const href = (getAttr(link, 'href') ?? '').trim()

    if (href === '') {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'low',
            confidence: 'high',
            title: 'Canonical href is empty',
            description: 'The canonical link element exists but has no href attribute value.',
            evidence: [elementEvidence(snapshot, link)],
            recommendation: 'Set href to the absolute URL of the preferred page.',
            ...locationProps(link),
          },
        ],
      }
    }

    if (!isAbsoluteUrl(href)) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'low',
            confidence: 'medium',
            title: 'Canonical URL is not absolute',
            description:
              'The canonical href is relative. Relative canonicals are resolved differently by different consumers, so an absolute URL is safer.',
            evidence: [elementEvidence(snapshot, link)],
            recommendation: `Use the absolute form, for example "${new URL(href, snapshot.finalUrl).toString()}".`,
            ...locationProps(link),
            patch: {
              kind: 'replace',
              target: 'html',
              before: `href="${href}"`,
              after: `href="${new URL(href, snapshot.finalUrl).toString()}"`,
              exact: true,
            },
          },
        ],
      }
    }

    return { status: 'passed', findings: [], note: `canonical: ${href}` }
  },
}

const BLOCKING_ROBOTS_DIRECTIVES = new Set(['noindex', 'nofollow', 'none'])

export const robotsMetaRule: RuleDefinition = {
  id: 'seo/robots-meta',
  category: 'seo',
  title: 'Page does not carry unintentional robots blocking directives',
  description:
    'Inspects <meta name="robots"> and reports index/follow blocking directives for human review.',
  docsSlug: 'seo-robots-meta',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const meta = findMeta(snapshot, 'name', 'robots')

    if (!meta) {
      return { status: 'passed', findings: [], note: 'no robots meta directive present' }
    }

    const content = (getAttr(meta, 'content') ?? '').toLowerCase()
    const directives = content
      .split(',')
      .map((directive) => directive.trim())
      .filter((directive) => directive !== '')
    const blocking = directives.filter((directive) => BLOCKING_ROBOTS_DIRECTIVES.has(directive))

    if (blocking.length === 0) {
      return { status: 'passed', findings: [], note: `robots: ${directives.join(', ')}` }
    }

    return {
      status: 'needs-review',
      findings: [
        {
          severity: 'medium',
          confidence: 'medium',
          title: `Robots meta contains "${blocking.join(', ')}"`,
          description:
            'This page asks crawlers not to index or follow it. That is correct for staging or private pages and wrong for public ones; PageScope cannot determine which applies here.',
          evidence: [elementEvidence(snapshot, meta)],
          recommendation:
            'Confirm the directive is intentional. Remove it from pages that should appear in search results.',
          ...locationProps(meta),
        },
      ],
    }
  },
}
```

- [ ] **Step 4: Add the Open Graph and heading rules**

Append to `packages/core/src/rules/seo.ts`:

```ts
const OG_PROPERTIES = ['og:title', 'og:description', 'og:image', 'og:url'] as const

export const openGraphRule: RuleDefinition = {
  id: 'seo/open-graph',
  category: 'seo',
  title: 'Page declares the core Open Graph properties',
  description: 'Checks for og:title, og:description, og:image and og:url meta properties.',
  docsSlug: 'seo-open-graph',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const missing = OG_PROPERTIES.filter(
      (property) => findMeta(snapshot, 'property', property) === undefined,
    )

    if (missing.length === 0) {
      return {
        status: 'passed',
        findings: [],
        note: 'all core Open Graph properties present',
      }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'low',
          confidence: 'high',
          title: 'Missing Open Graph properties',
          description: `The page does not declare ${missing.join(', ')}. PageScope verifies the presence of the tags only; it does not check how any social platform renders a preview.`,
          evidence: [
            {
              kind: 'measurement',
              label: 'missing Open Graph properties',
              value: missing.join(', '),
            },
            {
              kind: 'absence',
              expected: '<meta property="og:*"> inside <head>',
              scope: headScope(snapshot),
            },
          ],
          recommendation:
            'Add the missing <meta property="og:..."> tags inside <head>, using absolute URLs for og:image and og:url.',
        },
      ],
    }
  },
}

export const headingStructureRule: RuleDefinition = {
  id: 'seo/heading-structure',
  category: 'seo',
  title: 'Heading order is unambiguous',
  description: 'Counts <h1> elements and reports heading levels that skip a level.',
  docsSlug: 'seo-heading-structure',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const headings = findAll(snapshot.document, (el) => /^h[1-6]$/.test(el.tagName))
    const h1s = headings.filter((el) => el.tagName === 'h1')

    if (h1s.length === 0) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'medium',
            confidence: 'high',
            title: 'No <h1> on the page',
            description:
              'The document contains no <h1> element. PageScope inspects real heading elements only; headings built with role="heading" are not detected.',
            evidence: [
              {
                kind: 'absence',
                expected: '<h1>',
                scope: `scanned ${headings.length} heading elements`,
              },
            ],
            recommendation: 'Add a single <h1> describing the main subject of the page.',
          },
        ],
      }
    }

    if (h1s.length > 1) {
      return {
        status: 'needs-review',
        findings: [
          {
            severity: 'medium',
            confidence: 'low',
            title: `Multiple <h1> elements (${h1s.length})`,
            description:
              'More than one <h1> is valid HTML5, but many style guides and templates expect exactly one. PageScope cannot tell which convention this project follows.',
            evidence: [
              { kind: 'measurement', label: 'h1 count', value: h1s.length },
              ...h1s.map((el) => elementEvidence(snapshot, el)),
            ],
            recommendation:
              'If the template expects a single top-level heading, demote the extra ones to <h2>.',
          },
        ],
      }
    }

    let previous = 0
    for (const heading of headings) {
      const level = Number(heading.tagName[1])
      if (previous !== 0 && level > previous + 1) {
        return {
          status: 'needs-review',
          findings: [
            {
              severity: 'medium',
              confidence: 'low',
              title: `Heading level jumps from h${previous} to h${level}`,
              description:
                'Skipped heading levels can confuse assistive technology that builds a document outline. Some templates generate this pattern intentionally.',
              evidence: [elementEvidence(snapshot, heading)],
              recommendation: `Add the missing h${level - 1} level, or confirm the structure is intentional.`,
              ...locationProps(heading),
            },
          ],
        }
      }
      previous = level
    }

    return { status: 'passed', findings: [], note: `checked ${headings.length} headings` }
  },
}

export const seoRules: RuleDefinition[] = [
  titleRule,
  metaDescriptionRule,
  canonicalRule,
  robotsMetaRule,
  openGraphRule,
  headingStructureRule,
]
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run packages/core/test/rules`
Expected: all rule tests pass (8 from Task 6 plus 13 here).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add -A
git commit -m "feat(core): add canonical, robots, open graph and heading rules"
```

---

### Task 8: Technical rules

**Files:**
- Create: `packages/core/src/rules/technical.ts`
- Test: `packages/core/test/rules/technical.test.ts`

**Interfaces:**
- Consumes: `parse.ts` helpers, `elementEvidence`/`locationProps` (Task 6).
- Produces: `duplicateIdRule`, `metaViewportRule`, `httpStatusRule`, `technicalRules: RuleDefinition[]`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/rules/technical.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { duplicateIdRule, httpStatusRule, metaViewportRule } from '../../src/rules/technical.js'
import { page, snapshotOf } from './helpers.js'

describe('technical/duplicate-id', () => {
  it('passes when all ids are unique', () => {
    const result = duplicateIdRule.evaluate(
      snapshotOf(page('', '<div id="a"></div><div id="b"></div>')),
    )
    expect(result.status).toBe('passed')
    expect(result.note).toBe('2 unique ids')
  })

  it('fails once per duplicated id and shows every occurrence', () => {
    const result = duplicateIdRule.evaluate(
      snapshotOf(page('', '<p id="dup">one</p><p id="dup">two</p><p id="ok">x</p>')),
    )
    expect(result.status).toBe('failed')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.title).toBe('Duplicate id "dup"')
    expect(result.findings[0]?.evidence).toHaveLength(2)
    expect(result.findings[0]?.patch).toEqual({
      kind: 'replace',
      target: 'html',
      before: 'id="dup"',
      after: 'id="dup-2"',
      exact: true,
    })
  })

  it('ignores empty and whitespace-only ids', () => {
    const result = duplicateIdRule.evaluate(snapshotOf(page('', '<p id=""></p><p id=" "></p>')))
    expect(result.status).toBe('passed')
  })
})

describe('technical/meta-viewport', () => {
  it('passes when the viewport meta exists', () => {
    const result = metaViewportRule.evaluate(
      snapshotOf(page('<meta name="viewport" content="width=device-width, initial-scale=1">')),
    )
    expect(result.status).toBe('passed')
  })

  it('fails when the viewport meta is missing', () => {
    const result = metaViewportRule.evaluate(snapshotOf(page('')))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('medium')
    expect(result.findings[0]?.evidence[0]?.kind).toBe('absence')
  })
})

describe('technical/http-status', () => {
  it('passes for 200', () => {
    expect(httpStatusRule.evaluate(snapshotOf(page(''))).status).toBe('passed')
  })

  it('fails for a 404 with response evidence', () => {
    const result = httpStatusRule.evaluate(snapshotOf(page(''), { httpStatus: 404 }))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('high')
    expect(result.findings[0]?.evidence[0]).toEqual({
      kind: 'http-response',
      status: 404,
      finalUrl: 'https://example.com/',
      redirectChain: [],
    })
  })

  it('does not call a non-2xx response a broken link', () => {
    const result = httpStatusRule.evaluate(snapshotOf(page(''), { httpStatus: 429 }))
    expect(JSON.stringify(result.findings).toLowerCase()).not.toContain('broken link')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/test/rules/technical.test.ts`
Expected: FAIL — cannot resolve `../../src/rules/technical.js`.

- [ ] **Step 3: Write `packages/core/src/rules/technical.ts`**

```ts
import { findAll, getAttr, type HtmlElement } from '../collection/parse.js'
import { elementEvidence, locationProps } from './shared.js'
import type { RuleDefinition } from '../contracts/types.js'

export const duplicateIdRule: RuleDefinition = {
  id: 'technical/duplicate-id',
  category: 'technical',
  title: 'No duplicate id attributes',
  description: 'Reports id values that more than one element uses.',
  docsSlug: 'technical-duplicate-id',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const byId = new Map<string, HtmlElement[]>()

    const withId = findAll(snapshot.document, (candidate) => {
      const id = getAttr(candidate, 'id')
      return typeof id === 'string' && id.trim() !== ''
    })

    for (const el of withId) {
      const id = (getAttr(el, 'id') ?? '').trim()
      const group = byId.get(id)
      if (group) group.push(el)
      else byId.set(id, [el])
    }

    const duplicates = [...byId.entries()].filter(([, elements]) => elements.length > 1)

    if (duplicates.length === 0) {
      return { status: 'passed', findings: [], note: `${byId.size} unique ids` }
    }

    return {
      status: 'failed',
      findings: duplicates.map(([id, elements]) => ({
        severity: 'medium',
        confidence: 'high',
        title: `Duplicate id "${id}"`,
        description: `The id "${id}" is used by ${elements.length} elements. Duplicate ids break fragment links and document.getElementById lookups.`,
        evidence: elements.map((el) => elementEvidence(snapshot, el)),
        recommendation: 'Give every element a unique id, or use a class when grouping is intended.',
        ...locationProps(elements[1] ?? elements[0]!),
        patch: {
          kind: 'replace',
          target: 'html',
          before: `id="${id}"`,
          after: `id="${id}-2"`,
          exact: true,
        },
      })),
    }
  },
}

export const metaViewportRule: RuleDefinition = {
  id: 'technical/meta-viewport',
  category: 'technical',
  title: 'Page declares a viewport meta tag',
  description: 'Checks for <meta name="viewport"> in the document.',
  docsSlug: 'technical-meta-viewport',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const hasViewport =
      findAll(
        snapshot.document,
        (el) => el.tagName === 'meta' && (getAttr(el, 'name') ?? '').toLowerCase() === 'viewport',
      ).length > 0

    if (hasViewport) {
      return { status: 'passed', findings: [], note: 'viewport meta present' }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'medium',
          confidence: 'high',
          title: 'Missing viewport meta tag',
          description:
            'No <meta name="viewport"> was found. Without it, mobile browsers fall back to a desktop-width layout. PageScope does not evaluate the quality of the viewport value.',
          evidence: [
            {
              kind: 'absence',
              expected: '<meta name="viewport">',
              scope: 'scanned the whole document',
            },
          ],
          recommendation:
            'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.',
          patch: {
            kind: 'insert',
            target: 'html',
            after: '<meta name="viewport" content="width=device-width, initial-scale=1">',
            exact: true,
          },
        },
      ],
    }
  },
}

export const httpStatusRule: RuleDefinition = {
  id: 'technical/http-status',
  category: 'technical',
  title: 'Page responds with a 2xx status',
  description: 'Reports a final response status outside the 2xx range.',
  docsSlug: 'technical-http-status',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const status = snapshot.httpStatus

    if (status >= 200 && status < 300) {
      return { status: 'passed', findings: [], note: `HTTP ${status}` }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'high',
          confidence: 'high',
          title: `Page responded with HTTP ${status}`,
          description: `The final response for this URL has status ${status}. PageScope reports the status code it observed; it cannot tell whether a non-2xx response is intentional for this URL.`,
          evidence: [
            {
              kind: 'http-response',
              status,
              finalUrl: snapshot.finalUrl,
              redirectChain: snapshot.redirectChain,
            },
          ],
          recommendation:
            'Serve the page with a 2xx status, or confirm that a non-2xx response is intended for this URL.',
        },
      ],
    }
  },
}

export const technicalRules: RuleDefinition[] = [
  duplicateIdRule,
  metaViewportRule,
  httpStatusRule,
]
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/test/rules/technical.test.ts`
Expected: 7 tests passed.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add -A
git commit -m "feat(core): add duplicate id, viewport and http status rules"
```

---

### Task 9: Accessibility and security rules

**Files:**
- Create: `packages/core/src/rules/a11y.ts`
- Create: `packages/core/src/rules/security.ts`
- Test: `packages/core/test/rules/a11y.test.ts`, `packages/core/test/rules/security.test.ts`

**Interfaces:**
- Consumes: `parse.ts` helpers, `elementEvidence`, `locationProps`.
- Produces: `imgAltRule`, `htmlLangRule`, `a11yRules`, `httpsRule`, `securityHeadersRule`, `securityRules`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/rules/a11y.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { htmlLangRule, imgAltRule } from '../../src/rules/a11y.js'
import { page, snapshotOf } from './helpers.js'

describe('a11y/img-alt', () => {
  it('is not applicable when the page has no images', () => {
    const result = imgAltRule.evaluate(snapshotOf(page('', '<p>no images</p>')))
    expect(result.status).toBe('not-applicable')
    expect(result.note).toContain('no <img>')
  })

  it('passes when every image has an alt attribute, including empty ones', () => {
    const result = imgAltRule.evaluate(
      snapshotOf(page('', '<img src="a.png" alt="A cat"><img src="b.png" alt="">')),
    )
    expect(result.status).toBe('passed')
    expect(result.note).toContain('2 images')
  })

  it('fails one finding per image without an alt attribute', () => {
    const result = imgAltRule.evaluate(
      snapshotOf(page('', '<img src="a.png"><img src="b.png" alt="ok">')),
    )
    expect(result.status).toBe('failed')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.severity).toBe('medium')
    expect(result.findings[0]?.patch?.exact).toBe(false)
    expect(result.findings[0]?.evidence[0]?.kind).toBe('html-snippet')
  })

  it('never claims WCAG conformance', () => {
    const result = imgAltRule.evaluate(snapshotOf(page('', '<img src="a.png">')))
    expect(JSON.stringify(result.findings).toLowerCase()).not.toContain('wcag')
    expect(JSON.stringify(result.findings).toLowerCase()).not.toContain('conform')
  })
})

describe('a11y/html-lang', () => {
  it('passes when html has a lang attribute', () => {
    const result = htmlLangRule.evaluate(snapshotOf(page('<title>t</title>')))
    expect(result.status).toBe('passed')
    expect(result.note).toContain('en')
  })

  it('fails when lang is missing', () => {
    const result = htmlLangRule.evaluate(
      snapshotOf('<!doctype html><html><head><title>t</title></head><body></body></html>'),
    )
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('medium')
  })

  it('fails when lang is empty', () => {
    const result = htmlLangRule.evaluate(
      snapshotOf('<!doctype html><html lang=""><head></head><body></body></html>'),
    )
    expect(result.status).toBe('failed')
  })
})
```

`packages/core/test/rules/security.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { httpsRule, securityHeadersRule } from '../../src/rules/security.js'
import { page, snapshotOf } from './helpers.js'

const withHeaders = (headers: Record<string, string>) =>
  snapshotOf(page('<title>t</title>'), { headers: { headers, cookieNames: [] } })

describe('security/https', () => {
  it('passes when the final URL is https', () => {
    const result = httpsRule.evaluate(snapshotOf(page('<title>t</title>')))
    expect(result.status).toBe('passed')
  })

  it('fails when the final URL is http', () => {
    const result = httpsRule.evaluate(
      snapshotOf(page('<title>t</title>'), {
        requestedUrl: 'http://example.com/',
        finalUrl: 'http://example.com/',
      }),
    )
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('high')
    expect(result.findings[0]?.evidence[0]?.kind).toBe('http-response')
  })
})

describe('security/security-headers', () => {
  it('passes when all four headers are present', () => {
    const result = securityHeadersRule.evaluate(
      withHeaders({
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      }),
    )
    expect(result.status).toBe('passed')
  })

  it('lists the missing headers without claiming exploitability', () => {
    const result = securityHeadersRule.evaluate(withHeaders({ 'referrer-policy': 'no-referrer' }))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('low')
    const measurement = result.findings[0]?.evidence.find((item) => item.kind === 'measurement')
    expect(measurement).toEqual({
      kind: 'measurement',
      label: 'missing security headers',
      value: 'HSTS, CSP, X-Content-Type-Options',
    })
    const text = JSON.stringify(result.findings).toLowerCase()
    expect(text).not.toContain('vulnerable')
    expect(text).not.toContain('exploit')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/rules/a11y.test.ts packages/core/test/rules/security.test.ts`
Expected: FAIL — cannot resolve `../../src/rules/a11y.js`.

- [ ] **Step 3: Write `packages/core/src/rules/a11y.ts`**

```ts
import { findAll, getAttr, type HtmlElement } from '../collection/parse.js'
import { elementEvidence, locationProps } from './shared.js'
import type { FindingDraft, RuleDefinition } from '../contracts/types.js'

export const imgAltRule: RuleDefinition = {
  id: 'a11y/img-alt',
  category: 'accessibility',
  title: 'Images declare an alt attribute',
  description: 'Reports <img> elements that have no alt attribute at all.',
  docsSlug: 'a11y-img-alt',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const images = findAll(snapshot.document, (el) => el.tagName === 'img')

    if (images.length === 0) {
      return { status: 'not-applicable', findings: [], note: 'no <img> elements on the page' }
    }

    const missing = images.filter((el) => getAttr(el, 'alt') === undefined)

    if (missing.length === 0) {
      return {
        status: 'passed',
        findings: [],
        note: `${images.length} images declare an alt attribute`,
      }
    }

    const findings = missing.map(
      (el: HtmlElement): FindingDraft => ({
        severity: 'medium',
        confidence: 'high',
        title: '<img> without an alt attribute',
        description:
          'This image has no alt attribute. PageScope checks for the attribute only: it cannot judge whether existing alt text is useful, and alt="" is treated as an intentional decorative image.',
        evidence: [elementEvidence(snapshot, el)],
        recommendation: 'Add alt text describing the image, or alt="" if it is purely decorative.',
        ...locationProps(el),
        patch: {
          kind: 'insert',
          target: 'html',
          after: 'alt="{{describe the image}}"',
          exact: false,
        },
      }),
    )

    return { status: 'failed', findings }
  },
}

export const htmlLangRule: RuleDefinition = {
  id: 'a11y/html-lang',
  category: 'accessibility',
  title: 'Document declares a language',
  description: 'Checks that the <html> element has a non-empty lang attribute.',
  docsSlug: 'a11y-html-lang',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const html = findAll(snapshot.document, (el) => el.tagName === 'html')[0]

    if (!html) {
      return {
        status: 'not-applicable',
        findings: [],
        note: 'the parser produced no <html> element',
      }
    }

    const lang = (getAttr(html, 'lang') ?? '').trim()

    if (lang !== '') {
      return { status: 'passed', findings: [], note: `html lang="${lang}"` }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'medium',
          confidence: 'high',
          title: 'Missing lang attribute on <html>',
          description:
            'The <html> element has no lang attribute. Screen readers use it to choose pronunciation rules. PageScope does not verify that the declared language matches the content.',
          evidence: [
            {
              kind: 'absence',
              expected: 'lang attribute on <html>',
              scope: 'checked the <html> element',
            },
          ],
          recommendation: 'Add a language tag to the root element, for example <html lang="en">.',
          ...locationProps(html),
          patch: {
            kind: 'insert',
            target: 'html',
            after: 'lang="{{language code}}"',
            exact: false,
          },
        },
      ],
    }
  },
}

export const a11yRules: RuleDefinition[] = [imgAltRule, htmlLangRule]
```

- [ ] **Step 4: Write `packages/core/src/rules/security.ts`**

```ts
import type { RuleDefinition } from '../contracts/types.js'

export const httpsRule: RuleDefinition = {
  id: 'security/https',
  category: 'security',
  title: 'Page is served over HTTPS',
  description: 'Checks the scheme of the final URL after redirects.',
  docsSlug: 'security-https',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    if (snapshot.finalUrl.startsWith('https:')) {
      return { status: 'passed', findings: [], note: `final URL is ${snapshot.finalUrl}` }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'high',
          confidence: 'high',
          title: 'Page is not served over HTTPS',
          description:
            'The final response was delivered over plain HTTP, so traffic between the visitor and this page is not encrypted. PageScope does not validate certificates; that is the browser\u2019s job.',
          evidence: [
            {
              kind: 'http-response',
              status: snapshot.httpStatus,
              finalUrl: snapshot.finalUrl,
              redirectChain: snapshot.redirectChain,
            },
            {
              kind: 'measurement',
              label: 'requested scheme',
              value: new URL(snapshot.requestedUrl).protocol,
            },
          ],
          recommendation:
            'Serve the site over HTTPS and redirect plain HTTP requests to the HTTPS URL.',
        },
      ],
    }
  },
}

const EXPECTED_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['strict-transport-security', 'HSTS'],
  ['content-security-policy', 'CSP'],
  ['x-content-type-options', 'X-Content-Type-Options'],
  ['referrer-policy', 'Referrer-Policy'],
]

export const securityHeadersRule: RuleDefinition = {
  id: 'security/security-headers',
  category: 'security',
  title: 'Common security headers are present',
  description:
    'Reports which of HSTS, CSP, X-Content-Type-Options and Referrer-Policy are absent from the response.',
  docsSlug: 'security-headers',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const missing = EXPECTED_HEADERS.filter(
      ([header]) => snapshot.headers.headers[header] === undefined,
    )

    if (missing.length === 0) {
      return { status: 'passed', findings: [], note: 'all four headers present' }
    }

    const labels = missing.map(([, label]) => label).join(', ')

    return {
      status: 'failed',
      findings: [
        {
          severity: 'low',
          confidence: 'high',
          title: 'Missing security headers',
          description: `These response headers were not sent: ${labels}. This rule reports absence only: the presence of a header does not prove a secure configuration, and its absence does not prove a page is exploitable.`,
          evidence: [
            { kind: 'measurement', label: 'missing security headers', value: labels },
            {
              kind: 'absence',
              expected: missing.map(([header]) => header).join(', '),
              scope: 'scanned the response headers',
            },
          ],
          recommendation:
            'Review each missing header against your deployment platform and add the ones your site can support without breaking.',
        },
      ],
    }
  },
}

export const securityRules: RuleDefinition[] = [httpsRule, securityHeadersRule]
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run packages/core/test/rules`
Expected: all rule tests pass (SEO, technical, a11y, security).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add -A
git commit -m "feat(core): add accessibility and security rule modules"
```

---

### Task 10: Rule registry and audit engine

**Files:**
- Create: `packages/core/src/engine/registry.ts`
- Create: `packages/core/src/engine/audit.ts`
- Modify: `packages/core/src/index.ts` (export the engine and registry)
- Test: `packages/core/test/engine/audit.test.ts`

**Interfaces:**
- Consumes: `fetchPage`/`FetchOutcome` (Task 5), all four rule modules (Tasks 6–9), `SCHEMA_VERSION` (Task 2).
- Produces: `allRules`, `selectRules(include?, exclude?)`, `class UnknownRuleError`, `LIMITATIONS`, `AuditRequest`, `audit(request): Promise<AuditResult>`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/engine/audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LIMITATIONS, audit } from '../../src/engine/audit.js'
import { UnknownRuleError, allRules, selectRules } from '../../src/engine/registry.js'
import type { FetchOutcome } from '../../src/collection/fetch.js'
import { page, snapshotOf } from '../rules/helpers.js'

const brokenPage = snapshotOf(page('<title>t</title>'), {
  headers: { headers: {}, cookieNames: [] },
})

const okFetcher =
  (snapshot = brokenPage) =>
  async (): Promise<FetchOutcome> => ({ ok: true, snapshot })

const failingFetcher =
  () =>
  async (): Promise<FetchOutcome> => ({
    ok: false,
    error: { code: 'BLOCKED_ADDRESS', message: 'blocked' },
    finalUrl: null,
    redirectChain: [],
  })

describe('registry', () => {
  it('registers 13 rules with unique namespaced ids', () => {
    expect(allRules).toHaveLength(13)
    const ids = allRules.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(13)
    for (const id of ids) expect(id).toMatch(/^(seo|technical|security|a11y)\/[a-z-]+$/)
  })

  it('filters by include and exclude', () => {
    expect(selectRules(['seo/title']).map((rule) => rule.id)).toEqual(['seo/title'])
    expect(selectRules(undefined, ['seo/title']).map((rule) => rule.id)).not.toContain('seo/title')
  })

  it('throws UnknownRuleError with the valid ids in the message', () => {
    expect(() => selectRules(['seo/nope'])).toThrow(UnknownRuleError)
    try {
      selectRules(['seo/nope'])
    } catch (error) {
      expect((error as Error).message).toContain('seo/title')
    }
  })
})

describe('audit', () => {
  it('runs every rule against the snapshot and records a summary per rule', async () => {
    const result = await audit({ url: 'https://example.com/', fetcher: okFetcher() })
    expect(result.status).toBe('completed')
    expect(result.rules).toHaveLength(13)
    expect(result.schemaVersion).toBe('1.0.0')
    expect(result.limitations).toEqual(LIMITATIONS)
    expect(result.rules.some((summary) => summary.status === 'failed')).toBe(true)
    expect(result.rules.some((summary) => summary.status === 'passed')).toBe(true)
  })

  it('reports a failed audit without pretending the rules ran', async () => {
    const result = await audit({ url: 'https://example.com/', fetcher: failingFetcher() })
    expect(result.status).toBe('failed')
    expect(result.findings).toEqual([])
    expect(result.errors[0]?.code).toBe('BLOCKED_ADDRESS')
    expect(result.rules.every((summary) => summary.status === 'error')).toBe(true)
    expect(result.rules.some((summary) => summary.status === 'passed')).toBe(false)
  })

  it('keeps other findings when a single rule crashes', async () => {
    const crashing = snapshotOf(page('<link rel="canonical" href="/relative">'), {
      finalUrl: 'not-a-valid-url',
    })
    const result = await audit({ url: 'https://example.com/', fetcher: okFetcher(crashing) })
    expect(result.status).toBe('partial')
    const canonical = result.rules.find((summary) => summary.ruleId === 'seo/canonical')
    expect(canonical?.status).toBe('error')
    expect(canonical?.error?.code).toBe('RULE_CRASH')
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.errors.some((error) => error.code === 'RULE_CRASH')).toBe(true)
  })

  it('honours rule selection', async () => {
    const result = await audit({
      url: 'https://example.com/',
      rules: ['seo/title'],
      fetcher: okFetcher(),
    })
    expect(result.rules.map((summary) => summary.ruleId)).toEqual(['seo/title'])
  })

  it('rejects an unknown rule id before fetching', async () => {
    await expect(
      audit({ url: 'https://example.com/', rules: ['nope/nope'], fetcher: okFetcher() }),
    ).rejects.toBeInstanceOf(UnknownRuleError)
  })

  it('records findings with rule metadata attached', async () => {
    const result = await audit({ url: 'https://example.com/', fetcher: okFetcher() })
    for (const finding of result.findings) {
      expect(finding.docsUrl).toContain('/docs/rules/')
      expect(finding.evidence.length).toBeGreaterThan(0)
      expect(['failed', 'needs-review']).toContain(finding.status)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/test/engine/audit.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/audit.js`.

- [ ] **Step 3: Write `packages/core/src/engine/registry.ts`**

```ts
import { a11yRules } from '../rules/a11y.js'
import { securityRules } from '../rules/security.js'
import { seoRules } from '../rules/seo.js'
import { technicalRules } from '../rules/technical.js'
import type { RuleDefinition } from '../contracts/types.js'

export const allRules: readonly RuleDefinition[] = [
  ...seoRules,
  ...technicalRules,
  ...a11yRules,
  ...securityRules,
]

export class UnknownRuleError extends Error {
  readonly ruleId: string

  constructor(ruleId: string) {
    super(`Unknown rule id "${ruleId}". Known ids: ${allRules.map((rule) => rule.id).join(', ')}`)
    this.name = 'UnknownRuleError'
    this.ruleId = ruleId
  }
}

export function selectRules(
  include?: readonly string[],
  exclude?: readonly string[],
): RuleDefinition[] {
  const byId = new Map(allRules.map((rule) => [rule.id, rule]))

  let selected: RuleDefinition[] = [...allRules]

  if (include && include.length > 0) {
    selected = include.map((id) => {
      const rule = byId.get(id)
      if (!rule) throw new UnknownRuleError(id)
      return rule
    })
  }

  if (exclude && exclude.length > 0) {
    for (const id of exclude) {
      if (!byId.has(id)) throw new UnknownRuleError(id)
    }
    selected = selected.filter((rule) => !exclude.includes(rule.id))
  }

  return selected
}
```

- [ ] **Step 4: Write `packages/core/src/engine/audit.ts`**

```ts
import { fetchPage, type FetchOutcome } from '../collection/fetch.js'
import { SCHEMA_VERSION } from '../contracts/report-schema.js'
import { VERSION } from '../version.js'
import { selectRules } from './registry.js'
import type {
  AuditError,
  AuditResult,
  AuditSnapshot,
  Finding,
  FindingStatus,
  RuleDefinition,
  RuleExecutionSummary,
  RuleResult,
} from '../contracts/types.js'

export const LIMITATIONS: readonly string[] = [
  'JavaScript is not executed: only the raw HTML response is inspected.',
  'Only the single requested page is audited; links are not crawled.',
  'Automated checks cannot establish WCAG conformance or prove that a page is exploitable.',
]

export interface AuditRequest {
  url: string
  rules?: readonly string[]
  excludeRules?: readonly string[]
  timeoutMs?: number
  /** Internal only. Never wire this to a CLI flag or a config key. */
  allowPrivateNetworks?: boolean
  /** Internal only, used by tests to permit a specific fixture address. */
  allowAddresses?: readonly string[]
  /** Internal only: replaces the network fetcher in tests. */
  fetcher?: typeof fetchPage
  /** Internal only: replaces the clock in tests. */
  now?: () => Date
}

function docsUrlFor(slug: string): string {
  return `https://github.com/devalfian/website-auditor/blob/main/docs/rules/${slug}.md`
}

function assertResultInvariants(rule: RuleDefinition, result: RuleResult): void {
  const producesFindings = result.status === 'failed' || result.status === 'needs-review'
  if (producesFindings && result.findings.length === 0) {
    throw new Error(`Rule ${rule.id} reported "${result.status}" without any finding`)
  }
  if (!producesFindings && result.findings.length > 0) {
    throw new Error(`Rule ${rule.id} reported "${result.status}" but returned findings`)
  }
}

export async function audit(request: AuditRequest): Promise<AuditResult> {
  const now = request.now ?? (() => new Date())
  const startedAtMs = Date.now()
  const startedAt = now().toISOString()
  const rules = selectRules(request.rules, request.excludeRules)

  const finished = (): { startedAt: string; finishedAt: string; durationMs: number } => ({
    startedAt,
    finishedAt: now().toISOString(),
    durationMs: Date.now() - startedAtMs,
  })

  const buildFailure = (
    error: AuditError,
    finalUrl: string | null,
    redirectChain: string[],
  ): AuditResult => ({
    schemaVersion: SCHEMA_VERSION,
    audit: finished(),
    target: { requestedUrl: request.url, finalUrl, httpStatus: null, redirectChain },
    status: 'failed',
    rules: rules.map(
      (rule): RuleExecutionSummary => ({
        ruleId: rule.id,
        status: 'error',
        findingCount: 0,
        error,
      }),
    ),
    findings: [],
    errors: [error],
    environment: { pagescopeVersion: VERSION, node: process.versions.node },
    limitations: [...LIMITATIONS],
  })
```

Continue the same file with the fetch call, the rule loop, and the return:

```ts
  const fetcher = request.fetcher ?? fetchPage
  const outcome: FetchOutcome = await fetcher(request.url, {
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.allowPrivateNetworks !== undefined
      ? { allowPrivateNetworks: request.allowPrivateNetworks }
      : {}),
    ...(request.allowAddresses ? { allowAddresses: request.allowAddresses } : {}),
  })

  if (!outcome.ok) {
    return buildFailure(outcome.error, outcome.finalUrl, outcome.redirectChain)
  }

  const snapshot: AuditSnapshot = outcome.snapshot
  const findings: Finding[] = []
  const summaries: RuleExecutionSummary[] = []
  const errors: AuditError[] = []

  for (const rule of rules) {
    if (!rule.appliesTo(snapshot)) {
      summaries.push({ ruleId: rule.id, status: 'not-applicable', findingCount: 0 })
      continue
    }

    try {
      const result = rule.evaluate(snapshot)
      assertResultInvariants(rule, result)

      const ruleFindings = result.findings.map(
        (draft): Finding => ({
          ...draft,
          ruleId: rule.id,
          category: rule.category,
          status: result.status as FindingStatus,
          target: { url: snapshot.finalUrl },
          docsUrl: docsUrlFor(rule.docsSlug),
        }),
      )

      findings.push(...ruleFindings)
      summaries.push({
        ruleId: rule.id,
        status: result.status,
        findingCount: ruleFindings.length,
        ...(result.note !== undefined ? { note: result.note } : {}),
      })
    } catch (error) {
      const auditError: AuditError = {
        code: 'RULE_CRASH',
        message: error instanceof Error ? error.message : String(error),
        ruleId: rule.id,
      }
      errors.push(auditError)
      summaries.push({ ruleId: rule.id, status: 'error', findingCount: 0, error: auditError })
    }
  }

  const status = summaries.some((summary) => summary.status === 'error') ? 'partial' : 'completed'

  return {
    schemaVersion: SCHEMA_VERSION,
    audit: finished(),
    target: {
      requestedUrl: request.url,
      finalUrl: snapshot.finalUrl,
      httpStatus: snapshot.httpStatus,
      redirectChain: snapshot.redirectChain,
    },
    status,
    rules: summaries,
    findings,
    errors,
    environment: { pagescopeVersion: VERSION, node: process.versions.node },
    limitations: [...LIMITATIONS],
  }
}
```

- [ ] **Step 5: Export the engine**

`packages/core/src/index.ts` becomes:

```ts
export { VERSION } from './version.js'

export * from './contracts/types.js'
export { SCHEMA_VERSION, auditResultSchema } from './contracts/report-schema.js'
export { allRules, selectRules, UnknownRuleError } from './engine/registry.js'
export { audit, LIMITATIONS, type AuditRequest } from './engine/audit.js'
export { validateTarget, type FetchOptions, type FetchOutcome } from './collection/fetch.js'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/engine/audit.test.ts`
Expected: 10 tests passed.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add -A
git commit -m "feat(core): add rule registry and audit engine with per-rule error isolation"
```

---

### Task 11: Reporters — JSON, Markdown, HTML

**Files:**
- Create: `packages/core/src/reporters/escape.ts`, `json.ts`, `markdown.ts`, `html.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/reporters/reporters.test.ts`

**Interfaces:**
- Consumes: `AuditResult`, `auditResultSchema`, `SCHEMA_VERSION`.
- Produces: `escapeHtml(value)`, `sanitizeForTerminal(value)`, `toJsonReport(result)`, `toMarkdownReport(result)`, `toHtmlReport(result)`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/reporters/reporters.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, auditResultSchema } from '../../src/contracts/report-schema.js'
import { escapeHtml, sanitizeForTerminal } from '../../src/reporters/escape.js'
import { toHtmlReport } from '../../src/reporters/html.js'
import { toJsonReport } from '../../src/reporters/json.js'
import { toMarkdownReport } from '../../src/reporters/markdown.js'
import type { AuditResult } from '../../src/contracts/types.js'

const hostileTitle = '<script>alert(1)</script>'

const result: AuditResult = {
  schemaVersion: SCHEMA_VERSION,
  audit: {
    startedAt: '2026-11-02T10:00:00.000Z',
    finishedAt: '2026-11-02T10:00:02.000Z',
    durationMs: 2000,
  },
  target: {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    redirectChain: [],
  },
  status: 'partial',
  rules: [
    { ruleId: 'seo/title', status: 'failed', findingCount: 1 },
    { ruleId: 'a11y/html-lang', status: 'needs-review', findingCount: 1 },
    { ruleId: 'security/https', status: 'error', findingCount: 0 },
  ],
  findings: [
    {
      ruleId: 'seo/title',
      category: 'seo',
      status: 'failed',
      severity: 'high',
      confidence: 'high',
      title: `Title contains ${hostileTitle}`,
      description: 'Evidence contains <b>markup</b> that must be escaped.',
      target: { url: 'https://example.com/' },
      location: { line: 3, column: 5 },
      evidence: [
        {
          kind: 'html-snippet',
          snippet: `<title>${hostileTitle}</title>`,
          line: 3,
          column: 5,
          truncated: false,
        },
      ],
      recommendation: 'Escape untrusted content.',
      docsUrl: 'https://example.com/docs/rules/seo-title.md',
    },
    {
      ruleId: 'a11y/html-lang',
      category: 'accessibility',
      status: 'needs-review',
      severity: 'medium',
      confidence: 'low',
      title: 'Ambiguous language declaration',
      description: 'Needs a human decision.',
      target: { url: 'https://example.com/' },
      evidence: [{ kind: 'absence', expected: 'lang attribute', scope: 'checked <html>' }],
      recommendation: 'Confirm the language.',
      docsUrl: 'https://example.com/docs/rules/a11y-html-lang.md',
    },
  ],
  errors: [{ code: 'RULE_CRASH', message: 'boom', ruleId: 'security/https' }],
  environment: { pagescopeVersion: '0.0.0', node: process.versions.node },
  limitations: ['JavaScript is not executed.'],
}

describe('escapeHtml', () => {
  it('escapes every dangerous character', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })
})

describe('sanitizeForTerminal', () => {
  it('removes ANSI escapes, control characters and bidi overrides', () => {
    expect(sanitizeForTerminal('\u001b[31mred\u001b[0m\u0007\u202eabc')).toBe('redabc')
  })
})

describe('toJsonReport', () => {
  it('returns pretty printed JSON that satisfies the schema', () => {
    const json = toJsonReport(result)
    expect(json.endsWith('\n')).toBe(true)
    expect(() => auditResultSchema.parse(JSON.parse(json))).not.toThrow()
  })
})

describe('toMarkdownReport', () => {
  it('includes target, status, findings, errors and limitations', () => {
    const markdown = toMarkdownReport(result)
    expect(markdown).toContain('https://example.com/')
    expect(markdown).toContain('partial')
    expect(markdown).toContain('Title contains')
    expect(markdown).toContain('Ambiguous language declaration')
    expect(markdown).toContain('RULE_CRASH')
    expect(markdown).toContain('JavaScript is not executed.')
  })

  it('fences snippets so page markup cannot break the document', () => {
    expect(toMarkdownReport(result)).toContain('```html')
  })
})

describe('toHtmlReport', () => {
  it('never emits raw markup from the audited page', () => {
    const html = toHtmlReport(result)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<b>markup</b>')
  })

  it('is self contained and locks down resource loading', () => {
    const html = toHtmlReport(result)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
    expect(html).not.toContain('http://')
  })

  it('carries the same findings as the JSON report', () => {
    const parsed = JSON.parse(toJsonReport(result)) as AuditResult
    const html = toHtmlReport(result)
    for (const finding of parsed.findings) expect(html).toContain(escapeHtml(finding.title))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/test/reporters`
Expected: FAIL — cannot resolve `../../src/reporters/escape.js`.

- [ ] **Step 3: Write `escape.ts` and `json.ts`**

```ts
// packages/core/src/reporters/escape.ts
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

/** Strips ANSI escape sequences, C0/C1 control characters and bidi overrides. */
export function sanitizeForTerminal(value: string): string {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
}
```

```ts
// packages/core/src/reporters/json.ts
import { auditResultSchema } from '../contracts/report-schema.js'
import type { AuditResult } from '../contracts/types.js'

export function toJsonReport(result: AuditResult): string {
  const validated = auditResultSchema.parse(result)
  return `${JSON.stringify(validated, null, 2)}\n`
}
```

- [ ] **Step 4: Write `markdown.ts`**

```ts
import { sanitizeForTerminal } from './escape.js'
import type { AuditResult, Evidence, Finding } from '../contracts/types.js'

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const

function evidenceBlock(evidence: Evidence): string {
  switch (evidence.kind) {
    case 'html-snippet':
      return [
        `- Source at line ${evidence.line}, column ${evidence.column}${evidence.truncated ? ' (truncated)' : ''}:`,
        '',
        '```html',
        evidence.snippet.replace(/```/g, '`\u200b``'),
        '```',
      ].join('\n')
    case 'http-header':
      return `- Response header \`${evidence.name}\`: \`${evidence.value}\``
    case 'http-response':
      return `- Final response: HTTP ${evidence.status} at ${evidence.finalUrl}${
        evidence.redirectChain.length > 0 ? ` after ${evidence.redirectChain.length} redirect(s)` : ''
      }`
    case 'measurement':
      return `- ${evidence.label}: ${String(evidence.value)}${evidence.unit ? ` ${evidence.unit}` : ''}`
    case 'absence':
      return `- Not found: ${evidence.expected} (${evidence.scope})`
  }
}

function findingBlock(finding: Finding): string {
  const lines = [
    `### ${finding.severity.toUpperCase()} — ${sanitizeForTerminal(finding.title)}`,
    '',
    `- Rule: \`${finding.ruleId}\` (${finding.category})`,
    `- Status: ${finding.status}`,
    `- Confidence: ${finding.confidence}`,
    `- Docs: ${finding.docsUrl}`,
    '',
    sanitizeForTerminal(finding.description),
    '',
    '**Evidence**',
    '',
    ...finding.evidence.map(evidenceBlock),
    '',
    `**Recommendation:** ${sanitizeForTerminal(finding.recommendation)}`,
  ]

  if (finding.patch) {
    lines.push(
      '',
      `**Suggested change** (${finding.patch.exact ? 'exact' : 'template'}, ${finding.patch.target}):`,
      '',
      '```diff',
      finding.patch.before ? `- ${finding.patch.before}` : '',
      `+ ${finding.patch.after}`,
      '```',
    )
  }

  return lines.filter((line) => line !== undefined).join('\n')
}

export function toMarkdownReport(result: AuditResult): string {
  const counts = new Map<string, number>()
  for (const finding of result.findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1)
  }

  const lines: string[] = [
    '# PageScope report',
    '',
    `- Target: ${result.target.requestedUrl}`,
    `- Final URL: ${result.target.finalUrl ?? 'not resolved'}`,
    `- Audited at: ${result.audit.startedAt}`,
    `- Status: ${result.status}`,
    `- Schema version: ${result.schemaVersion}`,
    `- PageScope version: ${result.environment.pagescopeVersion}`,
    '',
    '## Summary',
    '',
    `Findings: ${result.findings.length}`,
    '',
    ...SEVERITY_ORDER.filter((severity) => counts.has(severity)).map(
      (severity) => `- ${severity}: ${counts.get(severity)}`,
    ),
    '',
    '## Rules',
    '',
    '| Rule | Status | Findings |',
    '| --- | --- | --- |',
    ...result.rules.map((rule) => `| \`${rule.ruleId}\` | ${rule.status} | ${rule.findingCount} |`),
    '',
  ]

  if (result.errors.length > 0) {
    lines.push('## Execution errors', '')
    for (const error of result.errors) {
      lines.push(`- ${error.code}: ${sanitizeForTerminal(error.message)}${error.ruleId ? ` (rule \`${error.ruleId}\`)` : ''}`)
    }
    lines.push('')
  }

  if (result.findings.length > 0) {
    lines.push('## Findings', '')
    const ordered = [...result.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    )
    for (const finding of ordered) {
      lines.push(findingBlock(finding), '')
    }
  }

  lines.push('## Limitations', '')
  for (const limitation of result.limitations) lines.push(`- ${limitation}`)
  lines.push('')

  return lines.join('\n')
}
```

- [ ] **Step 5: Write `html.ts`**

```ts
import { escapeHtml, sanitizeForTerminal } from './escape.js'
import type { AuditResult, Evidence } from '../contracts/types.js'

const STYLES = `
:root { color-scheme: light dark; }
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: 2rem 1rem; line-height: 1.5; }
h1 { font-size: 1.5rem; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid currentColor; }
code, pre { font-family: ui-monospace, monospace; }
pre { overflow-x: auto; padding: .75rem; border: 1px solid currentColor; }
.sev-critical, .sev-high { font-weight: 700; }
footer { margin-top: 3rem; font-size: .875rem; opacity: .8; }
`

function evidenceHtml(evidence: Evidence): string {
  switch (evidence.kind) {
    case 'html-snippet':
      return `<p>Source at line ${evidence.line}, column ${evidence.column}${
        evidence.truncated ? ' (truncated)' : ''
      }</p><pre><code>${escapeHtml(evidence.snippet)}</code></pre>`
    case 'http-header':
      return `<p>Response header <code>${escapeHtml(evidence.name)}</code>: <code>${escapeHtml(
        evidence.value,
      )}</code></p>`
    case 'http-response':
      return `<p>Final response: HTTP ${evidence.status} at <code>${escapeHtml(
        evidence.finalUrl,
      )}</code>${
        evidence.redirectChain.length > 0
          ? ` after ${evidence.redirectChain.length} redirect(s)`
          : ''
      }</p>`
    case 'measurement':
      return `<p>${escapeHtml(evidence.label)}: <strong>${escapeHtml(
        String(evidence.value),
      )}</strong>${evidence.unit ? ` ${escapeHtml(evidence.unit)}` : ''}</p>`
    case 'absence':
      return `<p>Not found: <code>${escapeHtml(evidence.expected)}</code> (${escapeHtml(
        evidence.scope,
      )})</p>`
  }
}

export function toHtmlReport(result: AuditResult): string {
  const findings = result.findings
    .map(
      (finding) => `<article>
  <h3 class="sev-${finding.severity}">${escapeHtml(finding.severity.toUpperCase())} — ${escapeHtml(
        finding.title,
      )}</h3>
  <p><code>${escapeHtml(finding.ruleId)}</code> · ${escapeHtml(finding.category)} · status ${escapeHtml(
        finding.status,
      )} · confidence ${escapeHtml(finding.confidence)}</p>
  <p>${escapeHtml(finding.description)}</p>
  <h4>Evidence</h4>
  ${finding.evidence.map(evidenceHtml).join('\n  ')}
  <h4>Recommendation</h4>
  <p>${escapeHtml(finding.recommendation)}</p>
  ${
    finding.patch
      ? `<h4>Suggested change (${finding.patch.exact ? 'exact' : 'template'})</h4>
  <pre><code>${escapeHtml(finding.patch.after)}</code></pre>`
      : ''
  }
  <p><a href="${escapeHtml(finding.docsUrl)}">Rule documentation</a></p>
</article>`,
    )
    .join('\n')

  const rules = result.rules
    .map(
      (rule) =>
        `<tr><td><code>${escapeHtml(rule.ruleId)}</code></td><td>${escapeHtml(rule.status)}</td><td>${
          rule.findingCount
        }</td></tr>`,
    )
    .join('')

  const errors =
    result.errors.length === 0
      ? ''
      : `<h2>Execution errors</h2><ul>${result.errors
          .map(
            (error) =>
              `<li><code>${escapeHtml(error.code)}</code>: ${escapeHtml(error.message)}</li>`,
          )
          .join('')}</ul>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>PageScope report for ${escapeHtml(result.target.requestedUrl)}</title>
<style>${STYLES}</style>
</head>
<body>
<h1>PageScope report</h1>
<p>Target: <code>${escapeHtml(result.target.requestedUrl)}</code></p>
<p>Final URL: <code>${escapeHtml(result.target.finalUrl ?? 'not resolved')}</code></p>
<p>Audited at ${escapeHtml(result.audit.startedAt)} · status <strong>${escapeHtml(
    result.status,
  )}</strong> · schema ${escapeHtml(result.schemaVersion)}</p>
<h2>Rules</h2>
<table><thead><tr><th>Rule</th><th>Status</th><th>Findings</th></tr></thead><tbody>${rules}</tbody></table>
${errors}
<h2>Findings (${result.findings.length})</h2>
${findings || '<p>No findings.</p>'}
<footer>
<h2>Limitations</h2>
<ul>${result.limitations.map((item) => `<li>${sanitizeForTerminal(escapeHtml(item))}</li>`).join('')}</ul>
</footer>
</body>
</html>
`
}
```

- [ ] **Step 6: Export the reporters**

Add to `packages/core/src/index.ts`:

```ts
export { escapeHtml, sanitizeForTerminal } from './reporters/escape.js'
export { toJsonReport } from './reporters/json.js'
export { toMarkdownReport } from './reporters/markdown.js'
export { toHtmlReport } from './reporters/html.js'
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run packages/core/test/reporters`
Expected: 10 tests passed. The HTML injection tests are the ones that matter — if `not.toContain('<script>alert(1)</script>')` fails, an unescaped value reached the template; find it rather than loosen the assertion.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck`
Expected: exit 0.

```bash
git add -A
git commit -m "feat(core): add JSON, Markdown and HTML reporters with output escaping"
```

---

### Task 12: CLI

**Files:**
- Create: `packages/cli/src/config.ts`, `packages/cli/src/output.ts`, `packages/cli/src/run.ts`, `packages/cli/src/cli.ts`
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `@pagescope/core` barrel (`audit`, `validateTarget`, `UnknownRuleError`, `VERSION`, reporters).
- Produces: `run(argv, deps?): Promise<number>`, `EXIT` constants `{ OK: 0, POLICY: 1, USAGE: 2, UNAUDITABLE: 3 }`.

**Design note on testing exit 0 and exit 1:** the connect-time guard blocks `127.0.0.1`, so a fixture server cannot be audited through the CLI. Rather than punch a hole in the guard for convenience, `run()` accepts an injected `auditFn`; the success and policy paths are tested through that seam, and the spawned-binary tests cover the usage and un-auditable paths. A full end-to-end run against a public site stays a manual, networked check and is not part of CI.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/cli.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { AuditResult } from '@pagescope/core'
import { SCHEMA_VERSION } from '@pagescope/core'
import { EXIT, run } from '../src/run.js'

const execFileAsync = promisify(execFile)
const cliPath = join(process.cwd(), 'packages/cli/dist/cli.js')

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
      env: { ...process.env, NO_COLOR: '1' },
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const baseResult = (overrides: Partial<AuditResult> = {}): AuditResult => ({
  schemaVersion: SCHEMA_VERSION,
  audit: {
    startedAt: '2026-11-02T10:00:00.000Z',
    finishedAt: '2026-11-02T10:00:01.000Z',
    durationMs: 1000,
  },
  target: {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    redirectChain: [],
  },
  status: 'completed',
  rules: [{ ruleId: 'seo/title', status: 'passed', findingCount: 0 }],
  findings: [],
  errors: [],
  environment: { pagescopeVersion: '0.0.0', node: process.versions.node },
  limitations: ['JavaScript is not executed.'],
  ...overrides,
})

const captured: string[] = []
const sink = {
  write: (text: string) => captured.push(text),
  error: (text: string) => captured.push(`ERR:${text}`),
}

const highFinding = {
  ruleId: 'seo/title',
  category: 'seo' as const,
  status: 'failed' as const,
  severity: 'high' as const,
  confidence: 'high' as const,
  title: 'Missing <title> element',
  description: 'no title',
  target: { url: 'https://example.com/' },
  evidence: [
    { kind: 'absence' as const, expected: '<title>', scope: 'scanned <head>' },
  ],
  recommendation: 'add one',
  docsUrl: 'https://example.com/docs/rules/seo-title.md',
}

describe('pagescope CLI (spawned binary)', () => {
  it('exits 2 for a malformed URL', async () => {
    const { code, stderr } = await runCli(['not-a-url'])
    expect(code).toBe(2)
    expect(stderr).toContain('INVALID_URL')
  })

  it('exits 2 for an unsupported protocol', async () => {
    const { code, stderr } = await runCli(['ftp://example.com/'])
    expect(code).toBe(2)
    expect(stderr).toContain('UNSUPPORTED_PROTOCOL')
  })

  it('exits 2 for an unknown rule id', async () => {
    const { code, stderr } = await runCli(['https://example.com/', '--rules', 'seo/nope'])
    expect(code).toBe(2)
    expect(stderr).toContain('Unknown rule id')
  })

  it('exits 3 when the target is not auditable', async () => {
    const { code, stderr } = await runCli(['http://127.0.0.1:9/'])
    expect(code).toBe(3)
    expect(stderr).toContain('BLOCKED_ADDRESS')
  })

  it('exits 0 for --help', async () => {
    const { code, stdout } = await runCli(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('Usage: pagescope')
  })
})

describe('run() with an injected audit', () => {
  it('returns 0 when the policy passes', async () => {
    const code = await run(['https://example.com/', '--fail-on', 'high'], {
      auditFn: async () => baseResult(),
      out: sink,
    })
    expect(code).toBe(EXIT.OK)
  })

  it('returns 1 when a finding meets the threshold', async () => {
    const code = await run(['https://example.com/', '--fail-on', 'high'], {
      auditFn: async () => baseResult({ findings: [highFinding] }),
      out: sink,
    })
    expect(code).toBe(EXIT.POLICY)
  })

  it('returns 3 when the audit itself failed', async () => {
    const code = await run(['https://example.com/'], {
      auditFn: async () => baseResult({ status: 'failed' }),
      out: sink,
    })
    expect(code).toBe(EXIT.UNAUDITABLE)
  })

  it('writes the requested report file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pagescope-'))
    try {
      const target = join(dir, 'report.json')
      const code = await run(['https://example.com/', '--format', 'json', '--out', target], {
        auditFn: async () => baseResult(),
        out: sink,
      })
      expect(code).toBe(EXIT.OK)
      const written = JSON.parse(await readFile(target, 'utf8')) as AuditResult
      expect(written.schemaVersion).toBe(SCHEMA_VERSION)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter pagescope build` then `pnpm vitest run packages/cli/test`
Expected: FAIL — cannot resolve `../src/run.js`.

- [ ] **Step 3: Write `config.ts` and `output.ts`**

```ts
// packages/cli/src/config.ts
import { readFile } from 'node:fs/promises'
import { z } from 'zod'

export const configSchema = z
  .object({
    failOn: z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']).optional(),
    format: z.enum(['summary', 'json', 'markdown', 'html', 'all']).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    rules: z.array(z.string().min(1)).optional(),
    excludeRules: z.array(z.string().min(1)).optional(),
  })
  .strict()

export type PageScopeConfig = z.infer<typeof configSchema>

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export async function loadConfig(path: string | undefined): Promise<PageScopeConfig> {
  if (!path) return {}
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new ConfigError(`Cannot read config file ${path}: ${String(error)}`)
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new ConfigError(`Config file ${path} is not valid JSON`)
  }
  const parsed = configSchema.safeParse(json)
  if (!parsed.success) {
    throw new ConfigError(`Config file ${path} is invalid: ${parsed.error.message}`)
  }
  return parsed.data
}
```

```ts
// packages/cli/src/output.ts
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { sanitizeForTerminal } from '@pagescope/core'
import type { AuditResult } from '@pagescope/core'

export interface OutputSink {
  write(text: string): void
  error(text: string): void
}

export const consoleSink: OutputSink = {
  write: (text) => process.stdout.write(text),
  error: (text) => process.stderr.write(text),
}

/** Writes a report file. The path always comes from --out, never from the audited URL. */
export async function writeReportFile(path: string, content: string): Promise<void> {
  const target = resolve(path)
  const existing = await stat(target).catch(() => undefined)
  if (existing?.isDirectory()) {
    throw new Error(`Refusing to write a report over the directory ${target}`)
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

const STATUS_GLYPH: Record<string, string> = {
  passed: '[ok]  ',
  failed: '[fail]',
  'needs-review': '[?]   ',
  'not-applicable': '[-]   ',
  error: '[err] ',
}

export function renderSummary(result: AuditResult): string {
  const lines = [
    `PageScope — ${sanitizeForTerminal(result.target.requestedUrl)}`,
    `status: ${result.status} | findings: ${result.findings.length} | ${result.audit.durationMs}ms`,
    '',
  ]

  for (const rule of result.rules) {
    const glyph = STATUS_GLYPH[rule.status] ?? '[?]   '
    const note = rule.note ? ` — ${sanitizeForTerminal(rule.note)}` : ''
    lines.push(`${glyph} ${rule.ruleId}${note}`)
  }

  if (result.findings.length > 0) {
    lines.push('', 'Findings:')
    for (const finding of result.findings) {
      lines.push(
        `  ${finding.severity.padEnd(8)} ${sanitizeForTerminal(finding.title)} (${finding.ruleId})`,
      )
      if (finding.location) {
        lines.push(`           at line ${finding.location.line}, column ${finding.location.column}`)
      }
    }
  }

  if (result.errors.length > 0) {
    lines.push('', 'Errors:')
    for (const error of result.errors) {
      lines.push(`  ${error.code}${error.ruleId ? ` (${error.ruleId})` : ''}: ${sanitizeForTerminal(error.message)}`)
    }
  }

  lines.push('', 'Limitations:')
  for (const limitation of result.limitations) lines.push(`  - ${limitation}`)
  lines.push('')

  return lines.join('\n')
}
```

- [ ] **Step 4: Write `run.ts` (part 1 — argument parsing and option resolution)**

```ts
// packages/cli/src/run.ts
import { Command, CommanderError } from 'commander'
import {
  UnknownRuleError,
  VERSION,
  audit,
  toHtmlReport,
  toJsonReport,
  toMarkdownReport,
  validateTarget,
} from '@pagescope/core'
import type { AuditResult } from '@pagescope/core'
import { ConfigError, loadConfig } from './config.js'
import { consoleSink, renderSummary, writeReportFile, type OutputSink } from './output.js'

export const EXIT = { OK: 0, POLICY: 1, USAGE: 2, UNAUDITABLE: 3 } as const

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const
type Severity = keyof typeof SEVERITY_RANK
type FailOn = Severity | 'none'
type Format = 'summary' | 'json' | 'markdown' | 'html' | 'all'

export interface CliDeps {
  auditFn?: typeof audit
  out?: OutputSink
}

const parseIds = (value: string | undefined): string[] | undefined => {
  if (!value) return undefined
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
  return ids.length > 0 ? ids : undefined
}

export async function run(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.out ?? consoleSink
  const auditFn = deps.auditFn ?? audit

  const program = new Command()
  program
    .name('pagescope')
    .description('Audit the technical and SEO quality of a single page. No browser required.')
    .version(VERSION)
    .exitOverride()
    .argument('<url>', 'absolute http(s) URL to audit')
    .option('--format <format>', 'summary | json | markdown | html | all', 'summary')
    .option('--out <path>', 'write the report to this path instead of stdout')
    .option('--fail-on <severity>', 'critical | high | medium | low | info | none', 'none')
    .option('--rules <ids>', 'comma separated rule ids to run')
    .option('--exclude-rules <ids>', 'comma separated rule ids to skip')
    .option('--config <path>', 'path to a pagescope.config.json file')
    .option('--timeout <ms>', 'request timeout in milliseconds', '10000')
    .option('--verbose', 'print extra diagnostics to stderr', false)
    .option('--no-color', 'disable colour in terminal output')

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return EXIT.OK
      }
      out.error(`${error.message}\n`)
      return EXIT.USAGE
    }
    throw error
  }

  const url = program.processedArgs[0] as string
  const options = program.opts<{
    format: Format
    out?: string
    failOn: FailOn
    rules?: string
    excludeRules?: string
    config?: string
    timeout: string
  }>()

  const validation = validateTarget(url)
  if (!validation.ok) {
    out.error(`${validation.error.code}: ${validation.error.message}\n`)
    return EXIT.USAGE
  }

  let config
  try {
    config = await loadConfig(options.config)
  } catch (error) {
    if (error instanceof ConfigError) {
      out.error(`${error.message}\n`)
      return EXIT.USAGE
    }
    throw error
  }

  const fromCli = (name: string): boolean => program.getOptionValueSource(name) === 'cli'
  const format = fromCli('format') ? options.format : (config.format ?? options.format)
  const failOn: FailOn = fromCli('failOn') ? options.failOn : (config.failOn ?? options.failOn)
  const timeoutMs = fromCli('timeout')
    ? Number(options.timeout)
    : (config.timeoutMs ?? Number(options.timeout))
  const rules = parseIds(options.rules) ?? config.rules
  const excludeRules = parseIds(options.excludeRules) ?? config.excludeRules

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    out.error('--timeout must be a positive number of milliseconds\n')
    return EXIT.USAGE
  }

  if (format === 'all' && !options.out) {
    out.error('--format all requires --out\n')
    return EXIT.USAGE
  }
```

- [ ] **Step 5: Append part 2 of `run.ts`, then write `cli.ts`**

```ts
  let result: AuditResult
  try {
    result = await auditFn({
      url,
      timeoutMs,
      ...(rules ? { rules } : {}),
      ...(excludeRules ? { excludeRules } : {}),
    })
  } catch (error) {
    if (error instanceof UnknownRuleError) {
      out.error(`${error.message}\n`)
      return EXIT.USAGE
    }
    out.error(`Audit failed: ${error instanceof Error ? error.message : String(error)}\n`)
    return EXIT.UNAUDITABLE
  }

  if (result.status === 'failed') {
    const first = result.errors[0]
    out.error(
      `Audit could not be completed: ${first ? `${first.code} — ${first.message}` : 'unknown error'}\n`,
    )
    return EXIT.UNAUDITABLE
  }

  if (result.status === 'partial') {
    out.error('Warning: partial audit — some rules did not run. See the report for details.\n')
  }

  if (format === 'summary') {
    out.write(renderSummary(result))
  } else if (options.out) {
    const base = options.out
    if (format === 'all') {
      await writeReportFile(`${base}.json`, toJsonReport(result))
      await writeReportFile(`${base}.md`, toMarkdownReport(result))
      await writeReportFile(`${base}.html`, toHtmlReport(result))
      out.error(`Wrote ${base}.json, ${base}.md and ${base}.html\n`)
    } else {
      const content =
        format === 'json'
          ? toJsonReport(result)
          : format === 'markdown'
            ? toMarkdownReport(result)
            : toHtmlReport(result)
      await writeReportFile(base, content)
      out.error(`Wrote ${base}\n`)
    }
  } else {
    out.write(
      format === 'json'
        ? toJsonReport(result)
        : format === 'markdown'
          ? toMarkdownReport(result)
          : toHtmlReport(result),
    )
  }

  const policyFailed =
    failOn !== 'none' &&
    result.findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn])

  return policyFailed ? EXIT.POLICY : EXIT.OK
}
```

```ts
// packages/cli/src/cli.ts
import { run } from './run.js'

process.exitCode = await run(process.argv.slice(2))
```

- [ ] **Step 6: Declare the CLI's own dependency on zod**

Run: `pnpm --filter pagescope add zod@4.6.7`
Expected: `packages/cli/package.json` lists `zod` under `dependencies`.

- [ ] **Step 7: Build and run the CLI tests**

Run: `pnpm --filter pagescope build` then `pnpm vitest run packages/cli/test`
Expected: 9 tests passed.

- [ ] **Step 8: Manual smoke check against a real site (network required)**

Run: `node packages/cli/dist/cli.js https://example.com`
Expected: a summary listing 13 rules and exit code 0. If this machine has no network access, record that the step was not verified rather than claiming it passed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(cli): implement audit command with documented exit codes"
```

---

### Task 13: Fixtures, documentation, CI and release hygiene

**Files:**
- Create: `packages/core/fixtures/index.html`, `packages/core/fixtures/clean.html`
- Create: `docs/rules/*.md` (13 files), `docs/architecture.md`, `docs/security/threat-model.md`, `docs/contributing/adding-a-rule.md`
- Create: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`
- Create: `.github/workflows/ci.yml`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `examples/github-actions/audit.yml`, `examples/github-actions/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the artefacts a stranger needs to clone, run, test and contribute.

- [ ] **Step 1: Create the two fixtures**

`packages/core/fixtures/index.html` must deliberately contain: no `<title>`, no meta description, a canonical with a relative href, a `noindex` robots meta, one `<img>` without `alt`, two elements sharing `id="dup"`, headings `<h1>` then `<h3>`, and no viewport meta.

`packages/core/fixtures/clean.html` must produce zero findings: `<title>`, meta description, absolute canonical, `index, follow`, all four `og:` properties, a single `<h1>` followed by `<h2>`, viewport meta, every `<img>` with `alt`, unique ids, `<html lang="en">`.

`README.md` must state that these fixtures are synthetic and that every sample report or screenshot comes from them.

- [ ] **Step 2: Write the 13 rule documents**

One file per rule in `docs/rules/`, named after the rule's `docsSlug` (`seo-title.md`, `seo-meta-description.md`, `seo-canonical.md`, `seo-robots-meta.md`, `seo-open-graph.md`, `seo-heading-structure.md`, `technical-duplicate-id.md`, `technical-meta-viewport.md`, `technical-http-status.md`, `a11y-img-alt.md`, `a11y-html-lang.md`, `security-https.md`, `security-headers.md`).

Each document contains exactly these sections:

1. `# <rule id>` plus its severity.
2. `## What this rule checks` — one or two sentences matching `description` in the code.
3. `## What this rule does not check` — the limitation from the spec table.
4. `## Statuses` — when it returns `passed`, `failed`, `needs-review`, `not-applicable`, `error`.
5. `## Evidence` — which evidence kinds it emits.
6. `## Recommendation` — the remediation text with a copy-pasteable example.
7. `## References` — a link to the relevant standard (HTML spec, HTTP RFC, MDN) when one exists.

`security-headers.md` must state, in its own words: *the presence of a header does not prove a secure configuration, and its absence does not prove a page is exploitable.* A test in Task 9 asserts this wording does not drift.

- [ ] **Step 3: Write the architecture and threat-model docs**

`docs/architecture.md`: the two-package boundary, why rules never touch the network, the collection→evaluate split, the five-status table, and the four exit codes.

`docs/security/threat-model.md`: one subsection per threat — SSRF, DNS rebinding, redirect SSRF, resource exhaustion, malicious HTML, terminal injection, path confusion — each with `Threat / Control / Where it is enforced / Test that proves it`. Every control names a real file and a real test.

- [ ] **Step 4: Write README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, LICENSE**

`README.md` sections, in this order: name and one-line pitch; the three differentiators (no browser, snippet + patch, library/CLI/CI); install and quick start (`npx pagescope audit https://example.com`); what it checks (the 13-rule table with severities); example output from `packages/core/fixtures/index.html`, labelled as fixture data; the exit-code table; a GitHub Actions snippet; library usage; architecture pointer; security model pointer; **Known limitations** (no JavaScript execution, single page, no WCAG or exploitability claims, no crawl, no hosted service); roadmap (baseline mode, broken-link check, browser adapter, dashboard, hosting — all marked *planned*); development commands; contributing pointer; MIT licence.

`CONTRIBUTING.md`: prerequisites (Node 22, pnpm), the command list, then the "Adding a rule" recipe as an ordered list — (1) add the rule to the right module in `packages/core/src/rules/`, (2) give it a `docsSlug` and write `docs/rules/<slug>.md`, (3) add it to the module's exported array, (4) write the test in `packages/core/test/rules/`, (5) run `pnpm verify`.

`SECURITY.md`: how to report (GitHub private vulnerability reporting on this repository — do not invent an email address), supported versions, and the self-hosting responsibility statement from spec §8.8.

`CODE_OF_CONDUCT.md`: Contributor Covenant v2.1 with attribution.

`LICENSE`: MIT, copyright "2026 Alfian Purwanto".

- [ ] **Step 5: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm build
      - run: npm pack --dry-run --workspace @pagescope/core
      - run: npm pack --dry-run --workspace pagescope
```

- [ ] **Step 6: Write the example workflow**

`examples/github-actions/audit.yml` — a complete workflow triggered by `workflow_dispatch` with a `url` input: `actions/setup-node@v4` (Node 22), a step running `npx pagescope@latest audit "${{ inputs.url }}" --format markdown --out pagescope-report.md --fail-on high`, and `actions/upload-artifact@v4` with `if: always()`.

`examples/github-actions/README.md` must state plainly that this is an example workflow and not a published Marketplace Action, and that publishing one requires releasing the npm package first.

- [ ] **Step 7: Run the full verification suite**

Run: `pnpm verify`
Expected: typecheck, lint, format check, tests and build all pass. Then run `git status --porcelain` and confirm that no `dist/`, `node_modules/` or secret-like file is staged.

- [ ] **Step 8: Commit and tag**

```bash
git add -A
git commit -m "docs: add README, rule docs, threat model, CI and example workflow"
git tag v0.1.0
```

Do not push and do not publish. Releasing to npm is a separate, deliberate action.

---

## Self-Review

**Spec coverage.** §3 scope → Tasks 1–13. §4 tech decisions → Task 1 manifests pin every version. §6 contracts → Task 2. §7 rules → Tasks 6–9, with docs in Task 13. §8 security → Tasks 4, 5, 11 (output escaping) and 12 (path handling); the ten-case table maps to Task 4 Step 1 and Task 5 Step 4. §9 CLI → Task 12. §10 reporters → Task 11. §11 GitHub Actions → Task 13. §12 testing → every task; no test touches the internet. §13 CI → Task 13 Step 5. §14 docs → Task 13. §17 acceptance criteria → verifiable through the steps above.

**Deliberate gaps, stated rather than hidden.** There is no automated end-to-end CLI success test; Task 12 explains why and substitutes an injected-audit test. There is no hosted deployment task, by design. There is no coverage threshold, because a coverage number is not evidence of meaningful assertions.

**Type consistency.** `AuditSnapshot`, `FetchOutcome`, `RuleDefinition`, `Finding`, `AuditResult` are introduced in Task 2 and used unchanged afterwards. `selectRules`, `audit`, `validateTarget`, `createGuardedLookup`, `snapshotOf`, `page`, `elementEvidence`, `locationProps`, `findMeta`, `headScope`, `docsUrlFor`, `escapeHtml`, `sanitizeForTerminal`, `toJsonReport`, `toMarkdownReport`, `toHtmlReport`, `renderSummary`, `writeReportFile`, `loadConfig` and `EXIT` are each defined once and referenced with the same names later.

**Known ordering constraint.** `NETWORK_ERROR` is added to the error union in Task 5 Step 2, after the schema test written in Task 2. Re-running Task 2's test after Task 5 must still pass — the addition widens the enum without renaming anything.