import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

export type HtmlDocument = DefaultTreeAdapterMap['document']
export type HtmlElement = DefaultTreeAdapterMap['element']
export type HtmlNode = DefaultTreeAdapterMap['node']
export type HtmlChildNode = DefaultTreeAdapterMap['childNode']

export function parseHtml(html: string): HtmlDocument {
  return parse(html, { sourceCodeLocationInfo: true })
}

function childrenOf(node: HtmlNode | HtmlDocument): HtmlChildNode[] {
  return (node as { childNodes?: HtmlChildNode[] }).childNodes ?? []
}

export function isElement(node: HtmlChildNode): node is HtmlElement {
  return (node as { tagName?: unknown }).tagName !== undefined
}

export function findAll(
  root: HtmlDocument | HtmlNode,
  predicate: (el: HtmlElement) => boolean,
): HtmlElement[] {
  const out: HtmlElement[] = []
  const visit = (node: HtmlDocument | HtmlNode): void => {
    for (const child of childrenOf(node)) {
      if (isElement(child)) {
        if (predicate(child)) out.push(child)
        visit(child)
      } else if ((child as { childNodes?: unknown }).childNodes !== undefined) {
        visit(child as unknown as HtmlNode)
      }
    }
  }
  visit(root)
  return out
}

export function byTagName(root: HtmlDocument | HtmlNode, tagName: string): HtmlElement[] {
  const wanted = tagName.toLowerCase()
  return findAll(root, (el) => el.tagName === wanted)
}

export function getAttr(el: HtmlElement, name: string): string | undefined {
  const wanted = name.toLowerCase()
  return el.attrs.find((attr) => attr.name.toLowerCase() === wanted)?.value
}

export function getTextContent(node: HtmlNode | HtmlChildNode): string {
  const value = (node as { value?: unknown }).value
  if (typeof value === 'string') return value
  return childrenOf(node as HtmlNode)
    .map((child) => getTextContent(child))
    .join('')
}

export function getHead(root: HtmlDocument): HtmlElement | undefined {
  return byTagName(root, 'head')[0]
}

export function locationOf(el: HtmlElement): { line: number; column: number } | undefined {
  const loc = el.sourceCodeLocation
  if (!loc) return undefined
  return { line: loc.startLine, column: loc.startCol }
}

export interface Snippet {
  snippet: string
  line: number
  column: number
  truncated: boolean
}

export function snippetOf(html: string, el: HtmlElement, maxChars = 200): Snippet | undefined {
  const loc = el.sourceCodeLocation
  if (!loc) return undefined
  const { startOffset, endOffset } = loc as typeof loc & {
    startOffset?: number
    endOffset?: number
  }
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number' || endOffset <= startOffset) {
    return undefined
  }
  const raw = html.slice(startOffset, endOffset)
  const truncated = raw.length > maxChars
  return {
    snippet: truncated ? raw.slice(0, maxChars) : raw,
    line: loc.startLine,
    column: loc.startCol,
    truncated,
  }
}