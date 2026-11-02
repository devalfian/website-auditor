import { describe, expect, it } from 'vitest'
import type { FetchOutcome } from '../../src/collection/fetch.js'
import { audit } from '../../src/engine/audit.js'
import {
  BaselineError,
  applyBaseline,
  createBaseline,
  parseBaseline,
  type BaselineFile,
} from '../../src/engine/baseline.js'
import { fingerprintOf } from '../../src/engine/fingerprint.js'
import type { AuditResult } from '../../src/contracts/types.js'
import { page, snapshotOf } from '../rules/helpers.js'

const auditHtml = async (html: string, baseline?: BaselineFile): Promise<AuditResult> => {
  const snapshot = snapshotOf(html)
  return audit({
    url: 'https://example.com/',
    ...(baseline ? { baseline } : {}),
    fetcher: async (): Promise<FetchOutcome> => ({ ok: true, snapshot }),
  })
}

const WITH_TITLE = page('<title>Page</title>', '<p id="dup">a</p><p id="dup">b</p>')
const WITHOUT_TITLE = page('', '<p id="dup">a</p><p id="dup">b</p>')
const DUPLICATE_FIXED = page('<title>Page</title>', '<p id="dup">a</p><p id="other">b</p>')

const findingFor = (result: AuditResult, ruleId: string) =>
  result.findings.find((finding) => finding.ruleId === ruleId)

describe('fingerprintOf', () => {
  it('is deterministic and separates rules and discriminators', () => {
    expect(fingerprintOf('seo/title')).toBe(fingerprintOf('seo/title'))
    expect(fingerprintOf('seo/title')).not.toBe(fingerprintOf('seo/canonical'))
    expect(fingerprintOf('technical/duplicate-id', 'a')).not.toBe(
      fingerprintOf('technical/duplicate-id', 'b'),
    )
    expect(fingerprintOf('seo/title')).toHaveLength(16)
  })
})

describe('fingerprint stability', () => {
  it('survives content shifting above the finding', async () => {
    const multiLine = (filler: string): string => `<!doctype html>
<html lang="en">
<head><title>Page</title></head>
<body>
${filler}<p id="dup">a</p>
<p id="dup">b</p>
</body>
</html>`

    const before = await auditHtml(multiLine(''))
    const shifted = await auditHtml(multiLine('<p>unrelated filler</p>\n<p>more filler</p>\n'))

    const first = findingFor(before, 'technical/duplicate-id')!
    const second = findingFor(shifted, 'technical/duplicate-id')!

    // The line moved...
    expect(second.location?.line).not.toBe(first.location?.line)
    // ...but the identity did not, which is the whole point of the design.
    expect(second.fingerprint).toBe(first.fingerprint)
  })

  it('gives distinct identities to distinct duplicated ids', async () => {
    const result = await auditHtml(
      page('', '<p id="one">a</p><p id="one">b</p><p id="two">c</p><p id="two">d</p>'),
    )
    const ids = result.findings
      .filter((finding) => finding.ruleId === 'technical/duplicate-id')
      .map((finding) => finding.fingerprint)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('createBaseline', () => {
  it('records one sorted entry per finding', async () => {
    const result = await auditHtml(WITH_TITLE)
    const baseline = createBaseline(result, new Date('2026-11-02T00:00:00.000Z'))
    expect(baseline.version).toBe(1)
    expect(baseline.target).toBe('https://example.com/')
    expect(baseline.generatedAt).toBe('2026-11-02T00:00:00.000Z')
    expect(baseline.entries).toHaveLength(result.findings.length)
    const fingerprints = baseline.entries.map((entry) => entry.fingerprint)
    expect([...fingerprints].sort()).toEqual(fingerprints)
  })
})

describe('parseBaseline', () => {
  it('rejects a wrong version and malformed entries', () => {
    expect(() => parseBaseline({ version: 2, entries: [] })).toThrow(BaselineError)
    expect(() => parseBaseline({ version: 1, entries: [{ fingerprint: '' }] })).toThrow(
      BaselineError,
    )
    expect(() => parseBaseline('not json at all')).toThrow(BaselineError)
  })

  it('accepts a file it produced itself', async () => {
    const baseline = createBaseline(await auditHtml(WITH_TITLE))
    expect(parseBaseline(JSON.parse(JSON.stringify(baseline)))).toEqual(baseline)
  })
})

describe('applyBaseline', () => {
  it('marks every pre-existing finding as known', async () => {
    const first = await auditHtml(WITH_TITLE)
    const second = await auditHtml(WITH_TITLE, createBaseline(first))

    expect(second.baseline?.newFindings).toBe(0)
    expect(second.baseline?.knownFindings).toBe(second.findings.length)
    expect(second.findings.every((finding) => finding.baseline === 'known')).toBe(true)
  })

  it('marks only the newly introduced finding as new', async () => {
    const baseline = createBaseline(await auditHtml(WITH_TITLE))
    const after = await auditHtml(WITHOUT_TITLE, baseline)

    expect(findingFor(after, 'seo/title')?.baseline).toBe('new')
    expect(findingFor(after, 'technical/duplicate-id')?.baseline).toBe('known')
    expect(after.baseline?.newFindings).toBe(1)
  })

  it('counts entries that no longer appear on the page', async () => {
    const baseline = createBaseline(await auditHtml(WITH_TITLE))
    const after = await auditHtml(DUPLICATE_FIXED, baseline)
    expect(after.baseline?.staleEntries).toBeGreaterThanOrEqual(1)
  })

  it('never removes findings, even known ones', async () => {
    const first = await auditHtml(WITH_TITLE)
    const second = await auditHtml(WITH_TITLE, createBaseline(first))
    expect(second.findings).toHaveLength(first.findings.length)
  })

  it('leaves findings unmarked when no baseline is supplied', async () => {
    const result = await auditHtml(WITH_TITLE)
    expect(result.baseline).toBeUndefined()
    expect(result.findings.every((finding) => finding.baseline === undefined)).toBe(true)
  })

  it('is a no-op shape check: applying twice yields the same counts', async () => {
    const first = await auditHtml(WITH_TITLE)
    const baseline = createBaseline(first)
    const once = applyBaseline(first, baseline)
    const twice = applyBaseline(once, baseline)
    expect(twice.baseline).toEqual(once.baseline)
  })
})
