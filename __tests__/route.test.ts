// Mock environment variables for all tests
process.env.PAUBOX_API_KEY = 'test-key';
process.env.PAUBOX_API_USER = 'test-user';

import request from 'supertest';
import { createTestServer, closeTestServer, TestServer } from './test-helpers';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer(3002);
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
          apiUser: "test-user@example.com",
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
      .send(payload)

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
          apiUser: "test-user@example.com",
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
      .send(payload)

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
          apiUser: "test-user@example.com",
          // Missing required fields: from, to, subject, message
        }
      }
    }

    const response = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send(payload)
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
})