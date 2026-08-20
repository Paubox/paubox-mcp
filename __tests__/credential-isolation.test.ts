// Tests that AsyncLocalStorage correctly isolates per-request credentials.
// Concurrent requests with different header credentials must never cross-contaminate —
// request A must not see request B's apiKey and vice versa.
//
// The apiKey is the only credential now (no apiUser). validate_credentials
// echoes the key masked to its first 4 characters, which is how each
// response is matched back to the credential its request carried.

process.env.PAUBOX_API_KEY = 'test-key';

import request from 'supertest';
import { createTestServer, closeTestServer, TestServer } from './test-helpers';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer();
}, 15000);

afterAll(async () => {
  await closeTestServer(testServer);
});

// validate_credentials masks the key as first-4-chars + asterisks.
const masked = (key: string) => key.slice(0, 4) + '*'.repeat(Math.max(0, key.length - 4));

function mcpValidate(id: number) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'validate_credentials', arguments: {} },
  };
}

function parseSSE(text: string) {
  const match = text.match(/data: (.+)/);
  if (!match) throw new Error(`No SSE data line found in response: ${text.slice(0, 200)}`);
  return JSON.parse(match[1]);
}

describe('AsyncLocalStorage credential isolation', () => {
  it('two concurrent requests with different header keys each see their own key', async () => {
    const KEY_A = 'akey_isolation_test_1234567890';
    const KEY_B = 'bkey_isolation_test_1234567890';

    const [resA, resB] = await Promise.all([
      request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', KEY_A)
        // Legacy clients may still send this header — it is ignored and
        // must not break the request or leak into the response.
        .set('x-paubox-api-user', 'stale-legacy-user@example.com')
        .send(mcpValidate(1)),
      request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', KEY_B)
        .send(mcpValidate(2)),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const dataA = parseSSE(resA.text);
    const dataB = parseSSE(resB.text);

    expect(dataA.result.content[0].text).toContain(masked(KEY_A));
    expect(dataA.result.content[0].text).not.toContain(masked(KEY_B));
    expect(dataA.result.content[0].text).not.toContain('stale-legacy-user@example.com');

    expect(dataB.result.content[0].text).toContain(masked(KEY_B));
    expect(dataB.result.content[0].text).not.toContain(masked(KEY_A));
  });

  it('five concurrent requests each see only their own credentials', async () => {
    const keys = Array.from({ length: 5 }, (_, i) => `iso${i}_concurrent_key_1234567890`);

    const responses = await Promise.all(
      keys.map((key, i) =>
        request(testServer.baseUrl)
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set('x-paubox-api-key', key)
          .send(mcpValidate(i + 10))
      )
    );

    responses.forEach((res, i) => {
      expect(res.status).toBe(200);
      const data = parseSSE(res.text);
      const text: string = data.result.content[0].text;

      // Must contain own masked key
      expect(text).toContain(masked(keys[i]));

      // Must not contain any other request's masked key
      keys.forEach((otherKey, j) => {
        if (j !== i) expect(text).not.toContain(masked(otherKey));
      });
    });
  });
});
