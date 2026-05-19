// Tests for the OAuth 2.1 + PKCE credential flow:
// - JWT utility round-trips and type safety
// - /.well-known discovery endpoints
// - /oauth/authorize (GET form rendering, POST code issuance)
// - /oauth/token (PKCE verification, error cases, full flow)
// - MCP route Bearer token credential resolution

process.env.JWT_SECRET = 'test-jwt-secret-for-oauth-tests-min-32-chars'
process.env.PAUBOX_API_KEY = 'test-key'
process.env.PAUBOX_API_USER = 'test-user'

import { createHash } from 'crypto'
import request from 'supertest'
import { signAuthCode, signAccessToken, verifyAuthCode, verifyAccessToken } from '../lib/oauth-jwt'
import { createTestServer, closeTestServer, TestServer } from './test-helpers'

let testServer: TestServer

beforeAll(async () => {
  testServer = await createTestServer(3006)
}, 15000)

afterAll(async () => {
  await closeTestServer(testServer)
})

// PKCE helpers used throughout
const TEST_CODE_VERIFIER = 'test-code-verifier-for-pkce-abc123xyz789'
function computeChallenge(verifier: string): string {
  const digest = createHash('sha256').update(verifier).digest()
  return digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
const TEST_CODE_CHALLENGE = computeChallenge(TEST_CODE_VERIFIER)

const LOCALHOST_REDIRECT = 'http://localhost:9999/callback'
const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

// ─── JWT utilities ────────────────────────────────────────────────────────────

describe('lib/oauth-jwt', () => {
  it('signAuthCode / verifyAuthCode round-trip preserves payload', async () => {
    const token = await signAuthCode({
      apiKey: 'pk_test_key',
      apiUser: 'user@example.com',
      codeChallenge: TEST_CODE_CHALLENGE,
      redirectUri: LOCALHOST_REDIRECT,
    })
    const payload = await verifyAuthCode(token)
    expect(payload.type).toBe('auth_code')
    expect(payload.apiKey).toBe('pk_test_key')
    expect(payload.apiUser).toBe('user@example.com')
    expect(payload.codeChallenge).toBe(TEST_CODE_CHALLENGE)
    expect(payload.redirectUri).toBe(LOCALHOST_REDIRECT)
  })

  it('signAccessToken / verifyAccessToken round-trip preserves payload', async () => {
    const token = await signAccessToken({ apiKey: 'ak', apiUser: 'u@example.com' })
    const payload = await verifyAccessToken(token)
    expect(payload.type).toBe('access_token')
    expect(payload.apiKey).toBe('ak')
    expect(payload.apiUser).toBe('u@example.com')
  })

  it('verifyAuthCode rejects an access token (wrong type)', async () => {
    const accessToken = await signAccessToken({ apiKey: 'ak', apiUser: 'u@example.com' })
    await expect(verifyAuthCode(accessToken)).rejects.toThrow()
  })

  it('verifyAccessToken rejects an auth code token (wrong type)', async () => {
    const authCode = await signAuthCode({
      apiKey: 'ak', apiUser: 'u@example.com',
      codeChallenge: TEST_CODE_CHALLENGE, redirectUri: LOCALHOST_REDIRECT,
    })
    await expect(verifyAccessToken(authCode)).rejects.toThrow()
  })

  it('verifyAccessToken rejects a tampered token', async () => {
    const token = await signAccessToken({ apiKey: 'ak', apiUser: 'u@example.com' })
    const tampered = token.slice(0, -4) + 'XXXX'
    await expect(verifyAccessToken(tampered)).rejects.toThrow()
  })
})

// ─── Discovery endpoints ──────────────────────────────────────────────────────

describe('GET /.well-known/oauth-protected-resource', () => {
  it('returns resource and authorization_servers pointing to the same origin', async () => {
    const res = await request(testServer.baseUrl)
      .get('/.well-known/oauth-protected-resource')

    expect(res.status).toBe(200)
    const body = JSON.parse(res.text)
    expect(body.resource).toMatch(/^http:\/\/localhost:3006/)
    expect(body.authorization_servers).toContain(body.resource)
  })
})

describe('GET /.well-known/oauth-authorization-server', () => {
  it('returns complete OAuth 2.1 metadata', async () => {
    const res = await request(testServer.baseUrl)
      .get('/.well-known/oauth-authorization-server')

    expect(res.status).toBe(200)
    const body = JSON.parse(res.text)
    expect(body.issuer).toMatch(/^http:\/\/localhost:3006/)
    expect(body.authorization_endpoint).toContain('/oauth/authorize')
    expect(body.token_endpoint).toContain('/oauth/token')
    expect(body.response_types_supported).toContain('code')
    expect(body.grant_types_supported).toContain('authorization_code')
    expect(body.code_challenge_methods_supported).toContain('S256')
    expect(body.token_endpoint_auth_methods_supported).toContain('none')
  })
})

// ─── /oauth/authorize ─────────────────────────────────────────────────────────

describe('GET /oauth/authorize', () => {
  it('renders the Configure Paubox credential form for valid params', async () => {
    const res = await request(testServer.baseUrl)
      .get('/oauth/authorize')
      .query({
        response_type: 'code',
        redirect_uri: LOCALHOST_REDIRECT,
        state: 'test-state',
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
        client_id: 'https://claude.ai',
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('Configure Paubox')
    expect(res.text).toContain('name="apiUser"')
    expect(res.text).toContain('name="apiKey"')
  })

  it('accepts https://claude.ai/api/mcp/auth_callback as redirect_uri', async () => {
    const res = await request(testServer.baseUrl)
      .get('/oauth/authorize')
      .query({
        response_type: 'code',
        redirect_uri: CLAUDE_REDIRECT,
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
      })

    expect(res.status).toBe(200)
    expect(res.text).toContain('Configure Paubox')
  })

  it('returns 400 for unsupported response_type', async () => {
    const res = await request(testServer.baseUrl)
      .get('/oauth/authorize')
      .query({
        response_type: 'token',
        redirect_uri: LOCALHOST_REDIRECT,
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
      })

    expect(res.status).toBe(400)
  })

  it('returns 400 for an untrusted redirect_uri', async () => {
    const res = await request(testServer.baseUrl)
      .get('/oauth/authorize')
      .query({
        response_type: 'code',
        redirect_uri: 'https://evil.example.com/steal',
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
      })

    expect(res.status).toBe(400)
  })
})

describe('POST /oauth/authorize', () => {
  it('redirects with authorization code and state when credentials are provided', async () => {
    const res = await request(testServer.baseUrl)
      .post('/oauth/authorize')
      .type('form')
      .send({
        client_id: 'https://claude.ai',
        redirect_uri: LOCALHOST_REDIRECT,
        state: 'my-state-xyz',
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
        response_type: 'code',
        apiUser: 'user@example.com',
        apiKey: 'pk_test_valid_api_key_1234567890',
      })

    expect(res.status).toBe(302)
    const location = res.headers['location'] as string
    expect(location).toBeDefined()
    expect(location).toContain('code=')
    expect(location).toContain('state=my-state-xyz')
    expect(location).toContain(LOCALHOST_REDIRECT)
  })

  it('re-renders form with error when apiUser is empty', async () => {
    const res = await request(testServer.baseUrl)
      .post('/oauth/authorize')
      .type('form')
      .send({
        redirect_uri: LOCALHOST_REDIRECT,
        state: 'state',
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
        response_type: 'code',
        apiUser: '',
        apiKey: 'pk_test_valid_api_key_1234567890',
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('required')
  })

  it('re-renders form with error when apiKey is empty', async () => {
    const res = await request(testServer.baseUrl)
      .post('/oauth/authorize')
      .type('form')
      .send({
        redirect_uri: LOCALHOST_REDIRECT,
        state: 'state',
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
        response_type: 'code',
        apiUser: 'user@example.com',
        apiKey: '',
      })

    expect(res.status).toBe(200)
    expect(res.text).toContain('required')
  })

  it('returns 400 for an untrusted redirect_uri', async () => {
    const res = await request(testServer.baseUrl)
      .post('/oauth/authorize')
      .type('form')
      .send({
        redirect_uri: 'https://evil.example.com/steal',
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
        response_type: 'code',
        apiUser: 'user@example.com',
        apiKey: 'pk_test_valid_api_key_1234567890',
      })

    expect(res.status).toBe(400)
  })
})

// ─── /oauth/token ─────────────────────────────────────────────────────────────

describe('POST /oauth/token', () => {
  async function getCode(apiKey: string, apiUser: string): Promise<string> {
    const res = await request(testServer.baseUrl)
      .post('/oauth/authorize')
      .type('form')
      .send({
        redirect_uri: LOCALHOST_REDIRECT,
        state: 'state',
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
        response_type: 'code',
        apiUser,
        apiKey,
      })
    const location = res.headers['location'] as string
    return new URL(location).searchParams.get('code')!
  }

  it('issues an access token encoding apiKey and apiUser', async () => {
    const code = await getCode('pk_test_valid_key_1234567890', 'token-user@example.com')

    const res = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: TEST_CODE_VERIFIER,
        redirect_uri: LOCALHOST_REDIRECT,
      })

    expect(res.status).toBe(200)
    const body = JSON.parse(res.text)
    expect(body.access_token).toBeDefined()
    expect(body.token_type).toBe('bearer')
    expect(body.expires_in).toBeUndefined()

    const payload = await verifyAccessToken(body.access_token)
    expect(payload.apiKey).toBe('pk_test_valid_key_1234567890')
    expect(payload.apiUser).toBe('token-user@example.com')
  })

  it('rejects unsupported grant_type', async () => {
    const res = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'client_credentials',
        code: 'any',
        code_verifier: TEST_CODE_VERIFIER,
        redirect_uri: LOCALHOST_REDIRECT,
      })

    expect(res.status).toBe(400)
    expect(JSON.parse(res.text).error).toBe('unsupported_grant_type')
  })

  it('rejects an invalid authorization code', async () => {
    const res = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'not.a.valid.jwt',
        code_verifier: TEST_CODE_VERIFIER,
        redirect_uri: LOCALHOST_REDIRECT,
      })

    expect(res.status).toBe(401)
    expect(JSON.parse(res.text).error).toBe('invalid_grant')
  })

  it('rejects a wrong code_verifier (PKCE mismatch)', async () => {
    const code = await getCode('pk_test_valid_key_1234567890', 'user@example.com')

    const res = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier-does-not-match-challenge',
        redirect_uri: LOCALHOST_REDIRECT,
      })

    expect(res.status).toBe(401)
    expect(JSON.parse(res.text).error).toBe('invalid_grant')
  })

  it('rejects a redirect_uri that does not match the one in the auth code', async () => {
    const code = await getCode('pk_test_valid_key_1234567890', 'user@example.com')

    const res = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: TEST_CODE_VERIFIER,
        redirect_uri: 'http://localhost:8888/different',
      })

    expect(res.status).toBe(401)
    expect(JSON.parse(res.text).error).toBe('invalid_grant')
  })

  it('rejects missing code_verifier', async () => {
    const code = await getCode('pk_test_valid_key_1234567890', 'user@example.com')

    const res = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOCALHOST_REDIRECT,
        // code_verifier omitted
      })

    expect(res.status).toBe(400)
    expect(JSON.parse(res.text).error).toBe('invalid_request')
  })

  it('rejects an authorization code that has already been redeemed (single-use)', async () => {
    const code = await getCode('pk_test_replay_key_1234567890', 'replay-user@example.com')

    const first = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: TEST_CODE_VERIFIER,
        redirect_uri: LOCALHOST_REDIRECT,
      })

    expect(first.status).toBe(200)

    const second = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: TEST_CODE_VERIFIER,
        redirect_uri: LOCALHOST_REDIRECT,
      })

    expect(second.status).toBe(401)
    expect(JSON.parse(second.text).error).toBe('invalid_grant')
    expect(JSON.parse(second.text).error_description).toMatch(/already been used/i)
  })

  it('sets Cache-Control: no-store and Pragma: no-cache on success responses', async () => {
    const code = await getCode('pk_test_cache_key_1234567890', 'cache-user@example.com')

    const res = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: TEST_CODE_VERIFIER,
        redirect_uri: LOCALHOST_REDIRECT,
      })

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['pragma']).toBe('no-cache')
  })

  it('sets Cache-Control: no-store and Pragma: no-cache on error responses', async () => {
    const res = await request(testServer.baseUrl)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'not.a.valid.jwt',
        code_verifier: TEST_CODE_VERIFIER,
        redirect_uri: LOCALHOST_REDIRECT,
      })

    expect(res.status).toBe(401)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['pragma']).toBe('no-cache')
  })
})

// ─── XSS protection in /oauth/authorize ───────────────────────────────────────

describe('GET /oauth/authorize — XSS protection', () => {
  it('escapes `</script>` in reflected `state` so it cannot break out of the inline script', async () => {
    const malicious = `</script><script>window.__pwned=1</script>`

    const res = await request(testServer.baseUrl)
      .get('/oauth/authorize')
      .query({
        response_type: 'code',
        redirect_uri: LOCALHOST_REDIRECT,
        state: malicious,
        code_challenge: TEST_CODE_CHALLENGE,
        code_challenge_method: 'S256',
      })

    expect(res.status).toBe(200)
    // Literal `</script>` must not appear inside the rendered <script> block
    // before its legitimate closing tag — if it did, a real browser would
    // terminate the first <script> early and parse the attacker payload as
    // new HTML.
    const firstScriptOpen = res.text.indexOf('<script>')
    const firstScriptClose = res.text.indexOf('</script>', firstScriptOpen)
    const innerScript = res.text.slice(firstScriptOpen + '<script>'.length, firstScriptClose)
    expect(innerScript).not.toContain('</script>')
    // The escaped form should appear instead (only `<` is encoded — `>` is
    // unaffected, since the `</script>` breakout depends solely on `<`).
    expect(innerScript).toContain('\\u003C/script>')
  })
})

// ─── MCP route — Bearer token path ────────────────────────────────────────────

describe('MCP route — Bearer token credential resolution', () => {
  it('uses credentials from Bearer access token when no x-paubox headers are set', async () => {
    const accessToken = await signAccessToken({
      apiKey: 'pk_test_bearer_key_1234567890',
      apiUser: 'bearer-user@example.com',
    })

    const res = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'validate_credentials', arguments: {} },
      })

    expect(res.status).toBe(200)
    const match = res.text.match(/data: (.+)/)
    expect(match).toBeTruthy()
    if (match) {
      const data = JSON.parse(match[1])
      expect(data.result.content[0].text).toContain('✅ Credentials validated successfully')
      expect(data.result.content[0].text).toContain('bearer-user@example.com')
    }
  })

  it('x-paubox headers take priority over a Bearer token', async () => {
    const accessToken = await signAccessToken({
      apiKey: 'pk_test_bearer_key_1234567890',
      apiUser: 'bearer-user@example.com',
    })

    const res = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-paubox-api-key', 'pk_test_header_key_0987654321')
      .set('x-paubox-api-user', 'header-user@example.com')
      .send({
        jsonrpc: '2.0', id: 2,
        method: 'tools/call',
        params: { name: 'validate_credentials', arguments: {} },
      })

    expect(res.status).toBe(200)
    const match = res.text.match(/data: (.+)/)
    expect(match).toBeTruthy()
    if (match) {
      const data = JSON.parse(match[1])
      expect(data.result.content[0].text).toContain('header-user@example.com')
      expect(data.result.content[0].text).not.toContain('bearer-user@example.com')
    }
  })

  it('returns missing-credentials error for an invalid Bearer token', async () => {
    const res = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('Authorization', 'Bearer not.a.valid.token')
      .send({
        jsonrpc: '2.0', id: 3,
        method: 'tools/call',
        params: { name: 'validate_credentials', arguments: {} },
      })

    expect(res.status).toBe(200)
    const match = res.text.match(/data: (.+)/)
    if (match) {
      const data = JSON.parse(match[1])
      expect(data.result.content[0].text).toContain('❌ API credentials required')
    }
  })
})
