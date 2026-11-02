# a11y/html-lang

Severity is decided per rule, not per category. Every finding carries its severity and a separate confidence value.

## What this rule checks

Checks that the <html> element has a non-empty lang attribute.

## What this rule does not check

It does not check whether the declared language matches the content, or whether it is a valid BCP 47 tag.

## Statuses

- `passed` — the rule ran and the condition held.
- `failed` — the rule ran and the condition did not hold.
- `needs-review` — used where the correct answer depends on intent PageScope cannot know.
- `not-applicable` — the rule does not apply to this page.
- `error` — set by the engine when the rule throws. A rule that did not run is never reported as passed.

## Evidence

Evidence is whatever was actually observed: an escaped source snippet with line and column, a response header, an HTTP response, a measurement, or an explicit statement of what was searched for and not found. PageScope never fabricates a snippet for something that is absent.

## Recommendation

The finding carries a remediation sentence, and where a mechanical fix is possible, a patch marked `exact: true`. Templates are marked `exact: false` so you can tell the difference.

## References

- https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes
