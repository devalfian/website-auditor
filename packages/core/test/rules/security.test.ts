import { describe, expect, it } from 'vitest'
import { httpsRule, securityHeadersRule } from '../../src/rules/security.js'
import { page, snapshotOf } from './helpers.js'

const withHeaders = (headers: Record<string, string>) =>
  snapshotOf(page('<title>t</title>'), { headers: { headers, cookieNames: [] } })

describe('security/https', () => {
  it('passes when the final URL is https', () => {
    const result = httpsRule.evaluate(snapshotOf(page('<title>t</title>')))
    expect(result.status).toBe('passed')
  })

  it('fails when the final URL is http', () => {
    const result = httpsRule.evaluate(
      snapshotOf(page('<title>t</title>'), {
        requestedUrl: 'http://example.com/',
        finalUrl: 'http://example.com/',
      }),
    )
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('high')
    expect(result.findings[0]?.evidence[0]?.kind).toBe('http-response')
  })
})

describe('security/security-headers', () => {
  it('passes when all four headers are present', () => {
    const result = securityHeadersRule.evaluate(
      withHeaders({
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      }),
    )
    expect(result.status).toBe('passed')
  })

  it('lists the missing headers without claiming exploitability', () => {
    const result = securityHeadersRule.evaluate(withHeaders({ 'referrer-policy': 'no-referrer' }))
    expect(result.status).toBe('failed')
    expect(result.findings[0]?.severity).toBe('low')
    const measurement = result.findings[0]?.evidence.find((item) => item.kind === 'measurement')
    expect(measurement).toEqual({
      kind: 'measurement',
      label: 'missing security headers',
      value: 'HSTS, CSP, X-Content-Type-Options',
    })
    const text = JSON.stringify(result.findings).toLowerCase()
    expect(text).not.toContain('vulnerable')
    expect(text).not.toContain('exploit')
  })
})