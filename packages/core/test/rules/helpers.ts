import { parseHtml } from '../../src/collection/parse.js'
import type { AuditSnapshot } from '../../src/contracts/types.js'

export function snapshotOf(html: string, overrides: Partial<AuditSnapshot> = {}): AuditSnapshot {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    headers: { headers: {}, cookieNames: [] },
    redirectChain: [],
    html,
    document: parseHtml(html),
    truncated: false,
    ...overrides,
  }
}

export const page = (head: string, body = ''): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`
