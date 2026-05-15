// Tests for Claude Connectors header-based credential support.
// Credentials can be passed via x-paubox-api-key / x-paubox-api-user headers
// instead of (or in addition to) tool parameters.

process.env.PAUBOX_API_KEY = 'test-key';
process.env.PAUBOX_API_USER = 'test-user';

import request from 'supertest';
import { createTestServer, closeTestServer, TestServer } from './test-helpers';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer(3003);
}, 10000);

afterAll(async () => {
  await closeTestServer(testServer);
});

const VALID_API_KEY = 'pk_test_valid_api_key_1234567890';
const VALID_API_USER = 'connector-user@example.com';

function mcpCall(id: number, toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
}

describe('Claude Connectors — header-based credentials', () => {

  describe('validate_credentials', () => {
    it('succeeds with credentials provided only via headers', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', VALID_API_KEY)
        .set('x-paubox-api-user', VALID_API_USER)
        .send(mcpCall(1, 'validate_credentials', {}));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        expect(data.result.content[0].text).toContain('✅ Credentials validated successfully');
        expect(data.result.content[0].text).toContain(VALID_API_USER);
      }
    });

    it('returns missing-credentials error when no headers and no params', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .send(mcpCall(2, 'validate_credentials', {}));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        expect(data.result.content[0].text).toContain('❌ API credentials required');
        expect(data.result.content[0].text).toContain('x-paubox-api-key');
      }
    });

    it('tool params take precedence over headers', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', 'header-key-should-be-ignored')
        .set('x-paubox-api-user', 'header-user@example.com')
        .send(mcpCall(3, 'validate_credentials', {
          apiKey: VALID_API_KEY,
          apiUser: 'param-user@example.com',
        }));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        // The tool should use the param value, not the header value
        expect(data.result.content[0].text).toContain('param-user@example.com');
        expect(data.result.content[0].text).not.toContain('header-user@example.com');
      }
    });
  });

  describe('send_secure_email', () => {
    it('accepts credentials only via headers', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', VALID_API_KEY)
        .set('x-paubox-api-user', VALID_API_USER)
        .send(mcpCall(4, 'send_secure_email', {
          from: 'sender@example.com',
          to: ['recipient@example.com'],
          subject: 'Connector Header Test',
          message: 'Testing header-based credentials',
        }));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        // Should attempt the API call (succeed or fail with API error), not a credentials error
        expect(data.result.content[0].text).not.toContain('❌ API credentials required');
        expect(data.result.content[0].text).toMatch(/✅ Email sent successfully|❌ Failed to send email/);
      }
    });

    it('returns missing-credentials error when no headers and no params', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .send(mcpCall(5, 'send_secure_email', {
          from: 'sender@example.com',
          to: ['recipient@example.com'],
          subject: 'No Creds Test',
          message: 'This should fail with credentials error',
        }));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result.content[0].text).toContain('❌ API credentials required');
      }
    });
  });

  describe('check_email_status', () => {
    it('accepts credentials only via headers', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', VALID_API_KEY)
        .set('x-paubox-api-user', VALID_API_USER)
        .send(mcpCall(6, 'check_email_status', {
          sourceTrackingId: 'test-tracking-id-123',
        }));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        // Should attempt the API call, not return credentials error
        expect(data.result.content[0].text).not.toContain('❌ API credentials required');
        expect(data.result.content[0].text).toMatch(/📊 Email Status Report|❌ Failed to check email status/);
      }
    });

    it('returns missing-credentials error when no headers and no params', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .send(mcpCall(7, 'check_email_status', {
          sourceTrackingId: 'test-tracking-id-123',
        }));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result.content[0].text).toContain('❌ API credentials required');
      }
    });
  });

  describe('tools/list schema', () => {
    it('shows apiKey and apiUser as optional (not required) in all tools', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 8, method: 'tools/list' });

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        if (data.result?.tools) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tools: any[] = data.result.tools;
          for (const tool of tools) {
            const required: string[] = tool.inputSchema?.required ?? [];
            expect(required).not.toContain('apiKey');
            expect(required).not.toContain('apiUser');
          }
        }
      }
    });
  });
});
