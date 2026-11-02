import { findAll, getAttr, type HtmlElement } from '../collection/parse.js'
import { elementEvidence, locationProps } from './shared.js'
import type { RuleDefinition } from '../contracts/types.js'

export const duplicateIdRule: RuleDefinition = {
  id: 'technical/duplicate-id',
  category: 'technical',
  title: 'No duplicate id attributes',
  description: 'Reports id values that more than one element uses.',
  docsSlug: 'technical-duplicate-id',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const byId = new Map<string, HtmlElement[]>()

    const withId = findAll(snapshot.document, (candidate) => {
      const id = getAttr(candidate, 'id')
      return typeof id === 'string' && id.trim() !== ''
    })

    for (const el of withId) {
      const id = (getAttr(el, 'id') ?? '').trim()
      const group = byId.get(id)
      if (group) group.push(el)
      else byId.set(id, [el])
    }

    const duplicates = [...byId.entries()].filter(([, elements]) => elements.length > 1)

    if (duplicates.length === 0) {
      return { status: 'passed', findings: [], note: `${byId.size} unique ids` }
    }

    return {
      status: 'failed',
      findings: duplicates.map(([id, elements]) => ({
        severity: 'medium',
        confidence: 'high',
        title: `Duplicate id "${id}"`,
        description: `The id "${id}" is used by ${elements.length} elements. Duplicate ids break fragment links and document.getElementById lookups.`,
        evidence: elements.map((el) => elementEvidence(snapshot, el)),
        recommendation: 'Give every element a unique id, or use a class when grouping is intended.',
        ...locationProps(elements[1] ?? elements[0]!),
        patch: {
          kind: 'replace',
          target: 'html',
          before: `id="${id}"`,
          after: `id="${id}-2"`,
          exact: true,
        },
      })),
    }
  },
}

export const metaViewportRule: RuleDefinition = {
  id: 'technical/meta-viewport',
  category: 'technical',
  title: 'Page declares a viewport meta tag',
  description: 'Checks for <meta name="viewport"> in the document.',
  docsSlug: 'technical-meta-viewport',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const hasViewport =
      findAll(
        snapshot.document,
        (el) => el.tagName === 'meta' && (getAttr(el, 'name') ?? '').toLowerCase() === 'viewport',
      ).length > 0

    if (hasViewport) {
      return { status: 'passed', findings: [], note: 'viewport meta present' }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'medium',
          confidence: 'high',
          title: 'Missing viewport meta tag',
          description:
            'No <meta name="viewport"> was found. Without it, mobile browsers fall back to a desktop-width layout. PageScope does not evaluate the quality of the viewport value.',
          evidence: [
            {
              kind: 'absence',
              expected: '<meta name="viewport">',
              scope: 'scanned the whole document',
            },
          ],
          recommendation:
            'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.',
          patch: {
            kind: 'insert',
            target: 'html',
            after: '<meta name="viewport" content="width=device-width, initial-scale=1">',
            exact: true,
          },
        },
      ],
    }
  },
}

export const httpStatusRule: RuleDefinition = {
  id: 'technical/http-status',
  category: 'technical',
  title: 'Page responds with a 2xx status',
  description: 'Reports a final response status outside the 2xx range.',
  docsSlug: 'technical-http-status',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const status = snapshot.httpStatus

    if (status >= 200 && status < 300) {
      return { status: 'passed', findings: [], note: `HTTP ${status}` }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'high',
          confidence: 'high',
          title: `Page responded with HTTP ${status}`,
          description: `The final response for this URL has status ${status}. PageScope reports the status code it observed; it cannot tell whether a non-2xx response is intentional for this URL.`,
          evidence: [
            {
              kind: 'http-response',
              status,
              finalUrl: snapshot.finalUrl,
              redirectChain: snapshot.redirectChain,
            },
          ],
          recommendation:
            'Serve the page with a 2xx status, or confirm that a non-2xx response is intended for this URL.',
        },
      ],
    }
  },
}

export const technicalRules: RuleDefinition[] = [
  duplicateIdRule,
  metaViewportRule,
  httpStatusRule,
]