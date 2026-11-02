import { describe, expect, it } from 'vitest'
import {
  byTagName,
  findAll,
  getAttr,
  getHead,
  getTextContent,
  locationOf,
  parseHtml,
  snippetOf,
} from '../../src/collection/parse.js'

describe('parseHtml', () => {
  it('finds elements by tag name', () => {
    const doc = parseHtml(
      '<html><head><title>Hi</title></head><body><img src="a.png"></body></html>',
    )
    expect(byTagName(doc, 'title')).toHaveLength(1)
    expect(byTagName(doc, 'img')).toHaveLength(1)
    expect(byTagName(doc, 'video')).toHaveLength(0)
  })

  it('reports a source location for explicitly written elements', () => {
    const doc = parseHtml('<html><head><title>Hi</title></head><body></body></html>')
    const [title] = byTagName(doc, 'title')
    const location = locationOf(title!)
    expect(location).toBeDefined()
    expect(location!.line).toBeGreaterThan(0)
    expect(location!.column).toBeGreaterThan(0)
  })

  it('has no source location for nodes the parser inserted implicitly', () => {
    const doc = parseHtml('<html><body><table><tr><td>x</td></tr></table></body></html>')
    const [tbody] = byTagName(doc, 'tbody')
    expect(tbody).toBeDefined()
    expect(locationOf(tbody!)).toBeUndefined()
  })

  it('returns the raw source snippet of an element', () => {
    const html = '<html><head><title>Hello there</title></head></html>'
    const [title] = byTagName(parseHtml(html), 'title')
    const snippet = snippetOf(html, title!)
    expect(snippet?.snippet).toBe('<title>Hello there</title>')
    expect(snippet?.truncated).toBe(false)
  })

  it('truncates long snippets and flags them', () => {
    const html = `<html><head><title>${'x'.repeat(400)}</title></head></html>`
    const [title] = byTagName(parseHtml(html), 'title')
    const snippet = snippetOf(html, title!, 50)
    expect(snippet?.snippet.length).toBe(50)
    expect(snippet?.truncated).toBe(true)
  })

  it('reads attributes case-insensitively and text content', () => {
    const doc = parseHtml(
      '<html><body><img SRC="a.png" alt="A cat"><p>Hello <b>world</b></p></body></html>',
    )
    const [img] = byTagName(doc, 'img')
    expect(getAttr(img!, 'src')).toBe('a.png')
    expect(getAttr(img!, 'alt')).toBe('A cat')
    expect(getAttr(img!, 'title')).toBeUndefined()
    const [p] = byTagName(doc, 'p')
    expect(getTextContent(p!).trim()).toBe('Hello world')
  })

  it('finds the head element even when the parser synthesises it', () => {
    expect(getHead(parseHtml('<html><head><title>x</title></head></html>'))).toBeDefined()
    expect(getHead(parseHtml('just text'))).toBeDefined()
  })

  it('collects nodes matching a predicate', () => {
    const doc = parseHtml(
      '<html><body><input id="a"><input id="b"><p id="c"></p></body></html>',
    )
    const withId = findAll(doc, (el) => getAttr(el, 'id') !== undefined)
    expect(withId.map((el) => getAttr(el, 'id'))).toEqual(['a', 'b', 'c'])
  })
})