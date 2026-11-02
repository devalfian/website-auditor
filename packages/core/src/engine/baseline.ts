import { z } from 'zod'
import type { AuditResult } from '../contracts/types.js'

export const BASELINE_FORMAT_VERSION = 1

export interface BaselineEntry {
  fingerprint: string
  ruleId: string
  title: string
}

export interface BaselineFile {
  version: typeof BASELINE_FORMAT_VERSION
  /** Report schema version the entries were produced with. */
  schemaVersion: string
  generatedAt: string
  target: string
  entries: BaselineEntry[]
}

export class BaselineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BaselineError'
  }
}

const baselineSchema = z.object({
  version: z.literal(BASELINE_FORMAT_VERSION),
  schemaVersion: z.string(),
  generatedAt: z.string(),
  target: z.string(),
  entries: z.array(
    z.object({
      fingerprint: z.string().min(1),
      ruleId: z.string().min(1),
      title: z.string(),
    }),
  ),
})

/** Baseline files are user-supplied input, so they are validated before use. */
export function parseBaseline(raw: unknown): BaselineFile {
  const parsed = baselineSchema.safeParse(raw)
  if (!parsed.success) {
    throw new BaselineError(`Invalid baseline file: ${parsed.error.message}`)
  }
  return parsed.data
}

export function createBaseline(result: AuditResult, now: Date = new Date()): BaselineFile {
  const entries = result.findings
    .map((finding) => ({
      fingerprint: finding.fingerprint,
      ruleId: finding.ruleId,
      title: finding.title,
    }))
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))

  return {
    version: BASELINE_FORMAT_VERSION,
    schemaVersion: result.schemaVersion,
    generatedAt: now.toISOString(),
    target: result.target.finalUrl ?? result.target.requestedUrl,
    entries,
  }
}

/**
 * Marks every finding as `known` (already in the baseline) or `new`, and counts
 * baseline entries that no longer appear on the page. Findings themselves are never
 * removed: hiding a known finding would make the report lie about the page.
 */
export function applyBaseline(result: AuditResult, baseline: BaselineFile): AuditResult {
  const known = new Set(baseline.entries.map((entry) => entry.fingerprint))
  const findings = result.findings.map((finding) => ({
    ...finding,
    baseline: known.has(finding.fingerprint) ? ('known' as const) : ('new' as const),
  }))

  const knownFindings = findings.filter((finding) => finding.baseline === 'known').length
  const current = new Set(result.findings.map((finding) => finding.fingerprint))
  const staleEntries = baseline.entries.filter((entry) => !current.has(entry.fingerprint)).length

  return {
    ...result,
    findings,
    baseline: {
      newFindings: findings.length - knownFindings,
      knownFindings,
      staleEntries,
    },
  }
}
