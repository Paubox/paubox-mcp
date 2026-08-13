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
) => Promise<{ status: number }>

// Hits a cheap, auth-gated Paubox endpoint to confirm the apiKey is
// accepted before the server hands out an OAuth token or reports
// success from the validate_credentials tool. The endpoint mirrors
// `getEmailDisposition` in lib/paubox-email.ts so the auth model is
// identical to what send_secure_email / check_email_status use at runtime.
//
// 401/403           → { ok: false }   credentials rejected by Paubox
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
    'https://api.paubox.com/v1' +
    '/message_receipt?sourceTrackingId=00000000-0000-0000-0000-000000000000'

  try {
    const res = await httpGet(url, {
      headers: {
        Authorization: `Token token=${apiKey}`,
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
    return { ok: true }
  } catch {
    // Network error, timeout, DNS failure, etc. Soft-pass: a Paubox
    // outage must not block all new connector adds.
    return { ok: true }
  }
}
