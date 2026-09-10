// Unit tests for lib/email-body.ts (HTML rendering + attachment validation)
// and for the attachment pass-through in lib/paubox-email.ts. The email
// client takes an injected HttpRequest, same pattern as
// __tests__/paubox-forms.test.ts, so no network and no module mocks.

import {
  escapeHtml,
  normalizeAttachments,
  renderHtmlBody,
  MAX_ATTACHMENT_BYTES,
} from '../lib/email-body'
import * as stdioCopy from '../src/email-body'
import { sendEmail, scheduleEmail, HttpRequest } from '../lib/paubox-email'
import { readFileSync } from 'fs'
import { join } from 'path'

// ESM test files have no __dirname; resolve from the repo root jest runs in.
const ROOT = process.cwd()

const PDF_B64 = Buffer.from('%PDF-1.4 fake').toString('base64')

describe('renderHtmlBody', () => {
  it('turns blank-line-separated text into paragraphs and single newlines into <br>', () => {
    const html = renderHtmlBody('Aloha,\n\nLine one\nLine two\n\nMahalo')
    expect(html).toBe('<p>Aloha,</p>\n<p>Line one<br>\nLine two</p>\n<p>Mahalo</p>')
  })

  it('escapes markup so message text cannot inject HTML', () => {
    const html = renderHtmlBody('<script>alert(1)</script> & "quotes"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;')
  })

  it('links bare URLs and leaves trailing punctuation outside the anchor', () => {
    const html = renderHtmlBody('RSVP here: https://get.paubox.com/mixer.')
    expect(html).toBe(
      '<p>RSVP here: <a href="https://get.paubox.com/mixer">https://get.paubox.com/mixer</a>.</p>',
    )
  })

  it('does not double-escape URLs containing query strings', () => {
    const url = 'https://docs.google.com/spreadsheets/d/abc/edit?gid=1&x=2#gid=1'
    const html = renderHtmlBody(url)
    expect(html).toContain(`href="${url.replace('&', '&amp;')}"`)
  })

  it('normalizes CRLF and trims surrounding whitespace', () => {
    expect(renderHtmlBody('\r\n a\r\nb \r\n')).toBe('<p>a<br>\nb</p>')
  })

  it('preserves non-ASCII text such as the ʻokina unchanged', () => {
    expect(renderHtmlBody('Hawaiʻi')).toBe('<p>Hawaiʻi</p>')
  })

  it('returns an empty string for whitespace-only input', () => {
    expect(renderHtmlBody('   \n\n ')).toBe('')
  })
})

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})

describe('normalizeAttachments', () => {
  it('returns an empty array for undefined or empty input', () => {
    expect(normalizeAttachments(undefined)).toEqual([])
    expect(normalizeAttachments([])).toEqual([])
  })

  it('trims fields and strips whitespace from base64 content', () => {
    const [att] = normalizeAttachments([
      { fileName: ' report.pdf ', contentType: ' application/pdf ', content: `${PDF_B64.slice(0, 4)}\n${PDF_B64.slice(4)}` },
    ])
    expect(att).toEqual({ fileName: 'report.pdf', contentType: 'application/pdf', content: PDF_B64 })
  })

  it('rejects a missing or path-like fileName', () => {
    expect(() =>
      normalizeAttachments([{ fileName: '', contentType: 'application/pdf', content: PDF_B64 }]),
    ).toThrow('attachments[0].fileName is required.')
    expect(() =>
      normalizeAttachments([{ fileName: '../x.pdf', contentType: 'application/pdf', content: PDF_B64 }]),
    ).toThrow('bare filename')
  })

  it('rejects an invalid MIME type', () => {
    expect(() =>
      normalizeAttachments([{ fileName: 'x.pdf', contentType: 'pdf', content: PDF_B64 }]),
    ).toThrow('attachments[0].contentType must be a MIME type')
  })

  it('rejects content that is empty or not base64', () => {
    expect(() =>
      normalizeAttachments([{ fileName: 'x.pdf', contentType: 'application/pdf', content: '' }]),
    ).toThrow('attachments[0].content is required.')
    expect(() =>
      normalizeAttachments([{ fileName: 'x.pdf', contentType: 'application/pdf', content: 'not base64!' }]),
    ).toThrow('must be base64-encoded')
  })

  it('reports the index of the offending attachment', () => {
    expect(() =>
      normalizeAttachments([
        { fileName: 'ok.txt', contentType: 'text/plain', content: PDF_B64 },
        { fileName: 'bad.txt', contentType: 'nope', content: PDF_B64 },
      ]),
    ).toThrow('attachments[1].contentType')
  })

  it('enforces the total decoded size limit across all attachments', () => {
    // Two attachments each just over half the cap.
    const half = Buffer.alloc(Math.floor(MAX_ATTACHMENT_BYTES / 2) + 1).toString('base64')
    expect(() =>
      normalizeAttachments([
        { fileName: 'a.bin', contentType: 'application/octet-stream', content: half },
        { fileName: 'b.bin', contentType: 'application/octet-stream', content: half },
      ]),
    ).toThrow('exceed the 25 MB total limit')
  })
})

describe('src/email-body.ts stays in sync with lib/email-body.ts', () => {
  it('has identical source apart from the header comment', () => {
    const strip = (s: string) => s.replace(/^\/\/.*\n/gm, '').trim()
    const lib = readFileSync(join(ROOT, 'lib', 'email-body.ts'), 'utf8')
    const src = readFileSync(join(ROOT, 'src', 'email-body.ts'), 'utf8')
    expect(strip(src)).toBe(strip(lib))
  })

  it('exports the same helpers', () => {
    expect(typeof stdioCopy.renderHtmlBody).toBe('function')
    expect(typeof stdioCopy.normalizeAttachments).toBe('function')
    expect(stdioCopy.renderHtmlBody('a\n\nb')).toBe(renderHtmlBody('a\n\nb'))
  })
})

describe('paubox-email attachments pass-through', () => {
  type HttpConfig = Parameters<HttpRequest>[0]
  function fakeHttp() {
    const calls: HttpConfig[] = []
    const fn: HttpRequest = async (config) => {
      calls.push(config)
      return { status: 200, data: { sourceTrackingId: 'trk_1', data: { message_id: 'm1' } } }
    }
    return { fn, calls }
  }
  const base = {
    from: 'hg@paubox.com',
    to: ['a@example.com'],
    subject: 'Hi',
    textContent: 'Body',
    htmlContent: '<p>Body</p>',
  }
  const attachment = { fileName: 'report.pdf', contentType: 'application/pdf', content: PDF_B64 }

  it('sendEmail sends an empty attachments array when none are given', async () => {
    const { fn, calls } = fakeHttp()
    await sendEmail('key', base, fn)
    const body = calls[0].data as { data: { message: { attachments: unknown } } }
    expect(body.data.message.attachments).toEqual([])
  })

  it('sendEmail forwards attachments verbatim in the message payload', async () => {
    const { fn, calls } = fakeHttp()
    await sendEmail('key', { ...base, attachments: [attachment] }, fn)
    const body = calls[0].data as { data: { message: { attachments: unknown } } }
    expect(body.data.message.attachments).toEqual([attachment])
  })

  it('scheduleEmail forwards attachments too', async () => {
    const { fn, calls } = fakeHttp()
    await scheduleEmail('key', { ...base, attachments: [attachment], scheduledAt: '2026-09-11T18:00:00Z' }, fn)
    const body = calls[0].data as { data: { message: { attachments: unknown }; scheduled_at: string } }
    expect(body.data.message.attachments).toEqual([attachment])
    expect(body.data.scheduled_at).toBe('2026-09-11T18:00:00Z')
  })
})
