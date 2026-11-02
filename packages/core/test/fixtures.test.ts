import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHtml } from '../src/collection/parse.js'
import type { FetchOutcome } from '../src/collection/fetch.js'
import { audit } from '../src/engine/audit.js'
import type { AuditResult } from '../src/contracts/types.js'

const FIXTURES = join(process.cwd(), 'packages/core/fixtures')

const ALL_SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
}

async function auditFixture(name: string, headers: Record<string, string>): Promise<AuditResult> {
  const html = await readFile(join(FIXTURES, name), 'utf8')
  const snapshot = {
    requestedUrl: `https://example.com/${name}`,
    finalUrl: `https://example.com/${name}`,
    httpStatus: 200,
    headers: { headers, cookieNames: [] },
    redirectChain: [],
    html,
    document: parseHtml(html),
    truncated: false,
  }
  return audit({
    url: snapshot.requestedUrl,
    fetcher: async (): Promise<FetchOutcome> => ({ ok: true, snapshot }),
  })
}

const statusOf = (result: AuditResult, ruleId: string): string | undefined =>
  result.rules.find((summary) => summary.ruleId === ruleId)?.status

describe('fixtures', () => {
  it('index.html produces the documented findings', async () => {
    const result = await auditFixture('index.html', {})
    expect(result.status).toBe('completed')

    expect(statusOf(result, 'seo/title')).toBe('failed')
    expect(statusOf(result, 'seo/meta-description')).toBe('failed')
    expect(statusOf(result, 'seo/canonical')).toBe('failed')
    expect(statusOf(result, 'seo/robots-meta')).toBe('needs-review')
    expect(statusOf(result, 'seo/open-graph')).toBe('failed')
    expect(statusOf(result, 'seo/heading-structure')).toBe('needs-review')
    expect(statusOf(result, 'technical/duplicate-id')).toBe('failed')
    expect(statusOf(result, 'technical/meta-viewport')).toBe('failed')
    expect(statusOf(result, 'a11y/img-alt')).toBe('failed')
    expect(statusOf(result, 'a11y/html-lang')).toBe('failed')
    expect(statusOf(result, 'security/security-headers')).toBe('failed')
    expect(statusOf(result, 'security/https')).toBe('passed')
    expect(statusOf(result, 'technical/http-status')).toBe('passed')
  })

  it('clean.html produces no findings at all', async () => {
    const result = await auditFixture('clean.html', ALL_SECURITY_HEADERS)
    expect(result.status).toBe('completed')
    expect(result.findings).toEqual([])
    expect(result.rules.every((summary) => summary.status === 'passed')).toBe(true)
  })
})
