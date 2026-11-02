# seo/title

Severity is decided per rule, not per category. Every finding carries its severity and a separate confidence value.

## What this rule checks

Checks that <head> contains a <title> element with non-empty text.

## What this rule does not check

It does not check title quality, length, uniqueness across pages, or keyword usage. This is a presence check, not a ranking opinion.

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

- https://html.spec.whatwg.org/multipage/semantics.html#the-title-element
