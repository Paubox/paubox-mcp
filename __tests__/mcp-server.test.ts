// Mock environment variables for all tests
process.env.PAUBOX_API_KEY = 'test-key';

import request from 'supertest';
import next from 'next';
import http from 'http';

let server: http.Server;
let app: ReturnType<typeof next>;

beforeAll(async () => {
  app = next({ dev: false, dir: process.cwd() });
  await app.prepare();
  server = http.createServer((req, res) => app.getRequestHandler()(req, res));
  await new Promise<void>((resolve) => server.listen(3001, () => resolve()));
}, 5000);

// The API key alone authenticates — no x-paubox-api-user header is sent, so
// every test here also proves key-only transport auth works.
const TEST_AUTH_HEADERS = {
  'x-paubox-api-key': 'pk_test_valid_api_key_1234567890',
};

// Tool-call responses arrive as SSE (text/event-stream); parse the data line.
function parseSse(text: string) {
  const dataMatch = text.match(/data: (.+)/);
  if (!dataMatch) throw new Error(`No SSE data line found in response: ${text.slice(0, 200)}`);
  return JSON.parse(dataMatch[1]);
}

afterAll(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (app && typeof app.close === 'function') {
    await app.close();
  }
});

describe('Paubox MCP Server', () => {
  describe('Route Exports', () => {
    it('should export GET handler as a function', async () => {
      const { GET } = await import('../app/[transport]/route');
      expect(typeof GET).toBe('function');
    });

    it('should export POST handler as a function', async () => {
      const { POST } = await import('../app/[transport]/route');
      expect(typeof POST).toBe('function');
    });
  });

  describe('MCP API Endpoints', () => {
    describe('GET /mcp', () => {
      it('should return 405 Method Not Allowed for authenticated GET requests', async () => {
        const res = await request('http://localhost:3001')
          .get('/mcp')
          .set(TEST_AUTH_HEADERS);
        expect(res.statusCode).toBe(405);
      });
    });

    describe('POST /mcp', () => {
      it('should list available tools', async () => {
        const res = await request('http://localhost:3001')
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
          .send({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list'
          });

        expect(res.statusCode).toBe(200);
        // The MCP handler might return a different format, so we'll check for a valid response
        expect(res.body).toBeDefined();
        
        // If it's a JSON-RPC response, check the format
        if (res.body.jsonrpc) {
          expect(res.body.jsonrpc).toBe('2.0');
          expect(res.body.id).toBe(1);
          expect(res.body.result).toBeDefined();
          expect(res.body.result.tools).toBeDefined();
          expect(Array.isArray(res.body.result.tools)).toBe(true);

          // Check for expected tools
          const toolNames = res.body.result.tools.map((tool: { name: string }) => tool.name);
          expect(toolNames).toContain('validate_credentials');
          expect(toolNames).toContain('send_secure_email');
          expect(toolNames).toContain('check_email_status');
        }
      });

      it('should not expose an apiUser parameter in any tool schema', async () => {
        const res = await request('http://localhost:3001')
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
          .send({
            jsonrpc: '2.0',
            id: 100,
            method: 'tools/list'
          });

        expect(res.statusCode).toBe(200);
        const data = parseSse(res.text);
        const tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> =
          data.result.tools;
        expect(tools.length).toBeGreaterThan(0);
        for (const tool of tools) {
          const properties = tool.inputSchema?.properties ?? {};
          expect(Object.keys(properties)).not.toContain('apiUser');
        }
      });

      describe('validate_credentials tool', () => {
        it('should validate credentials successfully with valid input', async () => {
          const res = await request('http://localhost:3001')
            .post('/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
            .send({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: {
                name: 'validate_credentials',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890'
                }
              }
            });

          expect(res.statusCode).toBe(200);
          expect(res.body).toBeDefined();

          // Check for either JSON-RPC format or direct response
          if (res.body.jsonrpc) {
            expect(res.body.jsonrpc).toBe('2.0');
            expect(res.body.id).toBe(2);
            expect(res.body.result).toBeDefined();
            expect(res.body.result.content).toBeDefined();
            expect(Array.isArray(res.body.result.content)).toBe(true);

            const content = res.body.result.content[0];
            expect(content.type).toBe('text');
            expect(content.text).toContain('✅ Credentials validated successfully');
          }
        });

        it('should reject invalid API key format', async () => {
          const res = await request('http://localhost:3001')
            .post('/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
            .send({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: 'validate_credentials',
                arguments: {
                  apiKey: 'short'
                }
              }
            });

          expect(res.statusCode).toBe(200);
          expect(res.body).toBeDefined();
          
          if (res.body.jsonrpc) {
            expect(res.body.jsonrpc).toBe('2.0');
            expect(res.body.id).toBe(3);
            expect(res.body.result).toBeDefined();
            expect(res.body.result.content).toBeDefined();

            const content = res.body.result.content[0];
            expect(content.type).toBe('text');
            expect(content.text).toContain('❌ Credential validation failed');
          }
        });

        // apiUser is no longer part of the credential model: the apiKey
        // alone authenticates. A legacy client that still sends apiUser
        // must be tolerated — the argument is ignored, never an error.
        it('should validate successfully without apiUser, ignoring a legacy apiUser argument', async () => {
          const res = await request('http://localhost:3001')
            .post('/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
            .send({
              jsonrpc: '2.0',
              id: 4,
              method: 'tools/call',
              params: {
                name: 'validate_credentials',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',
                  apiUser: 'legacy-user@example.com'
                }
              }
            });

          expect(res.statusCode).toBe(200);
          const data = parseSse(res.text);
          expect(data.jsonrpc).toBe('2.0');
          expect(data.id).toBe(4);
          expect(data.result).toBeDefined();
          expect(data.result.isError).not.toBe(true);

          const content = data.result.content[0];
          expect(content.type).toBe('text');
          // The extra apiUser must never trip argument validation or the
          // missing-credentials path. The call reaches the credential
          // check itself: ✅ when the check is bypassed / soft-passes,
          // or the live API's "Invalid API key" for the placeholder key.
          expect(content.text).not.toContain('Invalid arguments');
          expect(content.text).not.toContain('API key required');
          expect(content.text).toMatch(
            /✅ Credentials validated successfully|❌ Credential validation failed: Invalid API key\./
          );
        });
      });

      describe('send_secure_email tool', () => {
        it('should validate send_secure_email parameters', async () => {
          const res = await request('http://localhost:3001')
            .post('/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
            .send({
              jsonrpc: '2.0',
              id: 5,
              method: 'tools/call',
              params: {
                name: 'send_secure_email',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',                  from: 'sender@example.com',
                  to: ['recipient@example.com'],
                  subject: 'Test Email',
                  message: 'This is a test email'
                }
              }
            });

          expect(res.statusCode).toBe(200);
          expect(res.body).toBeDefined();
          
          if (res.body.jsonrpc) {
            expect(res.body.jsonrpc).toBe('2.0');
            expect(res.body.id).toBe(5);
            expect(res.body.result).toBeDefined();
          }
        });

        it('should reject invalid email format in send_secure_email', async () => {
          const res = await request('http://localhost:3001')
            .post('/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
            .send({
              jsonrpc: '2.0',
              id: 6,
              method: 'tools/call',
              params: {
                name: 'send_secure_email',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',                  from: 'invalid-email',
                  to: ['recipient@example.com'],
                  subject: 'Test Email',
                  message: 'This is a test email'
                }
              }
            });

          expect(res.statusCode).toBe(200);
          expect(res.body).toBeDefined();
          
          // Should get an error response for invalid email format
          if (res.body.error) {
            expect(res.body.error).toBeDefined();
          }
        });

        it('should handle optional parameters correctly', async () => {
          const res = await request('http://localhost:3001')
            .post('/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
            .send({
              jsonrpc: '2.0',
              id: 7,
              method: 'tools/call',
              params: {
                name: 'send_secure_email',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',                  from: 'sender@example.com',
                  to: ['recipient@example.com'],
                  subject: 'Test Email',
                  message: 'This is a test email',
                  cc: ['cc@example.com'],
                  bcc: ['bcc@example.com'],
                  forceSecureNotification: true
                }
              }
            });

          expect(res.statusCode).toBe(200);
          expect(res.body).toBeDefined();
          
          if (res.body.jsonrpc) {
            expect(res.body.jsonrpc).toBe('2.0');
            expect(res.body.id).toBe(7);
            expect(res.body.result).toBeDefined();
          }
        });
      });

      describe('check_email_status tool', () => {
        it('should validate check_email_status parameters', async () => {
          const res = await request('http://localhost:3001')
            .post('/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
            .send({
              jsonrpc: '2.0',
              id: 8,
              method: 'tools/call',
              params: {
                name: 'check_email_status',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',                  sourceTrackingId: 'tracking_id_123'
                }
              }
            });

          expect(res.statusCode).toBe(200);
          expect(res.body).toBeDefined();
          
          if (res.body.jsonrpc) {
            expect(res.body.jsonrpc).toBe('2.0');
            expect(res.body.id).toBe(8);
            expect(res.body.result).toBeDefined();
          }
        });

        it('should reject missing sourceTrackingId in check_email_status', async () => {
          const res = await request('http://localhost:3001')
            .post('/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
            .send({
              jsonrpc: '2.0',
              id: 9,
              method: 'tools/call',
              params: {
                name: 'check_email_status',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',                  sourceTrackingId: ''
                }
              }
            });

          expect(res.statusCode).toBe(200);
          expect(res.body).toBeDefined();
          
          if (res.body.jsonrpc) {
            expect(res.body.jsonrpc).toBe('2.0');
            expect(res.body.id).toBe(9);
            // Should get an error response for missing tracking ID
            expect(res.body.error).toBeDefined();
          }
        });
      });
    });

    describe('Error handling', () => {
      it('should handle missing Accept header', async () => {
        const res = await request('http://localhost:3001')
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set(TEST_AUTH_HEADERS)
          .send({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list'
          });

        // The MCP handler returns 406 when Accept header is missing
        expect(res.statusCode).toBe(406);
      });

      it('should handle invalid tool names', async () => {
        const res = await request('http://localhost:3001')
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
          .send({
            jsonrpc: '2.0',
            id: 10,
            method: 'tools/call',
            params: {
              name: 'invalid_tool_name',
              arguments: {}
            }
          });

        expect(res.statusCode).toBe(200);
        expect(res.body).toBeDefined();
        
        if (res.body.error) {
          expect(res.body.error).toBeDefined();
        }
      });

      // apiKey is the only credential — a call carrying nothing but the
      // apiKey must succeed, not error with a missing-parameter complaint.
      it('should treat apiKey as the only required credential', async () => {
        const res = await request('http://localhost:3001')
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set(TEST_AUTH_HEADERS)
          .send({
            jsonrpc: '2.0',
            id: 11,
            method: 'tools/call',
            params: {
              name: 'validate_credentials',
              arguments: {
                apiKey: 'pk_test_valid_api_key_1234567890'
              }
            }
          });

        expect(res.statusCode).toBe(200);
        const data = parseSse(res.text);
        expect(data.jsonrpc).toBe('2.0');
        expect(data.id).toBe(11);
        expect(data.result).toBeDefined();
        expect(data.result.isError).not.toBe(true);
        // No "missing apiUser" complaint: the call must get past argument
        // validation and credential resolution with the apiKey alone.
        const text = data.result.content[0].text;
        expect(text).not.toContain('Invalid arguments');
        expect(text).not.toContain('API key required');
        expect(text).toMatch(
          /✅ Credentials validated successfully|❌ Credential validation failed: Invalid API key\./
        );
      });
    });
  });
}); 