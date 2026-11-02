import { findAll, getAttr, getHead, getTextContent } from '../collection/parse.js'
import type { HtmlElement } from '../collection/parse.js'
import { elementEvidence, findMeta, headScope, locationProps } from './shared.js'
import type { AuditSnapshot, RuleDefinition } from '../contracts/types.js'

export const titleRule: RuleDefinition = {
  id: 'seo/title',
  category: 'seo',
  title: 'Page declares a non-empty <title>',
  description: 'Checks that <head> contains a <title> element with non-empty text.',
  docsSlug: 'seo-title',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const head = getHead(snapshot.document)
    const title = head ? findAll(head, (el) => el.tagName === 'title')[0] : undefined

    if (!title) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'high',
            confidence: 'high',
            title: 'Missing <title> element',
            description:
              'The document has no <title> element inside <head>. Browsers and search result listings use it as the page title.',
            evidence: [
              { kind: 'absence', expected: '<title> inside <head>', scope: headScope(snapshot) },
            ],
            recommendation:
              'Add a <title> element inside <head> describing this specific page, and keep it unique across pages.',
            patch: {
              kind: 'insert',
              target: 'html',
              after: '<title>{{page title}}</title>',
              exact: false,
            },
          },
        ],
      }
    }

    const text = getTextContent(title).trim()
    if (text === '') {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'high',
            confidence: 'high',
            title: '<title> is empty',
            description: 'The <title> element exists but contains only whitespace.',
            evidence: [elementEvidence(snapshot, title)],
            recommendation: 'Put a descriptive page title inside the <title> element.',
            ...locationProps(title),
            patch: {
              kind: 'replace',
              target: 'html',
              before: '<title></title>',
              after: '<title>{{page title}}</title>',
              exact: false,
            },
          },
        ],
      }
    }

    return { status: 'passed', findings: [], note: `title length: ${text.length} characters` }
  },
}

export const metaDescriptionRule: RuleDefinition = {
  id: 'seo/meta-description',
  category: 'seo',
  title: 'Page declares a non-empty meta description',
  description: 'Checks for <meta name="description"> with non-empty content inside <head>.',
  docsSlug: 'seo-meta-description',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const meta = findMeta(snapshot, 'name', 'description')

    if (!meta) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'medium',
            confidence: 'high',
            title: 'Missing meta description',
            description:
              'No <meta name="description"> element was found in <head>. This rule verifies presence only and makes no claim about search ranking effects.',
            evidence: [
              {
                kind: 'absence',
                expected: '<meta name="description"> inside <head>',
                scope: headScope(snapshot),
              },
            ],
            recommendation:
              'Add <meta name="description" content="..."> describing the page in one or two sentences.',
            patch: {
              kind: 'insert',
              target: 'html',
              after: '<meta name="description" content="{{page summary}}">',
              exact: false,
            },
          },
        ],
      }
    }

    const content = (
      meta.attrs.find((attr) => attr.name.toLowerCase() === 'content')?.value ?? ''
    ).trim()

    if (content === '') {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'medium',
            confidence: 'high',
            title: 'Meta description is empty',
            description:
              'A <meta name="description"> element exists but its content attribute is empty or missing.',
            evidence: [elementEvidence(snapshot, meta)],
            recommendation:
              'Set the content attribute to a one or two sentence summary of the page.',
            ...locationProps(meta),
            patch: {
              kind: 'replace',
              target: 'html',
              before: '<meta name="description" content="">',
              after: '<meta name="description" content="{{page summary}}">',
              exact: false,
            },
          },
        ],
      }
    }

    return {
      status: 'passed',
      findings: [],
      note: `description length: ${content.length} characters`,
    }
  },
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function canonicalLink(snapshot: AuditSnapshot): HtmlElement | undefined {
  const head = getHead(snapshot.document)
  if (!head) return undefined
  return findAll(head, (el) => {
    if (el.tagName !== 'link') return false
    const rel = (getAttr(el, 'rel') ?? '').toLowerCase().split(/\s+/)
    return rel.includes('canonical')
  })[0]
}

export const canonicalRule: RuleDefinition = {
  id: 'seo/canonical',
  category: 'seo',
  title: 'Page declares an absolute canonical URL',
  description: 'Checks for <link rel="canonical"> with an absolute href inside <head>.',
  docsSlug: 'seo-canonical',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const link = canonicalLink(snapshot)

    if (!link) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'low',
            confidence: 'high',
            title: 'Missing canonical URL',
            description:
              'No <link rel="canonical"> element was found in <head>. PageScope reports the absence of the declaration; it cannot know which URL should be canonical for this site.',
            evidence: [
              {
                kind: 'absence',
                expected: '<link rel="canonical"> inside <head>',
                scope: headScope(snapshot),
              },
            ],
            recommendation:
              'Declare the preferred absolute URL for this page with <link rel="canonical" href="...">.',
            patch: {
              kind: 'insert',
              target: 'html',
              after: '<link rel="canonical" href="{{absolute page URL}}">',
              exact: false,
            },
          },
        ],
      }
    }

    const href = (getAttr(link, 'href') ?? '').trim()

    if (href === '') {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'low',
            confidence: 'high',
            title: 'Canonical href is empty',
            description: 'The canonical link element exists but has no href attribute value.',
            evidence: [elementEvidence(snapshot, link)],
            recommendation: 'Set href to the absolute URL of the preferred page.',
            ...locationProps(link),
          },
        ],
      }
    }

    if (!isAbsoluteUrl(href)) {
      const absolute = new URL(href, snapshot.finalUrl).toString()
      return {
        status: 'failed',
        findings: [
          {
            severity: 'low',
            confidence: 'medium',
            title: 'Canonical URL is not absolute',
            description:
              'The canonical href is relative. Relative canonicals are resolved differently by different consumers, so an absolute URL is safer.',
            evidence: [elementEvidence(snapshot, link)],
            recommendation: `Use the absolute form, for example "${absolute}".`,
            ...locationProps(link),
            patch: {
              kind: 'replace',
              target: 'html',
              before: `href="${href}"`,
              after: `href="${absolute}"`,
              exact: true,
            },
          },
        ],
      }
    }

    return { status: 'passed', findings: [], note: `canonical: ${href}` }
  },
}

const BLOCKING_ROBOTS_DIRECTIVES = new Set(['noindex', 'nofollow', 'none'])

export const robotsMetaRule: RuleDefinition = {
  id: 'seo/robots-meta',
  category: 'seo',
  title: 'Page carries no unintentional robots blocking directives',
  description:
    'Inspects <meta name="robots"> and reports index/follow blocking directives for human review.',
  docsSlug: 'seo-robots-meta',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const meta = findMeta(snapshot, 'name', 'robots')

    if (!meta) {
      return { status: 'passed', findings: [], note: 'no robots meta directive present' }
    }

    const content = (getAttr(meta, 'content') ?? '').toLowerCase()
    const directives = content
      .split(',')
      .map((directive) => directive.trim())
      .filter((directive) => directive !== '')
    const blocking = directives.filter((directive) => BLOCKING_ROBOTS_DIRECTIVES.has(directive))

    if (blocking.length === 0) {
      return { status: 'passed', findings: [], note: `robots: ${directives.join(', ')}` }
    }

    return {
      status: 'needs-review',
      findings: [
        {
          severity: 'medium',
          confidence: 'medium',
          title: `Robots meta contains "${blocking.join(', ')}"`,
          description:
            'This page asks crawlers not to index or follow it. That is correct for staging or private pages and wrong for public ones; PageScope cannot determine which applies here.',
          evidence: [elementEvidence(snapshot, meta)],
          recommendation:
            'Confirm the directive is intentional. Remove it from pages that should appear in search results.',
          ...locationProps(meta),
        },
      ],
    }
  },
}

const OG_PROPERTIES = ['og:title', 'og:description', 'og:image', 'og:url'] as const

export const openGraphRule: RuleDefinition = {
  id: 'seo/open-graph',
  category: 'seo',
  title: 'Page declares the core Open Graph properties',
  description: 'Checks for og:title, og:description, og:image and og:url meta properties.',
  docsSlug: 'seo-open-graph',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const missing = OG_PROPERTIES.filter(
      (property) => findMeta(snapshot, 'property', property) === undefined,
    )

    if (missing.length === 0) {
      return { status: 'passed', findings: [], note: 'all core Open Graph properties present' }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'low',
          confidence: 'high',
          title: 'Missing Open Graph properties',
          description: `The page does not declare ${missing.join(', ')}. PageScope verifies the presence of the tags only; it does not check how any social platform renders a preview.`,
          evidence: [
            {
              kind: 'measurement',
              label: 'missing Open Graph properties',
              value: missing.join(', '),
            },
            {
              kind: 'absence',
              expected: '<meta property="og:*"> inside <head>',
              scope: headScope(snapshot),
            },
          ],
          recommendation:
            'Add the missing <meta property="og:..."> tags inside <head>, using absolute URLs for og:image and og:url.',
        },
      ],
    }
  },
}

export const headingStructureRule: RuleDefinition = {
  id: 'seo/heading-structure',
  category: 'seo',
  title: 'Heading order is unambiguous',
  description: 'Counts <h1> elements and reports heading levels that skip a level.',
  docsSlug: 'seo-heading-structure',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const headings = findAll(snapshot.document, (el) => /^h[1-6]$/.test(el.tagName))
    const h1s = headings.filter((el) => el.tagName === 'h1')

    if (h1s.length === 0) {
      return {
        status: 'failed',
        findings: [
          {
            severity: 'medium',
            confidence: 'high',
            title: 'No <h1> on the page',
            description:
              'The document contains no <h1> element. PageScope inspects real heading elements only; headings built with role="heading" are not detected.',
            evidence: [
              {
                kind: 'absence',
                expected: '<h1>',
                scope: `scanned ${headings.length} heading elements`,
              },
            ],
            recommendation: 'Add a single <h1> describing the main subject of the page.',
          },
        ],
      }
    }

    if (h1s.length > 1) {
      return {
        status: 'needs-review',
        findings: [
          {
            severity: 'medium',
            confidence: 'low',
            title: `Multiple <h1> elements (${h1s.length})`,
            description:
              'More than one <h1> is valid HTML5, but many style guides and templates expect exactly one. PageScope cannot tell which convention this project follows.',
            evidence: [
              { kind: 'measurement', label: 'h1 count', value: h1s.length },
              ...h1s.map((el) => elementEvidence(snapshot, el)),
            ],
            recommendation:
              'If the template expects a single top-level heading, demote the extra ones to <h2>.',
          },
        ],
      }
    }

    let previous = 0
    for (const heading of headings) {
      const level = Number(heading.tagName[1])
      if (previous !== 0 && level > previous + 1) {
        return {
          status: 'needs-review',
          findings: [
            {
              severity: 'medium',
              confidence: 'low',
              title: `Heading level jumps from h${previous} to h${level}`,
              description:
                'Skipped heading levels can confuse assistive technology that builds a document outline. Some templates generate this pattern intentionally.',
              evidence: [elementEvidence(snapshot, heading)],
              recommendation: `Add the missing h${level - 1} level, or confirm the structure is intentional.`,
              ...locationProps(heading),
            },
          ],
        }
      }
      previous = level
    }

    return { status: 'passed', findings: [], note: `checked ${headings.length} headings` }
  },
}

export const seoRules: RuleDefinition[] = [
  titleRule,
  metaDescriptionRule,
  canonicalRule,
  robotsMetaRule,
  openGraphRule,
  headingStructureRule,
]