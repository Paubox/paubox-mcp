import {
  createReceivingClient,
  PauboxReceivingError,
} from '../lib/paubox-receiving'
import { EMAIL_API_BASE_URL, HttpRequest } from '../lib/paubox-email'

type HttpConfig = Parameters<HttpRequest>[0]

function fakeHttp(
  impl: (config: HttpConfig) => Promise<{ status: number; data: unknown }> = async () => ({
    status: 200,
    data: {},
  }),
) {
  const calls: HttpConfig[] = []
  const fn: HttpRequest = async (config) => {
    calls.push(config)
    return impl(config)
  }
  return { fn, calls }
}

function client(fn: HttpRequest, apiKey = 'pk_receiving_test') {
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
    const emails = [{ id: 'e1', subject: 'test' }]
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: emails }))
    const result = await client(fn).listReceivedEmails()
    expect(calls[0].url).toContain('/receiving')
    expect(calls[0].method).toBe('get')
    expect(result).toEqual(emails)
  })

  it('passes limit, after, and before as query params', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listReceivedEmails({ limit: 10, after: 'cursor1', before: 'cursor2' })
    expect(calls[0].params).toEqual({ limit: 10, after: 'cursor1', before: 'cursor2' })
  })

  it('omits undefined query params', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listReceivedEmails({ limit: 5 })
    expect(calls[0].params).toEqual({ limit: 5 })
  })
})

describe('getReceivedEmail', () => {
  it('GETs /receiving/:emailId', async () => {
    const email = { id: 'e1', subject: 'hello' }
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: email }))
    const result = await client(fn).getReceivedEmail('e1')
    expect(calls[0].url).toContain('/receiving/e1')
    expect(calls[0].method).toBe('get')
    expect(result).toEqual(email)
  })
})

describe('getReceivedEmailAttachment', () => {
  it('GETs /receiving/:emailId/attachments/:blobId', async () => {
    const attachment = { content: 'base64data' }
    const { fn, calls } = fakeHttp(async () => ({ status: 200, data: attachment }))
    const result = await client(fn).getReceivedEmailAttachment('e1', 'b1')
    expect(calls[0].url).toContain('/receiving/e1/attachments/b1')
    expect(calls[0].method).toBe('get')
    expect(result).toEqual(attachment)
  })

  it('URL-encodes both path segments', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).getReceivedEmailAttachment('a/b', 'c/d')
    expect(calls[0].url).toContain('/receiving/a%2Fb/attachments/c%2Fd')
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
