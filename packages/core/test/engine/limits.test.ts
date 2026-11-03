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