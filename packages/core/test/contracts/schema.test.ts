import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, auditResultSchema } from '../../src/contracts/report-schema.js'
import type { AuditResult } from '../../src/contracts/types.js'

const minimal: AuditResult = {
  schemaVersion: SCHEMA_VERSION,
  audit: {
    startedAt: '2026-11-02T00:00:00.000Z',
    finishedAt: '2026-11-02T00:00:01.000Z',
    durationMs: 1000,
  },
  target: {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    redirectChain: [],
  },
  status: 'completed',
  rules: [{ ruleId: 'seo/title', status: 'passed', findingCount: 0 }],
  findings: [],
  errors: [],
  environment: { pagescopeVersion: '0.0.0', node: process.versions.node },
  limitations: ['JavaScript is not executed; only the raw HTML response is inspected.'],
}

describe('auditResultSchema', () => {
  it('accepts a minimal completed audit', () => {
    expect(auditResultSchema.parse(minimal)).toEqual(minimal)
  })

  it('rejects a report without schemaVersion', () => {
    const { schemaVersion: _dropped, ...rest } = minimal
    expect(() => auditResultSchema.parse(rest)).toThrow()
  })

  it('rejects an unknown status value', () => {
    expect(() => auditResultSchema.parse({ ...minimal, status: 'done' })).toThrow()
  })

  it('accepts an unobservable rule status', () => {
    const withUnobservable: AuditResult = {
      ...minimal,
      rules: [{ ruleId: 'a11y/img-alt', status: 'unobservable', findingCount: 0 }],
    }
    expect(auditResultSchema.parse(withUnobservable).rules[0]?.status).toBe('unobservable')
  })

  it('accepts a finding with absence evidence and no location', () => {
    const withFinding: AuditResult = {
      ...minimal,
      status: 'partial',
      findings: [
        {
          ruleId: 'seo/title',
          category: 'seo',
          status: 'failed',
          severity: 'high',
          confidence: 'high',
          title: 'Missing <title>',
          description: 'No <title> element was found inside <head>.',
          target: { url: 'https://example.com/' },
          evidence: [
            {
              kind: 'absence',
              expected: '<title> inside <head>',
              scope: 'scanned <head> (14 nodes)',
            },
          ],
          recommendation: 'Add a <title> element inside <head>.',
          docsUrl: 'https://github.com/devalfian/website-auditor/blob/main/docs/rules/seo-title.md',
          observedFrom: 'served-html',
          fingerprint: '0123456789abcdef',
        },
      ],
    }
    expect(auditResultSchema.parse(withFinding).findings).toHaveLength(1)
  })

  it('rejects a finding without observedFrom', () => {
    const withoutProvenance = {
      ...minimal,
      status: 'partial',
      findings: [
        {
          ruleId: 'seo/title',
          category: 'seo',
          status: 'failed',
          severity: 'high',
          confidence: 'high',
          title: 'Missing <title>',
          description: 'No <title> element was found inside <head>.',
          target: { url: 'https://example.com/' },
          evidence: [{ kind: 'absence', expected: '<title>', scope: 'scanned <head>' }],
          recommendation: 'Add a <title> element inside <head>.',
          docsUrl: 'https://example.com/docs/rules/seo-title.md',
          fingerprint: '0123456789abcdef',
        },
      ],
    }
    expect(() => auditResultSchema.parse(withoutProvenance)).toThrow()
  })
})
