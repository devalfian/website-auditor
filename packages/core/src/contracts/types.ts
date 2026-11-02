import type { DefaultTreeAdapterMap } from 'parse5'

/** parse5's default document type; `Document` is not exported by name. */
export type HtmlDocument = DefaultTreeAdapterMap['document']

export type Category = 'seo' | 'technical' | 'security' | 'accessibility'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Confidence = 'high' | 'medium' | 'low'
export type RuleStatus = 'passed' | 'failed' | 'needs-review' | 'not-applicable' | 'error'
export type EvaluatedStatus = Exclude<RuleStatus, 'error'>
export type FindingStatus = 'failed' | 'needs-review'
export type AuditStatus = 'completed' | 'partial' | 'failed'

export type AuditErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'BLOCKED_ADDRESS'
  | 'DNS_FAILURE'
  | 'FETCH_TIMEOUT'
  | 'TOO_MANY_REDIRECTS'
  | 'RESPONSE_TOO_LARGE'
  | 'NON_HTML_RESPONSE'
  | 'NETWORK_ERROR'
  | 'RULE_CRASH'

export interface AuditError {
  code: AuditErrorCode
  message: string
  ruleId?: string
}

export interface HeadersSummary {
  /** Lower-cased header names. `set-cookie` values are removed; see cookieNames. */
  headers: Record<string, string>
  /** Cookie names only — never their values. */
  cookieNames: string[]
}

export type Evidence =
  | { kind: 'html-snippet'; snippet: string; line: number; column: number; truncated: boolean }
  | { kind: 'http-header'; name: string; value: string }
  | { kind: 'http-response'; status: number; finalUrl: string; redirectChain: string[] }
  | { kind: 'measurement'; label: string; value: string | number; unit?: string }
  | { kind: 'absence'; expected: string; scope: string }

export interface Patch {
  kind: 'insert' | 'replace'
  target: 'html' | 'http-headers'
  before?: string
  after: string
  /** false when `after` is a template the engine cannot fill in reliably. */
  exact: boolean
}

export interface FindingDraft {
  severity: Severity
  confidence: Confidence
  title: string
  description: string
  evidence: Evidence[]
  recommendation: string
  location?: { line: number; column: number }
  patch?: Patch
}

export interface RuleResult {
  status: EvaluatedStatus
  findings: FindingDraft[]
  note?: string
}

export interface AuditSnapshot {
  requestedUrl: string
  finalUrl: string
  httpStatus: number
  headers: HeadersSummary
  redirectChain: string[]
  html: string
  document: HtmlDocument
  /** true when the response body exceeded the size limit and was cut. */
  truncated: boolean
}

export interface RuleDefinition {
  id: string
  category: Category
  title: string
  description: string
  docsSlug: string
  appliesTo: (snapshot: AuditSnapshot) => boolean
  evaluate: (snapshot: AuditSnapshot) => RuleResult
}

export interface Finding extends FindingDraft {
  ruleId: string
  category: Category
  status: FindingStatus
  target: { url: string }
  docsUrl: string
}

export interface RuleExecutionSummary {
  ruleId: string
  status: RuleStatus
  findingCount: number
  note?: string
  error?: AuditError
}

export interface AuditResult {
  schemaVersion: string
  audit: { startedAt: string; finishedAt: string; durationMs: number }
  target: {
    requestedUrl: string
    finalUrl: string | null
    httpStatus: number | null
    redirectChain: string[]
  }
  status: AuditStatus
  rules: RuleExecutionSummary[]
  findings: Finding[]
  errors: AuditError[]
  environment: { pagescopeVersion: string; node: string }
  limitations: string[]
}