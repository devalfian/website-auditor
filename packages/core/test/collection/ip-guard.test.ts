import { describe, expect, it } from 'vitest'
import { createGuardedLookup, isBlockedAddress } from '../../src/collection/ip-guard.js'

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
    '2001:db8::1',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([
    '93.184.216.34',
    '1.1.1.1',
    '172.32.0.1',
    '2606:2800:220:1:248:1893:25c8:1946',
    '::ffff:93.184.216.34',
  ])('allows the public address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })

  it('blocks anything it cannot parse', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
    expect(isBlockedAddress('')).toBe(true)
    expect(isBlockedAddress('1.2.3')).toBe(true)
  })

  it('strips an IPv6 zone index before checking', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true)
  })
})

const resolve = (
  lookup: ReturnType<typeof createGuardedLookup>,
  hostname: string,
): Promise<{ error: NodeJS.ErrnoException | null; address: string; family?: number }> =>
  new Promise((resolvePromise) => {
    lookup(hostname, {}, (error, address, family) => {
      resolvePromise({
        error: error as NodeJS.ErrnoException | null,
        address: String(address),
        family,
      })
    })
  })

describe('createGuardedLookup', () => {
  it('rejects a hostname that resolves to loopback', async () => {
    const { error } = await resolve(
      createGuardedLookup({ allowPrivateNetworks: false }),
      'localhost',
    )
    expect(error).not.toBeNull()
    expect(error?.code).toBe('EBLOCKEDADDRESS')
  })

  it('allows loopback when the internal escape hatch is enabled', async () => {
    const { error, address } = await resolve(
      createGuardedLookup({ allowPrivateNetworks: true }),
      'localhost',
    )
    expect(error).toBeNull()
    expect(['127.0.0.1', '::1']).toContain(address)
  })
})