import { escapeHtml, sanitizeForTerminal } from './escape.js'
import type { AuditResult, Evidence } from '../contracts/types.js'

const STYLES = `
:root { color-scheme: light dark; }
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: 2rem 1rem; line-height: 1.5; }
h1 { font-size: 1.5rem; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid currentColor; }
code, pre { font-family: ui-monospace, monospace; }
pre { overflow-x: auto; padding: .75rem; border: 1px solid currentColor; }
.sev-critical, .sev-high { font-weight: 700; }
footer { margin-top: 3rem; font-size: .875rem; opacity: .8; }
`

function evidenceHtml(evidence: Evidence): string {
  switch (evidence.kind) {
    case 'html-snippet':
      return `<p>Source at line ${evidence.line}, column ${evidence.column}${
        evidence.truncated ? ' (truncated)' : ''
      }</p><pre><code>${escapeHtml(evidence.snippet)}</code></pre>`
    case 'http-header':
      return `<p>Response header <code>${escapeHtml(evidence.name)}</code>: <code>${escapeHtml(
        evidence.value,
      )}</code></p>`
    case 'http-response':
      return `<p>Final response: HTTP ${evidence.status} at <code>${escapeHtml(
        evidence.finalUrl,
      )}</code>${
        evidence.redirectChain.length > 0
          ? ` after ${evidence.redirectChain.length} redirect(s)`
          : ''
      }</p>`
    case 'measurement':
      return `<p>${escapeHtml(evidence.label)}: <strong>${escapeHtml(
        String(evidence.value),
      )}</strong>${evidence.unit ? ` ${escapeHtml(evidence.unit)}` : ''}</p>`
    case 'absence':
      return `<p>Not found: <code>${escapeHtml(evidence.expected)}</code> (${escapeHtml(
        evidence.scope,
      )})</p>`
  }
}

export function toHtmlReport(result: AuditResult): string {
  const findings = result.findings
    .map(
      (finding) => `<article>
  <h3 class="sev-${finding.severity}">${escapeHtml(finding.severity.toUpperCase())} — ${escapeHtml(
    finding.title,
  )}</h3>
  <p><code>${escapeHtml(finding.ruleId)}</code> · ${escapeHtml(
    finding.category,
  )} · status ${escapeHtml(finding.status)} · confidence ${escapeHtml(finding.confidence)}</p>
  <p>${escapeHtml(finding.description)}</p>
  <h4>Evidence</h4>
  ${finding.evidence.map(evidenceHtml).join('\n  ')}
  <h4>Recommendation</h4>
  <p>${escapeHtml(finding.recommendation)}</p>
  ${
    finding.patch
      ? `<h4>Suggested change (${finding.patch.exact ? 'exact' : 'template'})</h4>
  <pre><code>${escapeHtml(finding.patch.after)}</code></pre>`
      : ''
  }
  <p><a href="${escapeHtml(finding.docsUrl)}">Rule documentation</a></p>
</article>`,
    )
    .join('\n')

  const rules = result.rules
    .map(
      (rule) =>
        `<tr><td><code>${escapeHtml(rule.ruleId)}</code></td><td>${escapeHtml(rule.status)}</td><td>${
          rule.findingCount
        }</td></tr>`,
    )
    .join('')

  const errors =
    result.errors.length === 0
      ? ''
      : `<h2>Execution errors</h2><ul>${result.errors
          .map(
            (error) =>
              `<li><code>${escapeHtml(error.code)}</code>: ${escapeHtml(error.message)}</li>`,
          )
          .join('')}</ul>`

  const limitations = result.limitations
    .map((item) => `<li>${escapeHtml(sanitizeForTerminal(item))}</li>`)
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>PageScope report for ${escapeHtml(result.target.requestedUrl)}</title>
<style>${STYLES}</style>
</head>
<body>
<h1>PageScope report</h1>
<p>Target: <code>${escapeHtml(result.target.requestedUrl)}</code></p>
<p>Final URL: <code>${escapeHtml(result.target.finalUrl ?? 'not resolved')}</code></p>
<p>Audited at ${escapeHtml(result.audit.startedAt)} · status <strong>${escapeHtml(
    result.status,
  )}</strong> · schema ${escapeHtml(result.schemaVersion)}</p>
<h2>Rules</h2>
<table><thead><tr><th>Rule</th><th>Status</th><th>Findings</th></tr></thead><tbody>${rules}</tbody></table>
${errors}
<h2>Findings (${result.findings.length})</h2>
${findings || '<p>No findings.</p>'}
<footer>
<h2>Limitations</h2>
<ul>${limitations}</ul>
</footer>
</body>
</html>
`
}