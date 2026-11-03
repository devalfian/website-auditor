import { describe, expect, it } from 'vitest'
import { detectRendering } from '../../src/collection/rendering.js'
import { parseHtml } from '../../src/collection/parse.js'

const assess = (html: string) => detectRendering(parseHtml(html), html)

describe('detectRendering', () => {
  it('treats an ordinary page as server-rendered and cites no evidence', () => {
    const result = assess(
      '<!doctype html><html><head><title>t</title></head><body><h1>Hi</h1><p>Body</p></body></html>',
    )
    expect(result.kind).toBe('server-rendered')
    expect(result.evidence).toEqual([])
    expect(result.reason).toContain('no client-side rendering signal')
  })

  it('detects an empty React mount point', () => {
    const result = assess(
      '<!doctype html><html><body><div id="root"></div><script src="/main.js"></script></body></html>',
    )
    expect(result.kind).toBe('client-rendered')
    expect(result.reason).toContain('"root"')
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]?.kind).toBe('html-snippet')
  })

  it('detects every mount point id in the list', () => {
    for (const id of ['root', 'app', '__next', '__nuxt', '___gatsby']) {
      const result = assess(`<!doctype html><html><body><div id="${id}"></div></body></html>`)
      expect(result.kind, `id=${id}`).toBe('client-rendered')
    }
  })

  it('detects an empty Angular root element', () => {
    const result = assess('<!doctype html><html><body><app-root></app-root></body></html>')
    expect(result.kind).toBe('client-rendered')
    expect(result.reason).toContain('app-root')
  })

  it('treats a mount point holding only whitespace as empty', () => {
    const result = assess('<!doctype html><html><body><div id="root">\n  \n</div></body></html>')
    expect(result.kind).toBe('client-rendered')
  })

  it('does not fire when the mount point already holds content', () => {
    const result = assess(
      '<!doctype html><html><body><div id="root"><h1>Server rendered</h1></div></body></html>',
    )
    expect(result.kind).toBe('server-rendered')
    expect(result.evidence).toEqual([])
  })

  it('does not fire on an unrelated empty div', () => {
    const result = assess('<!doctype html><html><body><div id="sidebar"></div></body></html>')
    expect(result.kind).toBe('server-rendered')
  })

  it('detects a noscript block that demands JavaScript', () => {
    const result = assess(
      '<!doctype html><html><body><noscript>You need to enable JavaScript to run this app.</noscript></body></html>',
    )
    expect(result.kind).toBe('client-rendered')
    expect(result.reason).toContain('<noscript>')
    expect(result.evidence).toHaveLength(1)
  })

  it('reports both signals when both fire', () => {
    const result = assess(
      '<!doctype html><html><body><div id="root"></div><noscript>Please enable JavaScript</noscript></body></html>',
    )
    expect(result.kind).toBe('client-rendered')
    expect(result.evidence).toHaveLength(2)
    expect(result.reason).toContain('"root"')
    expect(result.reason).toContain('<noscript>')
  })
})
