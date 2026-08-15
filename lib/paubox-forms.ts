import axios, { AxiosRequestConfig } from 'axios'

// All Forms API requests are served under /v1/forms; the bare /forms prefix
// is not routed and dies at the gateway with an HTML 404.
export const FORMS_BASE_URL = 'https://api.paubox.com/v1/forms'

// Minimal shape we need from the HTTP client — `axios.request` satisfies it.
// Exposed so unit tests can inject a fake without depending on jest's
// module-mock system (same pattern as lib/paubox-credentials.ts).
export type HttpRequest = (
  config: AxiosRequestConfig,
) => Promise<{ status: number; data: unknown }>

export class PauboxFormsError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'PauboxFormsError'
    this.status = status
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Validate caller-supplied identifiers before they hit a URL path. Rejects
// empty/`.`/`..` and non-UUID shapes so `?`/`#`/`/`/`..` in caller input
// can't splice the request to a different endpoint on the same host.
// Callers still URL-encode the survivor at the interpolation site. Throws
// PauboxFormsError so callers can map it into a user-facing "Failed to X"
// message the same way as HTTP errors.
export function validateFormId(raw: string, field = 'formId'): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new PauboxFormsError(`${field} is required.`)
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new PauboxFormsError(`${field} must be a UUID.`)
  }
  if (!UUID_RE.test(trimmed)) {
    throw new PauboxFormsError(`${field} must be a UUID.`)
  }
  return trimmed
}

export type Form = {
  id: string
  title: string
  description?: string | null
  form_html?: string | null
  form_json?: unknown
  form_css?: string | null
  vanity_url?: string | null
  version?: number
  active?: boolean
  customer_id?: number
  old_form_id?: string | null
  created_at?: string
  updated_at?: string
  recipient?: string | null
  signable?: boolean
  signature_confirmation_label?: string | null
  submission_count?: number
  type?: string | null
  subscription_list_id?: string | null
  deleted?: boolean
  archived?: boolean
}

export type PageInfo = {
  count: number
  pages: number
  page: number
  items: number
}

export type ListFormsResponse = {
  results: Form[]
  page_info: PageInfo
}

export type ListFormsParams = {
  customerId: number
  formId?: string
  search?: string
  order?: 'asc' | 'desc'
  orderBy?: 'title' | 'updated_at' | 'submission_count'
  archived?: boolean
  active?: boolean
  page?: number
  items?: number
}

export type CreateFormParams = {
  title: string
  formJson: unknown
  customerId: number
  version?: number
  description?: string
  formHtml?: string
  formCss?: string
  recipient?: string
  signable?: boolean
  signatureConfirmationLabel?: string
  subscriptionListId?: string
  type?: string
  active?: boolean
}

export type UpdateFormParams = {
  title?: string
  description?: string
  formJson?: unknown
  vanityUrl?: string
  recipient?: string
  active?: boolean
  subscriptionListId?: string
}

export type FormStats = {
  active_form_count: number
  total_submission_count: number
  submissions_last_7_days: number
}

export type FormSubmission = {
  id: string
  form_id: string
  form_data: string
  storage_type?: string
  storage_url?: string | null
  submitter_email?: string | null
  recipients?: string | null
  attachment_name?: string | null
  attachment_url?: string | null
  attachment_type?: string | null
  created_at?: string
}

export type ListSubmissionsResponse = {
  data: FormSubmission[]
  total: number
  page: number
  items: number
}

export type ListSubmissionsParams = {
  submissionId?: string
  orderBy?: 'submitter_email'
  order?: 'asc' | 'desc'
  page?: number
  items?: number
}

export type FormsClientOptions = {
  apiKey: string
  baseUrl?: string
  http?: HttpRequest
}

// Clients sometimes pass the form schema as a JSON-encoded string; the Paubox
// renderer expects an object, so normalize before writing.
export function normalizeFormJson(value: unknown): Record<string, unknown> {
  let result = value
  for (let i = 0; i < 3 && typeof result === 'string'; i++) {
    try {
      result = JSON.parse(result)
    } catch {
      throw new Error('formJson must be a JSON object; received a string that is not valid JSON.')
    }
  }
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error(
      'formJson must be a JSON object (e.g. {"fields": [...]}), not a string, array, or primitive.',
    )
  }
  return result as Record<string, unknown>
}

// Shared error mapping for the authenticated forms endpoints. The backend
// accepts any API key carrying the "forms" scope as a bearer token, so a
// 401 always means the key itself is bad or under-scoped.
function mapErrorResponse(status: number, data: unknown, notFoundMessage: string): PauboxFormsError {
  if (status === 401) {
    return new PauboxFormsError(
      'Your API key is invalid or lacks the "forms" scope. Scoped API keys are managed in the Paubox admin dashboard.',
      401,
    )
  }
  if (status === 403) {
    return new PauboxFormsError(
      "Your API key's customer does not have access to that form or customer.",
      403,
    )
  }
  if (status === 404) {
    return new PauboxFormsError(notFoundMessage, 404)
  }
  let detail = ''
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>
    const message = body.detail ?? body.error ?? body.message
    if (typeof message === 'string') detail = message
  } else if (typeof data === 'string' && data.trim().length > 0) {
    detail = data.slice(0, 300)
  }
  return new PauboxFormsError(
    `Paubox Forms API error (HTTP ${status})${detail ? `: ${detail}` : ''}`,
    status,
  )
}

export function createFormsClient({
  apiKey,
  baseUrl = FORMS_BASE_URL,
  http = axios.request,
}: FormsClientOptions) {
  async function request<T>(
    config: AxiosRequestConfig,
    notFoundMessage = 'Form not found.',
  ): Promise<T> {
    const res = await http({
      ...config,
      url: `${baseUrl}${config.url}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(config.headers ?? {}),
      },
      timeout: 15000,
      // Don't throw on 4xx — we map statuses to actionable messages.
      validateStatus: () => true,
    })
    if (res.status < 200 || res.status >= 300) {
      throw mapErrorResponse(res.status, res.data, notFoundMessage)
    }
    return res.data as T
  }

  return {
    async listForms(params: ListFormsParams): Promise<ListFormsResponse> {
      const query: Record<string, string | number | boolean> = {
        customer_id: params.customerId,
      }
      if (params.formId !== undefined) query.form_id = params.formId
      if (params.search !== undefined) query.search = params.search
      if (params.order !== undefined) query.order = params.order
      if (params.orderBy !== undefined) query.order_by = params.orderBy
      if (params.archived !== undefined) query.archived = params.archived
      if (params.active !== undefined) query.active = params.active
      if (params.page !== undefined) query.page = params.page
      if (params.items !== undefined) query.items = params.items
      return request<ListFormsResponse>({ method: 'get', url: '/api/forms', params: query })
    },

    async createForm(params: CreateFormParams): Promise<{ id: string }> {
      const body: Record<string, unknown> = {
        title: params.title,
        form_json: normalizeFormJson(params.formJson),
        customer_id: params.customerId,
        version: params.version ?? 1,
      }
      if (params.description !== undefined) body.description = params.description
      if (params.formHtml !== undefined) body.form_html = params.formHtml
      if (params.formCss !== undefined) body.form_css = params.formCss
      if (params.recipient !== undefined) body.recipient = params.recipient
      if (params.signable !== undefined) body.signable = params.signable
      if (params.signatureConfirmationLabel !== undefined) {
        body.signature_confirmation_label = params.signatureConfirmationLabel
      }
      if (params.subscriptionListId !== undefined) {
        body.subscription_list_id = params.subscriptionListId
      }
      if (params.type !== undefined) body.type = params.type
      if (params.active !== undefined) body.active = params.active
      return request<{ id: string }>({ method: 'post', url: '/api/forms', data: body })
    },

    async getForm(formId: string): Promise<Form> {
      const response = await request<{ data: Form }>({
        method: 'get',
        url: `/api/forms/${encodeURIComponent(formId)}`,
      })
      return response.data
    },

    async updateForm(
      formId: string,
      updates: UpdateFormParams,
    ): Promise<{ detail: string; form_id: string }> {
      const body: Record<string, unknown> = {}
      if (updates.title !== undefined) body.title = updates.title
      if (updates.description !== undefined) body.description = updates.description
      if (updates.formJson !== undefined) body.form_json = normalizeFormJson(updates.formJson)
      if (updates.vanityUrl !== undefined) body.vanity_url = updates.vanityUrl
      if (updates.recipient !== undefined) body.recipient = updates.recipient
      if (updates.active !== undefined) body.active = updates.active
      if (updates.subscriptionListId !== undefined) {
        body.subscription_list_id = updates.subscriptionListId
      }
      return request<{ detail: string; form_id: string }>({
        method: 'put',
        url: `/api/forms/${encodeURIComponent(formId)}`,
        data: body,
      })
    },

    async archiveForm(formId: string): Promise<{ detail: string }> {
      return request<{ detail: string }>({
        method: 'post',
        url: `/api/forms/${encodeURIComponent(formId)}/archive`,
      })
    },

    async unarchiveForm(formId: string): Promise<{ detail: string }> {
      return request<{ detail: string }>({
        method: 'post',
        url: `/api/forms/${encodeURIComponent(formId)}/unarchive`,
      })
    },

    async copyForm(formId: string, title: string): Promise<Form> {
      return request<Form>({
        method: 'post',
        url: '/api/forms/copy',
        data: { form_id: formId, title },
      })
    },

    async getFormStats(customerId?: number): Promise<FormStats> {
      return request<FormStats>({
        method: 'get',
        url: '/api/forms/stats',
        params: customerId !== undefined ? { customer_id: customerId } : {},
      })
    },

    async listSubmissions(
      formId: string,
      params: ListSubmissionsParams = {},
    ): Promise<ListSubmissionsResponse> {
      const query: Record<string, string | number> = {}
      if (params.submissionId !== undefined) query.submission_id = params.submissionId
      if (params.orderBy !== undefined) query.order_by = params.orderBy
      if (params.order !== undefined) query.order = params.order
      if (params.page !== undefined) query.page = params.page
      if (params.items !== undefined) query.items = params.items
      return request<ListSubmissionsResponse>(
        {
          method: 'get',
          url: `/api/forms/${encodeURIComponent(formId)}/submissions`,
          params: query,
        },
        'Form or submission not found.',
      )
    },

    async exportSubmissionsCsv(formId: string, submissionId?: string): Promise<string> {
      const path = submissionId
        ? `/api/forms/${encodeURIComponent(formId)}/submissions/submission-csv/${encodeURIComponent(submissionId)}`
        : `/api/forms/${encodeURIComponent(formId)}/submissions/submission-csv`
      const data = await request<unknown>(
        { method: 'get', url: path, responseType: 'text', transformResponse: (d) => d },
        'Form or submission not found.',
      )
      return typeof data === 'string' ? data : JSON.stringify(data)
    },

    async exportSubmissionPdf(formId: string, submissionId: string): Promise<Buffer> {
      const data = await request<unknown>(
        {
          method: 'get',
          url:
            `/api/forms/${encodeURIComponent(formId)}/submissions/` +
            `${encodeURIComponent(submissionId)}/submission-pdf`,
          responseType: 'arraybuffer',
        },
        'Form or submission not found.',
      )
      if (Buffer.isBuffer(data)) return data
      if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data))
      if (ArrayBuffer.isView(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      }
      return Buffer.from(String(data))
    },
  }
}

export type PauboxFormsClient = ReturnType<typeof createFormsClient>
