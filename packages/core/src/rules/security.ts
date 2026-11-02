import type { RuleDefinition } from '../contracts/types.js'

export const httpsRule: RuleDefinition = {
  id: 'security/https',
  category: 'security',
  title: 'Page is served over HTTPS',
  description: 'Checks the scheme of the final URL after redirects.',
  docsSlug: 'security-https',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    if (snapshot.finalUrl.startsWith('https:')) {
      return { status: 'passed', findings: [], note: `final URL is ${snapshot.finalUrl}` }
    }

    return {
      status: 'failed',
      findings: [
        {
          severity: 'high',
          confidence: 'high',
          title: 'Page is not served over HTTPS',
          description:
            'The final response was delivered over plain HTTP, so traffic between the visitor and this page is not encrypted. PageScope does not validate certificates; that is the browser\u2019s job.',
          evidence: [
            {
              kind: 'http-response',
              status: snapshot.httpStatus,
              finalUrl: snapshot.finalUrl,
              redirectChain: snapshot.redirectChain,
            },
            {
              kind: 'measurement',
              label: 'requested scheme',
              value: new URL(snapshot.requestedUrl).protocol,
            },
          ],
          recommendation:
            'Serve the site over HTTPS and redirect plain HTTP requests to the HTTPS URL.',
        },
      ],
    }
  },
}

const EXPECTED_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['strict-transport-security', 'HSTS'],
  ['content-security-policy', 'CSP'],
  ['x-content-type-options', 'X-Content-Type-Options'],
  ['referrer-policy', 'Referrer-Policy'],
]

export const securityHeadersRule: RuleDefinition = {
  id: 'security/security-headers',
  category: 'security',
  title: 'Common security headers are present',
  description:
    'Reports which of HSTS, CSP, X-Content-Type-Options and Referrer-Policy are absent from the response.',
  docsSlug: 'security-headers',
  appliesTo: () => true,
  evaluate: (snapshot) => {
    const missing = EXPECTED_HEADERS.filter(
      ([header]) => snapshot.headers.headers[header] === undefined,
    )

    if (missing.length === 0) {
      return { status: 'passed', findings: [], note: 'all four headers present' }
    }

    const labels = missing.map(([, label]) => label).join(', ')

    return {
      status: 'failed',
      findings: [
        {
          severity: 'low',
          confidence: 'high',
          title: 'Missing security headers',
          description: `These response headers were not sent: ${labels}. This rule reports absence only: a header being present does not prove a secure configuration, and a header being absent does not prove an attack is possible.`,
          evidence: [
            { kind: 'measurement', label: 'missing security headers', value: labels },
            {
              kind: 'absence',
              expected: missing.map(([header]) => header).join(', '),
              scope: 'scanned the response headers',
            },
          ],
          recommendation:
            'Review each missing header against your deployment platform and add the ones your site can support without breaking.',
        },
      ],
    }
  },
}

export const securityRules: RuleDefinition[] = [httpsRule, securityHeadersRule]
