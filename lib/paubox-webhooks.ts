import axios, { AxiosRequestConfig } from 'axios'
import { EMAIL_API_BASE_URL, HttpRequest } from './paubox-email'

export class PauboxWebhookError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'PauboxWebhookError'
    this.status = status
  }
}

function extractErrorDetail(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim().length > 0 ? data.slice(0, 300) : ''
  }
  if (typeof data !== 'object' || data === null) return ''
  const body = data as Record<string, unknown>
  const errors = body.errors
  if (Array.isArray(errors)) {
    const parts = errors
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (typeof entry === 'object' && entry !== null) {
          const record = entry as Record<string, unknown>
          const message = record.title ?? record.message ?? record.detail
          if (typeof message === 'string') return message
        }
        return ''
      })
      .filter((part) => part.length > 0)
    if (parts.length > 0) return parts.join('; ')
  }
  const message = body.message ?? body.error ?? body.detail
  return typeof message === 'string' ? message : ''
}

function mapErrorResponse(status: number, data: unknown): PauboxWebhookError {
  const detail = extractErrorDetail(data)
  if (status === 401 || status === 403) {
    return new PauboxWebhookError(
      `Paubox Webhook API rejected the API key (HTTP ${status})${detail ? `: ${detail}` : ''}`,
      status,
    )
  }
  if (status === 404) {
    return new PauboxWebhookError(
      detail || 'Not found.',
      404,
    )
  }
  return new PauboxWebhookError(
    `Paubox Webhook API error (HTTP ${status})${detail ? `: ${detail}` : ''}`,
    status,
  )
}

export type WebhookClientOptions = {
  apiKey: string
  baseUrl?: string
  http?: HttpRequest
}

export function createWebhookClient({
  apiKey,
  baseUrl = EMAIL_API_BASE_URL,
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

  return {
    async listWebhookEndpoints(): Promise<unknown> {
      return request({ method: 'get', url: '/webhook_endpoints' })
    },

    async createWebhookEndpoint(params: {
      target_url: string
      events: string[]
      signing_key?: string
      active?: boolean
    }): Promise<unknown> {
      const body: Record<string, unknown> = {
        target_url: params.target_url,
        events: params.events,
      }
      if (params.signing_key !== undefined) body.signing_key = params.signing_key
      if (params.active !== undefined) body.active = params.active
      return request({ method: 'post', url: '/webhook_endpoints', data: body })
    },

    async getWebhookEndpoint(id: number): Promise<unknown> {
      return request({
        method: 'get',
        url: `/webhook_endpoints/${encodeURIComponent(id)}`,
      })
    },

    async updateWebhookEndpoint(
      id: number,
      changes: { target_url?: string; events?: string[]; active?: boolean },
    ): Promise<unknown> {
      return request({
        method: 'patch',
        url: `/webhook_endpoints/${encodeURIComponent(id)}`,
        data: changes,
      })
    },

    async deleteWebhookEndpoint(id: number): Promise<unknown> {
      return request({
        method: 'delete',
        url: `/webhook_endpoints/${encodeURIComponent(id)}`,
      })
    },
  }
}

export type PauboxWebhookClient = ReturnType<typeof createWebhookClient>
