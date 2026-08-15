import axios, { AxiosRequestConfig } from 'axios'

export type CredentialCheckResult =
  | { ok: true }
  | { ok: false; reason: string }

// Minimal shape we need from the HTTP client — `axios.get` satisfies it.
// Exposed so unit tests can inject a fake without depending on jest's
// module-mock system (which is brittle under ts-jest ESM).
export type HttpGet = (
  url: string,
  config: AxiosRequestConfig,
) => Promise<{ status: number; data?: unknown; headers?: unknown }>

// True when a response body is an HTML document rather than an API payload.
// The Paubox gateway serves an HTML error page for paths it cannot route, so
// an HTML body means the request never reached the Email API at all.
function looksLikeHtml(res: { data?: unknown; headers?: unknown }): boolean {
  const headers = res.headers as Record<string, unknown> | undefined
  const contentType = headers?.['content-type'] ?? headers?.['Content-Type']
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('text/html')) {
    return true
  }
  return typeof res.data === 'string' && /^\s*<(!doctype|html)/i.test(res.data)
}

// Hits a cheap, auth-gated Paubox endpoint to confirm the apiKey is
// accepted before the server hands out an OAuth token or reports
// success from the validate_credentials tool. The endpoint mirrors
// `getEmailDisposition` in lib/paubox-email.ts so the auth model is
// identical to what send_secure_email / check_email_status use at runtime.
//
// 401/403           → { ok: false }   credentials rejected by Paubox
// 404 + HTML body   → { ok: false }   request never reached the Email API
//                                      (gateway could not route the path);
//                                      that is our bug, not an outage, and
//                                      must not be reported as "validated"
// any other outcome → { ok: true }    soft-pass; a Paubox outage must not
//                                      block all new connector adds
export async function checkPauboxCredentials(
  apiKey: string,
  httpGet: HttpGet = axios.get,
): Promise<CredentialCheckResult> {
  if (!apiKey) {
    return { ok: false, reason: 'API key is required.' }
  }

  // Integration test escape hatch. The unit tests inject `httpGet` directly,
  // but supertest-driven tests hit a real Next.js process whose route code
  // calls the live `axios.get`; without this gate they would hit the real
  // Paubox API and fail on the placeholder credentials used in fixtures.
  // Gated on NODE_ENV !== 'production' so an accidental prod env-var leak
  // can't silently disable the live-validation gate this module exists to
  // enforce.
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.PAUBOX_BYPASS_CRED_VALIDATION === 'true'
  ) {
    return { ok: true }
  }

  const url =
    'https://api.paubox.com/v1/email' +
    '/message_receipt?sourceTrackingId=00000000-0000-0000-0000-000000000000'

  try {
    const res = await httpGet(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
      // Don't throw on 4xx — we need to read the status to distinguish
      // auth errors (401/403) from "good creds, no such message" (404).
      validateStatus: () => true,
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'Invalid API key.' }
    }
    // A 404 from the Email API itself is the expected "valid credentials, no
    // such message" answer for the placeholder tracking ID above, so it stays
    // a pass. A 404 carrying an HTML body is the gateway's not-found page:
    // the base URL is wrong and nothing was actually validated.
    if (res.status === 404 && looksLikeHtml(res)) {
      return {
        ok: false,
        reason:
          'Could not reach the Paubox Email API — the request was not routed ' +
          'to it. This is a server configuration problem, not a bad API key.',
      }
    }
    return { ok: true }
  } catch {
    // Network error, timeout, DNS failure, etc. Soft-pass: a Paubox
    // outage must not block all new connector adds.
    return { ok: true }
  }
}
