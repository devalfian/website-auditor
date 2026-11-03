import { describe, expect, it } from 'vitest'
import { LIMITATIONS, audit } from '../../src/engine/audit.js'
import { UnknownRuleError, allRules, selectRules } from '../../src/engine/registry.js'
import { SCHEMA_VERSION } from '../../src/contracts/report-schema.js'
import type { FetchOutcome } from '../../src/collection/fetch.js'
import { page, snapshotOf } from '../rules/helpers.js'

const brokenPage = snapshotOf(page('<title>t</title>'))

const okFetcher =
  (snapshot = brokenPage) =>
  async (): Promise<FetchOutcome> => ({ ok: true, snapshot })

const failingFetcher = () => async (): Promise<FetchOutcome> => ({
  ok: false,
  error: { code: 'BLOCKED_ADDRESS', message: 'blocked' },
  finalUrl: null,
  redirectChain: [],
})

const clientRendered = snapshotOf(
  '<!doctype html><html lang="en"><head><title>App</title></head><body><div id="root"></div></body></html>',
)

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

  it('throws UnknownRuleError listing the valid ids', () => {
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
    expect(result.schemaVersion).toBe(SCHEMA_VERSION)
    expect(result.limitations).toEqual([...LIMITATIONS])
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

  it('records findings with rule metadata attached', async () => {
    const result = await audit({ url: 'https://example.com/', fetcher: okFetcher() })
    expect(result.findings.length).toBeGreaterThan(0)
    for (const finding of result.findings) {
      expect(finding.docsUrl).toContain('/docs/rules/')
      expect(finding.evidence.length).toBeGreaterThan(0)
      expect(['failed', 'needs-review']).toContain(finding.status)
    }
  })
})
