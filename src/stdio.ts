#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import pauboxNode from "paubox-node"
import { validateFormId } from "./validate-form-id.js"

const apiKey = process.env.PAUBOX_API_KEY
const apiUser = process.env.PAUBOX_API_USER

if (!apiKey || apiKey.trim().length < 10) {
  process.stderr.write(
    "Error: PAUBOX_API_KEY environment variable is required (minimum 10 characters)\n"
  )
  process.exit(1)
}
if (!apiUser || apiUser.trim().length === 0) {
  process.stderr.write("Error: PAUBOX_API_USER environment variable is required\n")
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pauboxService: any = new pauboxNode.emailService({
  apiKey: apiKey.trim(),
  apiUsername: apiUser.trim(),
})

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
          text: `Credentials configured\n\nAPI User: ${apiUser}\nAPI Key: ${masked}\n\nReady to send email with send_secure_email.`,
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
      const emailMessage = new pauboxNode.message({
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await pauboxService.sendMessage(emailMessage)

      return {
        content: [
          {
            type: "text" as const,
            text: `Email sent\n\nFrom: ${from}\nTo: ${to.join(", ")}\nSubject: ${subject}\nSource Tracking ID: ${response.sourceTrackingId}\nMessage ID: ${response.data.message_id}\n\nSave the Source Tracking ID to check delivery status later.`,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await pauboxService.getEmailDisposition(sourceTrackingId.trim())

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

// ---------------------------------------------------------------------------
// Paubox Forms tools
// ---------------------------------------------------------------------------

const FORMS_BASE_URL = "https://apx.paubox.com/forms"

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

const FETCH_TIMEOUT_MS = 15000

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
    formJson: z.unknown().describe("Form field definitions as a JSON value (form_json)"),
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
        form_json: formJson,
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
    formJson: z.unknown().optional().describe("Replacement form field definitions as a JSON value (form_json)"),
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
      if (formJson !== undefined) body.form_json = formJson
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

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
