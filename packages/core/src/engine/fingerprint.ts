import { createHash } from 'node:crypto'

const SEPARATOR = '\u0000'

/**
 * 64-bit fingerprint of a finding, used by baseline mode.
 *
 * The discriminator must be a *semantic* identity chosen by the rule (a duplicated id,
 * an image src, a heading-level pair), never a line number: positions shift whenever
 * unrelated content above them changes, which would make a baseline forget findings
 * and turn the CI gate into noise.
 */
export function fingerprintOf(ruleId: string, discriminator?: string): string {
  return createHash('sha256')
    .update(`${ruleId}${SEPARATOR}${discriminator ?? ''}`)
    .digest('hex')
    .slice(0, 16)
}
