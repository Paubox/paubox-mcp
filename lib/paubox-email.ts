import axios, { AxiosRequestConfig } from 'axios'

// All Email API requests are served under /v1/email; the bare /v1 prefix is
// not routed and dies at the gateway with an HTML 404.
export const EMAIL_API_BASE_URL = 'https://api.paubox.com/v1/email'

// Minimal shape we need from the HTTP client — `axios.request` satisfies it.
// Exposed so unit tests can inject a fake without depending on jest's
// module-mock system (same pattern as lib/paubox-forms.ts).
export type HttpRequest = (
  config: AxiosRequestConfig,
) => Promise<{ status: number; data: unknown }>

export interface SendEmailOptions {
  from: string
  to: string[]
  subject: string
  textContent: string
  htmlContent: string
  cc?: string[]
  bcc?: string[]
  forceSecureNotification?: boolean
}

export interface SendEmailResponse {
  sourceTrackingId?: string
  data?: { message_id?: string }
  errors?: unknown
}

export interface ScheduleEmailResponse {
  sourceTrackingId?: string
  scheduledAt?: string
  state?: string
  data?: string
  errors?: unknown
}

export interface ScheduledMessageResponse {
  sourceTrackingId?: string
  scheduledAt?: string
  state?: string
  data?: string
  errors?: unknown
}

// Mirrors paubox-node's error semantics: a response body that carries none
// of data / sourceTrackingId / errors is not a recognizable Paubox API
// response, so treat it as an error.
function isRecognizableBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const record = body as Record<string, unknown>
  return (
    record.data !== undefined ||
    record.sourceTrackingId !== undefined ||
    record.errors !== undefined ||
    record.state !== undefined
  )
}

function extractErrorDetail(body: unknown): string {
  if (typeof body === 'string' && body.trim().length > 0) {
    return body.slice(0, 300)
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (Array.isArray(record.errors)) {
      const messages = record.errors
        .map((e) =>
          e && typeof e === 'object' && typeof (e as Record<string, unknown>).title === 'string'
            ? (e as Record<string, unknown>).title
            : null,
        )
        .filter((m): m is string => typeof m === 'string')
      if (messages.length > 0) return messages.join('; ')
    }
    const message = record.detail ?? record.error ?? record.message
    if (typeof message === 'string') return message
    try {
      return JSON.stringify(body).slice(0, 300)
    } catch {
      return ''
    }
  }
  return ''
}

async function request(
  apiKey: string,
  config: AxiosRequestConfig,
  http: HttpRequest = axios.request,
): Promise<unknown> {
  const res = await http({
    ...config,
    // Keep baseURL separate from url so the interceptors in
    // lib/paubox-proxy.ts (which rewrite config.baseURL) still apply.
    baseURL: EMAIL_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(config.headers ?? {}),
    },
    timeout: 15000,
    // Don't throw on 4xx — we surface the status and body detail ourselves.
    validateStatus: () => true,
  })
  if (res.status < 200 || res.status >= 300) {
    const detail = extractErrorDetail(res.data)
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Paubox Email API rejected the API key (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
      )
    }
    throw new Error(
      `Paubox Email API error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
    )
  }
  if (!isRecognizableBody(res.data)) {
    throw new Error('Paubox Email API returned an unrecognized response body.')
  }
  return res.data
}

// Sends a secure email via POST /messages. Returns the parsed response body,
// which on success includes sourceTrackingId and data.message_id.
export async function sendEmail(
  apiKey: string,
  options: SendEmailOptions,
  http: HttpRequest = axios.request,
): Promise<SendEmailResponse> {
  const body = {
    data: {
      message: {
        recipients: options.to,
        cc: options.cc ?? null,
        bcc: options.bcc ?? null,
        headers: {
          subject: options.subject,
          from: options.from,
          'reply-to': null,
        },
        content: {
          'text/plain': options.textContent,
          // The Paubox API expects the HTML body base64-encoded, exactly
          // like paubox-node did.
          'text/html': Buffer.from(options.htmlContent).toString('base64'),
        },
        attachments: [],
        allowNonTLS: false,
        forceSecureNotification: options.forceSecureNotification ?? false,
      },
    },
  }
  return (await request(apiKey, { method: 'post', url: '/messages', data: body }, http)) as SendEmailResponse
}

export async function scheduleEmail(
  apiKey: string,
  options: SendEmailOptions & { scheduledAt: string },
  http: HttpRequest = axios.request,
): Promise<ScheduleEmailResponse> {
  const body = {
    data: {
      message: {
        recipients: options.to,
        cc: options.cc ?? null,
        bcc: options.bcc ?? null,
        headers: {
          subject: options.subject,
          from: options.from,
          'reply-to': null,
        },
        content: {
          'text/plain': options.textContent,
          'text/html': Buffer.from(options.htmlContent).toString('base64'),
        },
        attachments: [],
        allowNonTLS: false,
        forceSecureNotification: options.forceSecureNotification ?? false,
      },
      scheduled_at: options.scheduledAt,
    },
  }
  return (await request(apiKey, { method: 'post', url: '/schedule', data: body }, http)) as ScheduleEmailResponse
}

export async function getScheduledEmail(
  apiKey: string,
  sourceTrackingId: string,
  http: HttpRequest = axios.request,
): Promise<ScheduledMessageResponse> {
  return (await request(
    apiKey,
    { method: 'get', url: `/schedule/${encodeURIComponent(sourceTrackingId)}` },
    http,
  )) as ScheduledMessageResponse
}

export async function rescheduleEmail(
  apiKey: string,
  sourceTrackingId: string,
  scheduledAt: string,
  http: HttpRequest = axios.request,
): Promise<ScheduledMessageResponse> {
  return (await request(
    apiKey,
    {
      method: 'patch',
      url: `/schedule/${encodeURIComponent(sourceTrackingId)}`,
      data: { scheduled_at: scheduledAt },
    },
    http,
  )) as ScheduledMessageResponse
}

export async function cancelScheduledEmail(
  apiKey: string,
  sourceTrackingId: string,
  http: HttpRequest = axios.request,
): Promise<ScheduledMessageResponse> {
  return (await request(
    apiKey,
    {
      method: 'post',
      url: `/schedule/${encodeURIComponent(sourceTrackingId)}/cancel`,
      data: {},
    },
    http,
  )) as ScheduledMessageResponse
}

export async function getEmailDisposition(
  apiKey: string,
  sourceTrackingId: string,
  http: HttpRequest = axios.request,
): Promise<unknown> {
  return request(
    apiKey,
    {
      method: 'get',
      url: '/message_receipt',
      params: { sourceTrackingId },
    },
    http,
  )
}
