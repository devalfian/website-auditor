import { findAll, getAttr, getHead, locationOf, snippetOf } from '../collection/parse.js'
import type { HtmlElement, HtmlNode } from '../collection/parse.js'
import type { AuditSnapshot, Evidence } from '../contracts/types.js'

export const DOCS_BASE = 'https://github.com/devalfian/website-auditor/blob/main/docs/rules'

export function docsUrlFor(slug: string): string {
  return `${DOCS_BASE}/${slug}.md`
}

export function countDescendants(node: HtmlNode | { childNodes?: HtmlNode[] }): number {
  const children = (node as { childNodes?: HtmlNode[] }).childNodes ?? []
  let total = children.length
  for (const child of children) total += countDescendants(child)
  return total
}

export function headScope(snapshot: AuditSnapshot): string {
  const head = getHead(snapshot.document)
  return `scanned <head> (${head ? countDescendants(head) : 0} nodes)`
}

export function findMeta(
  snapshot: AuditSnapshot,
  attribute: 'name' | 'property',
  value: string,
): HtmlElement | undefined {
  const head = getHead(snapshot.document)
  if (!head) return undefined
  const wanted = value.toLowerCase()
  return findAll(
    head,
    (el) => el.tagName === 'meta' && (getAttr(el, attribute) ?? '').toLowerCase() === wanted,
  )[0]
}

export function elementEvidence(snapshot: AuditSnapshot, el: HtmlElement): Evidence {
  const snippet = snippetOf(snapshot.html, el)
  if (!snippet) {
    return {
      kind: 'absence',
      expected: `<${el.tagName}> snippet`,
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

export function locationProps(el: HtmlElement): { location?: { line: number; column: number } } {
  const location = locationOf(el)
  return location ? { location } : {}
}