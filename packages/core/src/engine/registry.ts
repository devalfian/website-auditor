import { a11yRules } from '../rules/a11y.js'
import { securityRules } from '../rules/security.js'
import { seoRules } from '../rules/seo.js'
import { technicalRules } from '../rules/technical.js'
import type { RuleDefinition } from '../contracts/types.js'

export const allRules: readonly RuleDefinition[] = [
  ...seoRules,
  ...technicalRules,
  ...a11yRules,
  ...securityRules,
]

export class UnknownRuleError extends Error {
  readonly ruleId: string

  constructor(ruleId: string) {
    super(`Unknown rule id "${ruleId}". Known ids: ${allRules.map((rule) => rule.id).join(', ')}`)
    this.name = 'UnknownRuleError'
    this.ruleId = ruleId
  }
}

export function selectRules(
  include?: readonly string[],
  exclude?: readonly string[],
): RuleDefinition[] {
  const byId = new Map(allRules.map((rule) => [rule.id, rule]))

  let selected: RuleDefinition[] = [...allRules]

  if (include && include.length > 0) {
    selected = include.map((id) => {
      const rule = byId.get(id)
      if (!rule) throw new UnknownRuleError(id)
      return rule
    })
  }

  if (exclude && exclude.length > 0) {
    for (const id of exclude) {
      if (!byId.has(id)) throw new UnknownRuleError(id)
    }
    selected = selected.filter((rule) => !exclude.includes(rule.id))
  }

  return selected
}
