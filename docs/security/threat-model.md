# Threat model

PageScope fetches URLs chosen by the user. That makes it a potential SSRF proxy and a potential resource sink. This document lists each threat, the control, where the control lives, and the test that proves it. If a control has no test, treat it as unimplemented.

## 1. SSRF against private and reserved networks

- **Threat:** an audit target resolves to `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254` or another reserved range, turning PageScope into a proxy into the host network.
- **Control:** every resolved address is classified before a socket is opened. Blocked ranges include loopback, RFC1918, link-local (including the cloud metadata address), CGNAT, multicast, reserved space, IPv6 ULA/link-local/multicast, and IPv4-mapped IPv6 such as `::ffff:127.0.0.1`.
- **Where:** `packages/core/src/collection/ip-guard.ts` (`isBlockedAddress`, `createGuardedLookup`).
- **Test:** `packages/core/test/collection/ip-guard.test.ts` — 21 blocked addresses, 5 permitted public addresses, unparsable input treated as blocked.

## 2. DNS rebinding / TOCTOU between validation and connection

- **Threat:** a hostname resolves to a public address during validation and to a private address when the connection is actually made.
- **Control:** classification happens inside the DNS `lookup` callback, so the address used to open the socket is the address that was validated.
- **Where:** `createGuardedLookup` in `ip-guard.ts`, wired through `new Agent({ connect: { lookup } })` in `packages/core/src/collection/fetch.ts`.
- **Test:** `ip-guard.test.ts` ("rejects a hostname that resolves to loopback") plus the probe recorded in §19.2 of the design spec, which confirms undici actually routes connections through the custom lookup.

## 3. SSRF via IP literal (bypass of the DNS guard)

- **Threat:** Node skips DNS entirely when the host is already an IP literal, so a URL such as `http://169.254.169.254/` never reaches the lookup callback.
- **Control:** literal hosts are classified separately, on the initial URL **and** on every redirect hop.
- **Where:** `checkLiteralAddress` in `fetch.ts`.
- **Test:** `packages/core/test/collection/fetch.test.ts` — "blocks a loopback IP literal when the guard is fully enabled" and "blocks the cloud metadata IP literal".

## 4. Redirect-based SSRF

- **Threat:** a public URL redirects to a private one after the first hop has passed validation.
- **Control:** redirects are followed manually; every hop is re-validated and re-classified. At most five hops.
- **Where:** the redirect loop in `fetchPage` (`fetch.ts`).
- **Test:** `fetch.test.ts` — "blocks a redirect that points at a private address" (hop 1 is permitted loopback, hop 2 is the metadata address) and "refuses more than five redirects".

## 5. Resource exhaustion (slow or oversized responses)

- **Threat:** a target never responds, or streams gigabytes, exhausting memory or CI minutes.
- **Control:** a total deadline (`AbortSignal.timeout`), a streaming byte cap that destroys the socket when exceeded, and a redirect cap.
- **Where:** `readBodyBounded` and the deadline arithmetic in `fetchPage`.
- **Test:** `fetch.test.ts` — "aborts an oversized body instead of buffering it" and "times out when the server never responds".

## 6. Malicious HTML in the audited page

- **Threat:** the audited page contains markup intended to break the parser or the report.
- **Control:** parsing uses parse5 (spec-compliant, no regex), and every string that reaches a report is escaped at the point of rendering.
- **Where:** `packages/core/src/collection/parse.ts`, `packages/core/src/reporters/escape.ts`.
- **Test:** `packages/core/test/reporters/reporters.test.ts` — "never emits raw markup from the audited page".

## 7. HTML injection into the HTML report

- **Threat:** a page title or snippet containing `<script>` executes when the report is opened.
- **Control:** all dynamic values pass through `escapeHtml`; the report contains no JavaScript and carries `Content-Security-Policy: default-src 'none'`.
- **Where:** `packages/core/src/reporters/html.ts`.
- **Test:** `reporters.test.ts` — asserts `<script` never appears in the output and that the raw string is escaped instead.

## 8. Terminal escape injection

- **Threat:** a page title containing ANSI escapes or bidi overrides rewrites terminal output, hiding or falsifying findings.
- **Control:** every string of page origin is sanitised before printing: ANSI sequences, C0/C1 control characters and bidi control characters are stripped.
- **Where:** `sanitizeForTerminal` in `escape.ts`, used by `packages/cli/src/output.ts` and the Markdown reporter.
- **Test:** `reporters.test.ts` — "removes ANSI escapes, control characters and bidi overrides".

## 9. Path confusion when writing reports

- **Threat:** a crafted target URL causes a report to be written somewhere unexpected.
- **Control:** output paths come only from the literal `--out` argument; no path component is ever derived from the audited URL. Directories are refused as targets.
- **Where:** `packages/cli/src/output.ts` (`writeReportFile`).
- **Test:** covered indirectly by `packages/cli/test/cli.test.ts` ("writes the requested report file"). There is no traversal test because no code path derives a path from a URL; if such a path is ever added, a test must be added with it.

## 10. Sensitive data in reports and logs

- **Threat:** cookies or authorisation headers from the audited site end up in a report attached to a CI artefact.
- **Control:** `set-cookie` values are discarded at collection time (only cookie names are kept), and `authorization` headers are dropped entirely.
- **Where:** `summarizeHeaders` in `fetch.ts`.
- **Test:** `fetch.test.ts` — "records cookie names but never cookie values".

## Out of scope for v0.1.0

- **Hosted multi-tenant auditing.** No authentication, rate limiting or per-tenant isolation exists. Do not expose PageScope publicly. `SECURITY.md` states the self-hoster's responsibilities.
- **Browser-based auditing.** Pages are never rendered, so no script from the audited origin ever executes in this process.
- **Certificate validation.** PageScope does not inspect certificates; the `security/https` rule text says so explicitly.
