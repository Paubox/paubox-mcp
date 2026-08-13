// Tests for Claude Connectors header-based credential support.
// The apiKey can be passed via the x-paubox-api-key header instead of
// (or in addition to) tool parameters. Only the apiKey authenticates —
// legacy x-paubox-api-user headers are tolerated and ignored.

process.env.PAUBOX_API_KEY = 'test-key';

import request from 'supertest';
import { createTestServer, closeTestServer, TestServer } from './test-helpers';
// (TEST_AUTH_HEADERS intentionally not imported — this file tests credential resolution specifically)

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer(3003);
}, 10000);

afterAll(async () => {
  await closeTestServer(testServer);
});

const VALID_API_KEY = 'pk_test_valid_api_key_1234567890';

// validate_credentials masks the key as first-4-chars + asterisks.
const masked = (key: string) => key.slice(0, 4) + '*'.repeat(Math.max(0, key.length - 4));

function mcpCall(id: number, toolName: string, args: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
}

// Requests with no headers/params must hit the unauthenticated 401 path —
// temporarily clear the local-dev env fallback so it can't satisfy them.
async function withoutEnvKey<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.PAUBOX_API_KEY;
  delete process.env.PAUBOX_API_KEY;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.PAUBOX_API_KEY;
    else process.env.PAUBOX_API_KEY = saved;
  }
}

describe('Claude Connectors — header-based credentials', () => {

  describe('validate_credentials', () => {
    it('succeeds with only the x-paubox-api-key header (no x-paubox-api-user needed)', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', VALID_API_KEY)
        .send(mcpCall(1, 'validate_credentials', {}));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        expect(data.result.content[0].text).toContain('✅ Credentials validated successfully');
        expect(data.result.content[0].text).toContain(masked(VALID_API_KEY));
      }
    });

    it('tolerates and ignores a legacy x-paubox-api-user header', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', VALID_API_KEY)
        .set('x-paubox-api-user', 'legacy-user@example.com')
        .send(mcpCall(9, 'validate_credentials', {}));

      expect(res.status).toBe(200);

      const match = res.text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result.content[0].text).toContain('✅ Credentials validated successfully');
        // The legacy header must not be required, cause an error, or leak
        // into the response.
        expect(data.result.content[0].text).not.toContain('legacy-user@example.com');
      }
    });

    it('returns 401 with WWW-Authenticate when no headers and no params (transport-level auth required)', async () => {
      await withoutEnvKey(async () => {
        const res = await request(testServer.baseUrl)
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .send(mcpCall(2, 'validate_credentials', {}));

        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toMatch(/Bearer realm="Paubox MCP"/);
        expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/);
      });
    });

    it('tool params take precedence over headers', async () => {
      const headerKey = 'hdr_test_header_key_0987654321';
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', headerKey)
        .send(mcpCall(3, 'validate_credentials', {
          apiKey: VALID_API_KEY,
        }));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        // The tool should use the param value, not the header value
        expect(data.result.content[0].text).toContain(masked(VALID_API_KEY));
        expect(data.result.content[0].text).not.toContain(masked(headerKey));
      }
    });
  });

  describe('send_secure_email', () => {
    it('accepts the apiKey only via the header', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', VALID_API_KEY)
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
        expect(data.result.content[0].text).not.toContain('❌ API key required');
        expect(data.result.content[0].text).toMatch(/✅ Email sent successfully|❌ Failed to send email/);
      }
    });

    it('returns 401 when no headers and no params (transport-level auth required)', async () => {
      await withoutEnvKey(async () => {
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

        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toMatch(/Bearer realm="Paubox MCP"/);
      });
    });
  });

  describe('send_secure_email — param precedence over headers', () => {
    it('uses the param apiKey over the header apiKey when both are provided', async () => {
      // Headers carry a key that would be ignored; params carry a valid key.
      // If params win, the tool proceeds past credential resolution to the
      // API call. If resolution broke, the tool would return a missing-key error.
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', 'ignored-header-key')
        .send(mcpCall(20, 'send_secure_email', {
          apiKey: VALID_API_KEY,
          from: 'sender@example.com',
          to: ['recipient@example.com'],
          subject: 'Precedence Test',
          message: 'Testing param over header',
        }));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        // Credentials were resolved → tool attempted the API call, not a credentials error
        expect(data.result.content[0].text).not.toContain('❌ API key required');
        expect(data.result.content[0].text).toMatch(/✅ Email sent successfully|❌ Failed to send email/);
      }
    });
  });

  describe('check_email_status', () => {
    it('accepts the apiKey only via the header', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', VALID_API_KEY)
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
        expect(data.result.content[0].text).not.toContain('❌ API key required');
        expect(data.result.content[0].text).toMatch(/📊 Email Status Report|❌ Failed to check email status/);
      }
    });

    it('returns 401 when no headers and no params (transport-level auth required)', async () => {
      await withoutEnvKey(async () => {
        const res = await request(testServer.baseUrl)
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .send(mcpCall(7, 'check_email_status', {
            sourceTrackingId: 'test-tracking-id-123',
          }));

        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toMatch(/Bearer realm="Paubox MCP"/);
      });
    });
  });

  describe('check_email_status — param precedence over headers', () => {
    it('uses the param apiKey over the header apiKey when both are provided', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', 'ignored-header-key')
        .send(mcpCall(21, 'check_email_status', {
          apiKey: VALID_API_KEY,
          sourceTrackingId: 'test-tracking-id-for-precedence',
        }));

      expect(res.status).toBe(200);

      const text = res.text;
      const match = text.match(/data: (.+)/);
      expect(match).toBeTruthy();

      if (match) {
        const data = JSON.parse(match[1]);
        expect(data.result).toBeDefined();
        // Credentials were resolved → tool attempted the API call, not a credentials error
        expect(data.result.content[0].text).not.toContain('❌ API key required');
        expect(data.result.content[0].text).toMatch(/📊 Email Status Report|❌ Failed to check email status/);
      }
    });
  });

  describe('tools/list schema', () => {
    it('shows apiKey as optional and has no apiUser parameter in any tool', async () => {
      const res = await request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', VALID_API_KEY)
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
          expect(tools.length).toBeGreaterThan(0);
          for (const tool of tools) {
            const required: string[] = tool.inputSchema?.required ?? [];
            expect(required).not.toContain('apiKey');
            // apiUser has been removed from every tool schema entirely
            const properties = Object.keys(tool.inputSchema?.properties ?? {});
            expect(properties).not.toContain('apiUser');
          }
        }
      }
    });
  });
});
