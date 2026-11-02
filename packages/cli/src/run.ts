import { Command, CommanderError } from 'commander'
import {
  UnknownRuleError,
  VERSION,
  audit,
  toHtmlReport,
  toJsonReport,
  toMarkdownReport,
  validateTarget,
} from '@pagescope/core'
import type { AuditResult } from '@pagescope/core'
import { ConfigError, loadConfig } from './config.js'
import { consoleSink, renderSummary, writeReportFile, type OutputSink } from './output.js'

export const EXIT = { OK: 0, POLICY: 1, USAGE: 2, UNAUDITABLE: 3 } as const

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const
type Severity = keyof typeof SEVERITY_RANK
type FailOn = Severity | 'none'
type Format = 'summary' | 'json' | 'markdown' | 'html' | 'all'

export interface CliDeps {
  auditFn?: typeof audit
  out?: OutputSink
}

const parseIds = (value: string | undefined): string[] | undefined => {
  if (!value) return undefined
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
  return ids.length > 0 ? ids : undefined
}

export async function run(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.out ?? consoleSink
  const auditFn = deps.auditFn ?? audit

  const program = new Command()
  program
    .name('pagescope')
    .description('Audit the technical and SEO quality of a single page. No browser required.')
    .version(VERSION)
    .exitOverride()
    .argument('<url>', 'absolute http(s) URL to audit')
    .option('--format <format>', 'summary | json | markdown | html | all', 'summary')
    .option('--out <path>', 'write the report to this path instead of stdout')
    .option('--fail-on <severity>', 'critical | high | medium | low | info | none', 'none')
    .option('--rules <ids>', 'comma separated rule ids to run')
    .option('--exclude-rules <ids>', 'comma separated rule ids to skip')
    .option('--config <path>', 'path to a pagescope.config.json file')
    .option('--timeout <ms>', 'request timeout in milliseconds', '10000')
    .option('--verbose', 'print extra diagnostics to stderr', false)
    .option('--no-color', 'disable colour in terminal output')

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return EXIT.OK
      }
      out.error(`${error.message}\n`)
      return EXIT.USAGE
    }
    throw error
  }

  const url = program.processedArgs[0] as string
  const options = program.opts<{
    format: Format
    out?: string
    failOn: FailOn
    rules?: string
    excludeRules?: string
    config?: string
    timeout: string
  }>()

  const validation = validateTarget(url)
  if (!validation.ok) {
    out.error(`${validation.error.code}: ${validation.error.message}\n`)
    return EXIT.USAGE
  }

  let config
  try {
    config = await loadConfig(options.config)
  } catch (error) {
    if (error instanceof ConfigError) {
      out.error(`${error.message}\n`)
      return EXIT.USAGE
    }
    throw error
  }

  const fromCli = (name: string): boolean => program.getOptionValueSource(name) === 'cli'
  const format = fromCli('format') ? options.format : (config.format ?? options.format)
  const failOn: FailOn = fromCli('failOn') ? options.failOn : (config.failOn ?? options.failOn)
  const timeoutMs = fromCli('timeout')
    ? Number(options.timeout)
    : (config.timeoutMs ?? Number(options.timeout))
  const rules = parseIds(options.rules) ?? config.rules
  const excludeRules = parseIds(options.excludeRules) ?? config.excludeRules

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    out.error('--timeout must be a positive number of milliseconds\n')
    return EXIT.USAGE
  }

  if (format === 'all' && !options.out) {
    out.error('--format all requires --out\n')
    return EXIT.USAGE
  }

  let result: AuditResult
  try {
    result = await auditFn({
      url,
      timeoutMs,
      ...(rules ? { rules } : {}),
      ...(excludeRules ? { excludeRules } : {}),
    })
  } catch (error) {
    if (error instanceof UnknownRuleError) {
      out.error(`${error.message}\n`)
      return EXIT.USAGE
    }
    out.error(`Audit failed: ${error instanceof Error ? error.message : String(error)}\n`)
    return EXIT.UNAUDITABLE
  }

  if (result.status === 'failed') {
    const first = result.errors[0]
    out.error(
      `Audit could not be completed: ${first ? `${first.code} — ${first.message}` : 'unknown error'}\n`,
    )
    return EXIT.UNAUDITABLE
  }

  if (result.status === 'partial') {
    out.error('Warning: partial audit — some rules did not run. See the report for details.\n')
  }

  if (format === 'summary') {
    out.write(renderSummary(result))
  } else if (options.out) {
    const base = options.out
    if (format === 'all') {
      await writeReportFile(`${base}.json`, toJsonReport(result))
      await writeReportFile(`${base}.md`, toMarkdownReport(result))
      await writeReportFile(`${base}.html`, toHtmlReport(result))
      out.error(`Wrote ${base}.json, ${base}.md and ${base}.html\n`)
    } else {
      const content =
        format === 'json'
          ? toJsonReport(result)
          : format === 'markdown'
            ? toMarkdownReport(result)
            : toHtmlReport(result)
      await writeReportFile(base, content)
      out.error(`Wrote ${base}\n`)
    }
  } else {
    out.write(
      format === 'json'
        ? toJsonReport(result)
        : format === 'markdown'
          ? toMarkdownReport(result)
          : toHtmlReport(result),
    )
  }

  const policyFailed =
    failOn !== 'none' &&
    result.findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn])

  return policyFailed ? EXIT.POLICY : EXIT.OK
}