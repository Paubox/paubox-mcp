// Mock environment variables for all tests
process.env.PAUBOX_API_KEY = 'test-key';

import request from 'supertest';
import { createTestServer, closeTestServer, TestServer } from './test-helpers';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer();
}, 10000);

afterAll(async () => {
  await closeTestServer(testServer);
});

describe('MCP Route Tests', () => {

  it('should handle send_secure_email tool call successfully', async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "send_secure_email",
        arguments: {
          apiKey: "test-api-key-1234567890",
          from: "test@example.com",
          to: ["recipient@example.com"],
          subject: "test subject",
          message: "Test message content"
        }
      }
    }

    const response = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('x-paubox-api-key', 'test-api-key-1234567890')      .send(payload)

    // Check that the response is successful
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')

    // Parse SSE response
    const responseText = response.text
    const dataMatch = responseText.match(/data: (.+)/)
    expect(dataMatch).toBeTruthy()

    if (dataMatch) {
      const responseData = JSON.parse(dataMatch[1])
      expect(responseData.jsonrpc).toBe('2.0')
      expect(responseData.id).toBe(1)
      expect(responseData.result).toBeDefined()
      expect(responseData.result.content).toBeDefined()
      expect(responseData.result.content[0].type).toBe('text')
      // The response should contain either success or error message
      expect(responseData.result.content[0].text).toMatch(/✅ Email sent successfully|❌ Failed to send email/)
    }
  })

  it('should handle send_secure_email tool call with optional fields', async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "send_secure_email",
        arguments: {
          apiKey: "test-api-key-1234567890",
          from: "test@example.com",
          to: ["recipient@example.com"],
          subject: "test subject",
          message: "Test message",
          cc: ["cc@example.com"],
          bcc: ["bcc@example.com"],
          forceSecureNotification: true
        }
      }
    }

    const response = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('x-paubox-api-key', 'test-api-key-1234567890')      .send(payload)

    // Check that the response is successful
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')

    // Parse SSE response
    const responseText = response.text
    const dataMatch = responseText.match(/data: (.+)/)
    expect(dataMatch).toBeTruthy()

    if (dataMatch) {
      const responseData = JSON.parse(dataMatch[1])
      expect(responseData.jsonrpc).toBe('2.0')
      expect(responseData.id).toBe(2)
      expect(responseData.result).toBeDefined()
      expect(responseData.result.content).toBeDefined()
      expect(responseData.result.content[0].type).toBe('text')
      // The response should contain either success or error message
      expect(responseData.result.content[0].text).toMatch(/✅ Email sent successfully|❌ Failed to send email/)
    }
  })

  it('should handle missing required fields gracefully', async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "send_secure_email",
        arguments: {
          apiKey: "test-api-key-1234567890",
          // Missing required fields: from, to, subject, message
        }
      }
    }

    const response = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('x-paubox-api-key', 'test-api-key-1234567890')      .send(payload)
      .timeout(5000)

    // Should still return 200 but with error in result
    expect(response).toBeDefined()
    expect(response.status).toBe(200)

    // Parse SSE response
    const responseText = response.text
    const dataMatch = responseText.match(/data: (.+)/)
    expect(dataMatch).toBeTruthy()

    if (dataMatch) {
      const responseData = JSON.parse(dataMatch[1])
      expect(responseData.jsonrpc).toBe('2.0')
      expect(responseData.id).toBe(3)

      // For validation errors, the response should have error in result content
      expect(responseData.result).toBeDefined()
      expect(responseData.result.isError).toBe(true)
      expect(responseData.result.content).toBeDefined()
      expect(responseData.result.content[0].text).toContain('Invalid arguments for tool send_secure_email')
    }
  })

  // Regression: caller-supplied formId that isn't a UUID must be rejected
  // before it hits any URL path — a `..`/`?`/`#` splice would otherwise
  // let a hostile caller retarget the request to a different endpoint on
  // the same host. Same class of finding that gate-blocked paubox-python3
  // PR #10 and paubox-php PR #16.
  const HOSTILE_FORM_IDS = [
    { label: 'dot-dot',       formId: '..' },
    { label: 'path traversal', formId: '../public/customers' },
    { label: 'query splice',   formId: 'abc?admin=true' },
    { label: 'fragment splice', formId: 'abc#frag' },
    { label: 'slash',          formId: 'abc/def' },
  ]

  async function callGetForm(id: number, formId: string) {
    const payload = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'get_form', arguments: { formId } },
    }
    return request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('x-paubox-api-key', 'test-api-key-1234567890')      .send(payload)
      .timeout(5000)
  }

  async function callSubmitForm(id: number, formId: string) {
    const payload = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: 'submit_form',
        arguments: { formId, formData: { probe: 'regression' } },
      },
    }
    return request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('x-paubox-api-key', 'test-api-key-1234567890')      .send(payload)
      .timeout(5000)
  }

  function parseSse(text: string): { result: { content: Array<{ text: string }> } } | null {
    const dataMatch = text.match(/data: (.+)/)
    if (!dataMatch) return null
    return JSON.parse(dataMatch[1])
  }

  HOSTILE_FORM_IDS.forEach(({ label, formId }, i) => {
    it(`get_form rejects hostile formId (${label}) before firing a request`, async () => {
      const response = await callGetForm(1000 + i, formId)
      expect(response.status).toBe(200)
      const parsed = parseSse(response.text)
      expect(parsed).not.toBeNull()
      expect(parsed!.result.content[0].text).toContain('formId must be a UUID.')
      expect(parsed!.result.content[0].text).toContain('❌ Failed to retrieve form')
    })

    it(`submit_form rejects hostile formId (${label}) before firing a request`, async () => {
      const response = await callSubmitForm(2000 + i, formId)
      expect(response.status).toBe(200)
      const parsed = parseSse(response.text)
      expect(parsed).not.toBeNull()
      expect(parsed!.result.content[0].text).toContain('formId must be a UUID.')
      expect(parsed!.result.content[0].text).toContain('❌ Failed to submit form')
    })
  })
})