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
    const result = await checkPauboxCredentials('', 'user@example.com', fn)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('returns ok:false when missing apiUser', async () => {
    const { fn, calls } = fakeGet(async () => ({ status: 200 }))
    const result = await checkPauboxCredentials('pk_test', '', fn)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('returns ok:false when Paubox responds 401', async () => {
    const { fn } = fakeGet(async () => ({ status: 401 }))
    const result = await checkPauboxCredentials('pk_bad', 'user@example.com', fn)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/invalid/i)
  })

  it('returns ok:false when Paubox responds 403', async () => {
    const { fn } = fakeGet(async () => ({ status: 403 }))
    const result = await checkPauboxCredentials('pk_test', 'user@example.com', fn)
    expect(result.ok).toBe(false)
  })

  it('returns ok:true when Paubox responds 404 (good creds, no such message)', async () => {
    const { fn } = fakeGet(async () => ({ status: 404 }))
    const result = await checkPauboxCredentials('pk_good', 'user@example.com', fn)
    expect(result.ok).toBe(true)
  })

  it('returns ok:true when Paubox responds 200', async () => {
    const { fn } = fakeGet(async () => ({ status: 200 }))
    const result = await checkPauboxCredentials('pk_good', 'user@example.com', fn)
    expect(result.ok).toBe(true)
  })

  it('soft-passes (ok:true) on network error', async () => {
    const { fn } = fakeGet(async () => { throw new Error('ECONNREFUSED') })
    const result = await checkPauboxCredentials('pk_test', 'user@example.com', fn)
    expect(result.ok).toBe(true)
  })

  it('soft-passes (ok:true) on 5xx', async () => {
    const { fn } = fakeGet(async () => ({ status: 503 }))
    const result = await checkPauboxCredentials('pk_test', 'user@example.com', fn)
    expect(result.ok).toBe(true)
  })

  it('encodes apiUser into the URL path (no path injection)', async () => {
    const { fn, calls } = fakeGet(async () => ({ status: 200 }))
    await checkPauboxCredentials('pk', 'user+plus@example.com', fn)
    expect(calls[0].url).toContain('user%2Bplus%40example.com')
  })

  it('sends Token-scheme Authorization header', async () => {
    const { fn, calls } = fakeGet(async () => ({ status: 200 }))
    await checkPauboxCredentials('pk_secret', 'u@example.com', fn)
    const headers = calls[0].config.headers as Record<string, string>
    expect(headers.Authorization).toBe('Token token=pk_secret')
  })

  it('PAUBOX_BYPASS_CRED_VALIDATION is inert when NODE_ENV is production', async () => {
    const prevBypass = process.env.PAUBOX_BYPASS_CRED_VALIDATION
    const prevNodeEnv = process.env.NODE_ENV
    process.env.PAUBOX_BYPASS_CRED_VALIDATION = 'true'
    process.env.NODE_ENV = 'production'
    try {
      const { fn, calls } = fakeGet(async () => ({ status: 401 }))
      const result = await checkPauboxCredentials('pk_bad', 'user@example.com', fn)
      expect(calls).toHaveLength(1)
      expect(result.ok).toBe(false)
    } finally {
      if (prevBypass === undefined) delete process.env.PAUBOX_BYPASS_CRED_VALIDATION
      else process.env.PAUBOX_BYPASS_CRED_VALIDATION = prevBypass
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
    }
  })
})
