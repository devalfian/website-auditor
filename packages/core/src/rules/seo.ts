import { findAll, getHead, getTextContent } from '../collection/parse.js'
import { elementEvidence, findMeta, headScope, locationProps } from './shared.js'
import type { RuleDefinition } from '../contracts/types.js'

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

export const seoRules: RuleDefinition[] = [titleRule, metaDescriptionRule]