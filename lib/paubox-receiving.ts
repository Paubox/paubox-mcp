import axios, { AxiosRequestConfig } from 'axios'
import { EMAIL_API_BASE_URL } from './paubox-email'

export type ReceivingHttpRequest = (
  config: AxiosRequestConfig,
) => Promise<{ status: number; data: unknown; headers?: unknown }>

export type ReceivedAttachment = {
  filename: string | null
  contentType: string | null
  size: number
  content: Buffer
}

export class PauboxReceivingError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'PauboxReceivingError'
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

function toBuffer(data: unknown): Buffer | undefined {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data))
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

function decodeBody(data: unknown): unknown {
  const bytes = toBuffer(data)
  if (!bytes) return data
  const text = bytes.toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value
  }
  return undefined
}

function decodeExtendedValue(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header)
  const decoded = extended ? decodeExtendedValue(extended[1].trim()) : null
  if (decoded) return decoded
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i.exec(header)
  if (!plain) return null
  return plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2]
}

function mapErrorResponse(status: number, data: unknown): PauboxReceivingError {
  const detail = extractErrorDetail(data)
  if (status === 401 || status === 403) {
    return new PauboxReceivingError(
      `Paubox Receiving API rejected the API key (HTTP ${status})${detail ? `: ${detail}` : ''}`,
      status,
    )
  }
  if (status === 404) {
    return new PauboxReceivingError(
      detail || 'Not found.',
      404,
    )
  }
  return new PauboxReceivingError(
    `Paubox Receiving API error (HTTP ${status})${detail ? `: ${detail}` : ''}`,
    status,
  )
}

export type ReceivingClientOptions = {
  apiKey: string
  baseUrl?: string
  http?: ReceivingHttpRequest
}

export function createReceivingClient({
  apiKey,
  baseUrl = EMAIL_API_BASE_URL,
  http = axios.request,
}: ReceivingClientOptions) {
  async function send(config: AxiosRequestConfig) {
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
      throw mapErrorResponse(res.status, decodeBody(res.data))
    }
    return res
  }

  async function request<T>(config: AxiosRequestConfig): Promise<T> {
    return (await send(config)).data as T
  }

  return {
    async listDomains(): Promise<unknown> {
      return request({ method: 'get', url: '/receiving/domains' })
    },

    async createDomain(slug?: string): Promise<unknown> {
      const body: Record<string, unknown> = {}
      if (slug !== undefined) body.slug = slug
      return request({ method: 'post', url: '/receiving/domains', data: body })
    },

    async getDomain(id: string): Promise<unknown> {
      return request({
        method: 'get',
        url: `/receiving/domains/${encodeURIComponent(id)}`,
      })
    },

    async deleteDomain(id: string): Promise<unknown> {
      return request({
        method: 'delete',
        url: `/receiving/domains/${encodeURIComponent(id)}`,
      })
    },

    async listMailboxes(domainId: string): Promise<unknown> {
      return request({
        method: 'get',
        url: `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes`,
      })
    },

    async createMailbox(
      domainId: string,
      params: { name: string; password: string; quota_bytes?: number },
    ): Promise<unknown> {
      const body: Record<string, unknown> = {
        name: params.name,
        password: params.password,
      }
      if (params.quota_bytes !== undefined) body.quota_bytes = params.quota_bytes
      return request({
        method: 'post',
        url: `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes`,
        data: body,
      })
    },

    async getMailbox(domainId: string, mailboxId: string): Promise<unknown> {
      return request({
        method: 'get',
        url: `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
      })
    },

    async deleteMailbox(domainId: string, mailboxId: string): Promise<unknown> {
      return request({
        method: 'delete',
        url: `/receiving/domains/${encodeURIComponent(domainId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
      })
    },

    async listReceivedEmails(params: {
      limit?: number
      after?: string
      before?: string
    } = {}): Promise<unknown> {
      const query: Record<string, string | number> = {}
      if (params.limit !== undefined) query.limit = params.limit
      if (params.after !== undefined) query.after = params.after
      if (params.before !== undefined) query.before = params.before
      return request({ method: 'get', url: '/receiving', params: query })
    },

    async getReceivedEmail(emailId: string): Promise<unknown> {
      return request({
        method: 'get',
        url: `/receiving/${encodeURIComponent(emailId)}`,
      })
    },

    async getReceivedEmailAttachment(
      emailId: string,
      attachmentId: string,
    ): Promise<ReceivedAttachment> {
      const res = await send({
        method: 'get',
        url: `/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
        responseType: 'arraybuffer',
      })
      const content = toBuffer(res.data) ?? Buffer.from(String(res.data ?? ''))
      return {
        filename: filenameFromContentDisposition(headerValue(res.headers, 'content-disposition')),
        contentType: headerValue(res.headers, 'content-type') ?? null,
        size: content.byteLength,
        content,
      }
    },
  }
}

export type PauboxReceivingClient = ReturnType<typeof createReceivingClient>
