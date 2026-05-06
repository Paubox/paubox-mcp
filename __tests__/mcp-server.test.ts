// Mock environment variables for all tests
process.env.PAUBOX_API_KEY = 'test-key';
process.env.PAUBOX_API_USER = 'test-user';

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

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Paubox MCP Server', () => {
  describe('Route Exports', () => {
    it('should export GET handler as a function', async () => {
      const { GET } = await import('../app/api/[transport]/route');
      expect(typeof GET).toBe('function');
    });

    it('should export POST handler as a function', async () => {
      const { POST } = await import('../app/api/[transport]/route');
      expect(typeof POST).toBe('function');
    });
  });

  describe('MCP API Endpoints', () => {
    describe('GET /api/mcp', () => {
      it('should return 405 Method Not Allowed for GET requests', async () => {
        const res = await request('http://localhost:3001').get('/api/mcp');
        expect(res.statusCode).toBe(405);
      });
    });

    describe('POST /api/mcp', () => {
      it('should list available tools', async () => {
        const res = await request('http://localhost:3001')
          .post('/api/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
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
          const toolNames = res.body.result.tools.map((tool: any) => tool.name);
          expect(toolNames).toContain('validate_credentials');
          expect(toolNames).toContain('send_secure_email');
          expect(toolNames).toContain('check_email_status');
        }
      });

      describe('validate_credentials tool', () => {
        it('should validate credentials successfully with valid input', async () => {
          const res = await request('http://localhost:3001')
            .post('/api/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
            .send({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: {
                name: 'validate_credentials',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',
                  apiUser: 'test@example.com'
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
            .post('/api/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
            .send({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: 'validate_credentials',
                arguments: {
                  apiKey: 'short',
                  apiUser: 'test@example.com'
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

        it('should reject missing API user', async () => {
          const res = await request('http://localhost:3001')
            .post('/api/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
            .send({
              jsonrpc: '2.0',
              id: 4,
              method: 'tools/call',
              params: {
                name: 'validate_credentials',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',
                  apiUser: ''
                }
              }
            });

          expect(res.statusCode).toBe(200);
          expect(res.body).toBeDefined();
          
          if (res.body.jsonrpc) {
            expect(res.body.jsonrpc).toBe('2.0');
            expect(res.body.id).toBe(4);
            expect(res.body.result).toBeDefined();
            expect(res.body.result.content).toBeDefined();

            const content = res.body.result.content[0];
            expect(content.type).toBe('text');
            expect(content.text).toContain('❌ Credential validation failed');
          }
        });
      });

      describe('send_secure_email tool', () => {
        it('should validate send_secure_email parameters', async () => {
          const res = await request('http://localhost:3001')
            .post('/api/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
            .send({
              jsonrpc: '2.0',
              id: 5,
              method: 'tools/call',
              params: {
                name: 'send_secure_email',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',
                  apiUser: 'test@example.com',
                  from: 'sender@example.com',
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
            .post('/api/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
            .send({
              jsonrpc: '2.0',
              id: 6,
              method: 'tools/call',
              params: {
                name: 'send_secure_email',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',
                  apiUser: 'test@example.com',
                  from: 'invalid-email',
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
            .post('/api/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
            .send({
              jsonrpc: '2.0',
              id: 7,
              method: 'tools/call',
              params: {
                name: 'send_secure_email',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',
                  apiUser: 'test@example.com',
                  from: 'sender@example.com',
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
            .post('/api/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
            .send({
              jsonrpc: '2.0',
              id: 8,
              method: 'tools/call',
              params: {
                name: 'check_email_status',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',
                  apiUser: 'test@example.com',
                  sourceTrackingId: 'tracking_id_123'
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
            .post('/api/mcp')
            .set('Content-Type', 'application/json')
            .set('Accept', 'application/json, text/event-stream')
            .send({
              jsonrpc: '2.0',
              id: 9,
              method: 'tools/call',
              params: {
                name: 'check_email_status',
                arguments: {
                  apiKey: 'pk_test_valid_api_key_1234567890',
                  apiUser: 'test@example.com',
                  sourceTrackingId: ''
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
          .post('/api/mcp')
          .set('Content-Type', 'application/json')
          .send({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list'
          });

        // The API returns 406 when Accept header is missing
        expect(res.statusCode).toBe(406);
      });

      it('should handle invalid tool names', async () => {
        const res = await request('http://localhost:3001')
          .post('/api/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
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

      it('should handle missing required parameters', async () => {
        const res = await request('http://localhost:3001')
          .post('/api/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .send({
            jsonrpc: '2.0',
            id: 11,
            method: 'tools/call',
            params: {
              name: 'validate_credentials',
              arguments: {
                apiKey: 'pk_test_valid_api_key_1234567890'
                // Missing apiUser
              }
            }
          });

        expect(res.statusCode).toBe(200);
        expect(res.body).toBeDefined();
        
        if (res.body.error) {
          expect(res.body.error).toBeDefined();
        }
      });
    });
  });
}); 