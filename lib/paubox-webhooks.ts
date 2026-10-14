import axios, { AxiosRequestConfig } from 'axios'
import { HttpRequest } from './paubox-email'

// The public gateway exposes only /v1/webhooks/endpoints and rewrites it onto
// the service's own /v1/endpoints, so the producers' event-ingest route is not
// reachable from here. The bare base is deliberately unrouted; every request
// below carries the /endpoints resource.
export const WEBHOOKS_API_BASE_URL = 'https://api.paubox.com/v1/webhooks'

/**
 * Events an endpoint can subscribe to.
 *
 * The four Email API events keep their legacy `api_mail_log_` names so that
 * receivers written against the retired Email API webhooks keep working. These
 * are the names on the wire — `delivered` or `failed` on their own are rejected
 * as unknown.
 *
 * The catalog lives in the service and can grow without a release here, so a
 * 422 for an unrecognised name is the service's answer, not ours.
 */
export const WEBHOOK_EVENTS = [
  'forms.submission.created',
  'api_mail_log_delivered',
  'api_mail_log_opened',
  'api_mail_log_temporary_failure',
  'api_mail_log_permanent_failure',
  'email.inbound.received',
] as const

export class PauboxWebhookError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'PauboxWebhookError'
    this.status = status
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Validate caller-supplied ids before they hit a URL path. Rejects empty, `.`,
// `..` and non-UUID shapes so `?`/`#`/`/`/`..` in caller input can't splice the
// request to a different endpoint on the same host — the Authorization header
// rides along, so a retargeted request would carry the key with it.
export function validateEndpointId(raw: string, field = 'endpoint_id'): string {
  const trimmed = (raw ?? '').trim()
  if (trimmed.length === 0) {
    throw new PauboxWebhookError(`${field} is required.`)
  }
  if (!UUID_RE.test(trimmed)) {
    throw new PauboxWebhookError(`${field} must be a UUID.`)
  }
  return trimmed
}

function extractErrorDetail(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim().length > 0 ? data.slice(0, 300) : ''
  }
  if (typeof data !== 'object' || data === null) return ''
  const body = data as Record<string, unknown>
  // The webhooks service answers failures as {"message": "..."}; the Email
  // API's {"errors":[...]} shape is still handled in case the gateway proxies
  // one through.
  const message = body.message ?? body.error ?? body.detail
  if (typeof message === 'string' && message.length > 0) return message
  const errors = body.errors
  if (Array.isArray(errors)) {
    const parts = errors
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (typeof entry === 'object' && entry !== null) {
          const record = entry as Record<string, unknown>
          const title = record.title ?? record.message ?? record.detail
          if (typeof title === 'string') return title
        }
        return ''
      })
      .filter((part) => part.length > 0)
    if (parts.length > 0) return parts.join('; ')
  }
  return ''
}

function mapErrorResponse(status: number, data: unknown): PauboxWebhookError {
  const detail = extractErrorDetail(data)
  if (status === 401 || status === 403) {
    // 403 is the service saying this key is not scoped for one of the events,
    // which is a different fix from a bad key — say so.
    const hint =
      status === 403
        ? ' The key may not be scoped for one of the requested events.'
        : ''
    return new PauboxWebhookError(
      `Paubox Webhook API rejected the API key (HTTP ${status})${detail ? `: ${detail}` : ''}.${hint}`,
      status,
    )
  }
  if (status === 404) {
    return new PauboxWebhookError(detail || 'Webhook endpoint not found.', 404)
  }
  return new PauboxWebhookError(
    `Paubox Webhook API error (HTTP ${status})${detail ? `: ${detail}` : ''}`,
    status,
  )
}

/** A configured webhook endpoint. */
export type WebhookEndpoint = {
  id: string
  target_url: string
  /** "active" or "disabled". */
  status: string
  events: string[]
  created_at: string
  updated_at: string
}

/**
 * A newly created endpoint. `signing_secret` is disclosed once, here, and
 * never again — not on get and not on list. Recovering from a lost secret
 * means deleting the endpoint and creating another.
 */
export type CreatedWebhookEndpoint = WebhookEndpoint & {
  signing_secret: string
}

export type WebhookEndpointList = {
  data: WebhookEndpoint[]
  /** `count` is the total matching, not the length of `data`. */
  page_info: { count: number; items: number }
}

export type WebhookClientOptions = {
  apiKey: string
  baseUrl?: string
  http?: HttpRequest
}

export function createWebhookClient({
  apiKey,
  baseUrl = WEBHOOKS_API_BASE_URL,
  http = axios.request,
}: WebhookClientOptions) {
  async function request<T>(config: AxiosRequestConfig): Promise<T> {
    const res = await http({
      ...config,
      url: `${baseUrl}${config.url}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(config.headers ?? {}),
      },
      timeout: 15000,
      validateStatus: () => true,
    })
    if (res.status < 200 || res.status >= 300) {
      throw mapErrorResponse(res.status, res.data)
    }
    return res.data as T
  }

  // Single resources arrive wrapped as {"data": {...}}. Unwrapped so callers
  // get the endpoint rather than an envelope carrying nothing else. The list
  // deliberately keeps its envelope: the page_info beside it is what a caller
  // paginating needs.
  function unwrap<T>(body: unknown): T {
    const data = (body as Record<string, unknown> | null)?.data
    if (data === undefined || data === null) {
      throw new PauboxWebhookError('The webhooks API returned no endpoint data.')
    }
    return data as T
  }

  return {
    async listWebhookEndpoints(params: { page?: number; items?: number } = {}): Promise<WebhookEndpointList> {
      const query = new URLSearchParams()
      if (params.page !== undefined) query.set('page', String(params.page))
      if (params.items !== undefined) query.set('items', String(params.items))
      const suffix = query.toString() ? `?${query.toString()}` : ''
      return request<WebhookEndpointList>({ method: 'get', url: `/endpoints${suffix}` })
    },

    async createWebhookEndpoint(params: {
      target_url: string
      events: string[]
    }): Promise<CreatedWebhookEndpoint> {
      const body = await request<unknown>({
        method: 'post',
        url: '/endpoints',
        data: { target_url: params.target_url, events: params.events },
      })
      return unwrap<CreatedWebhookEndpoint>(body)
    },

    async getWebhookEndpoint(id: string): Promise<WebhookEndpoint> {
      const safeId = validateEndpointId(id)
      const body = await request<unknown>({
        method: 'get',
        url: `/endpoints/${encodeURIComponent(safeId)}`,
      })
      return unwrap<WebhookEndpoint>(body)
    },

    async updateWebhookEndpoint(
      id: string,
      changes: { target_url?: string; events?: string[]; status?: string },
    ): Promise<WebhookEndpoint> {
      const safeId = validateEndpointId(id)
      const body = await request<unknown>({
        method: 'patch',
        url: `/endpoints/${encodeURIComponent(safeId)}`,
        data: changes,
      })
      return unwrap<WebhookEndpoint>(body)
    },

    // The service answers 204 with no body, so there is nothing to return.
    async deleteWebhookEndpoint(id: string): Promise<void> {
      const safeId = validateEndpointId(id)
      await request<unknown>({
        method: 'delete',
        url: `/endpoints/${encodeURIComponent(safeId)}`,
      })
    },
  }
}

export type PauboxWebhookClient = ReturnType<typeof createWebhookClient>
