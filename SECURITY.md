# Security policy

## Supported versions

PageScope is pre-1.0. Security fixes are made on `main` only; there are no maintained release branches yet.

## Reporting a vulnerability

Please use **GitHub private vulnerability reporting** on this repository (Security tab → "Report a vulnerability"). Do not open a public issue for a suspected vulnerability, and do not include working exploit code in a public discussion.

There is no dedicated security email address. Do not assume one exists.

Helpful reports include: the affected version or commit, the exact command that triggers the problem, what you expected versus what happened, and whether the target URL was attacker-controlled.

## Scope

PageScope fetches URLs that the user supplies, so the network boundary is the most security-relevant part of the codebase. Reports about the following are especially welcome:

- bypassing the private/reserved address guard (`packages/core/src/collection/ip-guard.ts` and `checkLiteralAddress` in `packages/core/src/collection/fetch.ts`);
- redirect handling that reaches a disallowed destination;
- response-size or timeout limits that can be circumvented;
- HTML or terminal injection through content taken from an audited page;
- report files being written to unintended paths.

## Self-hosting responsibilities

PageScope is designed to run locally. If you expose it as a hosted service, **you** are responsible for the controls this project does not provide:

- authentication and authorisation for anyone who can submit a URL;
- rate limiting and abuse prevention;
- network egress isolation so the auditing process cannot reach your internal infrastructure;
- log hygiene, since audited URLs may themselves be sensitive.

The current design does not implement those controls, and nothing in this repository should be read as claiming that a publicly exposed PageScope instance is safe.
