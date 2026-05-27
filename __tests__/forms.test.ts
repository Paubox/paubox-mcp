import request from 'supertest';
import { createTestServer, closeTestServer, TestServer, TEST_AUTH_HEADERS } from './test-helpers';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer(3007);
}, 15000);

afterAll(async () => {
  await closeTestServer(testServer);
});

const NON_EXISTENT_UUID = '00000000-0000-0000-0000-000000000000';

async function callTool(id: number, name: string, args: Record<string, unknown>) {
  const response = await request(testServer.baseUrl)
    .post('/mcp')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .set(TEST_AUTH_HEADERS)
    .send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
    .timeout(10000);
  return response;
}

describe('Paubox Forms MCP Tools', () => {
  it('get_form and submit_form appear in tools/list', async () => {
    const response = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(TEST_AUTH_HEADERS)
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      .timeout(10000);

    expect(response.status).toBe(200);
    const dataMatch = response.text.match(/data: (.+)/);
    expect(dataMatch).toBeTruthy();
    const data = JSON.parse(dataMatch![1]);
    const toolNames: string[] = data.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('get_form');
    expect(toolNames).toContain('submit_form');
  });

  it('get_form returns form data or not-found for a UUID', async () => {
    const response = await callTool(2, 'get_form', { formId: NON_EXISTENT_UUID });

    expect(response.status).toBe(200);
    const dataMatch = response.text.match(/data: (.+)/);
    expect(dataMatch).toBeTruthy();
    const data = JSON.parse(dataMatch![1]);
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(2);
    expect(data.result).toBeDefined();
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/Form not found\.|❌ Failed to retrieve form|"id":/);
  });

  it('get_form returns a validation error when formId is empty', async () => {
    const response = await callTool(3, 'get_form', { formId: '' });

    expect(response.status).toBe(200);
    const dataMatch = response.text.match(/data: (.+)/);
    expect(dataMatch).toBeTruthy();
    const data = JSON.parse(dataMatch![1]);
    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain('Invalid arguments for tool get_form');
  });

  it('submit_form returns success or not-found for a UUID with form data', async () => {
    const response = await callTool(4, 'submit_form', {
      formId: NON_EXISTENT_UUID,
      formData: { first_name: 'Test', last_name: 'User' },
    });

    expect(response.status).toBe(200);
    const dataMatch = response.text.match(/data: (.+)/);
    expect(dataMatch).toBeTruthy();
    const data = JSON.parse(dataMatch![1]);
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(4);
    expect(data.result).toBeDefined();
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/✅ Form submitted successfully\.|Form not found\.|❌ Failed to submit form/);
  });

  it('submit_form returns a validation error when formId is empty', async () => {
    const response = await callTool(5, 'submit_form', { formId: '', formData: { name: 'Test' } });

    expect(response.status).toBe(200);
    const dataMatch = response.text.match(/data: (.+)/);
    expect(dataMatch).toBeTruthy();
    const data = JSON.parse(dataMatch![1]);
    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain('Invalid arguments for tool submit_form');
  });
});
