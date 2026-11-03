import type { AuditCoverage } from '../contracts/types.js'

/**
 * Turns coverage facts into the sentences a report prints. Nothing here is
 * asserted unconditionally: each line exists because a fact in `coverage`
 * makes it true.
 */
export function limitationsFor(coverage: AuditCoverage): string[] {
  const limitations: string[] = []
  const missing = (what: AuditCoverage['notInspected'][number]): boolean =>
    coverage.notInspected.includes(what)

  if (missing('rendered-dom')) {
    limitations.push('JavaScript is not executed: only the raw HTML response is inspected.')
  }

  if (coverage.rendering === 'client-rendered') {
    limitations.push(
      'This page appears to be rendered client-side; rules that need the rendered DOM reported `unobservable` rather than guessing.',
    )
  }

  if (missing('linked-pages')) {
    limitations.push('Only the single requested page is audited; links are not crawled.')
  }

  if (missing('wcag-conformance') || missing('exploitability')) {
    limitations.push(
      'Automated checks cannot establish WCAG conformance or prove that a page is exploitable.',
    )
  }

  return limitations
}