import { AsyncLocalStorage } from 'async_hooks'
import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import axios from 'axios'
import { verifyAccessToken } from '../../lib/oauth-jwt'
import { checkPauboxCredentials } from '../../lib/paubox-credentials'
import { sendEmail, getEmailDisposition, scheduleEmail, getScheduledEmail, rescheduleEmail, cancelScheduledEmail } from '../../lib/paubox-email'
import {
  FORMS_BASE_URL,
  createFormsClient,
  PauboxFormsError,
  Form,
  FormSubmission,
  validateFormId,
} from '../../lib/paubox-forms'
import {
  ANALYTICS_REPORTS,
  AnalyticsReport,
  createMarketingClient,
} from '../../lib/paubox-marketing'

type RequestCredentials = {
  apiKey?: string
}

const credentialsStorage = new AsyncLocalStorage<RequestCredentials>()

function resolveCredentials(params: { apiKey?: string }) {
  const stored = credentialsStorage.getStore()
  return {
    apiKey: params.apiKey || stored?.apiKey || '',
  }
}

const MISSING_CREDENTIALS_ERROR = "❌ API key required. Reconnect the Paubox connector in your client (Claude → Settings → Integrations → Paubox) to re-enter your API key, or pass apiKey as a tool parameter, or set the x-paubox-api-key header."

const MISSING_FORMS_API_KEY_ERROR = "❌ API key required. Forms management tools need an apiKey carrying the \"forms\" scope — scoped API keys are managed in the Paubox admin dashboard. Reconnect the Paubox connector in your client (Claude → Settings → Integrations → Paubox), or pass apiKey as a tool parameter, or set the x-paubox-api-key header."

// Trim heavy fields (form_html/form_css/form_json) out of list output so the
// model sees a compact summary; get_form returns the full field schema.
const trimForm = (form: Form) => ({
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
})

// form_data arrives as a JSON string — parse it so the model sees structured
// key/value data instead of an escaped string.
const trimSubmission = (submission: FormSubmission) => {
  let formData: unknown = submission.form_data
  if (typeof submission.form_data === 'string') {
    try {
      formData = JSON.parse(submission.form_data)
    } catch {
      // Leave as the raw string if it isn't valid JSON.
    }
  }
  const trimmed: Record<string, unknown> = {
    id: submission.id,
    created_at: submission.created_at,
    submitter_email: submission.submitter_email,
    form_data: formData,
  }
  if (submission.attachment_name) trimmed.attachment_name = submission.attachment_name
  if (submission.attachment_url) trimmed.attachment_url = submission.attachment_url
  if (submission.attachment_type) trimmed.attachment_type = submission.attachment_type
  return trimmed
}

const formsFailureText = (action: string, error: unknown) =>
  `❌ Failed to ${action}: ${error instanceof Error ? error.message : 'Unknown error occurred'}`

const MISSING_MARKETING_API_KEY_ERROR = "❌ API key required. Marketing tools use the same Paubox API key as the email tools. Reconnect the Paubox connector in your client (Claude → Settings → Integrations → Paubox), or pass apiKey as a tool parameter, or set the x-paubox-api-key header."

const marketingFailureText = (action: string, error: unknown) =>
  `❌ Failed to ${action}: ${error instanceof Error ? error.message : 'Unknown error occurred'}`

const jsonText = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
})

const mcpHandler = createMcpHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server: any) => {
    server.tool(
      "validate_credentials",
      "Validate Paubox API credentials before sending email",
      {
        apiKey: z.string().min(10, "API key must be at least 10 characters").optional(),
      },
      async ({ apiKey: paramKey }: { apiKey?: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }
          if (apiKey.trim().length < 10) {
            throw new Error("Invalid API key format")
          }
          const result = await checkPauboxCredentials(apiKey)
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
                text: `✅ Credentials validated successfully!\n\n🔑 API Key: ${apiKey.slice(0, 4)}${"*".repeat(Math.max(0, apiKey.length - 4))}\n\n💡 You can now use send_secure_email to send emails.`,
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
        from: z.string(),
        to: z.array(z.string()),
        subject: z.string(),
        message: z.string(),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        forceSecureNotification: z.boolean().optional(),
      },
      async ({ apiKey: paramKey, from, to, subject, message, cc, bcc, forceSecureNotification }: {
        apiKey?: string;
        from: string;
        to: string[];
        subject: string;
        message: string;
        cc?: string[];
        bcc?: string[];
        forceSecureNotification?: boolean;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }

          if (!message || message.trim().length === 0) {
            throw new Error("Message content is required and cannot be empty")
          }

          const response = await sendEmail(apiKey, {
            from,
            to,
            subject,
            textContent: message.trim(),
            htmlContent: `<p>${message.trim()}</p>`,
            cc,
            bcc,
            forceSecureNotification: forceSecureNotification ?? false,
          })

          return {
            content: [
              {
                type: "text",
                text: `✅ Email sent successfully!\n\n📧 From: ${from}\n📧 To: ${to.join(", ")}\n📋 Subject: ${subject}\n🔍 Source Tracking ID: ${response.sourceTrackingId}\n🆔 Message ID: ${response.data?.message_id}\n\n💡 Save the Source Tracking ID to check delivery status later.`,
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
        sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
      },
      async ({ apiKey: paramKey, sourceTrackingId }: {
        apiKey?: string;
        sourceTrackingId: string;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }

          if (!sourceTrackingId || sourceTrackingId.trim().length === 0) {
            throw new Error("Source Tracking ID is required")
          }

          const response = await getEmailDisposition(apiKey, sourceTrackingId.trim())

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
      "schedule_email",
      "Schedule a secure, HIPAA-compliant email for future delivery using Paubox",
      {
        apiKey: z.string().optional(),
        from: z.string(),
        to: z.array(z.string()),
        subject: z.string(),
        message: z.string(),
        scheduledAt: z.string().describe("ISO 8601 datetime for when the email should be sent (e.g. 2025-12-25T15:00:00Z)"),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        forceSecureNotification: z.boolean().optional(),
      },
      async ({ apiKey: paramKey, from, to, subject, message, scheduledAt, cc, bcc, forceSecureNotification }: {
        apiKey?: string;
        from: string;
        to: string[];
        subject: string;
        message: string;
        scheduledAt: string;
        cc?: string[];
        bcc?: string[];
        forceSecureNotification?: boolean;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }

          if (!message || message.trim().length === 0) {
            throw new Error("Message content is required and cannot be empty")
          }

          const response = await scheduleEmail(apiKey, {
            from,
            to,
            subject,
            textContent: message.trim(),
            htmlContent: `<p>${message.trim()}</p>`,
            cc,
            bcc,
            forceSecureNotification: forceSecureNotification ?? false,
            scheduledAt,
          })

          return {
            content: [
              {
                type: "text",
                text: `Email scheduled\n\nFrom: ${from}\nTo: ${to.join(", ")}\nSubject: ${subject}\nScheduled at: ${response.scheduledAt}\nSource Tracking ID: ${response.sourceTrackingId}\nState: ${response.state}\n\nSave the Source Tracking ID to check status, reschedule, or cancel.`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to schedule email: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'}`,
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
        apiKey: z.string().optional(),
        sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
      },
      async ({ apiKey: paramKey, sourceTrackingId }: {
        apiKey?: string;
        sourceTrackingId: string;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }

          const response = await getScheduledEmail(apiKey, sourceTrackingId.trim())

          return {
            content: [
              {
                type: "text",
                text: `Scheduled Email Status\n\nSource Tracking ID: ${sourceTrackingId}\nState: ${(response as Record<string, unknown>).state}\nScheduled at: ${(response as Record<string, unknown>).scheduledAt}\n\n${JSON.stringify(response, null, 2)}`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get scheduled email: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'}`,
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
        apiKey: z.string().optional(),
        sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
        scheduledAt: z.string().describe("New ISO 8601 datetime for when the email should be sent"),
      },
      async ({ apiKey: paramKey, sourceTrackingId, scheduledAt }: {
        apiKey?: string;
        sourceTrackingId: string;
        scheduledAt: string;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }

          const response = await rescheduleEmail(apiKey, sourceTrackingId.trim(), scheduledAt)

          return {
            content: [
              {
                type: "text",
                text: `Email rescheduled\n\nSource Tracking ID: ${response.sourceTrackingId}\nNew scheduled time: ${response.scheduledAt}\nState: ${response.state}`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to reschedule email: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'}`,
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
        apiKey: z.string().optional(),
        sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
      },
      async ({ apiKey: paramKey, sourceTrackingId }: {
        apiKey?: string;
        sourceTrackingId: string;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_CREDENTIALS_ERROR }] }
          }

          const response = await cancelScheduledEmail(apiKey, sourceTrackingId.trim())

          return {
            content: [
              {
                type: "text",
                text: `Scheduled email cancelled\n\nSource Tracking ID: ${response.sourceTrackingId}\nState: ${response.state}`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to cancel scheduled email: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'}`,
              },
            ],
          }
        }
      }
    )

    server.tool(
      "get_form",
      "Retrieve metadata and field schema for a Paubox Form by its UUID. Returns the form title, description, field definitions (form_json), and status. Works without credentials for active forms; when an API key with the \"forms\" scope is available, inactive and archived forms are retrievable too.",
      {
        formId: z.string().min(1, "Form ID is required"),
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope (optional — enables retrieving inactive/archived forms)"),
      },
      async ({ formId, apiKey: paramKey }: { formId: string; apiKey?: string }) => {
        try {
          const safeFormId = validateFormId(formId, 'formId')
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          let form
          if (apiKey) {
            const client = createFormsClient({ apiKey })
            try {
              form = await client.getForm(safeFormId)
            } catch (error) {
              // The stored key may be email-only (no "forms" scope). Fall back
              // to the public endpoint so get_form keeps working
              // credential-free for active forms, like the stdio server does.
              if (error instanceof PauboxFormsError && (error.status === 401 || error.status === 403)) {
                const response = await axios.get(
                  `${FORMS_BASE_URL}/public/form_data/${encodeURIComponent(safeFormId)}`,
                  { timeout: 15000 },
                )
                form = response.data
              } else {
                throw error
              }
            }
          } else {
            const response = await axios.get(
              `${FORMS_BASE_URL}/public/form_data/${encodeURIComponent(safeFormId)}`,
              { timeout: 15000 },
            )
            form = response.data
          }
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
                  archived: form.archived,
                  signable: form.signable,
                  submission_count: form.submission_count,
                  created_at: form.created_at,
                  updated_at: form.updated_at,
                }, null, 2),
              },
            ],
          }
        } catch (error) {
          if (error instanceof PauboxFormsError && error.status === 404) {
            return { content: [{ type: "text", text: "Form not found." }] }
          }
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
          const safeFormId = validateFormId(formId, 'formId')
          const body: Record<string, unknown> = { form_data: formData }
          if (attachments && attachments.length > 0) {
            body.attachments = attachments
          }
          await axios.post(
            `${FORMS_BASE_URL}/api/forms/${encodeURIComponent(safeFormId)}/submissions`,
            body,
            { timeout: 15000 },
          )
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

    server.tool(
      "list_forms",
      "List Paubox Forms for a customer. Requires an API key with the \"forms\" scope. Supports search, filtering by active/archived status, ordering, and pagination.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        customerId: z.number().int().describe("Paubox customer ID the forms belong to"),
        search: z.string().optional().describe("Search text matched against form title and description"),
        formId: z.string().optional().describe("Filter to a specific form UUID"),
        archived: z.boolean().optional().describe("Filter by archived status"),
        active: z.boolean().optional().describe("Filter by active status"),
        orderBy: z.enum(["title", "updated_at", "submission_count"]).optional().describe("Sort field (default created_at)"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
        page: z.number().int().min(1).optional().describe("Page number (default 1)"),
        items: z.number().int().min(1).max(100).optional().describe("Items per page (default 50, max 100)"),
      },
      async ({ apiKey: paramKey, customerId, search, formId, archived, active, orderBy, order, page, items }: {
        apiKey?: string;
        customerId: number;
        search?: string;
        formId?: string;
        archived?: boolean;
        active?: boolean;
        orderBy?: "title" | "updated_at" | "submission_count";
        order?: "asc" | "desc";
        page?: number;
        items?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const client = createFormsClient({ apiKey })
          const response = await client.listForms({ customerId, search, formId, archived, active, orderBy, order, page, items })
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  results: (response.results ?? []).map(trimForm),
                  page_info: response.page_info,
                }, null, 2),
              },
            ],
          }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("list forms", error) }] }
        }
      }
    )

    server.tool(
      "create_form",
      "Create a new Paubox Form. Requires an API key with the \"forms\" scope. Provide the form title, field schema (formJson), and the customer ID that owns the form.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        title: z.string().min(1, "Title is required").describe("Form title"),
        formJson: z.union([z.record(z.string(), z.unknown()), z.string()]).describe("Form field schema as a JSON object (form_json). Pass the object itself; a JSON-encoded string will be parsed."),
        customerId: z.number().int().describe("Paubox customer ID that owns the form"),
        description: z.string().optional().describe("Form description"),
        formHtml: z.string().optional().describe("Rendered form HTML"),
        formCss: z.string().optional().describe("Form CSS"),
        recipient: z.string().optional().describe("Comma-separated email addresses that receive submission notifications"),
        signable: z.boolean().optional().describe("Whether the form collects a signature"),
        signatureConfirmationLabel: z.string().optional().describe("Label shown next to the signature confirmation checkbox"),
        subscriptionListId: z.string().optional().describe("Subscription list ID to add submitters to"),
        type: z.string().optional().describe("Form type, e.g. \"marketing_form\""),
        active: z.boolean().optional().describe("Whether the form is active (default false)"),
        version: z.number().int().optional().describe("Form version (default 1)"),
      },
      async ({ apiKey: paramKey, title, formJson, customerId, description, formHtml, formCss, recipient, signable, signatureConfirmationLabel, subscriptionListId, type, active, version }: {
        apiKey?: string;
        title: string;
        formJson: unknown;
        customerId: number;
        description?: string;
        formHtml?: string;
        formCss?: string;
        recipient?: string;
        signable?: boolean;
        signatureConfirmationLabel?: string;
        subscriptionListId?: string;
        type?: string;
        active?: boolean;
        version?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          if (formJson === undefined || formJson === null) {
            throw new Error("formJson is required")
          }
          const client = createFormsClient({ apiKey })
          const result = await client.createForm({
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
            active: active ?? false,
            version: version ?? 1,
          })
          return {
            content: [
              {
                type: "text",
                text: `✅ Form created!\n\n🆔 Form ID: ${result.id}\n\n💡 Use get_form with this ID to view the form.`,
              },
            ],
          }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("create form", error) }] }
        }
      }
    )

    server.tool(
      "update_form",
      "Update an existing Paubox Form. Requires an API key with the \"forms\" scope. Only the fields you provide are changed; omitted fields stay unchanged.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        formId: z.string().min(1, "Form ID is required").describe("UUID of the form to update"),
        title: z.string().optional().describe("New form title"),
        description: z.string().optional().describe("New form description"),
        formJson: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe("New form field schema as a JSON object (form_json). Pass the object itself; a JSON-encoded string will be parsed."),
        vanityUrl: z.string().optional().describe("New vanity URL slug"),
        recipient: z.string().optional().describe("Comma-separated email addresses that receive submission notifications"),
        active: z.boolean().optional().describe("Set the form's active status"),
        subscriptionListId: z.string().optional().describe("Subscription list ID to add submitters to"),
      },
      async ({ apiKey: paramKey, formId, title, description, formJson, vanityUrl, recipient, active, subscriptionListId }: {
        apiKey?: string;
        formId: string;
        title?: string;
        description?: string;
        formJson?: unknown;
        vanityUrl?: string;
        recipient?: string;
        active?: boolean;
        subscriptionListId?: string;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const updates = { title, description, formJson, vanityUrl, recipient, active, subscriptionListId }
          if (Object.values(updates).every((value) => value === undefined)) {
            throw new Error("Provide at least one field to update")
          }
          const client = createFormsClient({ apiKey })
          const result = await client.updateForm(formId.trim(), updates)
          return {
            content: [
              { type: "text", text: `✅ Form updated.\n\n🆔 Form ID: ${result.form_id}\n📋 ${result.detail}` },
            ],
          }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("update form", error) }] }
        }
      }
    )

    server.tool(
      "archive_form",
      "Archive a Paubox Form (sets archived=true and active=false). Requires an API key with the \"forms\" scope.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        formId: z.string().min(1, "Form ID is required").describe("UUID of the form to archive"),
      },
      async ({ apiKey: paramKey, formId }: { apiKey?: string; formId: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const client = createFormsClient({ apiKey })
          const result = await client.archiveForm(formId.trim())
          return { content: [{ type: "text", text: `✅ Form archived.\n\n📋 ${result.detail}` }] }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("archive form", error) }] }
        }
      }
    )

    server.tool(
      "unarchive_form",
      "Unarchive a previously archived Paubox Form. Requires an API key with the \"forms\" scope.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        formId: z.string().min(1, "Form ID is required").describe("UUID of the form to unarchive"),
      },
      async ({ apiKey: paramKey, formId }: { apiKey?: string; formId: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const client = createFormsClient({ apiKey })
          const result = await client.unarchiveForm(formId.trim())
          return { content: [{ type: "text", text: `✅ Form unarchived.\n\n📋 ${result.detail}` }] }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("unarchive form", error) }] }
        }
      }
    )

    server.tool(
      "copy_form",
      "Duplicate an existing Paubox Form under a new title. Requires an API key with the \"forms\" scope.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        formId: z.string().min(1, "Form ID is required").describe("UUID of the form to copy"),
        title: z.string().min(1, "Title is required").describe("Title for the new copy"),
      },
      async ({ apiKey: paramKey, formId, title }: { apiKey?: string; formId: string; title: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const client = createFormsClient({ apiKey })
          const newForm = await client.copyForm(formId.trim(), title)
          return {
            content: [
              {
                type: "text",
                text: `✅ Form copied!\n\n🆔 New Form ID: ${newForm.id}\n📋 Title: ${newForm.title}\n\n💡 Use get_form with the new ID to view the copy.`,
              },
            ],
          }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("copy form", error) }] }
        }
      }
    )

    server.tool(
      "get_form_stats",
      "Get aggregate Paubox Forms statistics: active form count, total submission count, and submissions in the last 7 days. Requires an API key with the \"forms\" scope.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        customerId: z.number().int().optional().describe("Paubox customer ID (defaults to the API key's customer)"),
      },
      async ({ apiKey: paramKey, customerId }: { apiKey?: string; customerId?: number }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const client = createFormsClient({ apiKey })
          const stats = await client.getFormStats(customerId)
          return {
            content: [
              {
                type: "text",
                text: `📊 Paubox Forms Stats\n\n📄 Active forms: ${stats.active_form_count}\n📥 Total submissions: ${stats.total_submission_count}\n🗓️ Submissions (last 7 days): ${stats.submissions_last_7_days}`,
              },
            ],
          }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("get form stats", error) }] }
        }
      }
    )

    server.tool(
      "list_form_submissions",
      "List submissions for a Paubox Form, with each submission's form_data parsed into structured key/value pairs. Requires an API key with the \"forms\" scope.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        formId: z.string().min(1, "Form ID is required").describe("UUID of the form"),
        submissionId: z.string().optional().describe("Filter to a single submission UUID"),
        orderBy: z.enum(["submitter_email"]).optional().describe("Sort field (default created_at)"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
        page: z.number().int().min(1).optional().describe("Page number (default 1)"),
        items: z.number().int().min(1).max(100).optional().describe("Items per page (max 100)"),
      },
      async ({ apiKey: paramKey, formId, submissionId, orderBy, order, page, items }: {
        apiKey?: string;
        formId: string;
        submissionId?: string;
        orderBy?: "submitter_email";
        order?: "asc" | "desc";
        page?: number;
        items?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const client = createFormsClient({ apiKey })
          const response = await client.listSubmissions(formId.trim(), { submissionId, orderBy, order, page, items })
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  submissions: (response.data ?? []).map(trimSubmission),
                  total: response.total,
                  page: response.page,
                  items: response.items,
                }, null, 2),
              },
            ],
          }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("list form submissions", error) }] }
        }
      }
    )

    server.tool(
      "export_submissions_csv",
      "Export a Paubox Form's submissions as CSV text. Optionally export a single submission by ID. Requires an API key with the \"forms\" scope.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        formId: z.string().min(1, "Form ID is required").describe("UUID of the form"),
        submissionId: z.string().optional().describe("Export only this submission UUID"),
      },
      async ({ apiKey: paramKey, formId, submissionId }: { apiKey?: string; formId: string; submissionId?: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const client = createFormsClient({ apiKey })
          const csv = await client.exportSubmissionsCsv(formId.trim(), submissionId?.trim() || undefined)
          const CSV_LIMIT = 50 * 1024
          if (csv.length > CSV_LIMIT) {
            return {
              content: [
                {
                  type: "text",
                  text: `${csv.slice(0, CSV_LIMIT)}\n\n⚠️ Output truncated at 50KB (full export is ${csv.length} characters). Narrow the export with submissionId or download the CSV from the Paubox dashboard.`,
                },
              ],
            }
          }
          return { content: [{ type: "text", text: csv }] }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("export submissions CSV", error) }] }
        }
      }
    )

    server.tool(
      "export_submission_pdf",
      "Export a single Paubox Form submission as a PDF, returned base64-encoded. Requires an API key with the \"forms\" scope.",
      {
        apiKey: z.string().optional().describe("Paubox API key with the \"forms\" scope"),
        formId: z.string().min(1, "Form ID is required").describe("UUID of the form"),
        submissionId: z.string().min(1, "Submission ID is required").describe("UUID of the submission"),
      },
      async ({ apiKey: paramKey, formId, submissionId }: { apiKey?: string; formId: string; submissionId: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_FORMS_API_KEY_ERROR }] }
          }
          const client = createFormsClient({ apiKey })
          const pdf = await client.exportSubmissionPdf(formId.trim(), submissionId.trim())
          const PDF_LIMIT = 1024 * 1024
          if (pdf.byteLength > PDF_LIMIT) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ PDF is ${pdf.byteLength} bytes, which exceeds the 1MB limit for tool output. Use export_submissions_csv with submissionId instead, or download the PDF from the Paubox dashboard.`,
                },
              ],
            }
          }
          return {
            content: [
              {
                type: "text",
                text: `✅ PDF exported (${pdf.byteLength} bytes, base64-encoded below):\n\n${pdf.toString('base64')}`,
              },
            ],
          }
        } catch (error) {
          return { content: [{ type: "text", text: formsFailureText("export submission PDF", error) }] }
        }
      }
    )

    // -----------------------------------------------------------------------
    // Paubox Email Marketing tools (read-only + safe subscriber/list writes).
    //
    // These call the username-less Marketing API gateway at
    // api.paubox.com/v1/marketing, which resolves the customer from the same
    // API key the email tools use — no extra credential is needed. Sending and
    // deleting (campaign sends, scheduling, bulk delete) are deliberately not
    // exposed here; they mail or destroy whole lists and need a confirmation
    // model of their own.
    // -----------------------------------------------------------------------

    server.tool(
      "validate_marketing_access",
      "Check whether this Paubox account has Email Marketing provisioned, and return the marketing customer profile (name, from_name, from_email, physical address, global unsubscribe setting). Run this first if other marketing tools report that no marketing customer was found.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
      },
      async ({ apiKey: paramKey }: { apiKey?: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const customer = await createMarketingClient({ apiKey }).getCurrentCustomer()
          return {
            content: [
              {
                type: "text",
                text: `✅ Email Marketing is enabled for this API key.\n\n${JSON.stringify(customer, null, 2)}`,
              },
            ],
          }
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("validate marketing access", error) }] }
        }
      }
    )

    server.tool(
      "list_subscribers",
      "List Paubox Email Marketing subscribers. Supports full-text search, scoping to a subscription list or dynamic list, ordering, and pagination. Omit subscriptionListId to search the account's default \"All contacts\" list.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        search: z.string().optional().describe("Search text; defaults to all subscribers"),
        subscriptionListId: z.number().int().positive().optional().describe("Restrict to a subscription list (integer ID from list_subscription_lists)"),
        dynamicListId: z.string().optional().describe("Restrict to a dynamic list (UUID from list_dynamic_lists)"),
        orderBy: z.string().optional().describe("Sort field (default created_at)"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
        page: z.number().int().min(1).optional().describe("Page number (default 1)"),
        items: z.number().int().min(1).max(200).optional().describe("Items per page (default 50, capped at 200 here to keep output readable)"),
        withStats: z.boolean().optional().describe("Include per-subscriber delivery statistics"),
      },
      async ({ apiKey: paramKey, search, subscriptionListId, dynamicListId, orderBy, order, page, items, withStats }: {
        apiKey?: string;
        search?: string;
        subscriptionListId?: number;
        dynamicListId?: string;
        orderBy?: string;
        order?: "asc" | "desc";
        page?: number;
        items?: number;
        withStats?: boolean;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.listSubscribers({
            search, subscriptionListId, dynamicListId, orderBy, order, page, items, withStats,
          }))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("list subscribers", error) }] }
        }
      }
    )

    server.tool(
      "get_subscriber",
      "Retrieve one Paubox Email Marketing subscriber by UUID, including custom field values and the subscription lists they belong to.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        subscriberId: z.string().min(1, "Subscriber ID is required").describe("Subscriber UUID"),
        subscriptionListId: z.number().int().positive().optional().describe("Report subscribed/unsubscribed relative to this subscription list"),
        dynamicListId: z.string().optional().describe("Report subscribed/unsubscribed relative to this dynamic list (UUID)"),
        withStats: z.boolean().optional().describe("Include this subscriber's delivery statistics"),
      },
      async ({ apiKey: paramKey, subscriberId, subscriptionListId, dynamicListId, withStats }: {
        apiKey?: string;
        subscriberId: string;
        subscriptionListId?: number;
        dynamicListId?: string;
        withStats?: boolean;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.getSubscriber(subscriberId, { subscriptionListId, dynamicListId, withStats }))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("get subscriber", error) }] }
        }
      }
    )

    server.tool(
      "create_subscriber",
      "Add a subscriber to Paubox Email Marketing. Requires an email or a phone number. The subscriber always joins the default \"All contacts\" list, plus subscriptionListId when given. An existing subscriber with the same email or phone is updated rather than duplicated. Custom field names that do not exist yet are created automatically.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        email: z.string().optional().describe("Subscriber email address"),
        phoneNumber: z.string().optional().describe("Subscriber phone number (normalized to E.164)"),
        firstName: z.string().optional().describe("First name"),
        lastName: z.string().optional().describe("Last name"),
        customFields: z.array(z.object({
          name: z.string().describe("Custom field name"),
          value: z.unknown().describe("Custom field value"),
        })).optional().describe("Custom field name/value pairs"),
        subscriptionListId: z.number().int().positive().optional().describe("Additional subscription list to subscribe them to"),
      },
      async ({ apiKey: paramKey, email, phoneNumber, firstName, lastName, customFields, subscriptionListId }: {
        apiKey?: string;
        email?: string;
        phoneNumber?: string;
        firstName?: string;
        lastName?: string;
        customFields?: Array<{ name: string; value: unknown }>;
        subscriptionListId?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.createSubscriber(
            { email, phoneNumber, firstName, lastName, customFields },
            subscriptionListId,
          ))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("create subscriber", error) }] }
        }
      }
    )

    server.tool(
      "update_subscriber",
      "Update an existing Paubox Email Marketing subscriber by UUID. Only the fields you provide are changed; omitted fields stay unchanged.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        subscriberId: z.string().min(1, "Subscriber ID is required").describe("Subscriber UUID"),
        email: z.string().optional().describe("New email address"),
        phoneNumber: z.string().optional().describe("New phone number (normalized to E.164)"),
        firstName: z.string().optional().describe("New first name"),
        lastName: z.string().optional().describe("New last name"),
        customFields: z.array(z.object({
          name: z.string().describe("Custom field name"),
          value: z.unknown().describe("Custom field value"),
        })).optional().describe("Custom field name/value pairs to set"),
        subscriptionListId: z.number().int().positive().optional().describe("Subscription list to also subscribe them to"),
      },
      async ({ apiKey: paramKey, subscriberId, email, phoneNumber, firstName, lastName, customFields, subscriptionListId }: {
        apiKey?: string;
        subscriberId: string;
        email?: string;
        phoneNumber?: string;
        firstName?: string;
        lastName?: string;
        customFields?: Array<{ name: string; value: unknown }>;
        subscriptionListId?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.updateSubscriber(
            subscriberId,
            { email, phoneNumber, firstName, lastName, customFields },
            subscriptionListId,
          ))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("update subscriber", error) }] }
        }
      }
    )

    server.tool(
      "get_subscribed_count",
      "Get the number of currently subscribed (not unsubscribed, not deleted) contacts on a Paubox Email Marketing subscription list. Defaults to the \"All contacts\" list.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        subscriptionListId: z.number().int().positive().optional().describe("Subscription list ID (defaults to the account's default list)"),
      },
      async ({ apiKey: paramKey, subscriptionListId }: { apiKey?: string; subscriptionListId?: number }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.getSubscribedCount(subscriptionListId))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("get subscribed count", error) }] }
        }
      }
    )

    server.tool(
      "list_marketing_lists",
      "List all Paubox Email Marketing audiences — both static subscription lists and filter-based dynamic lists — in one view, with subscriber counts. Use list_subscription_lists or list_dynamic_lists when you need one kind specifically.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        search: z.string().optional().describe("Search text matched against list names"),
        orderBy: z.string().optional().describe("Sort field: name, created_at, updated_at, or subscriber_count (default name)"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)"),
        page: z.number().int().min(1).optional().describe("Page number (enables pagination)"),
        items: z.number().int().min(1).max(200).optional().describe("Items per page (enables pagination)"),
      },
      async ({ apiKey: paramKey, search, orderBy, order, page, items }: {
        apiKey?: string;
        search?: string;
        orderBy?: string;
        order?: "asc" | "desc";
        page?: number;
        items?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.listLists({ search, orderBy, order, page, items }))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("list marketing lists", error) }] }
        }
      }
    )

    server.tool(
      "list_subscription_lists",
      "List Paubox Email Marketing subscription lists (static audiences) with their integer IDs, subscriber counts, and which one is the default \"All contacts\" list. The IDs returned here are what subscriptionListId expects elsewhere.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        orderBy: z.string().optional().describe("Sort field (default name)"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)"),
        page: z.number().int().min(1).optional().describe("Page number (enables pagination)"),
        items: z.number().int().min(1).max(200).optional().describe("Items per page (enables pagination)"),
      },
      async ({ apiKey: paramKey, orderBy, order, page, items }: {
        apiKey?: string;
        orderBy?: string;
        order?: "asc" | "desc";
        page?: number;
        items?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.listSubscriptionLists({ orderBy, order, page, items }))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("list subscription lists", error) }] }
        }
      }
    )

    server.tool(
      "create_subscription_list",
      "Create a new (empty) Paubox Email Marketing subscription list. Returns the list's integer ID for use with create_subscriber and list_subscribers.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        name: z.string().min(1, "Name is required").describe("Name for the new subscription list"),
      },
      async ({ apiKey: paramKey, name }: { apiKey?: string; name: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.createSubscriptionList(name))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("create subscription list", error) }] }
        }
      }
    )

    server.tool(
      "list_dynamic_lists",
      "List Paubox Email Marketing dynamic lists — filter-based segments that recompute their membership — with their UUIDs, filter definitions, and subscriber counts.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        orderBy: z.string().optional().describe("Sort field (default name)"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)"),
        page: z.number().int().min(1).optional().describe("Page number (enables pagination)"),
        items: z.number().int().min(1).max(200).optional().describe("Items per page (enables pagination)"),
      },
      async ({ apiKey: paramKey, orderBy, order, page, items }: {
        apiKey?: string;
        orderBy?: string;
        order?: "asc" | "desc";
        page?: number;
        items?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.listDynamicLists({ orderBy, order, page, items }))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("list dynamic lists", error) }] }
        }
      }
    )

    server.tool(
      "list_subscriber_custom_fields",
      "List the custom subscriber field types defined for this Paubox Email Marketing account. Use this to discover which custom field names create_subscriber and update_subscriber can set.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
      },
      async ({ apiKey: paramKey }: { apiKey?: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.listCustomFieldTypes())
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("list subscriber custom fields", error) }] }
        }
      }
    )

    server.tool(
      "list_campaign_sends",
      "List Paubox Email Marketing campaign sends (each time a marketing email went out to a list), with per-send counts for delivered, viewed, clicked, bounced, and unsubscribed.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        search: z.string().optional().describe("Search text matched against the send"),
        orderBy: z.string().optional().describe("Sort field (default created_at)"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
        page: z.number().int().min(1).optional().describe("Page number (default 1)"),
        items: z.number().int().min(1).max(200).optional().describe("Items per page"),
      },
      async ({ apiKey: paramKey, search, orderBy, order, page, items }: {
        apiKey?: string;
        search?: string;
        orderBy?: string;
        order?: "asc" | "desc";
        page?: number;
        items?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.listCampaignSends({ search, orderBy, order, page, items }))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("list campaign sends", error) }] }
        }
      }
    )

    server.tool(
      "list_campaign_deliveries",
      "List individual Paubox Email Marketing deliveries — one row per recipient per campaign — showing what happened to each message. Scope with campaignMailingId or campaignMailingSendId.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        campaignMailingId: z.number().int().positive().optional().describe("Restrict to one campaign mailing (integer ID)"),
        campaignMailingSendId: z.number().int().positive().optional().describe("Restrict to one send of a campaign mailing (integer ID from list_campaign_sends)"),
        search: z.string().optional().describe("Search text"),
        orderBy: z.string().optional().describe("Sort field (default created_at)"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
        page: z.number().int().min(1).optional().describe("Page number (default 1)"),
        items: z.number().int().min(1).max(200).optional().describe("Items per page"),
      },
      async ({ apiKey: paramKey, campaignMailingId, campaignMailingSendId, search, orderBy, order, page, items }: {
        apiKey?: string;
        campaignMailingId?: number;
        campaignMailingSendId?: number;
        search?: string;
        orderBy?: string;
        order?: "asc" | "desc";
        page?: number;
        items?: number;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.listCampaignDeliveries({
            campaignMailingId, campaignMailingSendId, search, orderBy, order, page, items,
          }))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("list campaign deliveries", error) }] }
        }
      }
    )

    server.tool(
      "get_campaign_analytics",
      "Run a Paubox Email Marketing analytics report. Reports: campaign_mailing_sends_table (per-send performance rows), campaign_mailing_send_totals (aggregate totals, optionally bucketed by date), campaign_mailing_deliveries_table (per-recipient detail for one campaign or send), subscribers_by_tracking_link (who clicked a link), tracking_links_by_unique_link (click counts per link).",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        report: z.enum(ANALYTICS_REPORTS).describe("Which analytics report to run"),
        campaignMailingId: z.number().int().positive().optional().describe("Scope to one campaign mailing (integer ID)"),
        campaignMailingSendId: z.number().int().positive().optional().describe("Scope to one campaign send (integer ID)"),
        dripCampaignId: z.number().int().positive().optional().describe("Scope to one drip campaign (integer ID)"),
        trackingLinkId: z.number().int().positive().optional().describe("Scope to one tracking link (integer ID)"),
        emailType: z.string().optional().describe("Filter by email type"),
        search: z.string().optional().describe("Search text"),
        orderBy: z.string().optional().describe("Sort field, e.g. marketing_email_id, sent_at, subscription_list_name"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)"),
        byDate: z.boolean().optional().describe("For campaign_mailing_send_totals: bucket by date"),
        startDate: z.string().optional().describe("Start of the date range (parseable timestamp); pair with endDate"),
        endDate: z.string().optional().describe("End of the date range (parseable timestamp); pair with startDate"),
        dateOffset: z.number().int().optional().describe("For campaign_mailing_send_totals with byDate: look back this many days instead of giving startDate/endDate"),
        withStats: z.boolean().optional().describe("Include summed delivery statistics columns"),
      },
      async ({ apiKey: paramKey, report, ...params }: {
        apiKey?: string;
        report: AnalyticsReport;
        campaignMailingId?: number;
        campaignMailingSendId?: number;
        dripCampaignId?: number;
        trackingLinkId?: number;
        emailType?: string;
        search?: string;
        orderBy?: string;
        order?: "asc" | "desc";
        byDate?: boolean;
        startDate?: string;
        endDate?: string;
        dateOffset?: number;
        withStats?: boolean;
      }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.getAnalytics(report, params))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("get campaign analytics", error) }] }
        }
      }
    )

    server.tool(
      "get_marketing_bulk_job",
      "Check the progress of an asynchronous Paubox Email Marketing bulk job. Bulk subscriber imports and CSV exports return a job ID (jid/bid) instead of a result; pass it here to see total, pending, and failed counts.",
      {
        apiKey: z.string().optional().describe("Paubox API key (same key as the email tools)"),
        bulkJobId: z.string().min(1, "Bulk job ID is required").describe("The bid/jid returned by a bulk operation"),
      },
      async ({ apiKey: paramKey, bulkJobId }: { apiKey?: string; bulkJobId: string }) => {
        try {
          const { apiKey } = resolveCredentials({ apiKey: paramKey })
          if (!apiKey) {
            return { content: [{ type: "text", text: MISSING_MARKETING_API_KEY_ERROR }] }
          }
          const client = createMarketingClient({ apiKey })
          return jsonText(await client.getBulkJob(bulkJobId))
        } catch (error) {
          return { content: [{ type: "text", text: marketingFailureText("get marketing bulk job", error) }] }
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
  | { kind: 'unauthenticated' }

async function extractCredentials(req: Request): Promise<ExtractedCredentials> {
  // Priority 1: x-paubox-api-key custom header (Claude Connector header
  // path). Legacy clients may still send x-paubox-api-user — it is
  // ignored; the API key alone authenticates.
  const headerKey = req.headers.get('x-paubox-api-key') ?? undefined
  if (headerKey) {
    return { kind: 'ok', creds: { apiKey: headerKey } }
  }

  // Priority 2: Bearer token (OAuth flow). RFC 7235 §2.1 requires the
  // scheme name be matched case-insensitively. Older tokens may still
  // carry an apiUser claim — only apiKey is read.
  const authHeader = req.headers.get('authorization')
  const bearerMatch = authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader) : null
  if (bearerMatch) {
    try {
      const payload = await verifyAccessToken(bearerMatch[1])
      return { kind: 'ok', creds: { apiKey: payload.apiKey } }
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
  if (process.env.NODE_ENV !== 'production' && process.env.PAUBOX_API_KEY) {
    return {
      kind: 'ok',
      creds: {
        apiKey: process.env.PAUBOX_API_KEY,
      },
    }
  }

  // No auth attempted. Return unauthenticated so the route handler can
  // send a 401 with WWW-Authenticate pointing at our OAuth discovery
  // metadata. This is required for Claude.ai to trigger the OAuth flow
  // rather than treating the server as credential-free.
  return { kind: 'unauthenticated' }
}

function unauthenticatedResponse(req: Request): Response {
  const origin = new URL(req.url).origin
  return new Response(
    JSON.stringify({ error: 'unauthorized', error_description: 'Authentication required.' }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="Paubox MCP", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    }
  )
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
  if (result.kind === 'unauthenticated') return unauthenticatedResponse(req)
  if (result.kind === 'invalid_token') return invalidTokenResponse(result.description)
  return credentialsStorage.run(result.creds, () => mcpHandler(normalizeToMcp(req)))
}

export async function POST(req: Request) {
  const result = await extractCredentials(req)
  logRequest('POST', req, result)
  if (result.kind === 'unauthenticated') return unauthenticatedResponse(req)
  if (result.kind === 'invalid_token') return invalidTokenResponse(result.description)
  return credentialsStorage.run(result.creds, () => mcpHandler(normalizeToMcp(req)))
}
