import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { fetchPage, validateTarget } from '../../src/collection/fetch.js'

const ALLOW_LOOPBACK = { allowPrivateNetworks: false, allowAddresses: ['127.0.0.1'] }

async function withServer(
  handler: RequestListener,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('validateTarget', () => {
  it('accepts http and https URLs', () => {
    expect(validateTarget('https://example.com/').ok).toBe(true)
    expect(validateTarget('http://example.com/a?b=1').ok).toBe(true)
  })

  it.each(['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'rejects %s',
    (input) => {
      const result = validateTarget(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(['INVALID_URL', 'UNSUPPORTED_PROTOCOL']).toContain(result.error.code)
    },
  )

  it('rejects URLs carrying credentials', () => {
    const result = validateTarget('https://user:pass@example.com/')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_URL')
  })
})

describe('fetchPage', () => {
  it('returns a snapshot for an HTML page', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'x-frame-options': 'DENY',
        })
        res.end('<html><head><title>Hello</title></head><body><p>hi</p></body></html>')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.snapshot.httpStatus).toBe(200)
        expect(outcome.snapshot.finalUrl).toBe(`${base}/`)
        expect(outcome.snapshot.html).toContain('<title>Hello</title>')
        expect(outcome.snapshot.headers.headers['x-frame-options']).toBe('DENY')
        expect(outcome.snapshot.truncated).toBe(false)
      },
    )
  })

  it('records cookie names but never cookie values', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/html',
          'set-cookie': ['session=super-secret-token; HttpOnly', 'theme=dark'],
        })
        res.end('<html><head><title>t</title></head></html>')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.snapshot.headers.cookieNames).toEqual(['session', 'theme'])
        expect(JSON.stringify(outcome.snapshot.headers)).not.toContain('super-secret-token')
      },
    )
  })

  it('follows a redirect and records the chain', async () => {
    await withServer(
      (req, res) => {
        if (req.url === '/') {
          res.writeHead(302, { location: '/final' })
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><head><title>final</title></head></html>')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.snapshot.redirectChain).toEqual([`${base}/final`])
        expect(outcome.snapshot.finalUrl).toBe(`${base}/final`)
      },
    )
  })

  it('blocks a loopback IP literal when the guard is fully enabled', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html></html>')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, { allowPrivateNetworks: false })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('BLOCKED_ADDRESS')
      },
    )
  })

  it('blocks the cloud metadata IP literal', async () => {
    const outcome = await fetchPage('http://169.254.169.254/latest/meta-data/', {
      allowPrivateNetworks: false,
      timeoutMs: 2000,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('BLOCKED_ADDRESS')
  })

  it('blocks a redirect that points at a private address', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('BLOCKED_ADDRESS')
        expect(outcome.redirectChain).toHaveLength(1)
      },
    )
  })

  it('refuses more than five redirects', async () => {
    await withServer(
      (req, res) => {
        const step = Number(new URL(req.url ?? '/', 'http://x').pathname.replace('/', '') || '0')
        res.writeHead(302, { location: `/${step + 1}` })
        res.end()
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/0`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('TOO_MANY_REDIRECTS')
      },
    )
  })

  it('aborts an oversized body instead of buffering it', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(`<html><body>${'a'.repeat(4000)}</body></html>`)
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, { ...ALLOW_LOOPBACK, maxBytes: 1024 })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('RESPONSE_TOO_LARGE')
      },
    )
  })

  it('times out when the server never responds', async () => {
    await withServer(
      () => {
        /* never respond */
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, { ...ALLOW_LOOPBACK, timeoutMs: 300 })
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('FETCH_TIMEOUT')
      },
    )
  })

  it('rejects a non-HTML response', async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end('%PDF-1.4')
      },
      async (base) => {
        const outcome = await fetchPage(`${base}/`, ALLOW_LOOPBACK)
        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.error.code).toBe('NON_HTML_RESPONSE')
      },
    )
  })
})