// Helpers shared by send_secure_email and schedule_email for turning the
// caller's plain-text `message` into a safe HTML alternative, and for
// validating the optional `attachments` array before it goes to the Email API.
//
// `src/email-body.ts` is the stdio server's copy of this module, since
// `tsconfig.stdio.json` scopes stdio to `src/` and forbids importing from
// `lib/`. Keep the two in sync.

export interface EmailAttachment {
  /** Filename shown to the recipient, e.g. "report.pdf". */
  fileName: string
  /** MIME type, e.g. "application/pdf". */
  contentType: string
  /** Base64-encoded file bytes. */
  content: string
}

// The Email API accepts the whole message as one JSON document, so the cap
// is on the decoded bytes across all attachments. 25 MB matches the
// conventional mailbox limit; the API itself may enforce something lower.
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

const MIME_REGEX = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/

// Rough decoded size from base64 length, without allocating a Buffer.
function decodedLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

// Validates and normalizes attachments. Throws a caller-facing Error on the
// first problem so the tool can surface it verbatim.
export function normalizeAttachments(
  attachments: EmailAttachment[] | undefined,
): EmailAttachment[] {
  if (!attachments || attachments.length === 0) return []
  let total = 0
  return attachments.map((raw, index) => {
    const label = `attachments[${index}]`
    const fileName = (raw.fileName ?? '').trim()
    const contentType = (raw.contentType ?? '').trim()
    // Strip whitespace/newlines that base64 encoders commonly insert.
    const content = (raw.content ?? '').replace(/\s+/g, '')

    if (fileName.length === 0) throw new Error(`${label}.fileName is required.`)
    if (/[/\\]/.test(fileName)) {
      throw new Error(`${label}.fileName must be a bare filename, not a path.`)
    }
    if (!MIME_REGEX.test(contentType)) {
      throw new Error(`${label}.contentType must be a MIME type such as application/pdf.`)
    }
    if (content.length === 0) throw new Error(`${label}.content is required.`)
    if (content.length % 4 !== 0 || !BASE64_REGEX.test(content)) {
      throw new Error(`${label}.content must be base64-encoded.`)
    }
    total += decodedLength(content)
    if (total > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachments exceed the ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB total limit.`,
      )
    }
    return { fileName, contentType, content }
  })
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

// Matches http(s) URLs so they become clickable in the HTML part. Trailing
// punctuation that commonly follows a URL in prose is left outside the link.
const URL_REGEX = /https?:\/\/[^\s<>"']+?(?=[.,;:!?)\]]*(?:\s|$))/g

function linkify(escapedLine: string): string {
  return escapedLine.replace(
    URL_REGEX,
    (url) => `<a href="${url}">${url}</a>`,
  )
}

// Renders plain text as HTML that mirrors what the recipient sees in the
// text/plain part: blank lines separate paragraphs, single newlines become
// <br>, markup characters are escaped, and bare URLs become links.
//
// Previously the HTML part was built as `<p>${message}</p>`, which collapsed
// every newline into one run-on paragraph in HTML-first mail clients and let
// `<`, `>` and `&` in the message be interpreted as markup.
export function renderHtmlBody(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) return ''
  const paragraphs = normalized.split(/\n{2,}/)
  return paragraphs
    .map((para) => {
      const lines = para.split('\n').map((line) => linkify(escapeHtml(line)))
      return `<p>${lines.join('<br>\n')}</p>`
    })
    .join('\n')
}
