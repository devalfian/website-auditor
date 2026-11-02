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
    const text = JSON.stringify(result.findings).toLowerCase()
    expect(text).not.toContain('wcag')
    expect(text).not.toContain('conform')
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