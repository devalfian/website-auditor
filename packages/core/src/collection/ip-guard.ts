import { lookup as dnsLookup } from 'node:dns'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isIPv4, isIPv6 } from 'node:net'

/** IPv4 ranges that must never be contacted by an auditor. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, includes cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function v4ToBytes(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    bytes.push(value)
  }
  return bytes
}

function v4ToInt(ip: string): number | null {
  const bytes = v4ToBytes(ip)
  if (!bytes) return null
  return ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0
}

function inV4Range(ipInt: number, base: string, bits: number): boolean {
  const baseInt = v4ToInt(base)
  if (baseInt === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

function isBlockedV4(ip: string): boolean {
  const ipInt = v4ToInt(ip)
  if (ipInt === null) return true
  return BLOCKED_V4.some(([base, bits]) => inV4Range(ipInt, base, bits))
}

function expandIpv6(input: string): number[] | null {
  let ip = input
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)

  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':')
    if (lastColon === -1) return null
    const v4 = v4ToBytes(ip.slice(lastColon + 1))
    if (!v4) return null
    const high = ((v4[0]! << 8) | v4[1]!).toString(16)
    const low = ((v4[2]! << 8) | v4[3]!).toString(16)
    ip = `${ip.slice(0, lastColon + 1)}${high}:${low}`
  }

  const halves = ip.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === undefined || halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1]!.split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 && missing !== 0) return null
  if (missing < 0) return null

  const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
  if (groups.length !== 8) return null

  const bytes: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    const value = Number.parseInt(group, 16)
    bytes.push((value >> 8) & 0xff, value & 0xff)
  }
  return bytes
}

export function isBlockedAddress(address: string): boolean {
  const candidate = address.trim()
  if (candidate === '') return true

  if (isIPv4(candidate)) return isBlockedV4(candidate)

  const withoutZone = candidate.includes('%')
    ? candidate.slice(0, candidate.indexOf('%'))
    : candidate
  if (!isIPv6(withoutZone)) return true

  const bytes = expandIpv6(candidate)
  if (!bytes) return true

  const zeroPrefix = (length: number): boolean => bytes.slice(0, length).every((byte) => byte === 0)
  const tailAsV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`

  if (bytes.every((byte) => byte === 0)) return true // ::
  if (zeroPrefix(15) && bytes[15] === 1) return true // ::1
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) return isBlockedV4(tailAsV4)
  if (zeroPrefix(12)) return isBlockedV4(tailAsV4)
  if ((bytes[0]! & 0xfe) === 0xfc) return true // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true // fe80::/10 link local
  if (bytes[0] === 0xff) return true // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return true // 2001:db8::/32
  }
  return false
}

export interface GuardedLookupOptions {
  /** Internal only. Never wire this to a CLI flag or config key. */
  allowPrivateNetworks: boolean
  /** Internal only, used by tests: permit these exact addresses. */
  allowAddresses?: readonly string[]
}

export type GuardedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

export function createGuardedLookup(
  options: GuardedLookupOptions,
): (
  hostname: string,
  lookupOptions: LookupOptions | number | GuardedLookupCallback,
  callback?: GuardedLookupCallback,
) => void {
  return (hostname, lookupOptions, callback) => {
    const done = (
      typeof lookupOptions === 'function' ? lookupOptions : callback
    ) as GuardedLookupCallback
    const wantsAll =
      typeof lookupOptions === 'object' && lookupOptions !== null && lookupOptions.all === true

    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        done(error, '', 0)
        return
      }
      const resolved = addresses as LookupAddress[]
      if (resolved.length === 0) {
        done(
          Object.assign(new Error(`No addresses found for ${hostname}`), { code: 'ENOTFOUND' }),
          '',
          0,
        )
        return
      }

      const blocked = resolved.find(
        (entry) =>
          !options.allowPrivateNetworks &&
          !options.allowAddresses?.includes(entry.address) &&
          isBlockedAddress(entry.address),
      )

      if (blocked) {
        done(
          Object.assign(
            new Error(
              `Refusing to connect to ${hostname}: ${blocked.address} is a private, loopback, or reserved address`,
            ),
            { code: 'EBLOCKEDADDRESS' },
          ),
          '',
          0,
        )
        return
      }

      if (wantsAll) {
        done(null, resolved)
        return
      }

      const first = resolved[0]!
      done(null, first.address, first.family)
    })
  }
}