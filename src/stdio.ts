#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { validateFormId } from "./validate-form-id.js"

const apiKey = process.env.PAUBOX_API_KEY

if (!apiKey || apiKey.trim().length < 10) {
  process.stderr.write(
    "Error: PAUBOX_API_KEY environment variable is required (minimum 10 characters)\n"
  )
  process.exit(1)
}

const FETCH_TIMEOUT_MS = 15000

// ---------------------------------------------------------------------------
// Paubox Email API client (inlined; the stdio build cannot import from lib/)
// ---------------------------------------------------------------------------

// All Email API requests are served under /v1/email; the bare /v1 prefix is
// not routed and dies at the gateway with an HTML 404.
const EMAIL_API_BASE_URL = "https://api.paubox.com/v1/email"

interface SendMessageOptions {
  from: string
  to: string[]
  subject: string
  textContent: string
  htmlContent: string
  cc?: string[]
  bcc?: string[]
  forceSecureNotification?: boolean
}

interface EmailApiResponse {
  sourceTrackingId?: string
  data?: { message_id?: string }
  errors?: unknown
}

async function emailRequest(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<EmailApiResponse> {
  const response = await fetch(`${EMAIL_API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey!.trim()}`,
      "Content-Type": "application/json",
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  let rawBody = ""
  try {
    rawBody = await response.text()
  } catch {
    // ignore unreadable bodies
  }
  let payload: unknown
  try {
    payload = rawBody ? JSON.parse(rawBody) : undefined
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    const detail = extractEmailErrorDetail(payload) ?? (rawBody ? rawBody.slice(0, 300) : "")
    throw new Error(
      `Paubox Email API error (HTTP ${response.status})${detail ? `: ${detail}` : ""}`
    )
  }

  const record = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >
  // Mirror paubox-node semantics: a response with none of data /
  // sourceTrackingId / errors is treated as an error.
  if (
    record.data === undefined &&
    record.sourceTrackingId === undefined &&
    record.errors === undefined &&
    record.state === undefined
  ) {
    throw new Error("Unexpected response from the Paubox Email API")
  }
  if (record.errors !== undefined && record.data === undefined && record.sourceTrackingId === undefined) {
    const detail = extractEmailErrorDetail(record)
    throw new Error(detail ?? "The Paubox Email API returned errors")
  }
  return record as EmailApiResponse
}

function extractEmailErrorDetail(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  const errors = (payload as Record<string, unknown>).errors
  if (!Array.isArray(errors) || errors.length === 0) return undefined
  const parts = errors
    .map((err) => {
      if (typeof err === "object" && err !== null) {
        const record = err as Record<string, unknown>
        return [record.title, record.details].filter((v) => typeof v === "string").join(" - ")
      }
      return typeof err === "string" ? err : ""
    })
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join("; ") : undefined
}

async function sendMessage(options: SendMessageOptions): Promise<EmailApiResponse> {
  return emailRequest("/messages", {
    method: "POST",
    body: {
      data: {
        message: {
          recipients: options.to,
          cc: options.cc ?? null,
          bcc: options.bcc ?? null,
          headers: {
            subject: options.subject,
            from: options.from,
            "reply-to": null,
          },
          content: {
            "text/plain": options.textContent,
            "text/html": Buffer.from(options.htmlContent, "utf-8").toString("base64"),
          },
          attachments: [],
          allowNonTLS: false,
          forceSecureNotification: options.forceSecureNotification ?? false,
        },
      },
    },
  })
}

async function getEmailDisposition(sourceTrackingId: string): Promise<EmailApiResponse> {
  return emailRequest(
    `/message_receipt?sourceTrackingId=${encodeURIComponent(sourceTrackingId)}`
  )
}

async function scheduleMessage(
  options: SendMessageOptions & { scheduledAt: string }
): Promise<EmailApiResponse> {
  return emailRequest("/schedule", {
    method: "POST",
    body: {
      data: {
        message: {
          recipients: options.to,
          cc: options.cc ?? null,
          bcc: options.bcc ?? null,
          headers: {
            subject: options.subject,
            from: options.from,
            "reply-to": null,
          },
          content: {
            "text/plain": options.textContent,
            "text/html": Buffer.from(options.htmlContent, "utf-8").toString("base64"),
          },
          attachments: [],
          allowNonTLS: false,
          forceSecureNotification: options.forceSecureNotification ?? false,
        },
        scheduled_at: options.scheduledAt,
      },
    },
  })
}

async function getScheduledMessage(sourceTrackingId: string): Promise<unknown> {
  return emailRequest(`/schedule/${encodeURIComponent(sourceTrackingId)}`)
}

async function rescheduleMessage(
  sourceTrackingId: string,
  scheduledAt: string
): Promise<unknown> {
  return emailRequest(`/schedule/${encodeURIComponent(sourceTrackingId)}`, {
    method: "PATCH",
    body: { scheduled_at: scheduledAt },
  })
}

async function cancelScheduledMessage(sourceTrackingId: string): Promise<unknown> {
  return emailRequest(`/schedule/${encodeURIComponent(sourceTrackingId)}/cancel`, {
    method: "POST",
    body: {},
  })
}

const server = new McpServer({ name: "paubox", version: "1.0.0" })

server.tool(
  "validate_credentials",
  "Confirm that the Paubox API credentials configured via environment variables are present and correctly formatted",
  {},
  async () => {
    const masked = apiKey!.slice(0, 4) + "*".repeat(Math.max(0, apiKey!.length - 4))
    return {
      content: [
        {
          type: "text" as const,
          text: `Credentials configured\n\nAPI Key: ${masked}\n\nReady to send email with send_secure_email.`,
        },
      ],
    }
  }
)

server.tool(
  "send_secure_email",
  "Send a secure, HIPAA-compliant email using Paubox",
  {
    from: z.string().email("Must be a valid email address"),
    to: z.array(z.string().email()).min(1, "At least one recipient is required"),
    subject: z.string().min(1, "Subject is required"),
    message: z.string().min(1, "Message content is required"),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    forceSecureNotification: z.boolean().optional(),
  },
  async ({
    from,
    to,
    subject,
    message,
    cc,
    bcc,
    forceSecureNotification,
  }: {
    from: string
    to: string[]
    subject: string
    message: string
    cc?: string[]
    bcc?: string[]
    forceSecureNotification?: boolean
  }) => {
    try {
      const response = await sendMessage({
        from,
        to,
        cc,
        bcc,
        subject,
        textContent: message.trim(),
        htmlContent: `<p>${message.trim()}</p>`,
        forceSecureNotification,
      })

      return {
        content: [
          {
            type: "text" as const,
            text: `Email sent\n\nFrom: ${from}\nTo: ${to.join(", ")}\nSubject: ${subject}\nSource Tracking ID: ${response.sourceTrackingId}\nMessage ID: ${response.data?.message_id}\n\nSave the Source Tracking ID to check delivery status later.`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to send email: ${error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"}`,
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
    sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
  },
  async ({ sourceTrackingId }: { sourceTrackingId: string }) => {
    try {
      const response = await getEmailDisposition(sourceTrackingId.trim())

      return {
        content: [
          {
            type: "text" as const,
            text: `Email Status\n\nSource Tracking ID: ${sourceTrackingId}\nStatus: ${JSON.stringify(response, null, 2)}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to check email status: ${error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"}`,
          },
        ],
      }
    }
  }
)

server.tool(
  "schedule_email",
  "Schedule a secure, HIPAA-compliant email for future delivery using Paubox",
  {
    from: z.string().email("Must be a valid email address"),
    to: z.array(z.string().email()).min(1, "At least one recipient is required"),
    subject: z.string().min(1, "Subject is required"),
    message: z.string().min(1, "Message content is required"),
    scheduledAt: z.string().describe("ISO 8601 datetime for when the email should be sent (e.g. 2025-12-25T15:00:00Z)"),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    forceSecureNotification: z.boolean().optional(),
  },
  async ({
    from,
    to,
    subject,
    message,
    scheduledAt,
    cc,
    bcc,
    forceSecureNotification,
  }: {
    from: string
    to: string[]
    subject: string
    message: string
    scheduledAt: string
    cc?: string[]
    bcc?: string[]
    forceSecureNotification?: boolean
  }) => {
    try {
      const response = await scheduleMessage({
        from,
        to,
        cc,
        bcc,
        subject,
        textContent: message.trim(),
        htmlContent: `<p>${message.trim()}</p>`,
        forceSecureNotification,
        scheduledAt,
      })

      return {
        content: [
          {
            type: "text" as const,
            text: `Email scheduled\n\nFrom: ${from}\nTo: ${to.join(", ")}\nSubject: ${subject}\nScheduled at: ${(response as Record<string, unknown>).scheduledAt}\nSource Tracking ID: ${response.sourceTrackingId}\nState: ${(response as Record<string, unknown>).state}\n\nSave the Source Tracking ID to check status, reschedule, or cancel.`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to schedule email: ${error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"}`,
          },
        ],
      }
    }
  }
)

server.tool(
  "get_scheduled_email",
  "Check the status of a scheduled email using its Source Tracking ID",
  {
    sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
  },
  async ({ sourceTrackingId }: { sourceTrackingId: string }) => {
    try {
      const response = await getScheduledMessage(sourceTrackingId.trim()) as Record<string, unknown>

      return {
        content: [
          {
            type: "text" as const,
            text: `Scheduled Email Status\n\nSource Tracking ID: ${sourceTrackingId}\nState: ${response.state}\nScheduled at: ${response.scheduledAt}\n\n${JSON.stringify(response, null, 2)}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to get scheduled email: ${error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"}`,
          },
        ],
      }
    }
  }
)

server.tool(
  "reschedule_email",
  "Change the scheduled delivery time of a pending email",
  {
    sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
    scheduledAt: z.string().describe("New ISO 8601 datetime for when the email should be sent"),
  },
  async ({ sourceTrackingId, scheduledAt }: { sourceTrackingId: string; scheduledAt: string }) => {
    try {
      const response = await rescheduleMessage(sourceTrackingId.trim(), scheduledAt) as Record<string, unknown>

      return {
        content: [
          {
            type: "text" as const,
            text: `Email rescheduled\n\nSource Tracking ID: ${response.sourceTrackingId}\nNew scheduled time: ${response.scheduledAt}\nState: ${response.state}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to reschedule email: ${error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"}`,
          },
        ],
      }
    }
  }
)

server.tool(
  "cancel_scheduled_email",
  "Cancel a scheduled email that has not yet been sent",
  {
    sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
  },
  async ({ sourceTrackingId }: { sourceTrackingId: string }) => {
    try {
      const response = await cancelScheduledMessage(sourceTrackingId.trim()) as Record<string, unknown>

      return {
        content: [
          {
            type: "text" as const,
            text: `Scheduled email cancelled\n\nSource Tracking ID: ${response.sourceTrackingId}\nState: ${response.state}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to cancel scheduled email: ${error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"}`,
          },
        ],
      }
    }
  }
)

// ---------------------------------------------------------------------------
// Paubox Forms tools
// ---------------------------------------------------------------------------

// All Forms API requests are served under /v1/forms; the bare /forms prefix
// is not routed and dies at the gateway with an HTML 404.
const FORMS_BASE_URL = "https://api.paubox.com/v1/forms"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"
}

function formsErrorMessage(status: number, body: string): string {
  if (status === 401) {
    return 'Your Paubox API key is invalid or lacks the "forms" scope. Scoped API keys are managed in the Paubox admin dashboard.'
  }
  if (status === 403) {
    return "Access denied: your API key's customer does not have access to that form or customer."
  }
  if (status === 404) {
    return "Not found: the requested form or submission does not exist."
  }
  const detail = body ? `: ${body.slice(0, 300)}` : ""
  return `Paubox Forms API error (HTTP ${status})${detail}`
}

// Clients sometimes pass the form schema as a JSON-encoded string; the Paubox
// renderer expects an object, so normalize before writing.
function normalizeFormJson(value: unknown): Record<string, unknown> {
  let result = value
  for (let i = 0; i < 3 && typeof result === "string"; i++) {
    try {
      result = JSON.parse(result)
    } catch {
      throw new Error("formJson must be a JSON object; received a string that is not valid JSON.")
    }
  }
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error(
      'formJson must be a JSON object (e.g. {"fields": [...]}), not a string, array, or primitive.'
    )
  }
  return result as Record<string, unknown>
}

async function formsRequest(
  path: string,
  options: {
    method?: string
    query?: Record<string, string | number | boolean | undefined>
    body?: unknown
  } = {}
): Promise<Response> {
  const url = new URL(`${FORMS_BASE_URL}${path}`)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey!.trim()}`,
      "Content-Type": "application/json",
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    let body = ""
    try {
      body = await response.text()
    } catch {
      // ignore unreadable error bodies
    }
    throw new Error(formsErrorMessage(response.status, body))
  }
  return response
}

type FormRecord = Record<string, unknown>

function trimForm(form: FormRecord): FormRecord {
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    active: form.active,
    archived: form.archived,
    signable: form.signable,
    type: form.type,
    submission_count: form.submission_count,
    vanity_url: form.vanity_url,
    created_at: form.created_at,
    updated_at: form.updated_at,
  }
}

server.tool(
  "get_form",
  "Retrieve metadata and field schema for a Paubox Form by its UUID. Returns the form title, description, field definitions (form_json), and status. Uses the configured API key to retrieve inactive or archived forms when possible.",
  {
    formId: z.string().min(1, "Form ID is required"),
  },
  async ({ formId }: { formId: string }) => {
    try {
      const validated = validateFormId(formId, "formId")
      const id = encodeURIComponent(validated)
      let form: FormRecord | undefined

      // Authenticated lookup first (retrieves inactive/archived forms). Fall
      // back to the public endpoint when the key lacks the forms scope so
      // get_form keeps working credential-free.
      const authResponse = await fetch(`${FORMS_BASE_URL}/api/forms/${id}`, {
        headers: { Authorization: `Bearer ${apiKey!.trim()}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (authResponse.ok) {
        const payload = (await authResponse.json()) as { data: FormRecord }
        form = payload.data
      } else if (authResponse.status === 401 || authResponse.status === 403) {
        const publicResponse = await fetch(`${FORMS_BASE_URL}/public/form_data/${id}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (publicResponse.status === 404) {
          return { content: [{ type: "text" as const, text: "Form not found." }] }
        }
        if (!publicResponse.ok) {
          throw new Error(formsErrorMessage(publicResponse.status, ""))
        }
        form = (await publicResponse.json()) as FormRecord
      } else if (authResponse.status === 404) {
        return { content: [{ type: "text" as const, text: "Form not found." }] }
      } else {
        throw new Error(formsErrorMessage(authResponse.status, ""))
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: form.id,
                title: form.title,
                description: form.description,
                form_json: form.form_json,
                active: form.active,
                archived: form.archived,
                signable: form.signable,
                submission_count: form.submission_count,
                created_at: form.created_at,
                updated_at: form.updated_at,
              },
              null,
              2
            ),
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Failed to retrieve form: ${errorText(error)}` },
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
    attachments: z
      .array(
        z.object({
          name: z.string().describe("Filename"),
          content: z.string().describe("Base64-encoded file content"),
        })
      )
      .optional()
      .describe("Optional file attachments"),
  },
  async ({
    formId,
    formData,
    attachments,
  }: {
    formId: string
    formData: Record<string, unknown>
    attachments?: Array<{ name: string; content: string }>
  }) => {
    try {
      const validated = validateFormId(formId, "formId")
      const body: Record<string, unknown> = { form_data: formData }
      if (attachments && attachments.length > 0) {
        body.attachments = attachments
      }
      const response = await fetch(`${FORMS_BASE_URL}/api/forms/${encodeURIComponent(validated)}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.status === 404) {
        return { content: [{ type: "text" as const, text: "Form not found." }] }
      }
      if (response.status === 400) {
        return {
          content: [{ type: "text" as const, text: "Bad request: missing required form_data." }],
        }
      }
      if (!response.ok) {
        throw new Error(formsErrorMessage(response.status, ""))
      }
      return { content: [{ type: "text" as const, text: "Form submitted successfully." }] }
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Failed to submit form: ${errorText(error)}` }],
      }
    }
  }
)

server.tool(
  "list_forms",
  "List Paubox Forms for a customer. Supports search, filtering by archived/active status, ordering, and pagination. Returns form summaries plus page info.",
  {
    customerId: z.number().int().describe("Customer ID that owns the forms (required)"),
    search: z.string().optional().describe("Search text matched against form title and description"),
    formId: z.string().optional().describe("Filter to a specific form UUID"),
    archived: z.boolean().optional().describe("Filter by archived status"),
    active: z.boolean().optional().describe("Filter by active status"),
    orderBy: z
      .enum(["title", "updated_at", "submission_count"])
      .optional()
      .describe("Field to order by (default created_at)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
    items: z.number().int().min(1).max(100).optional().describe("Items per page (default 50, max 100)"),
  },
  async ({
    customerId,
    search,
    formId,
    archived,
    active,
    orderBy,
    order,
    page,
    items,
  }: {
    customerId: number
    search?: string
    formId?: string
    archived?: boolean
    active?: boolean
    orderBy?: "title" | "updated_at" | "submission_count"
    order?: "asc" | "desc"
    page?: number
    items?: number
  }) => {
    try {
      const response = await formsRequest("/api/forms", {
        query: {
          customer_id: customerId,
          search,
          form_id: formId,
          archived,
          active,
          order_by: orderBy,
          order,
          page,
          items,
        },
      })
      const payload = (await response.json()) as {
        results: FormRecord[]
        page_info: Record<string, unknown>
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                results: (payload.results ?? []).map(trimForm),
                page_info: payload.page_info,
              },
              null,
              2
            ),
          },
        ],
      }
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Failed to list forms: ${errorText(error)}` }],
      }
    }
  }
)

server.tool(
  "create_form",
  "Create a new Paubox Form. Provide a title, the form field definitions as JSON (form_json), and the owning customer ID. Returns the new form's UUID.",
  {
    title: z.string().min(1, "Title is required"),
    formJson: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .describe(
        "Form field schema as a JSON object (form_json). Pass the object itself; a JSON-encoded string will be parsed."
      ),
    customerId: z.number().int().describe("Customer ID that will own the form"),
    description: z.string().optional(),
    formHtml: z.string().optional().describe("Rendered HTML for the form"),
    formCss: z.string().optional().describe("CSS for the form"),
    recipient: z
      .string()
      .optional()
      .describe("Comma-separated email addresses that receive submission notifications"),
    signable: z.boolean().optional().describe("Whether the form supports signatures"),
    signatureConfirmationLabel: z.string().optional(),
    subscriptionListId: z.string().optional(),
    type: z.string().optional().describe('Form type, e.g. "marketing_form"'),
    active: z.boolean().optional().describe("Whether the form is active (default false)"),
    version: z.number().int().optional().describe("Form version (default 1)"),
  },
  async ({
    title,
    formJson,
    customerId,
    description,
    formHtml,
    formCss,
    recipient,
    signable,
    signatureConfirmationLabel,
    subscriptionListId,
    type,
    active,
    version,
  }: {
    title: string
    formJson: unknown
    customerId: number
    description?: string
    formHtml?: string
    formCss?: string
    recipient?: string
    signable?: boolean
    signatureConfirmationLabel?: string
    subscriptionListId?: string
    type?: string
    active?: boolean
    version?: number
  }) => {
    try {
      if (formJson === undefined || formJson === null) {
        throw new Error("formJson is required")
      }
      const body: Record<string, unknown> = {
        title,
        form_json: normalizeFormJson(formJson),
        customer_id: customerId,
        version: version ?? 1,
        active: active ?? false,
      }
      if (description !== undefined) body.description = description
      if (formHtml !== undefined) body.form_html = formHtml
      if (formCss !== undefined) body.form_css = formCss
      if (recipient !== undefined) body.recipient = recipient
      if (signable !== undefined) body.signable = signable
      if (signatureConfirmationLabel !== undefined) {
        body.signature_confirmation_label = signatureConfirmationLabel
      }
      if (subscriptionListId !== undefined) body.subscription_list_id = subscriptionListId
      if (type !== undefined) body.type = type

      const response = await formsRequest("/api/forms", { method: "POST", body })
      const payload = (await response.json()) as { id: string }
      return {
        content: [
          {
            type: "text" as const,
            text: `Form created\n\nForm ID: ${payload.id}\n\nUse get_form with this ID to review the form.`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Failed to create form: ${errorText(error)}` }],
      }
    }
  }
)

server.tool(
  "update_form",
  "Update an existing Paubox Form. Only the provided fields are changed; omitted fields are left as-is.",
  {
    formId: z.string().min(1, "Form ID is required"),
    title: z.string().optional(),
    description: z.string().optional(),
    formJson: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .describe(
        "Replacement form field schema as a JSON object (form_json). Pass the object itself; a JSON-encoded string will be parsed."
      ),
    vanityUrl: z.string().optional(),
    recipient: z
      .string()
      .optional()
      .describe("Comma-separated email addresses that receive submission notifications"),
    active: z.boolean().optional(),
    subscriptionListId: z.string().optional(),
  },
  async ({
    formId,
    title,
    description,
    formJson,
    vanityUrl,
    recipient,
    active,
    subscriptionListId,
  }: {
    formId: string
    title?: string
    description?: string
    formJson?: unknown
    vanityUrl?: string
    recipient?: string
    active?: boolean
    subscriptionListId?: string
  }) => {
    try {
      const body: Record<string, unknown> = {}
      if (title !== undefined) body.title = title
      if (description !== undefined) body.description = description
      if (formJson !== undefined) body.form_json = normalizeFormJson(formJson)
      if (vanityUrl !== undefined) body.vanity_url = vanityUrl
      if (recipient !== undefined) body.recipient = recipient
      if (active !== undefined) body.active = active
      if (subscriptionListId !== undefined) body.subscription_list_id = subscriptionListId
      if (Object.keys(body).length === 0) {
        throw new Error("Provide at least one field to update")
      }
      const validated = validateFormId(formId, "formId")

      const response = await formsRequest(`/api/forms/${encodeURIComponent(validated)}`, {
        method: "PUT",
        body,
      })
      const payload = (await response.json()) as { detail?: string; form_id?: string }
      return {
        content: [
          {
            type: "text" as const,
            text: `Form updated\n\nForm ID: ${payload.form_id ?? formId}\n${payload.detail ?? ""}`.trim(),
          },
        ],
      }
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Failed to update form: ${errorText(error)}` }],
      }
    }
  }
)

server.tool(
  "archive_form",
  "Archive a Paubox Form (sets archived=true and active=false). Archived forms stop accepting submissions but keep their data.",
  {
    formId: z.string().min(1, "Form ID is required"),
  },
  async ({ formId }: { formId: string }) => {
    try {
      const validated = validateFormId(formId, "formId")
      const response = await formsRequest(`/api/forms/${encodeURIComponent(validated)}/archive`, {
        method: "POST",
      })
      const payload = (await response.json()) as { detail?: string }
      return {
        content: [
          { type: "text" as const, text: payload.detail ?? "Form archived." },
        ],
      }
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Failed to archive form: ${errorText(error)}` }],
      }
    }
  }
)

server.tool(
  "unarchive_form",
  "Unarchive a previously archived Paubox Form.",
  {
    formId: z.string().min(1, "Form ID is required"),
  },
  async ({ formId }: { formId: string }) => {
    try {
      const validated = validateFormId(formId, "formId")
      const response = await formsRequest(`/api/forms/${encodeURIComponent(validated)}/unarchive`, {
        method: "POST",
      })
      const payload = (await response.json()) as { detail?: string }
      return {
        content: [
          { type: "text" as const, text: payload.detail ?? "Form unarchived." },
        ],
      }
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Failed to unarchive form: ${errorText(error)}` },
        ],
      }
    }
  }
)

server.tool(
  "copy_form",
  "Copy an existing Paubox Form to a new form with a new title. Returns the new form's ID and title.",
  {
    formId: z.string().min(1, "Form ID is required").describe("UUID of the form to copy"),
    title: z.string().min(1, "Title is required").describe("Title for the new copy"),
  },
  async ({ formId, title }: { formId: string; title: string }) => {
    try {
      const validated = validateFormId(formId, "formId")
      const response = await formsRequest("/api/forms/copy", {
        method: "POST",
        body: { form_id: validated, title },
      })
      const payload = (await response.json()) as FormRecord
      return {
        content: [
          {
            type: "text" as const,
            text: `Form copied\n\nNew Form ID: ${payload.id}\nTitle: ${payload.title}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Failed to copy form: ${errorText(error)}` }],
      }
    }
  }
)

server.tool(
  "get_form_stats",
  "Get aggregate Paubox Forms statistics: active form count, total submission count, and submissions in the last 7 days.",
  {
    customerId: z
      .number()
      .int()
      .optional()
      .describe("Customer ID (defaults to the API key's customer)"),
  },
  async ({ customerId }: { customerId?: number }) => {
    try {
      const response = await formsRequest("/api/forms/stats", {
        query: { customer_id: customerId },
      })
      const payload = (await response.json()) as {
        active_form_count?: number
        total_submission_count?: number
        submissions_last_7_days?: number
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Forms Stats\n\nActive forms: ${payload.active_form_count}\nTotal submissions: ${payload.total_submission_count}\nSubmissions (last 7 days): ${payload.submissions_last_7_days}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Failed to get form stats: ${errorText(error)}` },
        ],
      }
    }
  }
)

server.tool(
  "list_form_submissions",
  "List submissions for a Paubox Form. Each submission's form_data is returned as structured key-value pairs, along with submitter email and any attachment metadata.",
  {
    formId: z.string().min(1, "Form ID is required"),
    submissionId: z.string().optional().describe("Filter to a specific submission UUID"),
    orderBy: z
      .enum(["submitter_email"])
      .optional()
      .describe("Field to order by (default created_at)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
    page: z.number().int().min(1).optional().describe("Page number"),
    items: z.number().int().min(1).max(100).optional().describe("Items per page (max 100)"),
  },
  async ({
    formId,
    submissionId,
    orderBy,
    order,
    page,
    items,
  }: {
    formId: string
    submissionId?: string
    orderBy?: "submitter_email"
    order?: "asc" | "desc"
    page?: number
    items?: number
  }) => {
    try {
      const validated = validateFormId(formId, "formId")
      if (submissionId !== undefined) validateFormId(submissionId, "submissionId")
      const response = await formsRequest(`/api/forms/${encodeURIComponent(validated)}/submissions`, {
        query: {
          submission_id: submissionId,
          order_by: orderBy,
          order,
          page,
          items,
        },
      })
      const payload = (await response.json()) as {
        data: FormRecord[]
        total?: number
        page?: number
        items?: number
      }
      const submissions = (payload.data ?? []).map((row) => {
        let formData: unknown = row.form_data
        if (typeof formData === "string") {
          try {
            formData = JSON.parse(formData)
          } catch {
            // leave as raw string if it is not valid JSON
          }
        }
        const entry: FormRecord = {
          id: row.id,
          created_at: row.created_at,
          submitter_email: row.submitter_email,
          form_data: formData,
        }
        if (row.attachment_name != null) entry.attachment_name = row.attachment_name
        if (row.attachment_url != null) entry.attachment_url = row.attachment_url
        if (row.attachment_type != null) entry.attachment_type = row.attachment_type
        return entry
      })
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                submissions,
                total: payload.total,
                page: payload.page,
                items: payload.items,
              },
              null,
              2
            ),
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Failed to list form submissions: ${errorText(error)}` },
        ],
      }
    }
  }
)

const CSV_TRUNCATE_BYTES = 50 * 1024

server.tool(
  "export_submissions_csv",
  "Export a Paubox Form's submissions as CSV. Exports all submissions by default, or a single submission when submissionId is provided.",
  {
    formId: z.string().min(1, "Form ID is required"),
    submissionId: z
      .string()
      .optional()
      .describe("Export only this submission instead of all submissions"),
  },
  async ({ formId, submissionId }: { formId: string; submissionId?: string }) => {
    try {
      const validatedForm = validateFormId(formId, "formId")
      const basePath = `/api/forms/${encodeURIComponent(validatedForm)}/submissions/submission-csv`
      const path = submissionId
        ? `${basePath}/${encodeURIComponent(validateFormId(submissionId, "submissionId"))}`
        : basePath
      const response = await formsRequest(path)
      const csv = await response.text()
      if (csv.length > CSV_TRUNCATE_BYTES) {
        const truncated = csv.slice(0, CSV_TRUNCATE_BYTES)
        return {
          content: [
            {
              type: "text" as const,
              text: `${truncated}\n\n[Truncated: CSV output exceeded ${CSV_TRUNCATE_BYTES} bytes (full size ${csv.length} bytes). Narrow the export with submissionId or use pagination via list_form_submissions.]`,
            },
          ],
        }
      }
      return { content: [{ type: "text" as const, text: csv }] }
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Failed to export submissions CSV: ${errorText(error)}` },
        ],
      }
    }
  }
)

const PDF_MAX_BYTES = 1024 * 1024

server.tool(
  "export_submission_pdf",
  "Export a single Paubox Form submission as a PDF, returned base64-encoded.",
  {
    formId: z.string().min(1, "Form ID is required"),
    submissionId: z.string().min(1, "Submission ID is required"),
  },
  async ({ formId, submissionId }: { formId: string; submissionId: string }) => {
    try {
      const validatedForm = validateFormId(formId, "formId")
      const validatedSubmission = validateFormId(submissionId, "submissionId")
      const response = await formsRequest(
        `/api/forms/${encodeURIComponent(validatedForm)}/submissions/${encodeURIComponent(validatedSubmission)}/submission-pdf`
      )
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > PDF_MAX_BYTES) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to export submission PDF: the PDF is ${buffer.byteLength} bytes, which exceeds the ${PDF_MAX_BYTES} byte limit for tool output. Use export_submissions_csv instead.`,
            },
          ],
        }
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `PDF export (${buffer.byteLength} bytes, base64-encoded):\n\n${buffer.toString("base64")}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Failed to export submission PDF: ${errorText(error)}` },
        ],
      }
    }
  }
)

// ---------------------------------------------------------------------------
// Paubox Email Marketing tools (read-only + safe subscriber/list writes)
//
// These call the username-less Marketing API gateway, which resolves the
// customer from the same API key the email tools use — no extra credential is
// needed. Sending and deleting (campaign sends, scheduling, bulk delete) are
// deliberately not exposed; they mail or destroy whole lists and need a
// confirmation model of their own.
//
// The client is inlined here for the same reason as the email and forms
// clients: the stdio build cannot import from lib/.
// ---------------------------------------------------------------------------

// As with email and forms, the /v1 prefix is required — a bare /marketing
// base is unrouted and dies at the gateway with an HTML 404.
const MARKETING_BASE_URL = "https://api.paubox.com/v1/marketing"

const MARKETING_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Keep path separators and query delimiters out of interpolated path segments.
function validateMarketingUuid(raw: string, field: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error(`${field} is required.`)
  if (!MARKETING_UUID_RE.test(trimmed)) throw new Error(`${field} must be a UUID.`)
  return trimmed
}

// Sidekiq batch IDs are URL-safe tokens rather than UUIDs, so they get a
// charset check instead.
function validateBulkJobId(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error("bulkJobId is required.")
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) {
    throw new Error("bulkJobId must contain only letters, numbers, hyphens, and underscores.")
  }
  return trimmed
}

// The Rails error envelope is {"errors":[{"message":"404 Customer Not Found"}]};
// validation failures arrive as {"errors":{"email":["is invalid"]}}.
function marketingErrorDetail(body: string): string {
  if (!body) return ""
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body.slice(0, 300)
  }
  if (typeof parsed !== "object" || parsed === null) return body.slice(0, 300)
  const errors = (parsed as Record<string, unknown>).errors
  if (Array.isArray(errors)) {
    const parts = errors
      .map((entry) => {
        if (typeof entry === "string") return entry
        if (typeof entry === "object" && entry !== null) {
          const message = (entry as Record<string, unknown>).message
          if (typeof message === "string") return message
        }
        return ""
      })
      .filter((part) => part.length > 0)
    if (parts.length > 0) return parts.join("; ")
  } else if (errors && typeof errors === "object") {
    const parts = Object.entries(errors as Record<string, unknown>).map(
      ([field, messages]) =>
        `${field} ${Array.isArray(messages) ? messages.join(", ") : String(messages)}`
    )
    if (parts.length > 0) return parts.join("; ")
  } else if (typeof errors === "string") {
    return errors
  }
  return body.slice(0, 300)
}

function marketingErrorMessage(status: number, body: string): string {
  const detail = marketingErrorDetail(body)
  if (status === 401) {
    return "Your Paubox API key was rejected by the Marketing API. Marketing tools authenticate with the same API key as the email tools."
  }
  if (status === 403) {
    return "Access denied: your API key's customer cannot access that marketing resource."
  }
  if (status === 404) {
    // A 404 saying "Customer Not Found" means the key authenticated but no
    // marketing customer is associated with it — a provisioning gap, not a
    // missing record.
    if (/customer not found/i.test(detail)) {
      return "This Paubox account does not have Email Marketing provisioned. The API key is valid, but no marketing customer is associated with it — contact Paubox to enable Marketing for this account."
    }
    return "Not found: the requested marketing resource does not exist."
  }
  return `Paubox Marketing API error (HTTP ${status})${detail ? `: ${detail}` : ""}`
}

type MarketingQuery = Record<string, string | number | boolean | undefined>

async function marketingRequest(
  path: string,
  options: { method?: string; query?: MarketingQuery; body?: unknown } = {}
): Promise<unknown> {
  const url = new URL(`${MARKETING_BASE_URL}${path}`)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey!.trim()}`,
      "Content-Type": "application/json",
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  let raw = ""
  try {
    raw = await response.text()
  } catch {
    // ignore unreadable bodies
  }
  if (!response.ok) {
    throw new Error(marketingErrorMessage(response.status, raw))
  }
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// Collapse fast_jsonapi resources ({ id, type, attributes }) into flat objects
// so the model sees `{ id, email, ... }` instead of a nested envelope, keeping
// the sibling metadata (total_count, page_info) the controllers merge in.
function flattenMarketingResource(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry
  const record = entry as { id?: unknown; attributes?: unknown }
  if (typeof record.attributes !== "object" || record.attributes === null) return entry
  return { id: record.id, ...(record.attributes as Record<string, unknown>) }
}

function flattenMarketingDocument(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload
  const body = payload as Record<string, unknown>
  if (!("data" in body)) return payload
  const data = Array.isArray(body.data)
    ? body.data.map(flattenMarketingResource)
    : flattenMarketingResource(body.data)
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key !== "data" && value !== undefined && value !== null) rest[key] = value
  }
  return { data, ...rest }
}

function marketingJson(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] }
}

function marketingFailure(action: string, error: unknown) {
  return { content: [{ type: "text" as const, text: `Failed to ${action}: ${errorText(error)}` }] }
}

// These endpoints only paginate when use_pagination is set; asking for a page
// without it silently returns the whole collection.
function marketingCollectionQuery(params: {
  search?: string
  orderBy?: string
  order?: string
  page?: number
  items?: number
}): MarketingQuery {
  const query: MarketingQuery = {
    search: params.search,
    order_by: params.orderBy,
    order: params.order,
  }
  if (params.page !== undefined) {
    query.page = params.page
    query.use_pagination = true
  }
  if (params.items !== undefined) {
    query.items = params.items
    query.use_pagination = true
  }
  return query
}

// SubscriberCreator reads snake_case keys off subscriber_data. `create`
// matches an existing record by email or phone and cannot identify a new one
// without either; `update` assigns each field only when present, so partial
// updates are valid.
function marketingSubscriberPayload(
  fields: {
    email?: string
    phoneNumber?: string
    firstName?: string
    lastName?: string
    customFields?: Array<{ name: string; value: unknown }>
  },
  requireIdentifier: boolean
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (fields.email !== undefined) payload.email = fields.email
  if (fields.phoneNumber !== undefined) payload.phone_number = fields.phoneNumber
  if (fields.firstName !== undefined) payload.first_name = fields.firstName
  if (fields.lastName !== undefined) payload.last_name = fields.lastName
  if (fields.customFields !== undefined) payload.custom_fields = fields.customFields
  if (Object.keys(payload).length === 0) {
    throw new Error(
      "Provide at least one subscriber field (email, phoneNumber, firstName, lastName, or customFields)."
    )
  }
  if (requireIdentifier && payload.email === undefined && payload.phone_number === undefined) {
    throw new Error("A new subscriber needs an email or a phoneNumber to be identified.")
  }
  return payload
}

// The five report types registered in
// Analytics::EmailMarketingAnalyticsService.request_types. The controller
// derives the report from the last path segment, so anything outside this set
// raises a KeyError server-side and returns a 500.
const ANALYTICS_REPORTS = [
  "campaign_mailing_sends_table",
  "campaign_mailing_send_totals",
  "campaign_mailing_deliveries_table",
  "subscribers_by_tracking_link",
  "tracking_links_by_unique_link",
] as const

server.tool(
  "validate_marketing_access",
  "Check whether this Paubox account has Email Marketing provisioned, and return the marketing customer profile (name, from_name, from_email, physical address, global unsubscribe setting). Run this first if other marketing tools report that no marketing customer was found.",
  {},
  async () => {
    try {
      const customer = await marketingRequest("/current_customer")
      return marketingJson(flattenMarketingDocument(customer))
    } catch (error) {
      return marketingFailure("validate marketing access", error)
    }
  }
)

server.tool(
  "list_subscribers",
  'List Paubox Email Marketing subscribers. Supports full-text search, scoping to a subscription list or dynamic list, ordering, and pagination. Omit subscriptionListId to search the account\'s default "All contacts" list.',
  {
    search: z.string().optional().describe("Search text; defaults to all subscribers"),
    subscriptionListId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Restrict to a subscription list (integer ID from list_subscription_lists)"),
    dynamicListId: z
      .string()
      .optional()
      .describe("Restrict to a dynamic list (UUID from list_dynamic_lists)"),
    orderBy: z.string().optional().describe("Sort field (default created_at)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
    items: z.number().int().min(1).max(200).optional().describe("Items per page (default 50)"),
    withStats: z.boolean().optional().describe("Include per-subscriber delivery statistics"),
  },
  async ({
    search,
    subscriptionListId,
    dynamicListId,
    orderBy,
    order,
    page,
    items,
    withStats,
  }: {
    search?: string
    subscriptionListId?: number
    dynamicListId?: string
    orderBy?: string
    order?: "asc" | "desc"
    page?: number
    items?: number
    withStats?: boolean
  }) => {
    try {
      const response = await marketingRequest("/subscribers", {
        query: {
          search,
          subscription_list_id: subscriptionListId,
          dynamic_list_id:
            dynamicListId === undefined
              ? undefined
              : validateMarketingUuid(dynamicListId, "dynamicListId"),
          order_by: orderBy,
          order,
          page,
          items,
          with_stats: withStats,
        },
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("list subscribers", error)
    }
  }
)

server.tool(
  "get_subscriber",
  "Retrieve one Paubox Email Marketing subscriber by UUID, including custom field values and the subscription lists they belong to.",
  {
    subscriberId: z.string().min(1, "Subscriber ID is required").describe("Subscriber UUID"),
    subscriptionListId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Report subscribed/unsubscribed relative to this subscription list"),
    dynamicListId: z
      .string()
      .optional()
      .describe("Report subscribed/unsubscribed relative to this dynamic list (UUID)"),
    withStats: z.boolean().optional().describe("Include this subscriber's delivery statistics"),
  },
  async ({
    subscriberId,
    subscriptionListId,
    dynamicListId,
    withStats,
  }: {
    subscriberId: string
    subscriptionListId?: number
    dynamicListId?: string
    withStats?: boolean
  }) => {
    try {
      const validated = validateMarketingUuid(subscriberId, "subscriberId")
      const response = await marketingRequest(`/subscribers/${encodeURIComponent(validated)}`, {
        query: {
          subscription_list_id: subscriptionListId,
          dynamic_list_id:
            dynamicListId === undefined
              ? undefined
              : validateMarketingUuid(dynamicListId, "dynamicListId"),
          // The serializer gates statistics on the literal string "true".
          with_stats: withStats ? "true" : undefined,
        },
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("get subscriber", error)
    }
  }
)

server.tool(
  "create_subscriber",
  'Add a subscriber to Paubox Email Marketing. Requires an email or a phone number. The subscriber always joins the default "All contacts" list, plus subscriptionListId when given. An existing subscriber with the same email or phone is updated rather than duplicated. Custom field names that do not exist yet are created automatically.',
  {
    email: z.string().optional().describe("Subscriber email address"),
    phoneNumber: z.string().optional().describe("Subscriber phone number (normalized to E.164)"),
    firstName: z.string().optional().describe("First name"),
    lastName: z.string().optional().describe("Last name"),
    customFields: z
      .array(z.object({ name: z.string(), value: z.unknown() }))
      .optional()
      .describe("Custom field name/value pairs"),
    subscriptionListId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Additional subscription list to subscribe them to"),
  },
  async ({
    email,
    phoneNumber,
    firstName,
    lastName,
    customFields,
    subscriptionListId,
  }: {
    email?: string
    phoneNumber?: string
    firstName?: string
    lastName?: string
    customFields?: Array<{ name: string; value: unknown }>
    subscriptionListId?: number
  }) => {
    try {
      const body: Record<string, unknown> = {
        subscriber: marketingSubscriberPayload(
          { email, phoneNumber, firstName, lastName, customFields },
          true
        ),
      }
      if (subscriptionListId !== undefined) body.subscription_list_id = subscriptionListId
      const response = await marketingRequest("/subscribers", { method: "POST", body })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("create subscriber", error)
    }
  }
)

server.tool(
  "update_subscriber",
  "Update an existing Paubox Email Marketing subscriber by UUID. Only the fields you provide are changed; omitted fields stay unchanged.",
  {
    subscriberId: z.string().min(1, "Subscriber ID is required").describe("Subscriber UUID"),
    email: z.string().optional().describe("New email address"),
    phoneNumber: z.string().optional().describe("New phone number (normalized to E.164)"),
    firstName: z.string().optional().describe("New first name"),
    lastName: z.string().optional().describe("New last name"),
    customFields: z
      .array(z.object({ name: z.string(), value: z.unknown() }))
      .optional()
      .describe("Custom field name/value pairs to set"),
    subscriptionListId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Subscription list to also subscribe them to"),
  },
  async ({
    subscriberId,
    email,
    phoneNumber,
    firstName,
    lastName,
    customFields,
    subscriptionListId,
  }: {
    subscriberId: string
    email?: string
    phoneNumber?: string
    firstName?: string
    lastName?: string
    customFields?: Array<{ name: string; value: unknown }>
    subscriptionListId?: number
  }) => {
    try {
      const validated = validateMarketingUuid(subscriberId, "subscriberId")
      const body: Record<string, unknown> = {
        subscriber: marketingSubscriberPayload(
          { email, phoneNumber, firstName, lastName, customFields },
          false
        ),
      }
      if (subscriptionListId !== undefined) body.subscription_list_id = subscriptionListId
      const response = await marketingRequest(`/subscribers/${encodeURIComponent(validated)}`, {
        method: "PATCH",
        body,
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("update subscriber", error)
    }
  }
)

server.tool(
  "get_subscribed_count",
  'Get the number of currently subscribed (not unsubscribed, not deleted) contacts on a Paubox Email Marketing subscription list. Defaults to the "All contacts" list.',
  {
    subscriptionListId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Subscription list ID (defaults to the account's default list)"),
  },
  async ({ subscriptionListId }: { subscriptionListId?: number }) => {
    try {
      const response = await marketingRequest("/subscribers/subscribed_count", {
        query: { subscription_list_id: subscriptionListId },
      })
      return marketingJson(response)
    } catch (error) {
      return marketingFailure("get subscribed count", error)
    }
  }
)

server.tool(
  "list_marketing_lists",
  "List all Paubox Email Marketing audiences — both static subscription lists and filter-based dynamic lists — in one view, with subscriber counts. Use list_subscription_lists or list_dynamic_lists when you need one kind specifically.",
  {
    search: z.string().optional().describe("Search text matched against list names"),
    orderBy: z
      .string()
      .optional()
      .describe("Sort field: name, created_at, updated_at, or subscriber_count (default name)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)"),
    page: z.number().int().min(1).optional().describe("Page number (enables pagination)"),
    items: z.number().int().min(1).max(200).optional().describe("Items per page (enables pagination)"),
  },
  async (params: {
    search?: string
    orderBy?: string
    order?: "asc" | "desc"
    page?: number
    items?: number
  }) => {
    try {
      const response = await marketingRequest("/lists", {
        query: marketingCollectionQuery(params),
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("list marketing lists", error)
    }
  }
)

server.tool(
  "list_subscription_lists",
  'List Paubox Email Marketing subscription lists (static audiences) with their integer IDs, subscriber counts, and which one is the default "All contacts" list. The IDs returned here are what subscriptionListId expects elsewhere.',
  {
    orderBy: z.string().optional().describe("Sort field (default name)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)"),
    page: z.number().int().min(1).optional().describe("Page number (enables pagination)"),
    items: z.number().int().min(1).max(200).optional().describe("Items per page (enables pagination)"),
  },
  async (params: {
    orderBy?: string
    order?: "asc" | "desc"
    page?: number
    items?: number
  }) => {
    try {
      const response = await marketingRequest("/subscription_lists", {
        query: marketingCollectionQuery(params),
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("list subscription lists", error)
    }
  }
)

server.tool(
  "create_subscription_list",
  "Create a new (empty) Paubox Email Marketing subscription list. Returns the list's integer ID for use with create_subscriber and list_subscribers.",
  {
    name: z.string().min(1, "Name is required").describe("Name for the new subscription list"),
  },
  async ({ name }: { name: string }) => {
    try {
      const response = await marketingRequest("/subscription_lists", {
        method: "POST",
        body: { name },
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("create subscription list", error)
    }
  }
)

server.tool(
  "list_dynamic_lists",
  "List Paubox Email Marketing dynamic lists — filter-based segments that recompute their membership — with their UUIDs, filter definitions, and subscriber counts.",
  {
    orderBy: z.string().optional().describe("Sort field (default name)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)"),
    page: z.number().int().min(1).optional().describe("Page number (enables pagination)"),
    items: z.number().int().min(1).max(200).optional().describe("Items per page (enables pagination)"),
  },
  async (params: {
    orderBy?: string
    order?: "asc" | "desc"
    page?: number
    items?: number
  }) => {
    try {
      const response = await marketingRequest("/dynamic_lists", {
        query: marketingCollectionQuery(params),
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("list dynamic lists", error)
    }
  }
)

server.tool(
  "list_subscriber_custom_fields",
  "List the custom subscriber field types defined for this Paubox Email Marketing account. Use this to discover which custom field names create_subscriber and update_subscriber can set.",
  {},
  async () => {
    try {
      const response = await marketingRequest("/subscriber_custom_field_types")
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("list subscriber custom fields", error)
    }
  }
)

server.tool(
  "list_campaign_sends",
  "List Paubox Email Marketing campaign sends (each time a marketing email went out to a list), with per-send counts for delivered, viewed, clicked, bounced, and unsubscribed.",
  {
    search: z.string().optional().describe("Search text matched against the send"),
    orderBy: z.string().optional().describe("Sort field (default created_at)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
    items: z.number().int().min(1).max(200).optional().describe("Items per page"),
  },
  async ({
    search,
    orderBy,
    order,
    page,
    items,
  }: {
    search?: string
    orderBy?: string
    order?: "asc" | "desc"
    page?: number
    items?: number
  }) => {
    try {
      const response = await marketingRequest("/campaign_mailing_sends", {
        query: { search, order_by: orderBy, order, page, items },
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("list campaign sends", error)
    }
  }
)

server.tool(
  "list_campaign_deliveries",
  "List individual Paubox Email Marketing deliveries — one row per recipient per campaign — showing what happened to each message. Scope with campaignMailingId or campaignMailingSendId.",
  {
    campaignMailingId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Restrict to one campaign mailing (integer ID)"),
    campaignMailingSendId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Restrict to one send of a campaign mailing (integer ID from list_campaign_sends)"),
    search: z.string().optional().describe("Search text"),
    orderBy: z.string().optional().describe("Sort field (default created_at)"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
    items: z.number().int().min(1).max(200).optional().describe("Items per page"),
  },
  async ({
    campaignMailingId,
    campaignMailingSendId,
    search,
    orderBy,
    order,
    page,
    items,
  }: {
    campaignMailingId?: number
    campaignMailingSendId?: number
    search?: string
    orderBy?: string
    order?: "asc" | "desc"
    page?: number
    items?: number
  }) => {
    try {
      const response = await marketingRequest("/campaign_mailing_deliveries", {
        query: {
          campaign_mailing_id: campaignMailingId,
          campaign_mailing_send_id: campaignMailingSendId,
          search,
          order_by: orderBy,
          order,
          page,
          items,
        },
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("list campaign deliveries", error)
    }
  }
)

server.tool(
  "get_campaign_analytics",
  "Run a Paubox Email Marketing analytics report. Reports: campaign_mailing_sends_table (per-send performance rows), campaign_mailing_send_totals (aggregate totals, optionally bucketed by date), campaign_mailing_deliveries_table (per-recipient detail for one campaign or send), subscribers_by_tracking_link (who clicked a link), tracking_links_by_unique_link (click counts per link).",
  {
    report: z.enum(ANALYTICS_REPORTS).describe("Which analytics report to run"),
    campaignMailingId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Scope to one campaign mailing (integer ID)"),
    campaignMailingSendId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Scope to one campaign send (integer ID)"),
    dripCampaignId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Scope to one drip campaign (integer ID)"),
    trackingLinkId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Scope to one tracking link (integer ID)"),
    emailType: z.string().optional().describe("Filter by email type"),
    search: z.string().optional().describe("Search text"),
    orderBy: z
      .string()
      .optional()
      .describe("Sort field, e.g. marketing_email_id, sent_at, subscription_list_name"),
    order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
    byDate: z.boolean().optional().describe("For campaign_mailing_send_totals: bucket by date"),
    startDate: z
      .string()
      .optional()
      .describe("Start of the date range (parseable timestamp); pair with endDate"),
    endDate: z
      .string()
      .optional()
      .describe("End of the date range (parseable timestamp); pair with startDate"),
    dateOffset: z
      .number()
      .int()
      .optional()
      .describe(
        "For campaign_mailing_send_totals with byDate: look back this many days instead of giving startDate/endDate"
      ),
    withStats: z.boolean().optional().describe("Include summed delivery statistics columns"),
  },
  async ({
    report,
    campaignMailingId,
    campaignMailingSendId,
    dripCampaignId,
    trackingLinkId,
    emailType,
    search,
    orderBy,
    order,
    byDate,
    startDate,
    endDate,
    dateOffset,
    withStats,
  }: {
    report: (typeof ANALYTICS_REPORTS)[number]
    campaignMailingId?: number
    campaignMailingSendId?: number
    dripCampaignId?: number
    trackingLinkId?: number
    emailType?: string
    search?: string
    orderBy?: string
    order?: "asc" | "desc"
    byDate?: boolean
    startDate?: string
    endDate?: string
    dateOffset?: number
    withStats?: boolean
  }) => {
    try {
      const response = await marketingRequest(`/analytics/${report}`, {
        query: {
          campaign_mailing_id: campaignMailingId,
          campaign_mailing_send_id: campaignMailingSendId,
          drip_campaign_id: dripCampaignId,
          tracking_link_id: trackingLinkId,
          email_type: emailType,
          search,
          order_by: orderBy,
          order,
          by_date: byDate,
          start_date: startDate,
          end_date: endDate,
          date_offset: dateOffset,
          with_stats: withStats,
        },
      })
      return marketingJson(flattenMarketingDocument(response))
    } catch (error) {
      return marketingFailure("get campaign analytics", error)
    }
  }
)

server.tool(
  "get_marketing_bulk_job",
  "Check the progress of an asynchronous Paubox Email Marketing bulk job. Bulk subscriber imports and CSV exports return a job ID (jid/bid) instead of a result; pass it here to see total, pending, and failed counts.",
  {
    bulkJobId: z
      .string()
      .min(1, "Bulk job ID is required")
      .describe("The bid/jid returned by a bulk operation"),
  },
  async ({ bulkJobId }: { bulkJobId: string }) => {
    try {
      const validated = validateBulkJobId(bulkJobId)
      const response = await marketingRequest(`/bulk_jobs/${encodeURIComponent(validated)}`)
      return marketingJson(response)
    } catch (error) {
      return marketingFailure("get marketing bulk job", error)
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
