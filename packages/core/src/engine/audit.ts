import { fetchPage, type FetchOutcome } from '../collection/fetch.js'
import { SCHEMA_VERSION } from '../contracts/report-schema.js'
import { VERSION } from '../version.js'
import { applyBaseline, type BaselineFile } from './baseline.js'
import { fingerprintOf } from './fingerprint.js'
import { limitationsFor } from './limits.js'
import { selectRules } from './registry.js'
import type {
  AuditCoverage,
  AuditError,
  AuditResult,
  AuditSnapshot,
  Finding,
  FindingStatus,
  NotInspected,
  RuleDefinition,
  RuleExecutionSummary,
  RuleResult,
} from '../contracts/types.js'

/** Spec C reads served HTML only. Each later phase removes one entry. */
const NOT_INSPECTED: NotInspected[] = [
  'rendered-dom',
  'linked-pages',
  'wcag-conformance',
  'exploitability',
]

export interface AuditRequest {
  url: string
  rules?: readonly string[]
  excludeRules?: readonly string[]
  timeoutMs?: number
  /** Internal only. Never wire this to a CLI flag or a config key. */
  allowPrivateNetworks?: boolean
  /** Internal only, used by tests to permit a specific address. */
  allowAddresses?: readonly string[]
  /** Internal only: replaces the network fetcher in tests. */
  fetcher?: typeof fetchPage
  /** Internal only: replaces the clock in tests. */
  now?: () => Date
  /** Marks findings as known or new against a previously recorded baseline. */
  baseline?: BaselineFile
}

function docsUrlFor(slug: string): string {
  return `https://github.com/devalfian/website-auditor/blob/main/docs/rules/${slug}.md`
}

function assertResultInvariants(rule: RuleDefinition, result: RuleResult): void {
  const producesFindings = result.status === 'failed' || result.status === 'needs-review'
  if (producesFindings && result.findings.length === 0) {
    throw new Error(`Rule ${rule.id} reported "${result.status}" without any finding`)
  }
  if (!producesFindings && result.findings.length > 0) {
    throw new Error(`Rule ${rule.id} reported "${result.status}" but returned findings`)
  }
}

export async function audit(request: AuditRequest): Promise<AuditResult> {
  const now = request.now ?? (() => new Date())
  const startedAtMs = Date.now()
  const startedAt = now().toISOString()
  const rules = selectRules(request.rules, request.excludeRules)

  const finished = (): { startedAt: string; finishedAt: string; durationMs: number } => ({
    startedAt,
    finishedAt: now().toISOString(),
    durationMs: Date.now() - startedAtMs,
  })

  const buildFailure = (
    error: AuditError,
    finalUrl: string | null,
    redirectChain: string[],
  ): AuditResult => {
    const coverage: AuditCoverage = {
      representation: 'served-html',
      rendering: 'server-rendered',
      renderingEvidence: [],
      rulesEvaluated: 0,
      unobservableRules: [],
      notInspected: [...NOT_INSPECTED],
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      audit: finished(),
      target: { requestedUrl: request.url, finalUrl, httpStatus: null, redirectChain },
      status: 'failed',
      rules: rules.map((rule): RuleExecutionSummary => ({
        ruleId: rule.id,
        status: 'error',
        findingCount: 0,
        error,
      })),
      findings: [],
      errors: [error],
      environment: { pagescopeVersion: VERSION, node: process.versions.node },
      coverage,
      limitations: limitationsFor(coverage),
    }
  }

  const fetcher = request.fetcher ?? fetchPage
  const outcome: FetchOutcome = await fetcher(request.url, {
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.allowPrivateNetworks !== undefined
      ? { allowPrivateNetworks: request.allowPrivateNetworks }
      : {}),
    ...(request.allowAddresses ? { allowAddresses: request.allowAddresses } : {}),
  })

  if (!outcome.ok) {
    return buildFailure(outcome.error, outcome.finalUrl, outcome.redirectChain)
  }

  const snapshot: AuditSnapshot = outcome.snapshot
  const findings: Finding[] = []
  const summaries: RuleExecutionSummary[] = []
  const errors: AuditError[] = []

  for (const rule of rules) {
    if (rule.observation === 'rendered-dom' && snapshot.rendering.kind === 'client-rendered') {
      summaries.push({
        ruleId: rule.id,
        status: 'unobservable',
        findingCount: 0,
        note: `needs the rendered DOM; ${snapshot.rendering.reason}`,
      })
      continue
    }

    if (!rule.appliesTo(snapshot)) {
      summaries.push({ ruleId: rule.id, status: 'not-applicable', findingCount: 0 })
      continue
    }

    try {
      const result = rule.evaluate(snapshot)
      assertResultInvariants(rule, result)

      const ruleFindings = result.findings.map((draft): Finding => ({
        ...draft,
        ruleId: rule.id,
        category: rule.category,
        status: result.status as FindingStatus,
        target: { url: snapshot.finalUrl },
        docsUrl: docsUrlFor(rule.docsSlug),
        observedFrom: rule.observation,
        fingerprint: fingerprintOf(rule.id, draft.fingerprint),
      }))

      findings.push(...ruleFindings)
      summaries.push({
        ruleId: rule.id,
        status: result.status,
        findingCount: ruleFindings.length,
        ...(result.note !== undefined ? { note: result.note } : {}),
      })
    } catch (error) {
      const auditError: AuditError = {
        code: 'RULE_CRASH',
        message: error instanceof Error ? error.message : String(error),
        ruleId: rule.id,
      }
      errors.push(auditError)
      summaries.push({ ruleId: rule.id, status: 'error', findingCount: 0, error: auditError })
    }
  }

  const status = summaries.some((summary) => summary.status === 'error') ? 'partial' : 'completed'

  const coverage: AuditCoverage = {
    representation: 'served-html',
    rendering: snapshot.rendering.kind,
    renderingEvidence: snapshot.rendering.evidence,
    rulesEvaluated: summaries.filter(
      (summary) => summary.status !== 'unobservable' && summary.status !== 'error',
    ).length,
    unobservableRules: summaries
      .filter((summary) => summary.status === 'unobservable')
      .map((summary) => summary.ruleId),
    notInspected: [...NOT_INSPECTED],
  }

  const result: AuditResult = {
    schemaVersion: SCHEMA_VERSION,
    audit: finished(),
    target: {
      requestedUrl: request.url,
      finalUrl: snapshot.finalUrl,
      httpStatus: snapshot.httpStatus,
      redirectChain: snapshot.redirectChain,
    },
    status,
    rules: summaries,
    findings,
    errors,
    environment: { pagescopeVersion: VERSION, node: process.versions.node },
    coverage,
    limitations: limitationsFor(coverage),
  }

  return request.baseline ? applyBaseline(result, request.baseline) : result
}
