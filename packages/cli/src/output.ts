import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { sanitizeForTerminal } from '@pagescope/core'
import type { AuditResult } from '@pagescope/core'

export interface OutputSink {
  write(text: string): void
  error(text: string): void
}

export const consoleSink: OutputSink = {
  write: (text) => process.stdout.write(text),
  error: (text) => process.stderr.write(text),
}

/** Writes a report file. The path always comes from --out, never from the audited URL. */
export async function writeReportFile(path: string, content: string): Promise<void> {
  const target = resolve(path)
  const existing = await stat(target).catch(() => undefined)
  if (existing?.isDirectory()) {
    throw new Error(`Refusing to write a report over the directory ${target}`)
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

const STATUS_GLYPH: Record<string, string> = {
  passed: '[ok]  ',
  failed: '[fail]',
  'needs-review': '[?]   ',
  'not-applicable': '[-]   ',
  error: '[err] ',
}

export function renderSummary(result: AuditResult): string {
  const lines = [
    `PageScope — ${sanitizeForTerminal(result.target.requestedUrl)}`,
    `status: ${result.status} | findings: ${result.findings.length} | ${result.audit.durationMs}ms`,
    '',
  ]

  for (const rule of result.rules) {
    const glyph = STATUS_GLYPH[rule.status] ?? '[?]   '
    const note = rule.note ? ` — ${sanitizeForTerminal(rule.note)}` : ''
    lines.push(`${glyph} ${rule.ruleId}${note}`)
  }

  if (result.findings.length > 0) {
    lines.push('', 'Findings:')
    for (const finding of result.findings) {
      lines.push(
        `  ${finding.severity.padEnd(8)} ${sanitizeForTerminal(finding.title)} (${finding.ruleId})`,
      )
      if (finding.location) {
        lines.push(`           at line ${finding.location.line}, column ${finding.location.column}`)
      }
    }
  }

  if (result.errors.length > 0) {
    lines.push('', 'Errors:')
    for (const error of result.errors) {
      lines.push(
        `  ${error.code}${error.ruleId ? ` (${error.ruleId})` : ''}: ${sanitizeForTerminal(error.message)}`,
      )
    }
  }

  lines.push('', 'Limitations:')
  for (const limitation of result.limitations) lines.push(`  - ${limitation}`)
  lines.push('')

  return lines.join('\n')
}