import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, type AuditResult } from '@pagescope/core'
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
  ...overrides,
})

const highFinding = {
  ruleId: 'seo/title',
  category: 'seo' as const,
  status: 'failed' as const,
  severity: 'high' as const,
  confidence: 'high' as const,
  title: 'Missing <title> element',
  description: 'no title',
  target: { url: 'https://example.com/' },
  evidence: [{ kind: 'absence' as const, expected: '<title>', scope: 'scanned <head>' }],
  recommendation: 'add one',
  docsUrl: 'https://example.com/docs/rules/seo-title.md',
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
