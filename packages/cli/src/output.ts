import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { sanitizeForTerminal } from '@pagescope/core'
import type { AuditResult, Confidence } from '@pagescope/core'

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

export interface GateSummary {
  minConfidence: Confidence
  /** Failed findings the gate did not count because their confidence was too low. */
  excluded: number
}

export function renderSummary(result: AuditResult, gate?: GateSummary): string {
  const lines = [
    `PageScope — ${sanitizeForTerminal(result.target.requestedUrl)}`,
    `status: ${result.status} | findings: ${result.findings.length} | ${result.audit.durationMs}ms`,
    `coverage: ${result.coverage.representation} (${result.coverage.rendering}) | ${
      result.coverage.rulesEvaluated
    }/${result.rules.length} rules evaluated${
      result.coverage.unobservableRules.length > 0
        ? ` | unobservable: ${result.coverage.unobservableRules.join(', ')}`
        : ''
    }`,
    `not inspected: ${result.coverage.notInspected.join(', ') || 'nothing'}`,
  ]

  if (result.baseline) {
    lines.push(
      `baseline: ${result.baseline.newFindings} new, ${result.baseline.knownFindings} known, ${result.baseline.staleEntries} stale entr${
        result.baseline.staleEntries === 1 ? 'y' : 'ies'
      }`,
    )
  }

  lines.push('')

  for (const rule of result.rules) {
    const glyph = STATUS_GLYPH[rule.status] ?? '[?]   '
    const note = rule.note ? ` — ${sanitizeForTerminal(rule.note)}` : ''
    lines.push(`${glyph} ${rule.ruleId}${note}`)
  }

  if (result.findings.length > 0) {
    lines.push('', 'Findings:')
    for (const finding of result.findings) {
      lines.push(
        `  ${finding.severity.padEnd(8)} ${sanitizeForTerminal(finding.title)} (${finding.ruleId}) [confidence: ${finding.confidence}]`,
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

  if (gate && gate.excluded > 0) {
    lines.push(
      '',
      `gate: ${gate.excluded} failed finding${
        gate.excluded === 1 ? '' : 's'
      } below --min-confidence ${gate.minConfidence} were not counted`,
    )
  }

  lines.push('', 'Limitations:')
  for (const limitation of result.limitations) lines.push(`  - ${limitation}`)
  lines.push('')

  return lines.join('\n')
}
