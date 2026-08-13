// Unit tests for lib/paubox-forms.ts. We inject a fake HttpRequest rather
// than mocking the axios module so behavior is deterministic and
// independent of jest's ESM-mode module-mock quirks (same pattern as
// __tests__/paubox-credentials.test.ts).

import {
  createFormsClient,
  normalizeFormJson,
  PauboxFormsError,
  HttpRequest,
  FORMS_BASE_URL,
} from '../lib/paubox-forms'

type HttpConfig = Parameters<HttpRequest>[0]

function fakeHttp(impl: (config: HttpConfig) => Promise<{ status: number; data: unknown }>) {
  const calls: HttpConfig[] = []
  const fn: HttpRequest = async (config) => {
    calls.push(config)
    return impl(config)
  }
  return { fn, calls }
}

function client(fn: HttpRequest, apiKey = 'pk_forms_test') {
  return createFormsClient({ apiKey, http: fn })
}

async function captureError(promise: Promise<unknown>): Promise<PauboxFormsError> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject')
    },
    (e) => e,
  )
  expect(error).toBeInstanceOf(PauboxFormsError)
  return error as PauboxFormsError
}

describe('FORMS_BASE_URL', () => {
  it('targets the consolidated api.paubox.com host', () => {
    expect(FORMS_BASE_URL).toBe('https://api.paubox.com/forms')
  })
})

describe('createFormsClient error mapping', () => {
  it('maps 401 to an invalid-key / missing "forms" scope message', async () => {
    const { fn } = fakeHttp(async () => ({ status: 401, data: {} }))
    const error = await captureError(client(fn).getForm('abc'))
    expect(error.status).toBe(401)
    expect(error.message).toMatch(/invalid or lacks the "forms" scope/i)
    expect(error.message).toMatch(/admin dashboard/i)
  })

  it('maps 403 to a customer-access message', async () => {
    const { fn } = fakeHttp(async () => ({ status: 403, data: {} }))
    const error = await captureError(client(fn).archiveForm('abc'))
    expect(error.status).toBe(403)
    expect(error.message).toMatch(/does not have access/i)
  })

  it('maps 404 to the default not-found message', async () => {
    const { fn } = fakeHttp(async () => ({ status: 404, data: {} }))
    const error = await captureError(client(fn).getForm('abc'))
    expect(error.status).toBe(404)
    expect(error.message).toBe('Form not found.')
  })

  it('maps 404 on submission endpoints to a submission-aware message', async () => {
    const { fn } = fakeHttp(async () => ({ status: 404, data: {} }))
    const error = await captureError(client(fn).listSubmissions('abc'))
    expect(error.status).toBe(404)
    expect(error.message).toBe('Form or submission not found.')
  })

  it('includes the status and body detail for other errors', async () => {
    const { fn } = fakeHttp(async () => ({ status: 500, data: { detail: 'boom' } }))
    const error = await captureError(client(fn).listForms({ customerId: 1 }))
    expect(error.status).toBe(500)
    expect(error.message).toContain('HTTP 500')
    expect(error.message).toContain('boom')
  })
})

describe('createFormsClient requests', () => {
  it('sends a Bearer Authorization header and prefixes the base URL', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: { data: { id: 'f1' } } }))
    await client(fn, 'pk_secret').getForm('f1')
    expect(calls).toHaveLength(1)
    const headers = calls[0].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer pk_secret')
    expect(calls[0].url).toBe(`${FORMS_BASE_URL}/api/forms/f1`)
  })

  it('encodes the form id into the URL path (no path injection)', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: { data: { id: 'x' } } }))
    await client(fn).getForm('a/../b')
    expect(calls[0].url).toContain('a%2F..%2Fb')
  })

  it('listForms maps camelCase params to snake_case query params', async () => {
    const { fn, calls } = fakeHttp(async () => ({
      status: 200,
      data: { results: [], page_info: { count: 0, pages: 0, page: 1, items: 50 } },
    }))
    await client(fn).listForms({
      customerId: 42,
      formId: 'f1',
      search: 'intake',
      order: 'asc',
      orderBy: 'title',
      archived: false,
      active: true,
      page: 2,
      items: 25,
    })
    expect(calls[0].params).toEqual({
      customer_id: 42,
      form_id: 'f1',
      search: 'intake',
      order: 'asc',
      order_by: 'title',
      archived: false,
      active: true,
      page: 2,
      items: 25,
    })
  })

  it('listForms omits undefined optional filters', async () => {
    const { fn, calls } = fakeHttp(async () => ({
      status: 200,
      data: { results: [], page_info: { count: 0, pages: 0, page: 1, items: 50 } },
    }))
    await client(fn).listForms({ customerId: 7 })
    expect(calls[0].params).toEqual({ customer_id: 7 })
  })

  it('createForm defaults version to 1 and omits undefined optionals', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: { id: 'new-id' } }))
    const result = await client(fn).createForm({
      title: 'Intake',
      formJson: { fields: [] },
      customerId: 9,
    })
    expect(result).toEqual({ id: 'new-id' })
    expect(calls[0].method).toBe('post')
    expect(calls[0].data).toEqual({
      title: 'Intake',
      form_json: { fields: [] },
      customer_id: 9,
      version: 1,
    })
  })

  it('createForm maps camelCase optionals to snake_case body fields', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: { id: 'new-id' } }))
    await client(fn).createForm({
      title: 'Intake',
      formJson: {},
      customerId: 9,
      version: 3,
      signatureConfirmationLabel: 'I agree',
      subscriptionListId: 'list-42',
      active: true,
    })
    const body = calls[0].data as Record<string, unknown>
    expect(body.version).toBe(3)
    expect(body.signature_confirmation_label).toBe('I agree')
    expect(body.subscription_list_id).toBe('list-42')
    expect(body.active).toBe(true)
  })

  it('getForm unwraps the .data envelope', async () => {
    const { fn } = fakeHttp(async () => ({
      status: 200,
      data: { data: { id: 'f1', title: 'Intake', archived: true } },
    }))
    const form = await client(fn).getForm('f1')
    expect(form).toEqual({ id: 'f1', title: 'Intake', archived: true })
  })

  it('updateForm sends only the provided fields', async () => {
    const { fn, calls } = fakeHttp(async () => ({
      status: 200,
      data: { detail: 'updated', form_id: 'f1' },
    }))
    await client(fn).updateForm('f1', { title: 'Renamed', active: false })
    expect(calls[0].method).toBe('put')
    expect(calls[0].data).toEqual({ title: 'Renamed', active: false })
  })

  it('copyForm posts form_id and title', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: { id: 'f2', title: 'Copy' } }))
    const form = await client(fn).copyForm('f1', 'Copy')
    expect(calls[0].url).toBe(`${FORMS_BASE_URL}/api/forms/copy`)
    expect(calls[0].data).toEqual({ form_id: 'f1', title: 'Copy' })
    expect(form.id).toBe('f2')
  })

  it('getFormStats passes customer_id only when provided', async () => {
    const stats = { active_form_count: 1, total_submission_count: 2, submissions_last_7_days: 3 }
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: stats }))
    const c = client(fn)
    await c.getFormStats()
    expect(calls[0].params).toEqual({})
    await c.getFormStats(11)
    expect(calls[1].params).toEqual({ customer_id: 11 })
  })

  it('listSubmissions maps params to snake_case query params', async () => {
    const { fn, calls } = fakeHttp(async () => ({
      status: 200,
      data: { data: [], total: 0, page: 1, items: 50 },
    }))
    await client(fn).listSubmissions('f1', { submissionId: 's1', orderBy: 'submitter_email', order: 'desc' })
    expect(calls[0].url).toBe(`${FORMS_BASE_URL}/api/forms/f1/submissions`)
    expect(calls[0].params).toEqual({ submission_id: 's1', order_by: 'submitter_email', order: 'desc' })
  })

  it('exportSubmissionsCsv targets the single-submission path when submissionId is given', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: 'a,b\n1,2\n' }))
    const c = client(fn)
    const csv = await c.exportSubmissionsCsv('f1')
    expect(csv).toBe('a,b\n1,2\n')
    expect(calls[0].url).toBe(`${FORMS_BASE_URL}/api/forms/f1/submissions/submission-csv`)
    await c.exportSubmissionsCsv('f1', 's1')
    expect(calls[1].url).toBe(`${FORMS_BASE_URL}/api/forms/f1/submissions/submission-csv/s1`)
  })

  it('exportSubmissionPdf returns a Buffer from arraybuffer data', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4')
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: bytes.buffer }))
    const pdf = await client(fn).exportSubmissionPdf('f1', 's1')
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.toString('utf8')).toBe('%PDF-1.4')
    expect(calls[0].url).toBe(`${FORMS_BASE_URL}/api/forms/f1/submissions/s1/submission-pdf`)
    expect(calls[0].responseType).toBe('arraybuffer')
  })
})

describe('normalizeFormJson', () => {
  it('passes a plain object through unchanged', () => {
    const schema = { fields: [{ type: 'text', label: 'Name' }] }
    expect(normalizeFormJson(schema)).toBe(schema)
  })

  it('parses a JSON-encoded string into the object', () => {
    expect(normalizeFormJson('{"fields":[{"type":"text"}]}')).toEqual({
      fields: [{ type: 'text' }],
    })
  })

  it('unwraps a double-encoded string', () => {
    const doubleEncoded = JSON.stringify(JSON.stringify({ fields: [] }))
    expect(normalizeFormJson(doubleEncoded)).toEqual({ fields: [] })
  })

  it('throws on a string that is not valid JSON', () => {
    expect(() => normalizeFormJson('not json')).toThrow(
      'formJson must be a JSON object; received a string that is not valid JSON.',
    )
  })

  it('throws on an array', () => {
    expect(() => normalizeFormJson([{ type: 'text' }])).toThrow(
      'formJson must be a JSON object (e.g. {"fields": [...]}), not a string, array, or primitive.',
    )
  })

  it('throws on a number', () => {
    expect(() => normalizeFormJson(42)).toThrow(/not a string, array, or primitive/)
  })

  it('throws on null', () => {
    expect(() => normalizeFormJson(null)).toThrow(/not a string, array, or primitive/)
  })
})

describe('formJson normalization at write sites', () => {
  it('createForm parses a stringified formJson before sending', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: { id: 'new-id' } }))
    await client(fn).createForm({
      title: 'Intake',
      formJson: '{"fields":[{"type":"text","label":"Name"}]}',
      customerId: 9,
    })
    const body = calls[0].data as Record<string, unknown>
    expect(typeof body.form_json).not.toBe('string')
    expect(body.form_json).toEqual({ fields: [{ type: 'text', label: 'Name' }] })
  })

  it('createForm sends an object formJson as-is', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: { id: 'new-id' } }))
    const schema = { fields: [{ type: 'email' }] }
    await client(fn).createForm({ title: 'Intake', formJson: schema, customerId: 9 })
    const body = calls[0].data as Record<string, unknown>
    expect(body.form_json).toEqual(schema)
  })

  it('updateForm parses a stringified formJson before sending', async () => {
    const { fn, calls } = fakeHttp(async () => ({
      status: 200,
      data: { detail: 'updated', form_id: 'f1' },
    }))
    await client(fn).updateForm('f1', { formJson: '{"fields":[]}' })
    const body = calls[0].data as Record<string, unknown>
    expect(typeof body.form_json).not.toBe('string')
    expect(body.form_json).toEqual({ fields: [] })
  })

  it('updateForm omits form_json when formJson is not provided', async () => {
    const { fn, calls } = fakeHttp(async () => ({
      status: 200,
      data: { detail: 'updated', form_id: 'f1' },
    }))
    await client(fn).updateForm('f1', { title: 'Renamed' })
    expect(calls[0].data).toEqual({ title: 'Renamed' })
  })
})
