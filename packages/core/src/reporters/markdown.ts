import { sanitizeForTerminal } from './escape.js'
import type { AuditResult, Evidence, Finding } from '../contracts/types.js'

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const

function evidenceBlock(evidence: Evidence): string {
  switch (evidence.kind) {
    case 'html-snippet':
      return [
        `- Source at line ${evidence.line}, column ${evidence.column}${
          evidence.truncated ? ' (truncated)' : ''
        }:`,
        '',
        '```html',
        evidence.snippet.replace(/```/g, '`\u200b``'),
        '```',
      ].join('\n')
    case 'http-header':
      return `- Response header \`${sanitizeForTerminal(evidence.name)}\`: \`${sanitizeForTerminal(evidence.value)}\``
    case 'http-response':
      return `- Final response: HTTP ${evidence.status} at ${sanitizeForTerminal(evidence.finalUrl)}${
        evidence.redirectChain.length > 0
          ? ` after ${evidence.redirectChain.length} redirect(s)`
          : ''
      }`
    case 'measurement':
      return `- ${sanitizeForTerminal(evidence.label)}: ${sanitizeForTerminal(
        String(evidence.value),
      )}${evidence.unit ? ` ${sanitizeForTerminal(evidence.unit)}` : ''}`
    case 'absence':
      return `- Not found: ${sanitizeForTerminal(evidence.expected)} (${sanitizeForTerminal(
        evidence.scope,
      )})`
  }
}

function findingBlock(finding: Finding): string {
  const lines = [
    `### ${finding.severity.toUpperCase()} — ${sanitizeForTerminal(finding.title)}`,
    '',
    `- Rule: \`${finding.ruleId}\` (${finding.category})`,
    `- Status: ${finding.status}`,
    `- Confidence: ${finding.confidence}`,
    `- Docs: ${finding.docsUrl}`,
    '',
    sanitizeForTerminal(finding.description),
    '',
    '**Evidence**',
    '',
    ...finding.evidence.map(evidenceBlock),
    '',
    `**Recommendation:** ${sanitizeForTerminal(finding.recommendation)}`,
  ]

  if (finding.patch) {
    lines.push(
      '',
      `**Suggested change** (${finding.patch.exact ? 'exact' : 'template'}, ${finding.patch.target}):`,
      '',
      '```diff',
      ...(finding.patch.before ? [`- ${sanitizeForTerminal(finding.patch.before)}`] : []),
      `+ ${sanitizeForTerminal(finding.patch.after)}`,
      '```',
    )
  }

  return lines.join('\n')
}

export function toMarkdownReport(result: AuditResult): string {
  const counts = new Map<string, number>()
  for (const finding of result.findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1)
  }

  const lines: string[] = [
    '# PageScope report',
    '',
    `- Target: ${sanitizeForTerminal(result.target.requestedUrl)}`,
    `- Final URL: ${result.target.finalUrl ? sanitizeForTerminal(result.target.finalUrl) : 'not resolved'}`,
    `- Audited at: ${result.audit.startedAt}`,
    `- Status: ${result.status}`,
    `- Schema version: ${result.schemaVersion}`,
    `- PageScope version: ${result.environment.pagescopeVersion}`,
    '',
    '## Summary',
    '',
    `Findings: ${result.findings.length}`,
    '',
    ...SEVERITY_ORDER.filter((severity) => counts.has(severity)).map(
      (severity) => `- ${severity}: ${counts.get(severity)}`,
    ),
    '',
    '## Rules',
    '',
    '| Rule | Status | Findings |',
    '| --- | --- | --- |',
    ...result.rules.map((rule) => `| \`${rule.ruleId}\` | ${rule.status} | ${rule.findingCount} |`),
    '',
  ]

  if (result.errors.length > 0) {
    lines.push('## Execution errors', '')
    for (const error of result.errors) {
      lines.push(
        `- ${error.code}: ${sanitizeForTerminal(error.message)}${
          error.ruleId ? ` (rule \`${error.ruleId}\`)` : ''
        }`,
      )
    }
    lines.push('')
  }

  if (result.findings.length > 0) {
    lines.push('## Findings', '')
    const ordered = [...result.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    )
    for (const finding of ordered) lines.push(findingBlock(finding), '')
  }

  lines.push('## Limitations', '')
  for (const limitation of result.limitations) lines.push(`- ${sanitizeForTerminal(limitation)}`)
  lines.push('')

  return lines.join('\n')
}
