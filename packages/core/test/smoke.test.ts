import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

describe('workspace', () => {
  it('exposes a version string from @pagescope/core', () => {
    expect(VERSION).toBe('0.0.0')
  })
})