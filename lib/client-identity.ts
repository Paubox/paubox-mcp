// Hosted-server wiring for the ADR-050 client identification headers.
// The convention itself (header names, request ids, tool context) lives in
// src/client-identity.ts so the stdio build shares it.

import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import {
  beginPauboxCall,
  isPauboxUrl,
  isServerSideFailure,
  type PauboxCall,
  type ToolFailure,
} from '../src/client-identity'

export * from '../src/client-identity'

type TrackedConfig = InternalAxiosRequestConfig & { pauboxCall?: PauboxCall }

function fullUrl(config: InternalAxiosRequestConfig): string | undefined {
  const url = config.url ?? ''
  if (/^https?:\/\//i.test(url)) return url
  if (!config.baseURL) return undefined
  return config.baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '')
}

/**
 * Add identity headers to every axios request bound for a Paubox host and
 * record each request's outcome in the current tool context. Idempotent per
 * axios instance.
 */
export function installAxiosIdentity(instance: AxiosInstance): void {
  const marked = instance as AxiosInstance & { __pauboxIdentity?: boolean }
  if (marked.__pauboxIdentity) return
  marked.__pauboxIdentity = true

  instance.interceptors.request.use((config: TrackedConfig) => {
    const url = fullUrl(config)
    if (!isPauboxUrl(url)) return config
    const { headers, call } = beginPauboxCall('http', config.method ?? 'get', url!)
    for (const [name, value] of Object.entries(headers)) config.headers.set(name, value)
    config.pauboxCall = call
    return config
  })

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const call = (response.config as TrackedConfig).pauboxCall
      if (call) call.status = response.status
      return response
    },
    (error: { config?: TrackedConfig; response?: { status: number }; code?: string }) => {
      const call = error.config?.pauboxCall
      if (call) {
        if (error.response) call.status = error.response.status
        else call.networkError = error.code ?? 'ERR_NETWORK'
      }
      return Promise.reject(error)
    }
  )
}

/** The minimal Sentry surface we use, so tests can pass a fake. */
export interface SentryLike {
  captureMessage(message: string, context?: unknown): string
  captureException(error: unknown, context?: unknown): string
}

/**
 * Report a tool failure to Sentry when it is ours to fix: an upstream 5xx, a
 * request that got no response, or a handler that threw. 4xx results (bad
 * key, bad input, missing scope) are user mistakes and are not reported.
 *
 * Only identifiers go to Sentry — tool name, product, status, request id —
 * never the error text, which can quote recipients or other PHI.
 */
export function reportToolFailure(sentry: SentryLike, failure: ToolFailure): void {
  const { tool, call, error } = failure
  const serverSide = call ? isServerSideFailure(call) : false
  if (!serverSide && !error) return

  const tags: Record<string, string> = {
    client: 'paubox-mcp',
    mcp_tool: tool,
  }
  if (call) {
    tags.request_id = call.requestId
    tags.paubox_product = call.product
    tags.upstream_status = call.status !== undefined ? String(call.status) : 'none'
    if (call.networkError) tags.network_error = call.networkError
  }
  const outcome = call
    ? call.networkError
      ? `no response (${call.networkError})`
      : `HTTP ${call.status}`
    : 'exception'
  const fingerprint = ['mcp-tool-failure', tool, call?.product ?? 'none', outcome.replace(/\d\d$/, 'xx')]

  if (error && !serverSide) {
    sentry.captureException(error, { tags, fingerprint: ['mcp-tool-exception', tool] })
    return
  }
  sentry.captureMessage(
    `paubox-mcp ${tool}: ${call?.method ?? ''} ${call?.product ?? ''} API ${outcome}`.replace(/\s+/g, ' '),
    { level: 'error', tags, fingerprint }
  )
}
