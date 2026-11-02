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

  it('disclaims a ranking effect and never advertises one', () => {
    const result = metaDescriptionRule.evaluate(snapshotOf(page('')))
    const text = JSON.stringify(result.findings).toLowerCase()
    expect(text).toContain('no claim')
    expect(text).not.toContain('rank higher')
    expect(text).not.toContain('will improve')
    expect(text).not.toContain('boosts')
  })
})