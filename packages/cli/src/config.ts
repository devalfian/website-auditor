import { readFile } from 'node:fs/promises'
import { z } from 'zod'

export const configSchema = z
  .object({
    failOn: z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']).optional(),
    minConfidence: z.enum(['low', 'medium', 'high']).optional(),
    format: z.enum(['summary', 'json', 'markdown', 'html', 'all']).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    rules: z.array(z.string().min(1)).optional(),
    excludeRules: z.array(z.string().min(1)).optional(),
  })
  .strict()

export type PageScopeConfig = z.infer<typeof configSchema>

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export async function loadConfig(path: string | undefined): Promise<PageScopeConfig> {
  if (!path) return {}

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new ConfigError(`Cannot read config file ${path}: ${String(error)}`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new ConfigError(`Config file ${path} is not valid JSON`)
  }

  const parsed = configSchema.safeParse(json)
  if (!parsed.success) {
    throw new ConfigError(`Config file ${path} is invalid: ${parsed.error.message}`)
  }

  return parsed.data
}
