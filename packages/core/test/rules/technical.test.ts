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