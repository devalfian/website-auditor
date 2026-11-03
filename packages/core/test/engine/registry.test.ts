import { describe, expect, it } from 'vitest'
import { allRules } from '../../src/engine/registry.js'

const OBSERVATIONS = ['served-html', 'rendered-dom', 'http-headers']

describe('rule observation declarations', () => {
  it('declares a valid observation source for every rule', () => {
    for (const rule of allRules) {
      expect(OBSERVATIONS, `${rule.id} declares an unknown observation`).toContain(rule.observation)
    }
  })

  it('marks exactly the two DOM-dependent rules as needing the rendered DOM', () => {
    const renderedDom = allRules
      .filter((rule) => rule.observation === 'rendered-dom')
      .map((rule) => rule.id)
      .sort()
    expect(renderedDom).toEqual(['a11y/img-alt', 'seo/heading-structure'])
  })
})
