// Integration test: drive a real tools/call through the hosted Next.js server
// and check what actually reaches the Paubox API.
//
// HTTPS_PROXY points at a local fake proxy. axios tunnels https:// requests
// with CONNECT, so the fake terminates TLS itself with a throwaway self-signed
// certificate (generated here with openssl, never committed) and answers as
// api.paubox.com. Certificate verification stays on: the suite adds that one
// certificate to the default CA store and restores the store afterwards.
// jest.setup.js points HTTPS_PROXY at a dead port for the other suites.

import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import tls from 'tls'
import request from 'supertest'
import { createTestServer, closeTestServer, TestServer, TEST_AUTH_HEADERS } from './test-helpers'

type Seen = { url: string; headers: http.IncomingHttpHeaders }

let testServer: TestServer
let proxy: http.Server
let seen: Seen[] = []
let respondStatus = 503
const originalEnv = {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  https_proxy: process.env.https_proxy,
}
const originalCAs = tls.getCACertificates('default')

function selfSignedCert(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'pbmcp-cert-'))
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=api.paubox.com', '-addext', 'subjectAltName=DNS:api.paubox.com',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
    ], { stdio: 'ignore' })
    return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

beforeAll(async () => {
  // Plays api.paubox.com behind the TLS tunnel.
  const fakeApi = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers })
    req.resume()
    req.on('end', () => {
      res.writeHead(respondStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errors: [{ code: respondStatus, title: 'Error', details: 'simulated' }] }))
    })
  })
  const { key, cert } = selfSignedCert()
  const secureContext = tls.createSecureContext({ key, cert })
  tls.setDefaultCACertificates([...originalCAs, cert.toString()])

  proxy = http.createServer((_req, res) => {
    res.writeHead(502)
    res.end()
  })
  proxy.on('connect', (_req, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    const secure = new tls.TLSSocket(socket, { isServer: true, secureContext })
    fakeApi.emit('connection', secure)
  })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', () => resolve()))
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
  process.env.HTTPS_PROXY = proxyUrl
  process.env.https_proxy = proxyUrl
  testServer = await createTestServer()
}, 30000)

afterAll(async () => {
  tls.setDefaultCACertificates(originalCAs)
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  await closeTestServer(testServer)
  proxy.closeAllConnections?.()
  await new Promise<void>((resolve) => proxy.close(() => resolve()))
})

beforeEach(() => {
  seen = []
})

async function callTool(name: string, args: Record<string, unknown>) {
  const response = await request(testServer.baseUrl)
    .post('/mcp')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .set(TEST_AUTH_HEADERS)
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  expect(response.status).toBe(200)
  const data = response.text.match(/data: (.+)/)
  expect(data).toBeTruthy()
  return JSON.parse(data![1]).result as { content: { type: string; text: string }[] }
}

const REQUEST_ID = /^pbmcp-[0-9a-f-]{36}$/

describe('hosted server client identification (ADR-050)', () => {
  it('identifies itself to the Email API and returns the request id on failure', async () => {
    respondStatus = 503
    const result = await callTool('send_secure_email', {
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      subject: 'subject',
      message: 'body',
    })

    const sends = seen.filter((s) => s.url.includes('/v1/email/messages'))
    expect(sends).toHaveLength(1)
    const { headers } = sends[0]
    expect(headers.host).toBe('api.paubox.com')
    expect(headers['x-paubox-client']).toBe('paubox-mcp')
    expect(headers['x-paubox-client-version']).toMatch(/^\d+\.\d+\.\d+/)
    expect(headers['x-paubox-client-command']).toBe('send_secure_email')
    expect(headers['user-agent']).toMatch(/^paubox-mcp\/\d+\.\d+\.\d+ \(node\/v\d+.*; http\)$/)
    expect(headers['x-request-id']).toMatch(REQUEST_ID)

    // No PHI in the identity headers: none of the tool arguments appear.
    const identity = [
      headers['user-agent'],
      headers['x-paubox-client'],
      headers['x-paubox-client-version'],
      headers['x-paubox-client-command'],
      headers['x-request-id'],
    ].join(' ')
    expect(identity).not.toMatch(/example\.com|subject|body/)

    const text = result.content.map((c) => c.text).join('\n')
    expect(text).toMatch(/❌/)
    expect(text).toContain(`Paubox request ID: ${headers['x-request-id']}`)
  }, 30000)

  it('sends a different request id per request and the right command per tool', async () => {
    respondStatus = 401
    await callTool('list_forms', { customerId: 1 })
    await callTool('list_forms', { customerId: 1 })
    const forms = seen.filter((s) => s.url.includes('/v1/forms'))
    expect(forms.length).toBeGreaterThanOrEqual(2)
    expect(forms.every((s) => s.headers['x-paubox-client-command'] === 'list_forms')).toBe(true)
    const ids = new Set(forms.map((s) => s.headers['x-request-id']))
    expect(ids.size).toBe(forms.length)
  }, 30000)
})

describe('hosted list_forms customer scoping', () => {
  it("omits customer_id without a customerId, so the Forms API uses the key's own customer", async () => {
    respondStatus = 401
    const result = await callTool('list_forms', {})
    expect(result.content[0].text).not.toContain('Invalid arguments')
    await callTool('list_forms', { customerId: 42 })

    const customerIds = seen
      .filter((s) => s.url.includes('/v1/forms/api/forms'))
      .map((s) => new URL(s.url, 'https://api.paubox.com').searchParams.get('customer_id'))
    expect(customerIds[0]).toBeNull()
    expect(customerIds.at(-1)).toBe('42')
  }, 30000)
})
