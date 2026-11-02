## What this changes

<!-- One paragraph. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes, and new behaviour has tests
- [ ] `pnpm lint` and `pnpm format:check` pass
- [ ] No test requires network access
- [ ] Documentation updated (rule docs live in `docs/rules/`)
- [ ] If this touches `Finding`, `AuditResult` or an exit code, the change is called out below

## Schema and contract impact

<!--
Does this change the report schema, an exit code, or the public library API?
If yes, say how and whether schemaVersion moves (additive = minor, breaking = major).
If no, write "none".
-->

## Claims check

<!--
PageScope's value depends on not overclaiming. Confirm that any new message,
finding text or docs sentence states only what the evidence supports — no WCAG
conformance claims, no "this page is vulnerable", no invented evidence.
-->

- [ ] Text added by this PR makes no unsupported claim
