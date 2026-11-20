// Unit tests for the ADR-050 client identification (src/client-identity.ts and
// its hosted-server wiring in lib/client-identity.ts). HTTP is faked with an
// axios adapter / a stubbed global fetch, so nothing leaves the process.

import axios, { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import {
  CLIENT_NAME,
  CLIENT_VERSION,
  REQUEST_ID_PREFIX,
  currentToolContext,
  identityHeaders,
  instrumentToolRegistration,
  isPauboxUrl,
  newRequestId,
  pauboxFetch,
  productFromUrl,
  runTool,
  userAgent,
  type ToolFailure,
} from '../src/client-identity'
import { installAxiosIdentity, reportToolFailure, type SentryLike } from '../lib/client-identity'
import { createFormsClient } from '../lib/paubox-forms'
import { sendEmail } from '../lib/paubox-email'
import { readFileSync } from 'fs'

const REQUEST_ID = /^pbmcp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('identity headers', () => {
  it('generates a fresh pbmcp- request id each time', () => {
    const a = newRequestId()
    const b = newRequestId()
    expect(a).toMatch(REQUEST_ID)
    expect(b).toMatch(REQUEST_ID)
    expect(a).not.toBe(b)
    expect(REQUEST_ID_PREFIX).toBe('pbmcp-')
  })

  it('builds a <client>/<version> (<runtime>; <platform>; <transport>) User-Agent', () => {
    expect(userAgent('stdio')).toBe(
      `paubox-mcp/${CLIENT_VERSION} (node/${process.version}; ${process.platform} ${process.arch}; stdio)`
    )
    expect(userAgent('http')).toMatch(/; http\)$/)
  })

  it('sends the registered client name, version, request id and command', () => {
    expect(identityHeaders('http', 'pbmcp-x', 'send_secure_email')).toEqual({
      'User-Agent': userAgent('http'),
      'X-Paubox-Client': 'paubox-mcp',
      'X-Paubox-Client-Version': CLIENT_VERSION,
      'X-Request-Id': 'pbmcp-x',
      'X-Paubox-Client-Command': 'send_secure_email',
    })
  })

  it('drops a command that is not a plain tool identifier', () => {
    expect(identityHeaders('http', 'pbmcp-x')).not.toHaveProperty('X-Paubox-Client-Command')
    for (const bad of ['patient@example.com', 'Send Email', 'a'.repeat(65), 'x\r\nInjected: 1']) {
      expect(identityHeaders('http', 'pbmcp-x', bad)).not.toHaveProperty('X-Paubox-Client-Command')
    }
  })

  it('keeps CLIENT_VERSION in step with the release-please manifest', () => {
    const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'))
    expect(CLIENT_VERSION).toBe(manifest['.'])
    const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'))
    expect(config.packages['.']['extra-files']).toContain('src/client-identity.ts')
    expect(CLIENT_NAME).toBe('paubox-mcp')
  })
})

describe('isPauboxUrl', () => {
  it.each([
    'https://api.paubox.com/v1/email/messages',
    'https://app.staging.paubox.net/v1/forms',
    'https://paubox.com/',
  ])('accepts %s', (url) => expect(isPauboxUrl(url)).toBe(true))

  it.each([
    'https://example.com/',
    'https://paubox.com.evil.example/',
    'https://evilpaubox.com/',
    'not a url',
    undefined,
  ])('rejects %s', (url) => expect(isPauboxUrl(url)).toBe(false))
})

describe('productFromUrl', () => {
  it('reads the /v1/<product> segment', () => {
    expect(productFromUrl('https://api.paubox.com/v1/email/messages')).toBe('email')
    expect(productFromUrl('https://api.paubox.com/v1/marketing/subscribers/abc')).toBe('marketing')
    expect(productFromUrl('https://api.paubox.com/forms/x')).toBe('forms')
    expect(productFromUrl('https://api.paubox.com/')).toBe('unknown')
    expect(productFromUrl(undefined)).toBe('unknown')
  })
})

describe('pauboxFetch', () => {
  const realFetch = global.fetch
  let seen: { url: string; headers: Headers }[]

  beforeEach(() => {
    seen = []
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  function stubFetch(respond: () => Promise<Response>) {
    global.fetch = (async (input: string | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers) })
      return respond()
    }) as typeof fetch
  }

  it('adds identity headers to Paubox requests, keeping the caller\'s headers', async () => {
    stubFetch(async () => new Response('{}', { status: 200 }))
    await runTool('check_email_status', async () =>
      pauboxFetch('stdio', 'https://api.paubox.com/v1/email/message_receipt', {
        headers: { Authorization: 'Bearer k' },
      })
    )
    const { headers } = seen[0]
    expect(headers.get('authorization')).toBe('Bearer k')
    expect(headers.get('x-paubox-client')).toBe('paubox-mcp')
    expect(headers.get('x-paubox-client-version')).toBe(CLIENT_VERSION)
    expect(headers.get('x-paubox-client-command')).toBe('check_email_status')
    expect(headers.get('user-agent')).toBe(userAgent('stdio'))
    expect(headers.get('x-request-id')).toMatch(REQUEST_ID)
  })

  it('leaves non-Paubox requests untouched', async () => {
    stubFetch(async () => new Response('ok'))
    await pauboxFetch('stdio', 'https://example.com/x', { headers: { A: 'b' } })
    expect(seen[0].headers.get('x-paubox-client')).toBeNull()
    expect(seen[0].headers.get('x-request-id')).toBeNull()
  })

  it('records the status and network failures in the tool context', async () => {
    stubFetch(async () => new Response('', { status: 503 }))
    let calls: unknown
    await runTool('list_forms', async () => {
      await pauboxFetch('stdio', 'https://api.paubox.com/v1/forms/api/forms')
      calls = [...currentToolContext()!.calls]
    })
    expect(calls).toEqual([expect.objectContaining({ status: 503, product: 'forms', method: 'GET' })])

    stubFetch(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    await runTool('list_forms', async () => {
      await expect(pauboxFetch('stdio', 'https://api.paubox.com/v1/forms/x')).rejects.toThrow('timed out')
      calls = [...currentToolContext()!.calls]
    })
    expect(calls).toEqual([expect.objectContaining({ networkError: 'TimeoutError' })])
  })
})

describe('runTool', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  function stubStatuses(...statuses: number[]) {
    const ids: string[] = []
    global.fetch = (async (_input: string | URL, init?: RequestInit) => {
      ids.push(new Headers(init?.headers).get('x-request-id')!)
      return new Response('', { status: statuses.shift() ?? 200 })
    }) as typeof fetch
    return ids
  }

  const errorResult = (text: string) => ({ content: [{ type: 'text', text }] })

  it('returns a successful result unchanged and reports nothing', async () => {
    stubStatuses(200)
    const failures: ToolFailure[] = []
    const result = { content: [{ type: 'text', text: 'Email sent' }] }
    const out = await runTool(
      'send_secure_email',
      async () => {
        await pauboxFetch('stdio', 'https://api.paubox.com/v1/email/messages', { method: 'POST' })
        return result
      },
      { onFailure: (f) => failures.push(f) }
    )
    expect(out).toBe(result)
    expect(failures).toEqual([])
  })

  it('appends the failed request id to the error text and reports the failure', async () => {
    const ids = stubStatuses(401)
    const failures: ToolFailure[] = []
    const out = (await runTool(
      'send_secure_email',
      async () => {
        await pauboxFetch('stdio', 'https://api.paubox.com/v1/email/messages', { method: 'POST' })
        return errorResult('Failed to send email: invalid key')
      },
      { onFailure: (f) => failures.push(f) }
    )) as { content: { text: string }[] }
    expect(out.content[0].text).toBe(
      `Failed to send email: invalid key\n\nPaubox request ID: ${ids[0]} (include this if you contact Paubox support)`
    )
    expect(failures).toEqual([
      { tool: 'send_secure_email', call: expect.objectContaining({ requestId: ids[0], status: 401, method: 'POST' }) },
    ])
  })

  it('does not tag a tool that recovered from an earlier failed request', async () => {
    stubStatuses(404, 200)
    const failures: ToolFailure[] = []
    const result = { content: [{ type: 'text', text: 'form' }] }
    const out = await runTool(
      'get_form',
      async () => {
        await pauboxFetch('stdio', 'https://api.paubox.com/v1/forms/api/forms/1')
        await pauboxFetch('stdio', 'https://api.paubox.com/v1/forms/public/form_data/1')
        return result
      },
      { onFailure: (f) => failures.push(f) }
    )
    expect(out).toBe(result)
    expect(failures).toEqual([])
  })

  it('converts a thrown error into an error result carrying the request id', async () => {
    const ids = stubStatuses(500)
    const failures: ToolFailure[] = []
    const boom = new Error('upstream exploded')
    const out = await runTool(
      'list_forms',
      async () => {
        await pauboxFetch('stdio', 'https://api.paubox.com/v1/forms/api/forms')
        throw boom
      },
      { onFailure: (f) => failures.push(f) }
    )
    expect(out).toEqual({
      content: [{ type: 'text', text: expect.stringContaining(`upstream exploded\n\nPaubox request ID: ${ids[0]}`) }],
      isError: true,
    })
    expect(failures[0]).toMatchObject({ tool: 'list_forms', error: boom, call: { status: 500 } })
  })

  it('isolates the context of concurrent tool calls', async () => {
    const commands: string[] = []
    global.fetch = (async (_input: string | URL, init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 5))
      commands.push(new Headers(init?.headers).get('x-paubox-client-command')!)
      return new Response('')
    }) as typeof fetch
    await Promise.all([
      runTool('list_forms', () => pauboxFetch('stdio', 'https://api.paubox.com/v1/forms/a')),
      runTool('get_subscriber', () => pauboxFetch('stdio', 'https://api.paubox.com/v1/marketing/b')),
    ])
    expect(commands.sort()).toEqual(['get_subscriber', 'list_forms'])
  })

  it('wraps the call in the around hook', async () => {
    const order: string[] = []
    await runTool('t', async () => order.push('handler'), {
      around: async (tool, run) => {
        order.push(`before:${tool}`)
        const out = await run()
        order.push('after')
        return out
      },
    })
    expect(order).toEqual(['before:t', 'handler', 'after'])
  })
})

describe('instrumentToolRegistration', () => {
  it('runs every handler registered afterwards inside a tool context', async () => {
    const registered: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    const server = {
      tool: (name: string, ...rest: unknown[]) => {
        registered[name] = rest[rest.length - 1] as (...args: unknown[]) => Promise<unknown>
      },
    }
    instrumentToolRegistration(server)
    let seenTool: string | undefined
    let seenArgs: unknown
    server.tool('get_form', 'desc', {}, async (args: unknown) => {
      seenTool = currentToolContext()?.tool
      seenArgs = args
      return { content: [] }
    })
    await registered.get_form({ formId: 'x' }, { extra: true })
    expect(seenTool).toBe('get_form')
    expect(seenArgs).toEqual({ formId: 'x' })
  })
})

describe('installAxiosIdentity', () => {
  function instanceWith(respond: (config: InternalAxiosRequestConfig) => { status: number } | Error) {
    const seen: InternalAxiosRequestConfig[] = []
    const adapter: AxiosAdapter = async (config) => {
      seen.push(config)
      const outcome = respond(config)
      if (outcome instanceof Error) throw outcome
      return { data: {}, status: outcome.status, statusText: '', headers: {}, config }
    }
    const instance = axios.create({ adapter })
    installAxiosIdentity(instance)
    installAxiosIdentity(instance) // idempotent: must not double-register
    return { instance, seen }
  }

  it('adds identity headers to Paubox requests made with baseURL + relative url', async () => {
    const { instance, seen } = instanceWith(() => ({ status: 200 }))
    await runTool('send_secure_email', () =>
      instance.request({ baseURL: 'https://api.paubox.com/v1/email', url: '/messages', method: 'post' })
    )
    const h = seen[0].headers
    expect(h.get('X-Paubox-Client')).toBe('paubox-mcp')
    expect(h.get('X-Paubox-Client-Command')).toBe('send_secure_email')
    expect(h.get('User-Agent')).toBe(userAgent('http'))
    expect(h.get('X-Request-Id')).toMatch(REQUEST_ID)
  })

  it('leaves non-Paubox requests untouched', async () => {
    const { instance, seen } = instanceWith(() => ({ status: 200 }))
    await instance.get('https://example.com/x')
    expect(seen[0].headers.get('X-Paubox-Client')).toBeUndefined()
  })

  it('records accepted statuses, rejected statuses and network errors', async () => {
    const statuses = [503, 418]
    const { instance } = instanceWith((config) =>
      config.url?.includes('down')
        ? Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', config })
        : { status: statuses.shift()! }
    )
    let calls: unknown
    await runTool('t', async () => {
      await instance.get('https://api.paubox.com/v1/email/a', { validateStatus: () => true })
      await instance.get('https://api.paubox.com/v1/email/b').catch(() => undefined)
      await instance.get('https://api.paubox.com/v1/email/down').catch(() => undefined)
      calls = currentToolContext()!.calls.map(({ status, networkError }) => ({ status, networkError }))
    })
    expect(calls).toEqual([
      { status: 503, networkError: undefined },
      { status: 418, networkError: undefined },
      { status: undefined, networkError: 'ECONNREFUSED' },
    ])
  })
})

describe('reportToolFailure', () => {
  function fakeSentry() {
    const messages: { message: string; context: { tags: Record<string, string>; fingerprint: string[] } }[] = []
    const exceptions: { error: unknown; context: unknown }[] = []
    const sentry: SentryLike = {
      captureMessage: (message, context) => {
        messages.push({ message, context: context as (typeof messages)[0]['context'] })
        return ''
      },
      captureException: (error, context) => {
        exceptions.push({ error, context })
        return ''
      },
    }
    return { sentry, messages, exceptions }
  }

  const call = (over: object) => ({ requestId: 'pbmcp-1', method: 'POST', product: 'email', ...over })

  it('ignores 4xx failures (user mistakes)', () => {
    const { sentry, messages, exceptions } = fakeSentry()
    for (const status of [400, 401, 403, 404, 422, 429]) {
      reportToolFailure(sentry, { tool: 'send_secure_email', call: call({ status }) })
    }
    expect(messages).toEqual([])
    expect(exceptions).toEqual([])
  })

  it('reports an upstream 5xx with identifier-only tags', () => {
    const { sentry, messages } = fakeSentry()
    reportToolFailure(sentry, { tool: 'send_secure_email', call: call({ status: 502 }) })
    expect(messages).toEqual([
      {
        message: 'paubox-mcp send_secure_email: POST email API HTTP 502',
        context: {
          level: 'error',
          tags: {
            client: 'paubox-mcp',
            mcp_tool: 'send_secure_email',
            request_id: 'pbmcp-1',
            paubox_product: 'email',
            upstream_status: '502',
          },
          fingerprint: ['mcp-tool-failure', 'send_secure_email', 'email', 'HTTP 5xx'],
        },
      },
    ])
  })

  it('reports a request that got no response', () => {
    const { sentry, messages } = fakeSentry()
    reportToolFailure(sentry, { tool: 'list_forms', call: call({ product: 'forms', networkError: 'ECONNABORTED' }) })
    expect(messages[0].message).toBe('paubox-mcp list_forms: POST forms API no response (ECONNABORTED)')
    expect(messages[0].context.tags).toMatchObject({ upstream_status: 'none', network_error: 'ECONNABORTED' })
  })

  it('reports a thrown handler error as an exception, even without a failed call', () => {
    const { sentry, exceptions } = fakeSentry()
    const error = new Error('bug')
    reportToolFailure(sentry, { tool: 'get_form', error })
    expect(exceptions).toEqual([
      { error, context: { tags: { client: 'paubox-mcp', mcp_tool: 'get_form' }, fingerprint: ['mcp-tool-exception', 'get_form'] } },
    ])
  })
})

// Crosses the lib client -> global axios interceptor -> tool context -> Sentry
// boundary the hosted server relies on: a real lib/ client making a call that
// comes back 503 must produce a request-id-tagged error and one Sentry event.
describe('hosted wiring end to end (global axios)', () => {
  const realAdapter = axios.defaults.adapter
  let seen: InternalAxiosRequestConfig[]

  beforeAll(() => installAxiosIdentity(axios))
  beforeEach(() => {
    seen = []
  })
  afterEach(() => {
    axios.defaults.adapter = realAdapter
  })

  function respondWith(status: number, data: unknown = {}) {
    axios.defaults.adapter = async (config) => {
      seen.push(config)
      return { data, status, statusText: '', headers: {}, config }
    }
  }

  it('tags a failed email send and reports the 503 to Sentry', async () => {
    respondWith(503, { errors: [{ details: 'unavailable' }] })
    const reported: string[] = []
    const sentry: SentryLike = {
      captureMessage: (m) => {
        reported.push(m)
        return ''
      },
      captureException: () => '',
    }
    const out = (await runTool(
      'send_secure_email',
      async () => {
        try {
          await sendEmail('k'.repeat(20), {
            from: 'a@example.com',
            to: ['b@example.com'],
            subject: 's',
            textContent: 't',
            htmlContent: '<p>t</p>',
          } as unknown as Parameters<typeof sendEmail>[1])
          return { content: [{ type: 'text', text: 'sent' }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `❌ Failed to send email: ${(e as Error).message}` }] }
        }
      },
      { onFailure: (f) => reportToolFailure(sentry, f) }
    )) as { content: { text: string }[] }

    const requestId = seen[0].headers.get('X-Request-Id') as string
    expect(requestId).toMatch(REQUEST_ID)
    expect(seen[0].headers.get('X-Paubox-Client-Command')).toBe('send_secure_email')
    expect(seen[0].headers.get('Authorization')).toBe(`Bearer ${'k'.repeat(20)}`)
    expect(out.content[0].text).toMatch(/^❌ Failed to send email/)
    expect(out.content[0].text).toContain(`Paubox request ID: ${requestId}`)
    expect(reported).toEqual(['paubox-mcp send_secure_email: POST email API HTTP 503'])
  })

  it('tags a forms 401 for support but keeps it out of Sentry', async () => {
    respondWith(401)
    const reported: string[] = []
    const sentry: SentryLike = {
      captureMessage: (m) => {
        reported.push(m)
        return ''
      },
      captureException: () => '',
    }
    const out = (await runTool(
      'list_forms',
      async () => {
        try {
          await createFormsClient({ apiKey: 'pk_forms_test' }).listForms({})
          return { content: [{ type: 'text', text: 'ok' }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `❌ Failed to list forms: ${(e as Error).message}` }] }
        }
      },
      { onFailure: (f) => reportToolFailure(sentry, f) }
    )) as { content: { text: string }[] }
    expect(seen[0].headers.get('X-Paubox-Client-Command')).toBe('list_forms')
    expect(out.content[0].text).toContain(`Paubox request ID: ${seen[0].headers.get('X-Request-Id')}`)
    expect(reported).toEqual([])
  })
})
