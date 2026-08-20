import next from 'next';
import http from 'http';
import type { AddressInfo } from 'net';
import '../lib/paubox-proxy';

// Standard auth headers for tests that need transport-level auth but aren't
// testing credential resolution specifically. The API key alone
// authenticates — no x-paubox-api-user header is needed anymore, and
// sending only the key exercises exactly that.
export const TEST_AUTH_HEADERS = {
  'x-paubox-api-key': 'pk_test_valid_api_key_1234567890',
} as const;

export interface TestServer {
  server: http.Server;
  app: ReturnType<typeof next>;
  baseUrl: string;
}

// Binds an OS-assigned free port rather than a fixed one. Suites used to hard
// code 3001-3007; paubox-next defaults to 3002, so anyone running both saw the
// server fail to bind, the beforeAll hook time out, and every test in the suite
// report as failed for a reason that had nothing to do with the code.
//
// Listening on port 0 first and reading the port back means there is no window
// between "find a free port" and "claim it" for something else to take it.
export async function createTestServer(): Promise<TestServer> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, 'localhost', () => resolve()));
  const { port } = server.address() as AddressInfo;

  // Next needs the port up front, so the handler is attached only once the app
  // is prepared. Callers await this function before issuing a request.
  const app = next({ dev: false, dir: process.cwd(), hostname: 'localhost', port });
  await app.prepare();
  server.on('request', app.getRequestHandler());

  return {
    server,
    app,
    baseUrl: `http://localhost:${port}`
  };
}

export async function closeTestServer(testServer: TestServer): Promise<void> {
  if (testServer?.server) {
    // closeAllConnections() drops idle keep-alive connections immediately so
    // server.close() doesn't hang waiting for them to drain on their own.
    testServer.server.closeAllConnections?.()
    await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
  }
  if (testServer?.app && typeof testServer.app.close === 'function') {
    await testServer.app.close();
  }
} 