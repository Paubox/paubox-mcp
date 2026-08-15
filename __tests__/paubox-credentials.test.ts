// Unit tests for lib/paubox-credentials.ts. We inject a fake httpGet
// rather than mocking the axios module so behavior is deterministic and
// independent of jest's ESM-mode module-mock quirks.
//
// jest.setup.js sets PAUBOX_BYPASS_CRED_VALIDATION=true for integration
// tests. Clear it here so the helper's real branches are exercised.
delete process.env.PAUBOX_BYPASS_CRED_VALIDATION

import { checkPauboxCredentials, HttpGet } from '../lib/paubox-credentials'

function fakeGet(impl: (url: string, config: Parameters<HttpGet>[1]) => Promise<{ status: number }>) {
  const calls: Array<{ url: string; config: Parameters<HttpGet>[1] }> = []
  const fn: HttpGet = async (url, config) => {
    calls.push({ url, config })
    return impl(url, config)
  }
  return { fn, calls }
}

describe('checkPauboxCredentials', () => {
  it('returns ok:false when missing apiKey', async () => {
    const { fn, calls } = fakeGet(async () => ({ status: 200 }))
    const result = await checkPauboxCredentials('', fn)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('returns ok:false when Paubox responds 401', async () => {
    const { fn } = fakeGet(async () => ({ status: 401 }))
    const result = await checkPauboxCredentials('pk_bad', fn)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/invalid/i)
  })

  it('returns ok:false when Paubox responds 403', async () => {
    const { fn } = fakeGet(async () => ({ status: 403 }))
    const result = await checkPauboxCredentials('pk_test', fn)
    expect(result.ok).toBe(false)
  })

  it('returns ok:true when Paubox responds 404 (good creds, no such message)', async () => {
    const { fn } = fakeGet(async () => ({ status: 404 }))
    const result = await checkPauboxCredentials('pk_good', fn)
    expect(result.ok).toBe(true)
  })

  it('returns ok:true when Paubox responds 200', async () => {
    const { fn } = fakeGet(async () => ({ status: 200 }))
    const result = await checkPauboxCredentials('pk_good', fn)
    expect(result.ok).toBe(true)
  })

  it('soft-passes (ok:true) on network error', async () => {
    const { fn } = fakeGet(async () => { throw new Error('ECONNREFUSED') })
    const result = await checkPauboxCredentials('pk_test', fn)
    expect(result.ok).toBe(true)
  })

  it('soft-passes (ok:true) on 5xx', async () => {
    const { fn } = fakeGet(async () => ({ status: 503 }))
    const result = await checkPauboxCredentials('pk_test', fn)
    expect(result.ok).toBe(true)
  })

  it('hits the /v1/email base path with no username path segment', async () => {
    const { fn, calls } = fakeGet(async () => ({ status: 200 }))
    await checkPauboxCredentials('pk', fn)
    expect(calls[0].url).toBe(
      'https://api.paubox.com/v1/email/message_receipt?sourceTrackingId=00000000-0000-0000-0000-000000000000'
    )
  })

  it('sends Bearer-scheme Authorization header', async () => {
    const { fn, calls } = fakeGet(async () => ({ status: 200 }))
    await checkPauboxCredentials('pk_secret', fn)
    const headers = calls[0].config.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer pk_secret')
  })

  it('returns ok:false when a 404 carries an HTML gateway page', async () => {
    // The gateway serves HTML for paths it cannot route. Soft-passing that
    // reports "credentials validated" for a base URL that reaches nothing.
    const { fn } = fakeGet(async () => ({
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      data: '<!DOCTYPE html><html><body>404 Not Found</body></html>',
    }))
    const result = await checkPauboxCredentials('pk_good', fn)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/not routed|configuration/i)
  })

  it('still returns ok:true for a JSON 404 from the Email API itself', async () => {
    const { fn } = fakeGet(async () => ({
      status: 404,
      headers: { 'content-type': 'application/json' },
      data: { errors: [{ title: 'Message not found' }] },
    }))
    const result = await checkPauboxCredentials('pk_good', fn)
    expect(result.ok).toBe(true)
  })

  it('PAUBOX_BYPASS_CRED_VALIDATION is inert when NODE_ENV is production', async () => {
    // @types/node marks NODE_ENV readonly; tests legitimately need to mutate it.
    const env = process.env as { NODE_ENV?: string; PAUBOX_BYPASS_CRED_VALIDATION?: string }
    const prevBypass = env.PAUBOX_BYPASS_CRED_VALIDATION
    const prevNodeEnv = env.NODE_ENV
    env.PAUBOX_BYPASS_CRED_VALIDATION = 'true'
    env.NODE_ENV = 'production'
    try {
      const { fn, calls } = fakeGet(async () => ({ status: 401 }))
      const result = await checkPauboxCredentials('pk_bad', fn)
      expect(calls).toHaveLength(1)
      expect(result.ok).toBe(false)
    } finally {
      if (prevBypass === undefined) delete env.PAUBOX_BYPASS_CRED_VALIDATION
      else env.PAUBOX_BYPASS_CRED_VALIDATION = prevBypass
      if (prevNodeEnv === undefined) delete env.NODE_ENV
      else env.NODE_ENV = prevNodeEnv
    }
  })
})
