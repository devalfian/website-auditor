# a11y/img-alt

Severity is decided per rule, not per category. Every finding carries its severity and a separate confidence value.

## What this rule checks

Reports <img> elements that have no alt attribute at all.

## What this rule does not check

It does not check whether the alt text is useful, or whether the page meets any accessibility standard. This check does not establish WCAG conformance.

## Statuses

- `passed` — the rule ran and the condition held.
- `failed` — the rule ran and the condition did not hold.
- `needs-review` — used where the correct answer depends on intent PageScope cannot know.
- `not-applicable` — the rule does not apply to this page.
- `error` — set by the engine when the rule throws. A rule that did not run is never reported as passed.
- `unobservable` — set by the engine when the page is rendered client-side and this rule needs the rendered DOM. A rule cannot return this status.

## Observation source

This rule declares `observation: 'rendered-dom'`.

It needs the DOM after JavaScript has run. On a page PageScope detects as client-rendered, the engine reports this rule as unobservable and never calls evaluate.

## Evidence

Evidence is whatever was actually observed: an escaped source snippet with line and column, a response header, an HTTP response, a measurement, or an explicit statement of what was searched for and not found. PageScope never fabricates a snippet for something that is absent.

## Recommendation

The finding carries a remediation sentence, and where a mechanical fix is possible, a patch marked `exact: true`. Templates are marked `exact: false` so you can tell the difference.

## References

- https://html.spec.whatwg.org/multipage/images.html#alt
