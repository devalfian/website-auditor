export { VERSION } from './version.js'

export * from './contracts/types.js'
export { SCHEMA_VERSION, auditResultSchema } from './contracts/report-schema.js'
export { allRules, selectRules, UnknownRuleError } from './engine/registry.js'
export { audit, type AuditRequest } from './engine/audit.js'
export { limitationsFor } from './engine/limits.js'
export type { FetchOptions, FetchOutcome } from './collection/fetch.js'
export { validateTarget } from './collection/fetch.js'
export { escapeHtml, sanitizeForTerminal } from './reporters/escape.js'
export { toJsonReport } from './reporters/json.js'
export { toMarkdownReport } from './reporters/markdown.js'
export { toHtmlReport } from './reporters/html.js'
export {
  applyBaseline,
  createBaseline,
  parseBaseline,
  BaselineError,
  BASELINE_FORMAT_VERSION,
  type BaselineEntry,
  type BaselineFile,
} from './engine/baseline.js'
export { fingerprintOf } from './engine/fingerprint.js'
