import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  applyBaseline,
  createBaseline,
  type AuditResult,
  type BaselineFile,
} from '@pagescope/core'
import { EXIT, run } from '../src/run.js'

const execFileAsync = promisify(execFile)
const repoRoot = process.cwd()
const cliPath = join(repoRoot, 'packages/cli/dist/cli.js')
const tsupCli = join(repoRoot, 'node_modules/tsup/dist/cli-default.js')

/**
 * The spawned-binary tests execute the built CLI, which imports @pagescope/core at
 * runtime through node's resolver (not vitest's alias). Both packages must therefore
 * be built, even on a fresh clone. Building here rather than relying on step order
 * means `pnpm test` works on its own.
 */
beforeAll(async () => {
  await execFileAsync(process.execPath, [tsupCli], { cwd: join(repoRoot, 'packages/core') })
  await execFileAsync(process.execPath, [tsupCli], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
      env: { ...process.env, NO_COLOR: '1' },
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const baseResult = (overrides: Partial<AuditResult> = {}): AuditResult => ({
  schemaVersion: SCHEMA_VERSION,
  audit: {
    startedAt: '2026-11-02T10:00:00.000Z',
    finishedAt: '2026-11-02T10:00:01.000Z',
    durationMs: 1000,
  },
  target: {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    redirectChain: [],
  },
  status: 'completed',
  rules: [{ ruleId: 'seo/title', status: 'passed', findingCount: 0 }],
  findings: [],
  errors: [],
  environment: { pagescopeVersion: '0.0.0', node: process.versions.node },
  limitations: ['JavaScript is not executed.'],
  coverage: {
    representation: 'served-html' as const,
    rendering: 'server-rendered' as const,
    renderingEvidence: [],
    rulesEvaluated: 1,
    unobservableRules: [],
    notInspected: ['rendered-dom', 'linked-pages', 'wcag-conformance', 'exploitability'] as (
      'rendered-dom' | 'linked-pages' | 'wcag-conformance' | 'exploitability'
    )[],
  },
  ...overrides,
})

const highFinding = {
  ruleId: 'seo/title',
  category: 'seo' as const,
  status: 'failed' as const,
  severity: 'high' as const,
  confidence: 'high' as const,
  observedFrom: 'served-html' as const,
  title: 'Missing <title> element',
  description: 'no title',
  target: { url: 'https://example.com/' },
  evidence: [{ kind: 'absence' as const, expected: '<title>', scope: 'scanned <head>' }],
  recommendation: 'add one',
  docsUrl: 'https://example.com/docs/rules/seo-title.md',
  fingerprint: 'aaaaaaaaaaaaaaaa',
}

const needsReviewFinding = {
  ruleId: 'seo/robots-meta',
  category: 'seo' as const,
  status: 'needs-review' as const,
  severity: 'medium' as const,
  confidence: 'medium' as const,
  observedFrom: 'served-html' as const,
  title: 'Robots meta contains "noindex"',
  description: 'PageScope cannot determine whether this directive is intentional.',
  target: { url: 'https://example.com/' },
  evidence: [
    { kind: 'absence' as const, expected: 'blocking robots directives', scope: 'scanned <head>' },
  ],
  recommendation: 'Confirm the directive is intentional.',
  docsUrl: 'https://example.com/docs/rules/seo-robots-meta.md',
  fingerprint: 'bbbbbbbbbbbbbbbb',
}

const captured: string[] = []
const sink = {
  write: (text: string) => captured.push(text),
  error: (text: string) => captured.push(`ERR:${text}`),
}

describe('pagescope CLI (spawned binary)', () => {
  it('exits 2 for a malformed URL', async () => {
    const { code, stderr } = await runCli(['not-a-url'])
    expect(code).toBe(2)
    expect(stderr).toContain('INVALID_URL')
  })

  it('exits 2 for an unsupported protocol', async () => {
    const { code, stderr } = await runCli(['ftp://example.com/'])
    expect(code).toBe(2)
    expect(stderr).toContain('UNSUPPORTED_PROTOCOL')
  })

  it('exits 2 for an unknown rule id', async () => {
    const { code, stderr } = await runCli(['https://example.com/', '--rules', 'seo/nope'])
    expect(code).toBe(2)
    expect(stderr).toContain('Unknown rule id')
  })

  it('exits 3 when the target is not auditable', async () => {
    const { code, stderr } = await runCli(['http://127.0.0.1:9/'])
    expect(code).toBe(3)
    expect(stderr).toContain('BLOCKED_ADDRESS')
  })

  it('exits 0 for --help', async () => {
    const { code, stdout } = await runCli(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('pagescope')
  })
})

describe('run() with an injected audit', () => {
  it('returns 0 when the policy passes', async () => {
    const code = await run(['https://example.com/', '--fail-on', 'high'], {
      auditFn: async () => baseResult(),
      out: sink,
    })
    expect(code).toBe(EXIT.OK)
  })

  it('returns 1 when a finding meets the threshold', async () => {
    const code = await run(['https://example.com/', '--fail-on', 'high'], {
      auditFn: async () => baseResult({ findings: [highFinding] }),
      out: sink,
    })
    expect(code).toBe(EXIT.POLICY)
  })

  it('returns 0 when findings exist but no policy is configured', async () => {
    const code = await run(['https://example.com/'], {
      auditFn: async () => baseResult({ findings: [highFinding] }),
      out: sink,
    })
    expect(code).toBe(EXIT.OK)
  })

  it('does not fail the gate on a needs-review finding', async () => {
    const code = await run(['https://example.com/', '--fail-on', 'medium'], {
      auditFn: async () => baseResult({ findings: [needsReviewFinding] }),
      out: sink,
    })
    expect(code).toBe(EXIT.OK)
  })

  it('still fails the gate on a failed finding at the same severity', async () => {
    const failed = { ...needsReviewFinding, status: 'failed' as const }
    const code = await run(['https://example.com/', '--fail-on', 'medium'], {
      auditFn: async () => baseResult({ findings: [failed] }),
      out: sink,
    })
    expect(code).toBe(EXIT.POLICY)
  })

  it('returns 3 when the audit itself failed', async () => {
    const code = await run(['https://example.com/'], {
      auditFn: async () => baseResult({ status: 'failed' }),
      out: sink,
    })
    expect(code).toBe(EXIT.UNAUDITABLE)
  })

  it('writes the requested report file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pagescope-'))
    try {
      const target = join(dir, 'report.json')
      const code = await run(['https://example.com/', '--format', 'json', '--out', target], {
        auditFn: async () => baseResult(),
        out: sink,
      })
      expect(code).toBe(EXIT.OK)
      const written = JSON.parse(await readFile(target, 'utf8')) as AuditResult
      expect(written.schemaVersion).toBe(SCHEMA_VERSION)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('baseline mode', () => {
  // The injected fake mirrors what audit() does: apply the baseline when one is passed.
  const baselineAware =
    (result: AuditResult) =>
    async (request: { baseline?: BaselineFile }): Promise<AuditResult> =>
      request.baseline ? applyBaseline(result, request.baseline) : result

  it('passes the gate when every finding is already in the baseline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pagescope-'))
    try {
      const baselinePath = join(dir, 'baseline.json')
      await writeFile(
        baselinePath,
        JSON.stringify(createBaseline(baseResult({ findings: [highFinding] }))),
      )

      const code = await run(
        ['https://example.com/', '--fail-on', 'high', '--baseline', baselinePath],
        {
          auditFn: baselineAware(baseResult({ findings: [highFinding] })),
          out: sink,
        },
      )
      expect(code).toBe(EXIT.OK)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails the gate on a finding that is not in the baseline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pagescope-'))
    try {
      const baselinePath = join(dir, 'baseline.json')
      await writeFile(baselinePath, JSON.stringify(createBaseline(baseResult())))

      const code = await run(
        ['https://example.com/', '--fail-on', 'high', '--baseline', baselinePath],
        { auditFn: baselineAware(baseResult({ findings: [highFinding] })), out: sink },
      )
      expect(code).toBe(EXIT.POLICY)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes a baseline and exits 0 without evaluating the policy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pagescope-'))
    try {
      const baselinePath = join(dir, 'baseline.json')
      const code = await run(
        ['https://example.com/', '--fail-on', 'high', '--write-baseline', baselinePath],
        { auditFn: baselineAware(baseResult({ findings: [highFinding] })), out: sink },
      )
      expect(code).toBe(EXIT.OK)

      const written = JSON.parse(await readFile(baselinePath, 'utf8')) as BaselineFile
      expect(written.version).toBe(1)
      expect(written.entries).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a malformed baseline file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pagescope-'))
    try {
      const baselinePath = join(dir, 'baseline.json')
      await writeFile(baselinePath, JSON.stringify({ version: 99, entries: [] }))

      const code = await run(['https://example.com/', '--baseline', baselinePath], {
        auditFn: baselineAware(baseResult()),
        out: sink,
      })
      expect(code).toBe(EXIT.USAGE)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses to read and write a baseline in the same run', async () => {
    const code = await run(
      ['https://example.com/', '--baseline', 'a.json', '--write-baseline', 'b.json'],
      {
        auditFn: baselineAware(baseResult()),
        out: sink,
      },
    )
    expect(code).toBe(EXIT.USAGE)
  })
})
