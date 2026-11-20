// Client identification for requests paubox-mcp makes to Paubox APIs.
//
// Implements the header convention in pb_architecture ADR-050: every request
// to a Paubox host carries a User-Agent, X-Paubox-Client, X-Paubox-Client-Version,
// X-Paubox-Client-Command (the MCP tool name) and a fresh X-Request-Id with
// the registered "pbmcp-" prefix. The apiproxy edge logs these to Graylog and
// the Email API / Forms / Webhooks services tag their Sentry events with them.
//
// HIPAA rule from the ADR: these headers never carry tool arguments, message
// content, addresses or anything user-supplied. The command header is only
// ever a tool name registered in this codebase.
//
// This file lives in src/ so the stdio build (which can only compile src/)
// and the hosted Next.js server (which imports it from lib/) share one copy.

import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

export const CLIENT_NAME = "paubox-mcp"
// Kept in step with package.json by release-please; see release-please-config.json extra-files.
export const CLIENT_VERSION = "2.1.0" // x-release-please-version
export const REQUEST_ID_PREFIX = "pbmcp-"

export type Transport = "http" | "stdio"

export function newRequestId(): string {
  return `${REQUEST_ID_PREFIX}${randomUUID()}`
}

export function userAgent(transport: Transport): string {
  return `${CLIENT_NAME}/${CLIENT_VERSION} (node/${process.version}; ${process.platform} ${process.arch}; ${transport})`
}

const COMMAND_PATTERN = /^[a-z0-9_]{1,64}$/

/** Headers to add to one request. A new request id is generated per call. */
export function identityHeaders(
  transport: Transport,
  requestId: string,
  command?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent(transport),
    "X-Paubox-Client": CLIENT_NAME,
    "X-Paubox-Client-Version": CLIENT_VERSION,
    "X-Request-Id": requestId,
  }
  // Tool names are fixed identifiers from this codebase; the pattern check is
  // a guard so nothing else can ever end up in the header.
  if (command && COMMAND_PATTERN.test(command)) {
    headers["X-Paubox-Client-Command"] = command
  }
  return headers
}

/**
 * True for Paubox-operated hosts (api.paubox.com, staging *.paubox.net, ...).
 * Identity headers are only sent there, never to third parties.
 */
export function isPauboxUrl(url: string | URL | undefined): boolean {
  if (!url) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return (
    host === "paubox.com" ||
    host.endsWith(".paubox.com") ||
    host === "paubox.net" ||
    host.endsWith(".paubox.net")
  )
}

// ---------------------------------------------------------------------------
// Per-tool-call context
// ---------------------------------------------------------------------------

/** One Paubox request made during a tool call. */
export interface PauboxCall {
  requestId: string
  method: string
  /** The API product, from the /v1/<product> path segment (email, forms, ...). */
  product: string
  /** HTTP status, once a response arrives. */
  status?: number
  /** Set when no response arrived (timeout, DNS, connection refused). */
  networkError?: string
}

export interface ToolContext {
  tool: string
  calls: PauboxCall[]
}

const toolContext = new AsyncLocalStorage<ToolContext>()

export function currentToolContext(): ToolContext | undefined {
  return toolContext.getStore()
}

/** The API product from a Paubox URL path: /v1/email/... -> "email". */
export function productFromUrl(url: string | URL | undefined): string {
  if (!url) return "unknown"
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean)
    const index = segments[0] === "v1" ? 1 : 0
    const product = segments[index]?.toLowerCase() ?? "unknown"
    return /^[a-z_]{1,32}$/.test(product) ? product : "unknown"
  } catch {
    return "unknown"
  }
}

/**
 * Start tracking a request. Returns the headers to send and the call record to
 * update with the outcome. Works outside a tool call too (no command header,
 * nothing recorded).
 */
export function beginPauboxCall(
  transport: Transport,
  method: string,
  url: string | URL
): { headers: Record<string, string>; call: PauboxCall } {
  const ctx = toolContext.getStore()
  const requestId = newRequestId()
  const call: PauboxCall = {
    requestId,
    method: method.toUpperCase(),
    product: productFromUrl(url),
  }
  ctx?.calls.push(call)
  return { headers: identityHeaders(transport, requestId, ctx?.tool), call }
}

export function isFailedCall(call: PauboxCall): boolean {
  return call.networkError !== undefined || (call.status !== undefined && call.status >= 400)
}

/** 5xx, or no response at all: our side (or the network) failed, not the user. */
export function isServerSideFailure(call: PauboxCall): boolean {
  return call.networkError !== undefined || (call.status !== undefined && call.status >= 500)
}

/**
 * The call a failed tool result should point support at: the last Paubox
 * request of the tool call, when it failed. A tool that recovered (e.g.
 * get_form falling back to the public endpoint after a 404) ends on a
 * successful call, so it gets no request id.
 */
export function failedCallOf(ctx: ToolContext): PauboxCall | undefined {
  const last = ctx.calls[ctx.calls.length - 1]
  return last && isFailedCall(last) ? last : undefined
}

export function requestIdNote(requestId: string): string {
  return `\n\nPaubox request ID: ${requestId} (include this if you contact Paubox support)`
}

// ---------------------------------------------------------------------------
// Tool registration wrapper
// ---------------------------------------------------------------------------

type TextContent = { type: "text"; text: string }
type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }

export interface ToolFailure {
  tool: string
  /** The failed Paubox request, if the failure came from one. */
  call?: PauboxCall
  /** Set when the handler threw instead of returning an error result. */
  error?: unknown
}

export interface InstrumentOptions {
  /**
   * Called when a tool call ends on a failed Paubox request, or the handler
   * throws. The hosted server uses this to report to Sentry.
   */
  onFailure?: (failure: ToolFailure) => void
  /** Wraps each tool invocation, e.g. in a Sentry scope. Must call run(). */
  around?: <T>(tool: string, run: () => Promise<T>) => Promise<T>
}

function appendNote(result: ToolResult, note: string): ToolResult {
  const content = [...(result.content ?? [])]
  for (let i = content.length - 1; i >= 0; i--) {
    const item = content[i]
    if (item.type === "text" && typeof item.text === "string") {
      content[i] = { ...item, text: item.text + note }
      return { ...result, content }
    }
  }
  content.push({ type: "text", text: note.trimStart() } as TextContent)
  return { ...result, content }
}

/**
 * Run a tool handler inside a tool context. When the call ends on a failed
 * Paubox request, the request id is appended to the result text so the user
 * can quote it to support.
 */
export async function runTool(
  tool: string,
  handler: () => Promise<unknown>,
  options: InstrumentOptions = {}
): Promise<unknown> {
  const ctx: ToolContext = { tool, calls: [] }
  const run = () =>
    toolContext.run(ctx, async () => {
      let result: unknown
      try {
        result = await handler()
      } catch (error) {
        const call = failedCallOf(ctx)
        options.onFailure?.({ tool, call, error })
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [
            { type: "text", text: message + (call ? requestIdNote(call.requestId) : "") },
          ],
          isError: true,
        }
      }
      const call = failedCallOf(ctx)
      if (!call) return result
      options.onFailure?.({ tool, call })
      if (typeof result !== "object" || result === null) return result
      return appendNote(result as ToolResult, requestIdNote(call.requestId))
    })
  return options.around ? options.around(tool, run) : run()
}

/**
 * Patch server.tool(...) so every tool registered afterwards runs through
 * runTool. The handler is always the last argument of server.tool.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function instrumentToolRegistration(server: any, options: InstrumentOptions = {}): void {
  const original = server.tool.bind(server)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.tool = (...args: any[]) => {
    const name = args[0]
    const handler = args[args.length - 1]
    if (typeof name === "string" && typeof handler === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args[args.length - 1] = (...handlerArgs: any[]) =>
        runTool(name, () => handler(...handlerArgs), options)
    }
    return original(...args)
  }
}

// ---------------------------------------------------------------------------
// fetch wrapper (stdio)
// ---------------------------------------------------------------------------

/**
 * fetch with identity headers and outcome tracking for Paubox hosts. Other
 * hosts are passed through untouched.
 */
export async function pauboxFetch(
  transport: Transport,
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  if (!isPauboxUrl(input)) return fetch(input, init)
  const { headers, call } = beginPauboxCall(transport, init.method ?? "GET", input)
  const merged = new Headers(init.headers)
  for (const [name, value] of Object.entries(headers)) merged.set(name, value)
  try {
    const response = await fetch(input, { ...init, headers: merged })
    call.status = response.status
    return response
  } catch (error) {
    call.networkError = error instanceof Error ? error.name || "Error" : "Error"
    throw error
  }
}
