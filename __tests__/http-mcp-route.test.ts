
// Mock environment variables for all tests
process.env.PAUBOX_API_KEY = 'test-key';
process.env.PAUBOX_API_USER = 'test-user';

import request from 'supertest';
import next from 'next';
import http from 'http';


let server: http.Server;
let app: ReturnType<typeof next>;

beforeAll(async () => {
  app = next({ dev: true, dir: process.cwd() });
  await app.prepare();
  server = http.createServer((req, res) => app.getRequestHandler()(req, res));
  await new Promise<void>((resolve) => server.listen(3001, () => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/mcp', () => {
  it('should respond with 405 for GET (method not allowed)', async () => {
    const res = await request('http://localhost:3001').get('/api/mcp');
    expect(res.statusCode).toBe(405);
    // Next.js may not parse JSON body automatically, so parse if needed
    const body = typeof res.body === 'object' && res.body !== null ? res.body : JSON.parse(res.text);
    expect(body).toEqual({ error: 'Method Not Allowed' });
  });
});
