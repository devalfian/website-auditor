import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, auditResultSchema } from '../../src/contracts/report-schema.js'
import { escapeHtml, sanitizeForTerminal } from '../../src/reporters/escape.js'
import { toHtmlReport } from '../../src/reporters/html.js'
import { toJsonReport } from '../../src/reporters/json.js'
import { toMarkdownReport } from '../../src/reporters/markdown.js'
import type { AuditResult } from '../../src/contracts/types.js'

const hostileTitle = '<script>alert(1)</script>'

const result: AuditResult = {
  schemaVersion: SCHEMA_VERSION,
  audit: {
    startedAt: '2026-11-02T10:00:00.000Z',
    finishedAt: '2026-11-02T10:00:02.000Z',
    durationMs: 2000,
  },
  target: {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    redirectChain: [],
  },
  status: 'partial',
  rules: [
    { ruleId: 'seo/title', status: 'failed', findingCount: 1 },
    { ruleId: 'a11y/html-lang', status: 'needs-review', findingCount: 1 },
    { ruleId: 'security/https', status: 'error', findingCount: 0 },
  ],
  findings: [
    {
      ruleId: 'seo/title',
      category: 'seo',
      status: 'failed',
      severity: 'high',
      confidence: 'high',
      title: `Title contains ${hostileTitle}`,
      description: 'Evidence contains <b>markup</b> that must be escaped.',
      target: { url: 'https://example.com/' },
      location: { line: 3, column: 5 },
      evidence: [
        {
          kind: 'html-snippet',
          snippet: `<title>${hostileTitle}</title>`,
          line: 3,
          column: 5,
          truncated: false,
        },
      ],
      recommendation: 'Escape untrusted content.',
      docsUrl: 'https://example.com/docs/rules/seo-title.md',
    },
    {
      ruleId: 'a11y/html-lang',
      category: 'accessibility',
      status: 'needs-review',
      severity: 'medium',
      confidence: 'low',
      title: 'Ambiguous language declaration',
      description: 'Needs a human decision.',
      target: { url: 'https://example.com/' },
      evidence: [{ kind: 'absence', expected: 'lang attribute', scope: 'checked <html>' }],
      recommendation: 'Confirm the language.',
      docsUrl: 'https://example.com/docs/rules/a11y-html-lang.md',
    },
  ],
  errors: [{ code: 'RULE_CRASH', message: 'boom', ruleId: 'security/https' }],
  environment: { pagescopeVersion: '0.0.0', node: process.versions.node },
  limitations: ['JavaScript is not executed.'],
}

describe('escapeHtml', () => {
  it('escapes every dangerous character', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })
})

describe('sanitizeForTerminal', () => {
  it('removes ANSI escapes, control characters and bidi overrides', () => {
    expect(sanitizeForTerminal('\u001b[31mred\u001b[0m\u0007\u202eabc')).toBe('redabc')
  })
})

describe('toJsonReport', () => {
  it('returns pretty printed JSON that satisfies the schema', () => {
    const json = toJsonReport(result)
    expect(json.endsWith('\n')).toBe(true)
    expect(() => auditResultSchema.parse(JSON.parse(json))).not.toThrow()
  })
})

describe('toMarkdownReport', () => {
  it('includes target, status, findings, errors and limitations', () => {
    const markdown = toMarkdownReport(result)
    expect(markdown).toContain('https://example.com/')
    expect(markdown).toContain('partial')
    expect(markdown).toContain('Title contains')
    expect(markdown).toContain('Ambiguous language declaration')
    expect(markdown).toContain('RULE_CRASH')
    expect(markdown).toContain('JavaScript is not executed.')
  })

  it('fences snippets so page markup cannot break the document', () => {
    expect(toMarkdownReport(result)).toContain('```html')
  })
})

describe('toHtmlReport', () => {
  it('never emits raw markup from the audited page', () => {
    const html = toHtmlReport(result)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<b>markup</b>')
  })

  it('is self contained and locks down resource loading', () => {
    const html = toHtmlReport(result)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
    expect(html).not.toContain('http://')
  })

  it('carries the same findings as the JSON report', () => {
    const parsed = JSON.parse(toJsonReport(result)) as AuditResult
    const html = toHtmlReport(result)
    for (const finding of parsed.findings) expect(html).toContain(escapeHtml(finding.title))
  })
})