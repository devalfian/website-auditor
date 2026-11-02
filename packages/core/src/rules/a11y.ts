import { findAll, getAttr, type HtmlElement } from '../collection/parse.js'
import { elementEvidence, locationProps } from './shared.js'
import type { FindingDraft, RuleDefinition } from '../contracts/types.js'

export const imgAltRule: RuleDefinition = {
  id: 'a11y/img-alt',
  category: 'accessibility',
  title: 'Images declare an alt attribute',
  description: 'Reports <img> elements that have no alt attribute at all.',
  docsSlug: 'a11y-img-alt',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const images = findAll(snapshot.document, (el) => el.tagName === 'img')

    if (images.length === 0) {
      return { status: 'not-applicable', findings: [], note: 'no <img> elements on the page' }
    }

    const missing = images.filter((el) => getAttr(el, 'alt') === undefined)

    if (missing.length === 0) {
      return {
        status: 'passed',
        findings: [],
        note: `${images.length} images declare an alt attribute`,
      }
    }

    const findings = missing.map((el: HtmlElement): FindingDraft => ({
      severity: 'medium',
      confidence: 'high',
      title: '<img> without an alt attribute',
      description:
        'This image has no alt attribute at all. PageScope checks for the attribute only: it cannot judge whether existing alt text is useful, and alt="" is treated as an intentional decorative image.',
      evidence: [elementEvidence(snapshot, el)],
      recommendation: 'Add alt text describing the image, or alt="" if it is purely decorative.',
      ...locationProps(el),
      patch: {
        kind: 'insert',
        target: 'html',
        after: 'alt="{{describe the image}}"',
        exact: false,
      },
    }))

    return { status: 'failed', findings }
  },
}

export const htmlLangRule: RuleDefinition = {
  id: 'a11y/html-lang',
  category: 'accessibility',
  title: 'Document declares a language',
  description: 'Checks that the <html> element has a non-empty lang attribute.',
  docsSlug: 'a11y-html-lang',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const html = findAll(snapshot.document, (el) => el.tagName === 'html')[0]

    if (!html) {
      return {
        status: 'not-applicable',
        findings: [],
        note: 'the parser produced no <html> element',
      }
    }

    const lang = (getAttr(html, 'lang') ?? '').trim()

    if (lang !== '') {
      return { status: 'passed', findings: [], note: `html lang="${lang}"` }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'medium',
          confidence: 'high',
          title: 'Missing lang attribute on <html>',
          description:
            'The <html> element has no lang attribute. Screen readers use it to choose pronunciation rules. PageScope does not verify that the declared language matches the content.',
          evidence: [
            {
              kind: 'absence',
              expected: 'lang attribute on <html>',
              scope: 'checked the <html> element',
            },
          ],
          recommendation: 'Add a language tag to the root element, for example <html lang="en">.',
          ...locationProps(html),
          patch: {
            kind: 'insert',
            target: 'html',
            after: 'lang="{{language code}}"',
            exact: false,
          },
        },
      ],
    }
  },
}

export const a11yRules: RuleDefinition[] = [imgAltRule, htmlLangRule]
