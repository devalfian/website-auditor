import { Agent, request } from 'undici'
import { isIP } from 'node:net'
import { createGuardedLookup, isBlockedAddress } from './ip-guard.js'
import { parseHtml } from './parse.js'
import { VERSION } from '../version.js'
import type { AuditError, AuditSnapshot, HeadersSummary } from '../contracts/types.js'

export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_MAX_REDIRECTS = 5

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const HTML_CONTENT_TYPE = /text\/html|application\/xhtml\+xml/i

export interface FetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** Internal only. Never wire this to a CLI flag, config key, or public API. */
  allowPrivateNetworks?: boolean
  /** Internal only, tests use it to permit 127.0.0.1 while everything else stays blocked. */
  allowAddresses?: readonly string[]
}

export type FetchOutcome =
  | { ok: true; snapshot: AuditSnapshot }
  | { ok: false; error: AuditError; finalUrl: string | null; redirectChain: string[] }

export type TargetValidation = { ok: true; url: URL } | { ok: false; error: AuditError }

/**
 * Node's net layer skips DNS — and therefore skips our guarded lookup — when the host
 * is already an IP literal. Literal addresses must be checked here or the connect-time
 * guard can be bypassed with a URL such as http://169.254.169.254/.
 */
function checkLiteralAddress(url: URL, options: FetchOptions): AuditError | undefined {
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  if (isIP(host) === 0) return undefined
  if (options.allowAddresses?.includes(host)) return undefined
  if (options.allowPrivateNetworks === true) return undefined
  if (!isBlockedAddress(host)) return undefined
  return {
    code: 'BLOCKED_ADDRESS',
    message: `Refusing to connect to ${host}: private, loopback, or reserved address`,
  }
}

export function validateTarget(raw: string): TargetValidation {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return {
      ok: false,
      error: { code: 'INVALID_URL', message: `Not a valid absolute URL: ${raw}` },
    }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_PROTOCOL',
        message: `Unsupported protocol "${url.protocol}"; only http and https can be audited`,
      },
    }
  }

  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      error: { code: 'INVALID_URL', message: 'URLs containing credentials are not accepted' },
    }
  }

  return { ok: true, url }
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

function nameOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : ''
}

/** Codes Node/undici use for aborted or timed-out operations. 20 and 23 are numeric DOMException codes. */
const TIMEOUT_CODES = new Set([
  '20',
  '23',
  'ABORT_ERR',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_ABORTED',
])

function toAuditError(error: unknown): AuditError {
  const message = error instanceof Error ? error.message : String(error)
  const code = codeOf(error)
  const name = nameOf(error)

  if (code === 'EBLOCKEDADDRESS') return { code: 'BLOCKED_ADDRESS', message }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { code: 'DNS_FAILURE', message }
  if (TIMEOUT_CODES.has(code) || name === 'TimeoutError' || name === 'AbortError') {
    return { code: 'FETCH_TIMEOUT', message }
  }
  return { code: 'NETWORK_ERROR', message }
}

function summarizeHeaders(raw: Record<string, string | string[] | undefined>): HeadersSummary {
  const headers: Record<string, string> = {}
  const cookieNames: string[] = []

  for (const [rawName, rawValue] of Object.entries(raw)) {
    if (rawValue === undefined) continue
    const name = rawName.toLowerCase()

    if (name === 'set-cookie') {
      const cookies = Array.isArray(rawValue) ? rawValue : [rawValue]
      for (const cookie of cookies) {
        const cookieName = cookie.split('=')[0]?.trim()
        if (cookieName) cookieNames.push(cookieName)
      }
      continue
    }

    if (name === 'authorization') continue
    headers[name] = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue
  }

  return { headers, cookieNames }
}

type BoundedBody = { text: string } | { tooLarge: true }

async function readBodyBounded(
  body: AsyncIterable<Uint8Array> & { destroy?: () => void },
  maxBytes: number,
): Promise<BoundedBody> {
  const chunks: Uint8Array[] = []
  let total = 0

  for await (const chunk of body) {
    total += chunk.byteLength
    if (total > maxBytes) {
      body.destroy?.()
      return { tooLarge: true }
    }
    chunks.push(chunk)
  }

  return { text: Buffer.concat(chunks).toString('utf8') }
}

export async function fetchPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchOutcome> {
  const validation = validateTarget(rawUrl)
  if (!validation.ok) {
    return { ok: false, error: validation.error, finalUrl: null, redirectChain: [] }
  }

  const initialLiteral = checkLiteralAddress(validation.url, options)
  if (initialLiteral) {
    return { ok: false, error: initialLiteral, finalUrl: null, redirectChain: [] }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  const dispatcher = new Agent({
    connect: {
      lookup: createGuardedLookup({
        allowPrivateNetworks: options.allowPrivateNetworks ?? false,
        ...(options.allowAddresses ? { allowAddresses: options.allowAddresses } : {}),
      }),
    },
  })

  const redirectChain: string[] = []
  let current = validation.url
  const deadline = Date.now() + timeoutMs

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        return {
          ok: false,
          error: { code: 'FETCH_TIMEOUT', message: `Audit exceeded the ${timeoutMs}ms budget` },
          finalUrl: current.toString(),
          redirectChain,
        }
      }

      let response
      try {
        response = await request(current, {
          dispatcher,
          method: 'GET',
          signal: AbortSignal.timeout(remaining),
          headers: {
            'user-agent': `pagescope/${VERSION}`,
            accept: 'text/html,application/xhtml+xml',
          },
        })
      } catch (error) {
        return {
          ok: false,
          error: toAuditError(error),
          finalUrl: current.toString(),
          redirectChain,
        }
      }

      const location = response.headers.location

      if (REDIRECT_STATUSES.has(response.statusCode) && typeof location === 'string') {
        await response.body.dump()
        const next = new URL(location, current)
        redirectChain.push(next.toString())

        if (hop === maxRedirects) {
          return {
            ok: false,
            error: { code: 'TOO_MANY_REDIRECTS', message: `More than ${maxRedirects} redirects` },
            finalUrl: next.toString(),
            redirectChain,
          }
        }

        const nextValidation = validateTarget(next.toString())
        if (!nextValidation.ok) {
          return {
            ok: false,
            error: nextValidation.error,
            finalUrl: next.toString(),
            redirectChain,
          }
        }

        current = nextValidation.url

        const hopLiteral = checkLiteralAddress(current, options)
        if (hopLiteral) {
          return {
            ok: false,
            error: hopLiteral,
            finalUrl: current.toString(),
            redirectChain,
          }
        }
        continue
      }

      const contentType = response.headers['content-type']
      const looksLikeHtml = typeof contentType !== 'string' || HTML_CONTENT_TYPE.test(contentType)

      if (!looksLikeHtml) {
        await response.body.dump()
        return {
          ok: false,
          error: {
            code: 'NON_HTML_RESPONSE',
            message: `Expected HTML but received "${String(contentType)}"`,
          },
          finalUrl: current.toString(),
          redirectChain,
        }
      }

      const body = await readBodyBounded(response.body, maxBytes)
      if ('tooLarge' in body) {
        return {
          ok: false,
          error: {
            code: 'RESPONSE_TOO_LARGE',
            message: `Response body exceeded the ${maxBytes} byte limit`,
          },
          finalUrl: current.toString(),
          redirectChain,
        }
      }

      return {
        ok: true,
        snapshot: {
          requestedUrl: rawUrl,
          finalUrl: current.toString(),
          httpStatus: response.statusCode,
          headers: summarizeHeaders(response.headers),
          redirectChain,
          html: body.text,
          document: parseHtml(body.text),
          // v1 aborts oversize responses instead of cutting them, so this is always
          // false today. The field exists so a future soft-limit mode needs no schema change.
          truncated: false,
        },
      }
    }

    return {
      ok: false,
      error: { code: 'TOO_MANY_REDIRECTS', message: `More than ${maxRedirects} redirects` },
      finalUrl: current.toString(),
      redirectChain,
    }
  } finally {
    await dispatcher.close()
  }
}