export { VERSION } from './version.js'

export * from './contracts/types.js'
export { SCHEMA_VERSION, auditResultSchema } from './contracts/report-schema.js'
export { allRules, selectRules, UnknownRuleError } from './engine/registry.js'
export { audit, LIMITATIONS, type AuditRequest } from './engine/audit.js'
export type { FetchOptions, FetchOutcome } from './collection/fetch.js'
export { validateTarget } from './collection/fetch.js'