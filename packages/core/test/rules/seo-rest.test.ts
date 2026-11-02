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
    const result = headingStructureRule.evaluate(snapshotOf(page('', '<h1>One</h1><h1>Two</h1>')))
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
