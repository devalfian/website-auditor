# Adding a rule

This walkthrough adds a rule end to end. The example rule checks that the document declares a character encoding. Everything here is real code you can copy and adapt.

## 0. Decide what the rule does and does not check

Before writing code, write those two sentences down. If you cannot describe what the rule does **not** check, the rule is too vague and will produce findings nobody trusts.

Example:

- **Checks:** a `<meta charset>` element exists in `<head>`.
- **Does not check:** whether the declared encoding matches the bytes actually served.

## 1. Write the rule

Add it to the module for its category — `packages/core/src/rules/technical.ts` in this case.

```ts
export const metaCharsetRule: RuleDefinition = {
  id: 'technical/meta-charset',
  category: 'technical',
  title: 'Document declares a character encoding',
  description: 'Checks for a <meta charset> element inside <head>.',
  docsSlug: 'technical-meta-charset',
  observation: 'served-html',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const head = getHead(snapshot.document)
    const found = head
      ? findAll(head, (el) => el.tagName === 'meta' && getAttr(el, 'charset') !== undefined)[0]
      : undefined

    if (found) {
      return { status: 'passed', findings: [], note: `charset: ${getAttr(found, 'charset')}` }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'medium',
          confidence: 'high',
          title: 'Missing <meta charset>',
          description:
            'No <meta charset> element was found inside <head>. PageScope does not verify that a declared encoding matches the served bytes.',
          evidence: [
            {
              kind: 'absence',
              expected: '<meta charset> inside <head>',
              scope: headScope(snapshot),
            },
          ],
          recommendation: 'Add <meta charset="utf-8"> as the first element inside <head>.',
          patch: {
            kind: 'insert',
            target: 'html',
            after: '<meta charset="utf-8">',
            exact: true,
          },
        },
      ],
    }
  },
}
```

Rules are pure and synchronous. They receive an `AuditSnapshot` and must not fetch, read files, or consult global state.

## 2. Register it

Add the rule to the module's exported array at the bottom of the same file:

```ts
export const technicalRules: RuleDefinition[] = [
  duplicateIdRule,
  metaViewportRule,
  httpStatusRule,
  metaCharsetRule,
]
```

The registry in `packages/core/src/engine/registry.ts` picks it up automatically — no other file changes.

## 3. Write the test

Create `packages/core/test/rules/technical-meta-charset.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { metaCharsetRule } from '../../src/rules/technical.js'
import { page, snapshotOf } from './helpers.js'

describe('technical/meta-charset', () => {
  it('passes when a charset is declared', () => {
    const result = metaCharsetRule.evaluate(snapshotOf(page('<meta charset="utf-8">')))
    expect(result.status).toBe('passed')
  })

  it('fails with absence evidence when the charset is missing', () => {
    const result = metaCharsetRule.evaluate(snapshotOf(page('')))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.evidence[0]?.kind).toBe('absence')
  })
})
```

Cover at minimum: the passing case, each failing case, and the ambiguous case if the rule has one. Use `page()` and `snapshotOf()` from `test/rules/helpers.ts` — they build a snapshot from an HTML string with no network access.

## 4. Update the rule count

`packages/core/test/engine/audit.test.ts` asserts that 13 rules are registered. Bump it to 14 and re-run. This is deliberate friction: it makes a public-surface change visible in review.

## 5. Document it

Create `docs/rules/technical-meta-charset.md` with these sections, in this order:

```markdown
# technical/meta-charset

Severity: medium

## What this rule checks

## What this rule does not check

## Statuses

## Evidence

## Recommendation

## References
```

The `docsSlug` in the rule definition must match the file name without `.md`. A test in `packages/core/test/reporters/reporters.test.ts` asserts that findings carry a `docsUrl` containing `/docs/rules/`, so a missing document produces a dead link in every report.

## 6. Verify

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

All four must pass. Tests must not require network access.

## Checklist

- [ ] Rule has a stable, namespaced `id`
- [ ] `docsSlug` matches a real file in `docs/rules/`
- [ ] Test covers passing, failing and (if applicable) ambiguous cases
- [ ] No network access in the rule or its test
- [ ] `description` states what the rule does not check
- [ ] Rule count in `test/engine/audit.test.ts` updated
- [ ] `observation` is declared, and choosing `'rendered-dom'` comes with one sentence in
      the rule description explaining why

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
