import type { DefaultTreeAdapterMap } from 'parse5'

/** parse5's default document type; `Document` is not exported by name. */
export type HtmlDocument = DefaultTreeAdapterMap['document']

/**
 * Whether the served HTML is a faithful representation of what a user sees.
 * PageScope only reports 'client-rendered' when a specific signal proves it, so
 * a missed detection leaves the v0.1.0 behaviour unchanged.
 */
export type RenderingKind = 'server-rendered' | 'client-rendered'

export interface RenderingAssessment {
  kind: RenderingKind
  reason: string
  evidence: Evidence[]
}

/**
 * The minimum representation a rule needs to reach a conclusion.
 * 'served-html'  — the bytes the server sent are enough
 * 'rendered-dom' — needs the DOM after JavaScript has run
 * 'http-headers' — reads only the status line and response headers
 */
export type ObservationSource = 'served-html' | 'rendered-dom' | 'http-headers'

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
  /**
   * Stable identity of this specific occurrence within the rule, e.g. the duplicated
   * id value or the image src. Deliberately NOT a line number: positions shift when
   * unrelated content above them changes, which would make baselines forget findings.
   * Omit it when a rule can produce at most one finding per page.
   */
  fingerprint?: string
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
  /** Whether the served HTML is a faithful representation of what a user sees. */
  rendering: RenderingAssessment
  /** true when the response body exceeded the size limit and was cut. */
  truncated: boolean
}

export interface RuleDefinition {
  id: string
  category: Category
  title: string
  description: string
  docsSlug: string
  /** The minimum representation this rule needs; see ObservationSource. */
  observation: ObservationSource
  appliesTo: (snapshot: AuditSnapshot) => boolean
  evaluate: (snapshot: AuditSnapshot) => RuleResult
}

export interface Finding extends FindingDraft {
  ruleId: string
  category: Category
  status: FindingStatus
  target: { url: string }
  docsUrl: string
  /** Computed by the engine: hash of rule id plus the rule's discriminator. */
  fingerprint: string
  /** Set only when a baseline was applied. Absent means no baseline was in use. */
  baseline?: 'new' | 'known'
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
  /** Present only when a baseline file was applied to this audit. */
  baseline?: {
    newFindings: number
    knownFindings: number
    /** Baseline entries whose fingerprint no longer appears on the page. */
    staleEntries: number
  }
}
