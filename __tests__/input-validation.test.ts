// Tests for input validation edge cases in tool handlers:
// - whitespace-only apiKey that passes Zod's length check but fails the trim check
// - legacy apiUser arguments are ignored (apiKey alone authenticates)
// - empty and whitespace-only message in send_secure_email
// - whitespace-only sourceTrackingId in check_email_status

process.env.PAUBOX_API_KEY = 'test-key';

import request from 'supertest';
import { createTestServer, closeTestServer, TestServer, TEST_AUTH_HEADERS } from './test-helpers';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer();
}, 15000);

afterAll(async () => {
  await closeTestServer(testServer);
});

const VALID_API_KEY = 'pk_test_valid_api_key_1234567890';

function mcpCall(id: number, toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
}

function parseSSE(text: string) {
  const match = text.match(/data: (.+)/);
  if (!match) throw new Error(`No SSE data line found in response: ${text.slice(0, 200)}`);
  return JSON.parse(match[1]);
}

describe('validate_credentials — input validation', () => {
  it('rejects whitespace-only apiKey (passes z.string().min(10) by length but fails trim check)', async () => {
    const res = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(TEST_AUTH_HEADERS)
      .send(mcpCall(1, 'validate_credentials', {
        apiKey: '          ', // 10 spaces — passes Zod min(10), caught by apiKey.trim().length < 10
      }));

    expect(res.status).toBe(200);
    const data = parseSSE(res.text);
    expect(data.result.content[0].text).toContain('❌ Credential validation failed');
  });

  // apiUser is no longer a credential. A legacy client may still send it —
  // even as garbage — and the tool must ignore it rather than fail.
  it('ignores a legacy apiUser argument and validates with the apiKey alone', async () => {
    const res = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(TEST_AUTH_HEADERS)
      .send(mcpCall(2, 'validate_credentials', {
        apiKey: VALID_API_KEY,
        apiUser: '   ',
      }));

    expect(res.status).toBe(200);
    const data = parseSSE(res.text);
    // The garbage apiUser must never trip argument validation or the
    // missing-credentials path — the call reaches the credential check
    // itself: ✅ when the check is bypassed / soft-passes, or the live
    // API's "Invalid API key" for the placeholder key.
    const text = data.result.content[0].text;
    expect(text).not.toContain('Invalid arguments');
    expect(text).not.toContain('API key required');
    expect(text).toMatch(
      /✅ Credentials validated successfully|❌ Credential validation failed: Invalid API key\./,
    );
  });
});

describe('send_secure_email — input validation', () => {
  it('rejects empty message', async () => {
    const res = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(TEST_AUTH_HEADERS)
      .send(mcpCall(3, 'send_secure_email', {
        apiKey: VALID_API_KEY,
        from: 'sender@example.com',
        to: ['recipient@example.com'],
        subject: 'Test',
        message: '',
      }));

    expect(res.status).toBe(200);
    const data = parseSSE(res.text);
    expect(data.result.content[0].text).toContain('❌ Failed to send email');
  });

  it('rejects whitespace-only message', async () => {
    const res = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(TEST_AUTH_HEADERS)
      .send(mcpCall(4, 'send_secure_email', {
        apiKey: VALID_API_KEY,
        from: 'sender@example.com',
        to: ['recipient@example.com'],
        subject: 'Test',
        message: '   ',
      }));

    expect(res.status).toBe(200);
    const data = parseSSE(res.text);
    expect(data.result.content[0].text).toContain('❌ Failed to send email');
  });
});

describe('check_email_status — input validation', () => {
  it('rejects whitespace-only sourceTrackingId (passes z.string().min(1) but fails trim check)', async () => {
    const res = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(TEST_AUTH_HEADERS)
      .send(mcpCall(5, 'check_email_status', {
        apiKey: VALID_API_KEY,
        sourceTrackingId: '   ',
      }));

    expect(res.status).toBe(200);
    const data = parseSSE(res.text);
    expect(data.result.content[0].text).toContain('❌ Failed to check email status');
  });
});
