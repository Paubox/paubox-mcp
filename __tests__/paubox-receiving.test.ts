import {
  createReceivingClient,
  filenameFromContentDisposition,
  PauboxReceivingError,
  ReceivingHttpRequest,
} from '../lib/paubox-receiving'
import { EMAIL_API_BASE_URL } from '../lib/paubox-email'

type HttpConfig = Parameters<ReceivingHttpRequest>[0]
type HttpResponse = Awaited<ReturnType<ReceivingHttpRequest>>

const EMAIL_ID = '0f8e9a52-3c1d-4b7e-9a6f-2d5c8b1e4a70'
const NEXT_EMAIL_ID = '7b2c4d6e-8f01-4a23-b456-789abcdef012'
const ATTACHMENT_ID = '5a1b2c3d-4e5f-4061-8a7b-9c0d1e2f3a4b'

const ADDRESS = { name: 'Jane Doe', address: 'jane@example.com' }

const LIST_ITEM = {
  email_id: EMAIL_ID,
  from: [ADDRESS],
  to: [{ name: null, address: 'intake@clinic.example' }],
  subject: 'Lab results',
  received_at: '2026-10-01T15:04:05Z',
  has_attachment: true,
  spam: false,
  size: 48213,
  domain: 'clinic.example',
}

const ATTACHMENT = {
  id: ATTACHMENT_ID,
  filename: 'results.pdf',
  content_type: 'application/pdf',
  size: 40960,
  content_id: null,
  download_url: `${EMAIL_API_BASE_URL}/receiving/${EMAIL_ID}/attachments/${ATTACHMENT_ID}`,
}

const DETAIL = {
  email_id: EMAIL_ID,
  from: [ADDRESS],
  to: [{ name: null, address: 'intake@clinic.example' }],
  cc: [],
  subject: 'Lab results',
  date: '2026-10-01T15:04:00Z',
  received_at: '2026-10-01T15:04:05Z',
  message_id: ['<abc123@example.com>'],
  in_reply_to: null,
  references: null,
  spam: false,
  spam_score: 0.4,
  text_body: 'See attached.',
  html_body: null,
  attachments: [ATTACHMENT],
  size: 48213,
  authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
  domain: 'clinic.example',
  headers: [{ name: 'Subject', value: 'Lab results' }],
}

function fakeHttp(
  impl: (config: HttpConfig) => Promise<HttpResponse> = async () => ({
    status: 200,
    data: {},
  }),
) {
  const calls: HttpConfig[] = []
  const fn: ReceivingHttpRequest = async (config) => {
    calls.push(config)
    return impl(config)
  }
  return { fn, calls }
}

function client(fn: ReceivingHttpRequest, apiKey = 'pk_receiving_test') {
  return createReceivingClient({ apiKey, http: fn })
}

async function captureError(promise: Promise<unknown>): Promise<PauboxReceivingError> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject')
    },
    (e) => e,
  )
  expect(error).toBeInstanceOf(PauboxReceivingError)
  return error as PauboxReceivingError
}

describe('receiving client base URL', () => {
  it('uses the email API base URL for all requests', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listDomains()
    expect(calls[0].url).toContain(EMAIL_API_BASE_URL)
  })
})

describe('authentication', () => {
  it('sends a Bearer token on every request', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn, 'pk_my_key').listDomains()
    expect(calls[0].headers?.Authorization).toBe('Bearer pk_my_key')
  })

  it('maps a 401 to a key-rejected error', async () => {
    const { fn } = fakeHttp(async () => ({ status: 401, data: {} }))
    const error = await captureError(client(fn).listDomains())
    expect(error.status).toBe(401)
    expect(error.message).toMatch(/rejected the API key/i)
  })

  it('maps a 403 to a key-rejected error', async () => {
    const { fn } = fakeHttp(async () => ({ status: 403, data: { message: 'forbidden' } }))
    const error = await captureError(client(fn).listDomains())
    expect(error.status).toBe(403)
    expect(error.message).toMatch(/rejected the API key/i)
  })
})

describe('listDomains', () => {
  it('GETs /receiving/domains', async () => {
    const domains = [{ id: '1', slug: 'example' }]
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: domains }))
    const result = await client(fn).listDomains()
    expect(calls[0].url).toContain('/receiving/domains')
    expect(calls[0].method).toBe('get')
    expect(result).toEqual(domains)
  })
})

describe('createDomain', () => {
  it('POSTs /receiving/domains with optional slug', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 201, data: { id: '1', slug: 'myslug' } }))
    await client(fn).createDomain('myslug')
    expect(calls[0].url).toContain('/receiving/domains')
    expect(calls[0].method).toBe('post')
    expect(calls[0].data).toEqual({ slug: 'myslug' })
  })

  it('POSTs with empty body when slug is omitted', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 201, data: { id: '1' } }))
    await client(fn).createDomain()
    expect(calls[0].data).toEqual({})
  })
})

describe('getDomain', () => {
  it('GETs /receiving/domains/:id', async () => {
    const domain = { id: '42', slug: 'test' }
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: domain }))
    const result = await client(fn).getDomain('42')
    expect(calls[0].url).toContain('/receiving/domains/42')
    expect(calls[0].method).toBe('get')
    expect(result).toEqual(domain)
  })

  it('URL-encodes the id', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).getDomain('a/b')
    expect(calls[0].url).toContain('/receiving/domains/a%2Fb')
  })

  it('maps 404 to a not-found error', async () => {
    const { fn } = fakeHttp(async () => ({ status: 404, data: {} }))
    const error = await captureError(client(fn).getDomain('999'))
    expect(error.status).toBe(404)
  })
})

describe('deleteDomain', () => {
  it('DELETEs /receiving/domains/:id', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 204, data: null }))
    await client(fn).deleteDomain('42')
    expect(calls[0].url).toContain('/receiving/domains/42')
    expect(calls[0].method).toBe('delete')
  })
})

describe('listMailboxes', () => {
  it('GETs /receiving/domains/:domainId/mailboxes', async () => {
    const mailboxes = [{ id: '1', name: 'inbox' }]
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: mailboxes }))
    const result = await client(fn).listMailboxes('d1')
    expect(calls[0].url).toContain('/receiving/domains/d1/mailboxes')
    expect(calls[0].method).toBe('get')
    expect(result).toEqual(mailboxes)
  })
})

describe('createMailbox', () => {
  it('POSTs with name, password, and optional quota_bytes', async () => {
    const { fn, calls } = fakeHttp(async () => ({
      status: 201,
      data: { id: '1', name: 'user', quota_bytes: 1024 },
    }))
    await client(fn).createMailbox('d1', { name: 'user', password: 'secret', quota_bytes: 1024 })
    expect(calls[0].url).toContain('/receiving/domains/d1/mailboxes')
    expect(calls[0].method).toBe('post')
    expect(calls[0].data).toEqual({ name: 'user', password: 'secret', quota_bytes: 1024 })
  })

  it('omits quota_bytes when not provided', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 201, data: { id: '1' } }))
    await client(fn).createMailbox('d1', { name: 'user', password: 'secret' })
    expect(calls[0].data).toEqual({ name: 'user', password: 'secret' })
  })
})

describe('getMailbox', () => {
  it('GETs /receiving/domains/:domainId/mailboxes/:mailboxId', async () => {
    const mailbox = { id: 'm1', name: 'inbox' }
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: mailbox }))
    const result = await client(fn).getMailbox('d1', 'm1')
    expect(calls[0].url).toContain('/receiving/domains/d1/mailboxes/m1')
    expect(calls[0].method).toBe('get')
    expect(result).toEqual(mailbox)
  })
})

describe('deleteMailbox', () => {
  it('DELETEs /receiving/domains/:domainId/mailboxes/:mailboxId', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 204, data: null }))
    await client(fn).deleteMailbox('d1', 'm1')
    expect(calls[0].url).toContain('/receiving/domains/d1/mailboxes/m1')
    expect(calls[0].method).toBe('delete')
  })
})

describe('listReceivedEmails', () => {
  it('GETs /receiving with no params by default', async () => {
    const page = { object: 'list', data: [LIST_ITEM], has_more: false }
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: page }))
    const result = await client(fn).listReceivedEmails()
    expect(calls[0].url).toBe(`${EMAIL_API_BASE_URL}/receiving`)
    expect(calls[0].method).toBe('get')
    expect(result).toEqual(page)
  })

  it('passes limit and email_id cursors as query params', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listReceivedEmails({ limit: 10, after: EMAIL_ID, before: NEXT_EMAIL_ID })
    expect(calls[0].params).toEqual({ limit: 10, after: EMAIL_ID, before: NEXT_EMAIL_ID })
  })

  it('omits undefined query params', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listReceivedEmails({ limit: 5 })
    expect(calls[0].params).toEqual({ limit: 5 })
  })
})

describe('getReceivedEmail', () => {
  it('GETs /receiving/:emailId by Paubox UUID', async () => {
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: { data: DETAIL } }))
    const result = await client(fn).getReceivedEmail(EMAIL_ID)
    expect(calls[0].url).toBe(`${EMAIL_API_BASE_URL}/receiving/${EMAIL_ID}`)
    expect(calls[0].method).toBe('get')
    expect(result).toEqual({ data: DETAIL })
  })

  it('maps a 404 for an unknown or legacy id to a not-found error', async () => {
    const { fn } = fakeHttp(async () => ({ status: 404, data: { message: 'email not found' } }))
    const error = await captureError(client(fn).getReceivedEmail('12345'))
    expect(error.status).toBe(404)
    expect(error.message).toBe('email not found')
  })
})

describe('getReceivedEmailAttachment', () => {
  const PDF_BYTES = Buffer.from('%PDF-1.7\n\x00\xff binary body', 'latin1')

  function attachmentResponse(headers: Record<string, string>): HttpResponse {
    return { status: 200, data: PDF_BYTES, headers }
  }

  it('GETs /receiving/:emailId/attachments/:attachmentId as raw bytes', async () => {
    const { fn, calls } = fakeHttp(async () =>
      attachmentResponse({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="results.pdf"',
      }),
    )
    await client(fn).getReceivedEmailAttachment(EMAIL_ID, ATTACHMENT_ID)
    expect(calls[0].url).toBe(
      `${EMAIL_API_BASE_URL}/receiving/${EMAIL_ID}/attachments/${ATTACHMENT_ID}`,
    )
    expect(calls[0].method).toBe('get')
    expect(calls[0].responseType).toBe('arraybuffer')
  })

  it('returns the bytes with content type, filename, and size from the headers', async () => {
    const { fn } = fakeHttp(async () =>
      attachmentResponse({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="results.pdf"',
      }),
    )
    const result = await client(fn).getReceivedEmailAttachment(EMAIL_ID, ATTACHMENT_ID)
    expect(result.contentType).toBe('application/pdf')
    expect(result.filename).toBe('results.pdf')
    expect(result.size).toBe(PDF_BYTES.byteLength)
    expect(result.content.equals(PDF_BYTES)).toBe(true)
  })

  it('reads headers case-insensitively', async () => {
    const { fn } = fakeHttp(async () =>
      attachmentResponse({
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="scan.png"',
      }),
    )
    const result = await client(fn).getReceivedEmailAttachment(EMAIL_ID, ATTACHMENT_ID)
    expect(result.contentType).toBe('image/png')
    expect(result.filename).toBe('scan.png')
  })

  it('returns a null filename when Content-Disposition is absent', async () => {
    const { fn } = fakeHttp(async () => attachmentResponse({ 'content-type': 'text/plain' }))
    const result = await client(fn).getReceivedEmailAttachment(EMAIL_ID, ATTACHMENT_ID)
    expect(result.filename).toBeNull()
    expect(result.contentType).toBe('text/plain')
  })

  it('accepts an ArrayBuffer body', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const { fn } = fakeHttp(async () => ({ status: 200, data: bytes.buffer, headers: {} }))
    const result = await client(fn).getReceivedEmailAttachment(EMAIL_ID, ATTACHMENT_ID)
    expect([...result.content]).toEqual([1, 2, 3, 4])
    expect(result.size).toBe(4)
    expect(result.contentType).toBeNull()
  })

  it('URL-encodes both path segments', async () => {
    const { fn, calls } = fakeHttp(async () => attachmentResponse({}))
    await client(fn).getReceivedEmailAttachment('a/b', 'c/d')
    expect(calls[0].url).toContain('/receiving/a%2Fb/attachments/c%2Fd')
  })

  it('decodes a JSON error body delivered as bytes', async () => {
    const { fn } = fakeHttp(async () => ({
      status: 404,
      data: Buffer.from(JSON.stringify({ message: 'attachment not found' })),
    }))
    const error = await captureError(client(fn).getReceivedEmailAttachment(EMAIL_ID, 'legacy-blob-id'))
    expect(error.status).toBe(404)
    expect(error.message).toBe('attachment not found')
  })

  it('surfaces a non-JSON error body delivered as bytes', async () => {
    const { fn } = fakeHttp(async () => ({ status: 502, data: Buffer.from('Bad Gateway') }))
    const error = await captureError(client(fn).getReceivedEmailAttachment(EMAIL_ID, ATTACHMENT_ID))
    expect(error.status).toBe(502)
    expect(error.message).toContain('Bad Gateway')
  })
})

describe('filenameFromContentDisposition', () => {
  it.each([
    ['attachment; filename="results.pdf"', 'results.pdf'],
    ['attachment; filename=results.pdf', 'results.pdf'],
    ['attachment; filename="lab \\"final\\".pdf"', 'lab "final".pdf'],
    ['attachment; filename="results.pdf"; size=40960', 'results.pdf'],
    ["attachment; filename*=UTF-8''R%C3%A9sultats.pdf", 'Résultats.pdf'],
    ["attachment; filename=\"fallback.pdf\"; filename*=UTF-8''R%C3%A9sultats.pdf", 'Résultats.pdf'],
    ["attachment; filename*=UTF-8''%E0%A4%A; filename=\"fallback.pdf\"", 'fallback.pdf'],
  ])('parses %s', (header: string, expected: string) => {
    expect(filenameFromContentDisposition(header)).toBe(expected)
  })

  it.each([undefined, null, '', 'attachment', 'inline'])('returns null for %p', (header: string | null | undefined) => {
    expect(filenameFromContentDisposition(header)).toBeNull()
  })
})

describe('error extraction', () => {
  it('extracts error detail from { errors: [{ title }] } shape', async () => {
    const { fn } = fakeHttp(async () => ({
      status: 422,
      data: { errors: [{ title: 'Slug already taken' }] },
    }))
    const error = await captureError(client(fn).createDomain('dup'))
    expect(error.message).toContain('Slug already taken')
  })

  it('extracts error detail from { message } shape', async () => {
    const { fn } = fakeHttp(async () => ({
      status: 500,
      data: { message: 'Internal server error' },
    }))
    const error = await captureError(client(fn).listDomains())
    expect(error.message).toContain('Internal server error')
  })
})
