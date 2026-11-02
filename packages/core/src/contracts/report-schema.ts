import { z } from 'zod'

export const SCHEMA_VERSION = '1.1.0'

const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('html-snippet'),
    snippet: z.string(),
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({ kind: z.literal('http-header'), name: z.string(), value: z.string() }),
  z.object({
    kind: z.literal('http-response'),
    status: z.number().int(),
    finalUrl: z.string(),
    redirectChain: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('measurement'),
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    unit: z.string().optional(),
  }),
  z.object({ kind: z.literal('absence'), expected: z.string(), scope: z.string() }),
])

const findingSchema = z.object({
  ruleId: z.string().min(1),
  category: z.enum(['seo', 'technical', 'security', 'accessibility']),
  status: z.enum(['failed', 'needs-review']),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  confidence: z.enum(['high', 'medium', 'low']),
  title: z.string().min(1),
  description: z.string().min(1),
  target: z.object({ url: z.string() }),
  location: z.object({ line: z.number().int(), column: z.number().int() }).optional(),
  evidence: z.array(evidenceSchema).min(1),
  recommendation: z.string().min(1),
  docsUrl: z.string(),
  fingerprint: z.string().min(1),
  baseline: z.enum(['new', 'known']).optional(),
  patch: z
    .object({
      kind: z.enum(['insert', 'replace']),
      target: z.enum(['html', 'http-headers']),
      before: z.string().optional(),
      after: z.string(),
      exact: z.boolean(),
    })
    .optional(),
})

const auditErrorSchema = z.object({
  code: z.enum([
    'INVALID_URL',
    'UNSUPPORTED_PROTOCOL',
    'BLOCKED_ADDRESS',
    'DNS_FAILURE',
    'FETCH_TIMEOUT',
    'TOO_MANY_REDIRECTS',
    'RESPONSE_TOO_LARGE',
    'NON_HTML_RESPONSE',
    'NETWORK_ERROR',
    'RULE_CRASH',
  ]),
  message: z.string(),
  ruleId: z.string().optional(),
})

export const auditResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  audit: z.object({
    startedAt: z.string(),
    finishedAt: z.string(),
    durationMs: z.number().nonnegative(),
  }),
  target: z.object({
    requestedUrl: z.string(),
    finalUrl: z.string().nullable(),
    httpStatus: z.number().int().nullable(),
    redirectChain: z.array(z.string()),
  }),
  status: z.enum(['completed', 'partial', 'failed']),
  rules: z.array(
    z.object({
      ruleId: z.string(),
      status: z.enum(['passed', 'failed', 'needs-review', 'not-applicable', 'error']),
      findingCount: z.number().int().nonnegative(),
      note: z.string().optional(),
      error: auditErrorSchema.optional(),
    }),
  ),
  findings: z.array(findingSchema),
  errors: z.array(auditErrorSchema),
  environment: z.object({ pagescopeVersion: z.string(), node: z.string() }),
  limitations: z.array(z.string()),
  baseline: z
    .object({
      newFindings: z.number().int().nonnegative(),
      knownFindings: z.number().int().nonnegative(),
      staleEntries: z.number().int().nonnegative(),
    })
    .optional(),
})
