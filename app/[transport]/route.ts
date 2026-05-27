import { AsyncLocalStorage } from 'async_hooks'
import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import pauboxNode from 'paubox-node'
import axios from 'axios'
import { verifyAccessToken } from '../../lib/oauth-jwt'
import { checkPauboxCredentials } from '../../lib/paubox-credentials'

const FORMS_BASE_URL = 'https://apx.paubox.com/forms'

type PauboxMessage = {
  from: string;
  to: string[];
  replyTo: string | null;
  cc: string[] | null;
  bcc: string[] | null;
  subject: string | null;
  customHeaders: Record<string, string>;
  allowNonTLS: boolean;
  forceSecureNotification: boolean;
  attachments: unknown[] | null;
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  plaintext: string | null;
  htmltext: string | null;
  validate(): void;
  toJSON(): unknown;
}

type RequestCredentials = {
  apiKey?: string
  apiUser?: string
}

const credentialsStorage = new AsyncLocalStorage<RequestCredentials>()

const createPauboxService = (config: { apiKey: string; apiUsername: string }) => {
  return new pauboxNode.emailService(config)
}

function resolveCredentials(params: { apiKey?: string; apiUser?: string }) {
  const stored = credentialsStorage.getStore()
  return {
    apiKey: params.apiKey || stored?.apiKey || '',
    apiUser: params.apiUser || stored?.apiUser || '',
  }
}

const MISSING_CREDENTIALS_ERROR = "❌ API credentials required. Reconnect the Paubox connector in your client (Claude → Settings → Integrations → Paubox) to re-enter your credentials, or pass apiKey and apiUser as tool parameters, or set the x-paubox-api-key / x-paubox-api-user headers."

const mcpHandler = createMcpHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server: any) => {
    server.tool(
      "validate_credentials",
      "Validate Paubox API credentials before sending email",
      {
        apiKey: z.string().min(10, "API key must be at least 10 characters").optional(),
        apiUser: z.string().min(1, "API user is required").optional(),
      },
      async ({ apiKey: paramKey, apiUser: paramUser }: { apiKey?: string; apiUser?: string }) => {
        try {
          const { apiKey, apiUser } = resolveCredentials({ apiKey: paramKey, apiUser: paramUser })
          if (!apiKey || !apiUser) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }
          if (apiKey.trim().length < 10) {
            throw new Error("Invalid API key format")
          }
          if (apiUser.trim().length === 0) {
            throw new Error("API user is required")
          }
          const result = await checkPauboxCredentials(apiKey, apiUser)
          if (!result.ok) {
            return {
              content: [
                { type: "text", text: `❌ Credential validation failed: ${result.reason}` },
              ],
            }
          }
          return {
            content: [
              {
                type: "text",
                text: `✅ Credentials validated successfully!\n\n👤 API User: ${apiUser}\n🔑 API Key: ${apiKey.slice(0, 4)}${"*".repeat(Math.max(0, apiKey.length - 4))}\n\n💡 You can now use send_secure_email to send emails.`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Credential validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
          }
        }
      }
    )

    server.tool(
      "send_secure_email",
      "Send a secure, HIPAA-compliant email using Paubox with your API credentials",
      {
        apiKey: z.string().optional(),
        apiUser: z.string().optional(),
        from: z.string(),
        to: z.array(z.string()),
        subject: z.string(),
        message: z.string(),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        forceSecureNotification: z.boolean().optional(),
      },
      async ({ apiKey: paramKey, apiUser: paramUser, from, to, subject, message, cc, bcc, forceSecureNotification }: {
        apiKey?: string;
        apiUser?: string;
        from: string;
        to: string[];
        subject: string;
        message: string;
        cc?: string[];
        bcc?: string[];
        forceSecureNotification?: boolean;
      }) => {
        try {
          const { apiKey, apiUser } = resolveCredentials({ apiKey: paramKey, apiUser: paramUser })
          if (!apiKey || !apiUser) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }

          if (!message || message.trim().length === 0) {
            throw new Error("Message content is required and cannot be empty")
          }

          const pauboxService = createPauboxService({ apiKey, apiUsername: apiUser })
          const emailMessage: PauboxMessage = new pauboxNode.message({
            from,
            to,
            cc: cc ?? null,
            bcc: bcc ?? null,
            subject,
            text_content: message.trim(),
            html_content: `<p>${message.trim()}</p>`,
            forceSecureNotification: forceSecureNotification ?? false,
            attachments: [],
          })

          const response = await pauboxService.sendMessage(emailMessage)

          return {
            content: [
              {
                type: "text",
                text: `✅ Email sent successfully!\n\n📧 From: ${from}\n📧 To: ${to.join(", ")}\n📋 Subject: ${subject}\n🔍 Source Tracking ID: ${response.sourceTrackingId}\n🆔 Message ID: ${response.data.message_id}\n\n💡 Save the Source Tracking ID to check delivery status later.`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to send email: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'}`,
              },
            ],
          }
        }
      }
    )

    server.tool(
      "check_email_status",
      "Check the delivery status of a previously sent email using its Source Tracking ID",
      {
        apiKey: z.string().optional(),
        apiUser: z.string().optional(),
        sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
      },
      async ({ apiKey: paramKey, apiUser: paramUser, sourceTrackingId }: {
        apiKey?: string;
        apiUser?: string;
        sourceTrackingId: string;
      }) => {
        try {
          const { apiKey, apiUser } = resolveCredentials({ apiKey: paramKey, apiUser: paramUser })
          if (!apiKey || !apiUser) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }

          if (!sourceTrackingId || sourceTrackingId.trim().length === 0) {
            throw new Error("Source Tracking ID is required")
          }

          const pauboxService = createPauboxService({ apiKey, apiUsername: apiUser })
          const response = await pauboxService.getEmailDisposition(sourceTrackingId.trim())

          return {
            content: [
              {
                type: "text",
                text: `📊 Email Status Report\n\n🔍 Source Tracking ID: ${sourceTrackingId}\n📬 Status: ${JSON.stringify(response, null, 2)}`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to check email status: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'}`,
              },
            ],
          }
        }
      }
    )
    server.tool(
      "get_form",
      "Retrieve metadata and field schema for a Paubox Form by its UUID. Returns the form title, description, field definitions (form_json), and status. No API credentials required.",
      {
        formId: z.string().min(1, "Form ID is required"),
      },
      async ({ formId }: { formId: string }) => {
        try {
          if (!formId || formId.trim().length === 0) {
            throw new Error("Form ID is required")
          }
          const response = await axios.get(`${FORMS_BASE_URL}/public/form_data/${formId.trim()}`)
          const form = response.data
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  id: form.id,
                  title: form.title,
                  description: form.description,
                  form_json: form.form_json,
                  active: form.active,
                  signable: form.signable,
                  submission_count: form.submission_count,
                  created_at: form.created_at,
                  updated_at: form.updated_at,
                }, null, 2),
              },
            ],
          }
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            return { content: [{ type: "text", text: "Form not found." }] }
          }
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to retrieve form: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
              },
            ],
          }
        }
      }
    )

    server.tool(
      "submit_form",
      "Submit a response to a Paubox Form. Provide the form UUID and key-value pairs matching the form's field schema (obtainable via get_form). Optionally include file attachments as base64-encoded content. No API credentials required.",
      {
        formId: z.string().min(1, "Form ID is required"),
        formData: z.record(z.string(), z.unknown()).describe("Key-value pairs matching the form field schema"),
        attachments: z.array(z.object({
          name: z.string().describe("Filename"),
          content: z.string().describe("Base64-encoded file content"),
        })).optional().describe("Optional file attachments"),
      },
      async ({ formId, formData, attachments }: {
        formId: string;
        formData: Record<string, unknown>;
        attachments?: Array<{ name: string; content: string }>;
      }) => {
        try {
          if (!formId || formId.trim().length === 0) {
            throw new Error("Form ID is required")
          }
          const body: Record<string, unknown> = { form_data: formData }
          if (attachments && attachments.length > 0) {
            body.attachments = attachments
          }
          await axios.post(`${FORMS_BASE_URL}/api/forms/${formId.trim()}/submissions`, body)
          return { content: [{ type: "text", text: "✅ Form submitted successfully." }] }
        } catch (error) {
          if (axios.isAxiosError(error)) {
            if (error.response?.status === 404) {
              return { content: [{ type: "text", text: "Form not found." }] }
            }
            if (error.response?.status === 400) {
              return { content: [{ type: "text", text: "❌ Bad request: missing required form_data." }] }
            }
          }
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to submit form: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
              },
            ],
          }
        }
      }
    )
  },
  {},
  { basePath: "", disableSse: true }
)

type ExtractedCredentials =
  | { kind: 'ok'; creds: RequestCredentials }
  | { kind: 'invalid_token'; description: string }

async function extractCredentials(req: Request): Promise<ExtractedCredentials> {
  // Priority 1: x-paubox-* custom headers (Claude Connector header path)
  const headerKey = req.headers.get('x-paubox-api-key') ?? undefined
  const headerUser = req.headers.get('x-paubox-api-user') ?? undefined
  if (headerKey && headerUser) {
    return { kind: 'ok', creds: { apiKey: headerKey, apiUser: headerUser } }
  }

  // Priority 2: Bearer token (OAuth flow). RFC 7235 §2.1 requires the
  // scheme name be matched case-insensitively.
  const authHeader = req.headers.get('authorization')
  const bearerMatch = authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader) : null
  if (bearerMatch) {
    try {
      const payload = await verifyAccessToken(bearerMatch[1])
      return { kind: 'ok', creds: { apiKey: payload.apiKey, apiUser: payload.apiUser } }
    } catch {
      // A Bearer token WAS presented but failed verification (expired,
      // tampered, wrong signing key). RFC 6750 §3.1 calls for 401 with
      // WWW-Authenticate so the client re-runs OAuth instead of seeing
      // a confusing "credentials required" tool error.
      return { kind: 'invalid_token', description: 'The access token expired or is invalid.' }
    }
  }

  // Priority 3: NODE_ENV-gated env-var fallback. Local-dev convenience
  // only — production is multi-tenant and must not silently borrow one
  // operator's identity for an unauthenticated caller.
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.PAUBOX_API_KEY &&
    process.env.PAUBOX_API_USER
  ) {
    return {
      kind: 'ok',
      creds: {
        apiKey: process.env.PAUBOX_API_KEY,
        apiUser: process.env.PAUBOX_API_USER,
      },
    }
  }

  // No auth attempted. Let the handler run; the tool surfaces a
  // missing-credentials message instead of a transport-level 401, which
  // matches how non-OAuth clients (tool-param-only callers) work today.
  return { kind: 'ok', creds: { apiKey: headerKey, apiUser: headerUser } }
}

function invalidTokenResponse(description: string): Response {
  return new Response(
    JSON.stringify({ error: 'invalid_token', error_description: description }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer error="invalid_token", error_description="${description}"`,
      },
    }
  )
}

function logRequest(method: string, req: Request, result: ExtractedCredentials) {
  const auth = req.headers.get('authorization')
  const authKind = auth
    ? (auth.toLowerCase().startsWith('bearer ') ? 'bearer' : 'other')
    : 'none'
  console.log(
    `[mcp] ${method} ${new URL(req.url).pathname}` +
    ` auth=${authKind}` +
    ` result=${result.kind}` +
    ` session=${req.headers.get('mcp-session-id') ?? 'none'}`
  )
}

// Next.js rewrites keep req.url at the original path, but mcp-handler
// does an exact pathname check for "/mcp". Normalize to "/mcp" so the
// handler routes correctly whether the request arrived at / or /mcp.
function normalizeToMcp(req: Request): Request {
  const url = new URL(req.url)
  if (url.pathname === '/mcp') return req
  url.pathname = '/mcp'
  return new Request(url.toString(), req)
}

export async function GET(req: Request) {
  const result = await extractCredentials(req)
  logRequest('GET', req, result)
  if (result.kind === 'invalid_token') return invalidTokenResponse(result.description)
  return credentialsStorage.run(result.creds, () => mcpHandler(normalizeToMcp(req)))
}

export async function POST(req: Request) {
  const result = await extractCredentials(req)
  logRequest('POST', req, result)
  if (result.kind === 'invalid_token') return invalidTokenResponse(result.description)
  return credentialsStorage.run(result.creds, () => mcpHandler(normalizeToMcp(req)))
}
