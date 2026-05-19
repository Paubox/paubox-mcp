// Tests that AsyncLocalStorage correctly isolates per-request credentials.
// Concurrent requests with different header credentials must never cross-contaminate —
// request A must not see request B's apiUser and vice versa.

process.env.PAUBOX_API_KEY = 'test-key';
process.env.PAUBOX_API_USER = 'test-user';

import request from 'supertest';
import { createTestServer, closeTestServer, TestServer } from './test-helpers';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer(3004);
}, 15000);

afterAll(async () => {
  await closeTestServer(testServer);
});

const API_KEY = 'pk_test_valid_api_key_1234567890';

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
  it('two concurrent requests with different header users each see their own user', async () => {
    const USER_A = 'user-a@example.com';
    const USER_B = 'user-b@example.com';

    const [resA, resB] = await Promise.all([
      request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', API_KEY)
        .set('x-paubox-api-user', USER_A)
        .send(mcpValidate(1)),
      request(testServer.baseUrl)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('x-paubox-api-key', API_KEY)
        .set('x-paubox-api-user', USER_B)
        .send(mcpValidate(2)),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const dataA = parseSSE(resA.text);
    const dataB = parseSSE(resB.text);

    expect(dataA.result.content[0].text).toContain(USER_A);
    expect(dataA.result.content[0].text).not.toContain(USER_B);

    expect(dataB.result.content[0].text).toContain(USER_B);
    expect(dataB.result.content[0].text).not.toContain(USER_A);
  });

  it('five concurrent requests each see only their own credentials', async () => {
    const users = Array.from({ length: 5 }, (_, i) => `concurrent-user-${i}@example.com`);

    const responses = await Promise.all(
      users.map((user, i) =>
        request(testServer.baseUrl)
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set('x-paubox-api-key', API_KEY)
          .set('x-paubox-api-user', user)
          .send(mcpValidate(i + 10))
      )
    );

    responses.forEach((res, i) => {
      expect(res.status).toBe(200);
      const data = parseSSE(res.text);
      const text: string = data.result.content[0].text;

      // Must contain own user
      expect(text).toContain(users[i]);

      // Must not contain any other user's address
      users.forEach((otherUser, j) => {
        if (j !== i) expect(text).not.toContain(otherUser);
      });
    });
  });
});
