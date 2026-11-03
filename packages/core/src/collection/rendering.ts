import { findAll, byTagName, getAttr, getTextContent, snippetOf } from './parse.js'
import type { HtmlElement } from './parse.js'
import type { Evidence, HtmlDocument, RenderingAssessment } from '../contracts/types.js'

/**
 * Mount points these frameworks actually emit. A guessed identifier would be
 * evidence PageScope cannot stand behind, so the list stays short on purpose.
 */
const ROOT_IDS = new Set(['root', 'app', '__next', '__nuxt', '___gatsby'])
const ROOT_TAGS = new Set(['app-root'])

const JAVASCRIPT_DEMAND =
  /enable javascript|requires javascript|javascript is (disabled|required)/i

function hasElementChild(el: HtmlElement): boolean {
  return (el.childNodes ?? []).some(
    (child) => (child as { tagName?: unknown }).tagName !== undefined,
  )
}

function snippetEvidence(html: string, el: HtmlElement, expected: string): Evidence {
  const snippet = snippetOf(html, el)
  if (!snippet) {
    return {
      kind: 'absence',
      expected,
      scope: 'the element has no source location in the response',
    }
  }
  return {
    kind: 'html-snippet',
    snippet: snippet.snippet,
    line: snippet.line,
    column: snippet.column,
    truncated: snippet.truncated,
  }
}

/**
 * Two high-precision signals, no numeric thresholds. A page is called
 * client-rendered only when one of them fires; everything else stays
 * server-rendered, the same assumption v0.1.0 made.
 */
export function detectRendering(document: HtmlDocument, html: string): RenderingAssessment {
  const evidence: Evidence[] = []
  const reasons: string[] = []

  const emptyMount = findAll(document, (el) => {
    const id = (getAttr(el, 'id') ?? '').trim().toLowerCase()
    return ROOT_IDS.has(id) || ROOT_TAGS.has(el.tagName)
  }).find((el) => !hasElementChild(el))

  if (emptyMount) {
    const name = (getAttr(emptyMount, 'id') ?? emptyMount.tagName).trim()
    reasons.push(`the framework mount point "${name}" is empty`)
    evidence.push(snippetEvidence(html, emptyMount, `content inside the mount point "${name}"`))
  }

  const noscript = byTagName(document, 'noscript').find((el) =>
    JAVASCRIPT_DEMAND.test(getTextContent(el)),
  )

  if (noscript) {
    reasons.push('a <noscript> block asks the visitor to enable JavaScript')
    evidence.push(snippetEvidence(html, noscript, '<noscript> content that renders without JS'))
  }

  if (reasons.length === 0) {
    return {
      kind: 'server-rendered',
      reason: 'no client-side rendering signal was found in the served HTML',
      evidence: [],
    }
  }

  return { kind: 'client-rendered', reason: reasons.join('; '), evidence }
}