import { auditResultSchema } from '../contracts/report-schema.js'
import type { AuditResult } from '../contracts/types.js'

export function toJsonReport(result: AuditResult): string {
  const validated = auditResultSchema.parse(result)
  return `${JSON.stringify(validated, null, 2)}\n`
}