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

describe('Paubox Forms management MCP tools', () => {
  const NEW_TOOL_NAMES = [
    'list_forms',
    'create_form',
    'update_form',
    'archive_form',
    'unarchive_form',
    'copy_form',
    'get_form_stats',
    'list_form_submissions',
    'export_submissions_csv',
    'export_submission_pdf',
  ];

  // Parse the SSE tool-call response and return the result object.
  function parseToolResult(responseText: string) {
    const dataMatch = responseText.match(/data: (.+)/);
    expect(dataMatch).toBeTruthy();
    return JSON.parse(dataMatch![1]);
  }

  it('all forms management tools appear in tools/list', async () => {
    const response = await request(testServer.baseUrl)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set(TEST_AUTH_HEADERS)
      .send({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} })
      .timeout(10000);

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    const toolNames: string[] = data.result.tools.map((t: { name: string }) => t.name);
    for (const name of NEW_TOOL_NAMES) {
      expect(toolNames).toContain(name);
    }
  });

  it('list_forms returns a validation error when customerId is missing', async () => {
    const response = await callTool(11, 'list_forms', {});

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain('Invalid arguments for tool list_forms');
  });

  it('copy_form returns a validation error when title is missing', async () => {
    const response = await callTool(12, 'copy_form', { formId: NON_EXISTENT_UUID });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain('Invalid arguments for tool copy_form');
  });

  it('export_submission_pdf returns a validation error when submissionId is missing', async () => {
    const response = await callTool(13, 'export_submission_pdf', { formId: NON_EXISTENT_UUID });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain('Invalid arguments for tool export_submission_pdf');
  });

  // The calls below reach the real forms host with placeholder test
  // credentials, so the API rejects them (401/403/404) or the network is
  // unreachable. Either way the tool must respond gracefully with 200 and
  // a ❌ text payload — never a protocol-level error. Accept the (never
  // expected in CI) success shape too, mirroring the existing UUID tests.

  it('list_forms handles rejection from the forms API gracefully', async () => {
    const response = await callTool(14, 'list_forms', { customerId: 1 });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/❌ Failed to list forms|"results":/);
  }, 20000);

  it('archive_form handles a non-existent form gracefully', async () => {
    const response = await callTool(15, 'archive_form', { formId: NON_EXISTENT_UUID });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/❌ Failed to archive form|✅ Form archived/);
  }, 20000);

  it('copy_form handles a non-existent form gracefully', async () => {
    const response = await callTool(16, 'copy_form', { formId: NON_EXISTENT_UUID, title: 'Copy of test' });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/❌ Failed to copy form|✅ Form copied/);
  }, 20000);

  it('get_form_stats handles rejection from the forms API gracefully', async () => {
    const response = await callTool(17, 'get_form_stats', {});

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/❌ Failed to get form stats|📊 Paubox Forms Stats/);
  }, 20000);

  it('list_form_submissions handles a non-existent form gracefully', async () => {
    const response = await callTool(18, 'list_form_submissions', { formId: NON_EXISTENT_UUID });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/❌ Failed to list form submissions|"submissions":/);
  }, 20000);

  it('export_submissions_csv handles a non-existent form gracefully', async () => {
    const response = await callTool(19, 'export_submissions_csv', { formId: NON_EXISTENT_UUID });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    // With placeholder credentials the export cannot succeed; the ❌ text
    // carries the mapped API error (invalid key / not found / network).
    expect(data.result.content[0].text).toMatch(/❌ Failed to export submissions CSV/);
  }, 20000);

  it('export_submission_pdf handles a non-existent submission gracefully', async () => {
    const response = await callTool(20, 'export_submission_pdf', {
      formId: NON_EXISTENT_UUID,
      submissionId: NON_EXISTENT_UUID,
    });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/❌ Failed to export submission PDF|✅ PDF exported/);
  }, 20000);

  it('update_form handles a non-existent form gracefully', async () => {
    const response = await callTool(21, 'update_form', { formId: NON_EXISTENT_UUID, title: 'Renamed' });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/❌ Failed to update form|✅ Form updated/);
  }, 20000);

  it('unarchive_form handles a non-existent form gracefully', async () => {
    const response = await callTool(22, 'unarchive_form', { formId: NON_EXISTENT_UUID });

    expect(response.status).toBe(200);
    const data = parseToolResult(response.text);
    expect(data.result.content[0].type).toBe('text');
    expect(data.result.content[0].text).toMatch(/❌ Failed to unarchive form|✅ Form unarchived/);
  }, 20000);
});
