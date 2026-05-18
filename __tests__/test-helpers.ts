import next from 'next';
import http from 'http';
import '../lib/paubox-proxy';

export interface TestServer {
  server: http.Server;
  app: ReturnType<typeof next>;
  baseUrl: string;
}

export async function createTestServer(port: number = 3001): Promise<TestServer> {
  const app = next({ dev: false, dir: process.cwd(), hostname: 'localhost', port });
  await app.prepare();
  const server = http.createServer((req, res) => app.getRequestHandler()(req, res));
  await new Promise<void>((resolve) => server.listen(port, () => resolve()));

  return {
    server,
    app,
    baseUrl: `http://localhost:${port}`
  };
}

export async function closeTestServer(testServer: TestServer): Promise<void> {
  if (testServer?.server) {
    await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
  }
  if (testServer?.app && typeof testServer.app.close === 'function') {
    await testServer.app.close();
  }
} 