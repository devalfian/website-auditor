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