// Generates docs/rules/<slug>.md for every registered rule.
// Titles and descriptions come from the built rules, so they cannot drift.
// `notChecks` is per-rule prose and must be updated by hand when a rule changes.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { allRules } from '../packages/core/dist/index.js'

const NOT_CHECKS = {
  'seo/title':
    'title quality, length, uniqueness across pages, or keyword usage. This is a presence check, not a ranking opinion.',
  'seo/meta-description':
    'whether the description affects search ranking. The finding text states explicitly that no such claim is made.',
  'seo/canonical':
    'whether the declared canonical is the correct one for the site. With one page PageScope cannot know which URL should win.',
  'seo/robots-meta':
    'intent. A noindex directive is correct on a staging site and wrong on a public page, so blocking directives produce needs-review rather than failed.',
  'seo/open-graph':
    'how any social platform renders the preview, or whether the referenced image exists.',
  'seo/heading-structure':
    'headings built with role="heading" or aria-level. Only real h1–h6 elements are inspected, and multiple h1 is valid HTML5.',
  'technical/duplicate-id':
    'whether the page’s own JavaScript depends on the duplication, for example by querying the first match.',
  'technical/meta-viewport': 'the quality of the viewport value. Any content value passes.',
  'technical/http-status':
    'whether a non-2xx status is intentional, or whether any link to this page is broken. A 404 is never reported as a broken link.',
  'a11y/img-alt':
    'whether the alt text is useful, or whether the page meets any accessibility standard. This check does not establish WCAG conformance.',
  'a11y/html-lang':
    'whether the declared language matches the content, or whether it is a valid BCP 47 tag.',
  'security/https':
    'certificate validity, expiration, or TLS configuration strength. That is the browser’s job.',
  'security/security-headers':
    'whether the values are configured correctly, or whether any attack is possible. A header being present does not prove a secure configuration, and a header being absent does not prove an attack is possible.',
}

const REFERENCES = {
  'seo/title': 'https://html.spec.whatwg.org/multipage/semantics.html#the-title-element',
  'seo/meta-description': 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta/name',
  'seo/canonical': 'https://www.rfc-editor.org/rfc/rfc6596',
  'seo/robots-meta': 'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag',
  'seo/open-graph': 'https://ogp.me/',
  'seo/heading-structure':
    'https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines',
  'technical/duplicate-id': 'https://html.spec.whatwg.org/multipage/dom.html#the-id-attribute',
  'technical/meta-viewport': 'https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag',
  'technical/http-status': 'https://www.rfc-editor.org/rfc/rfc9110#section-15',
  'a11y/img-alt': 'https://html.spec.whatwg.org/multipage/images.html#alt',
  'a11y/html-lang':
    'https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes',
  'security/https': 'https://www.rfc-editor.org/rfc/rfc9110#section-4.2.2',
  'security/security-headers': 'https://owasp.org/www-project-secure-headers/',
}

const render = (rule) => `# ${rule.id}

Severity is decided per rule, not per category. Every finding carries its severity and a separate confidence value.

## What this rule checks

${rule.description}

## What this rule does not check

It does not check ${NOT_CHECKS[rule.id]}

## Statuses

- \`passed\` — the rule ran and the condition held.
- \`failed\` — the rule ran and the condition did not hold.
- \`needs-review\` — used where the correct answer depends on intent PageScope cannot know.
- \`not-applicable\` — the rule does not apply to this page.
- \`error\` — set by the engine when the rule throws. A rule that did not run is never reported as passed.
- \`unobservable\` — set by the engine when the page is rendered client-side and this rule needs the rendered DOM. A rule cannot return this status.

## Observation source

This rule declares \`observation: '${rule.observation}'\`.

${
  rule.observation === 'rendered-dom'
    ? 'It needs the DOM after JavaScript has run. On a page PageScope detects as client-rendered, the engine reports this rule as unobservable and never calls evaluate.'
    : 'It reaches a conclusion from the served response alone, so client-side rendering does not affect it.'
}

## Evidence

Evidence is whatever was actually observed: an escaped source snippet with line and column, a response header, an HTTP response, a measurement, or an explicit statement of what was searched for and not found. PageScope never fabricates a snippet for something that is absent.

## Recommendation

The finding carries a remediation sentence, and where a mechanical fix is possible, a patch marked \`exact: true\`. Templates are marked \`exact: false\` so you can tell the difference.

## References

- ${REFERENCES[rule.id]}
`

const target = join(process.cwd(), 'docs', 'rules')
await mkdir(target, { recursive: true })

for (const rule of allRules) {
  await writeFile(join(target, `${rule.docsSlug}.md`), render(rule), 'utf8')
}

console.log(`wrote ${allRules.length} rule documents to docs/rules`)
