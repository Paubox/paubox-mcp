import axios, { AxiosRequestConfig } from 'axios'

// The Marketing API is served under /v1/marketing — the username-less gateway
// scope in paubox_marketing's config/routes.rb. It resolves the caller's
// customer from the email-API Bearer token (ApplicationController
// #token_authenticate_keyless), so it takes the same apiKey the email and
// forms tools already use. As with email and forms, the /v1 prefix is
// required: a bare /marketing base is unrouted and dies at the gateway with
// an HTML 404.
export const MARKETING_BASE_URL = 'https://api.paubox.com/v1/marketing'

// Minimal shape we need from the HTTP client — `axios.request` satisfies it.
// Exposed so unit tests can inject a fake without depending on jest's
// module-mock system (same pattern as lib/paubox-forms.ts).
export type HttpRequest = (
  config: AxiosRequestConfig,
) => Promise<{ status: number; data: unknown }>

export class PauboxMarketingError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'PauboxMarketingError'
    this.status = status
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Validate caller-supplied UUID identifiers before they hit a URL path.
// Rejects empty/`.`/`..` and non-UUID shapes so `?`/`#`/`/`/`..` in caller
// input can't splice the request to a different endpoint on the same host.
// Callers still URL-encode the survivor at the interpolation site.
export function validateMarketingUuid(raw: string, field: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new PauboxMarketingError(`${field} is required.`)
  }
  if (!UUID_RE.test(trimmed)) {
    throw new PauboxMarketingError(`${field} must be a UUID.`)
  }
  return trimmed
}

// Sidekiq batch IDs (bid) are URL-safe base64-ish tokens, not UUIDs, so they
// get a charset check rather than a UUID check. Same goal: keep path
// separators and query delimiters out of the interpolated path segment.
export function validateBulkJobId(raw: string, field = 'bulkJobId'): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new PauboxMarketingError(`${field} is required.`)
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) {
    throw new PauboxMarketingError(
      `${field} must contain only letters, numbers, hyphens, and underscores.`,
    )
  }
  return trimmed
}

// Subscription lists and campaign mailings key on integer ids, while
// subscribers, dynamic lists, and custom field types key on uuid. Integer ids
// still reach a URL path (subscribed_count, list scoping), so validate them
// rather than interpolating caller text directly.
export function validateIntegerId(raw: number | string, field: string): string {
  const value = typeof raw === 'number' ? raw : Number(raw.trim())
  if (!Number.isInteger(value) || value <= 0) {
    throw new PauboxMarketingError(`${field} must be a positive integer.`)
  }
  return String(value)
}

// The five report types registered in
// Analytics::EmailMarketingAnalyticsService.request_types. The controller
// derives the report from the last path segment, so a value outside this set
// raises a KeyError server-side and comes back as a 500 — hence the closed
// enum rather than a free-text path.
export const ANALYTICS_REPORTS = [
  'campaign_mailing_sends_table',
  'campaign_mailing_send_totals',
  'campaign_mailing_deliveries_table',
  'subscribers_by_tracking_link',
  'tracking_links_by_unique_link',
] as const

export type AnalyticsReport = (typeof ANALYTICS_REPORTS)[number]

// fast_jsonapi resource: { id, type, attributes: { ... } }.
export type JsonApiResource = {
  id?: string | number
  type?: string
  attributes?: Record<string, unknown>
}

// Collapse a fast_jsonapi resource into a flat object so the model sees
// `{ id, email, ... }` instead of a nested attributes envelope. Anything that
// isn't shaped like a resource passes through untouched — several marketing
// endpoints (brands, analytics) render plain ActiveRecord JSON instead.
export function flattenResource(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return entry
  }
  const record = entry as JsonApiResource
  if (typeof record.attributes !== 'object' || record.attributes === null) {
    return entry
  }
  return { id: record.id, ...record.attributes }
}

// Normalize a fast_jsonapi document ({ data: resource | resource[] }) into
// plain objects, preserving the sibling metadata keys the marketing
// controllers merge alongside `data` (total_count, page_info, search_after).
export function flattenDocument(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return payload
  const body = payload as Record<string, unknown>
  if (!('data' in body)) return payload
  const data = Array.isArray(body.data)
    ? body.data.map(flattenResource)
    : flattenResource(body.data)
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key !== 'data' && value !== undefined && value !== null) rest[key] = value
  }
  return { data, ...rest }
}

export type SubscriberData = {
  email?: string
  phoneNumber?: string
  firstName?: string
  lastName?: string
  customFields?: Array<{ name: string; value: unknown }>
}

export type ListSubscribersParams = {
  search?: string
  subscriptionListId?: number
  dynamicListId?: string
  orderBy?: string
  order?: 'asc' | 'desc'
  page?: number
  items?: number
  filters?: unknown
  withStats?: boolean
}

export type ListCollectionParams = {
  search?: string
  orderBy?: string
  order?: 'asc' | 'desc'
  page?: number
  items?: number
  usePagination?: boolean
}

export type AnalyticsParams = {
  campaignMailingId?: number
  campaignMailingSendId?: number
  dripCampaignId?: number
  emailType?: string
  trackingLinkId?: number
  search?: string
  orderBy?: string
  order?: 'asc' | 'desc'
  byDate?: boolean
  startDate?: string
  endDate?: string
  dateOffset?: number
  withStats?: boolean
}

export type MarketingClientOptions = {
  apiKey: string
  baseUrl?: string
  http?: HttpRequest
}

// The Rails error envelope is {"errors":[{"message":"404 Customer Not Found"}]}.
function extractErrorDetail(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim().length > 0 ? data.slice(0, 300) : ''
  }
  if (typeof data !== 'object' || data === null) return ''
  const body = data as Record<string, unknown>
  const errors = body.errors
  if (Array.isArray(errors)) {
    const parts = errors
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (typeof entry === 'object' && entry !== null) {
          const message = (entry as Record<string, unknown>).message
          if (typeof message === 'string') return message
        }
        return ''
      })
      .filter((part) => part.length > 0)
    if (parts.length > 0) return parts.join('; ')
  }
  if (errors && typeof errors === 'object') {
    // ActiveModel validation errors: { field: ["is invalid"] }
    const parts = Object.entries(errors as Record<string, unknown>).map(
      ([field, messages]) =>
        `${field} ${Array.isArray(messages) ? messages.join(', ') : String(messages)}`,
    )
    if (parts.length > 0) return parts.join('; ')
  }
  if (typeof errors === 'string') return errors
  const message = body.message ?? body.error ?? body.detail
  return typeof message === 'string' ? message : ''
}

// A 404 whose body says "Customer Not Found" means the API key authenticated
// fine but no PauboxMarketingCustomer exists for it — the account does not
// have the Marketing product provisioned. That is a different fix from "the
// subscriber you asked for is gone", so it gets its own message.
function isCustomerNotFound(detail: string): boolean {
  return /customer not found/i.test(detail)
}

function mapErrorResponse(
  status: number,
  data: unknown,
  notFoundMessage: string,
): PauboxMarketingError {
  const detail = extractErrorDetail(data)
  if (status === 401) {
    return new PauboxMarketingError(
      'Your Paubox API key was rejected by the Marketing API. Marketing tools authenticate with the same API key as the email tools.',
      401,
    )
  }
  if (status === 403) {
    return new PauboxMarketingError(
      "Access denied: your API key's customer cannot access that marketing resource.",
      403,
    )
  }
  if (status === 404) {
    if (isCustomerNotFound(detail)) {
      return new PauboxMarketingError(
        'This Paubox account does not have Email Marketing provisioned. The API key is valid, but no marketing customer is associated with it — contact Paubox to enable Marketing for this account.',
        404,
      )
    }
    return new PauboxMarketingError(notFoundMessage, 404)
  }
  return new PauboxMarketingError(
    `Paubox Marketing API error (HTTP ${status})${detail ? `: ${detail}` : ''}`,
    status,
  )
}

// `filters` reaches Rails as a JSON string that SubscribersController#decode_filters
// parses. Accept either a pre-encoded string or a structure we stringify.
function serializeFilters(filters: unknown): string {
  return typeof filters === 'string' ? filters : JSON.stringify(filters)
}

export function createMarketingClient({
  apiKey,
  baseUrl = MARKETING_BASE_URL,
  http = axios.request,
}: MarketingClientOptions) {
  async function request<T>(
    config: AxiosRequestConfig,
    notFoundMessage = 'Marketing resource not found.',
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
    // GET /current_customer — cheapest authenticated marketing call, so it
    // doubles as the "is Marketing provisioned for this key?" probe.
    async getCurrentCustomer(): Promise<unknown> {
      const data = await request<unknown>({ method: 'get', url: '/current_customer' })
      return flattenDocument(data)
    },

    async listSubscribers(params: ListSubscribersParams = {}): Promise<unknown> {
      const query: Record<string, string | number | boolean> = {}
      if (params.search !== undefined) query.search = params.search
      if (params.subscriptionListId !== undefined) {
        query.subscription_list_id = validateIntegerId(params.subscriptionListId, 'subscriptionListId')
      }
      if (params.dynamicListId !== undefined) {
        query.dynamic_list_id = validateMarketingUuid(params.dynamicListId, 'dynamicListId')
      }
      if (params.orderBy !== undefined) query.order_by = params.orderBy
      if (params.order !== undefined) query.order = params.order
      if (params.page !== undefined) query.page = params.page
      if (params.items !== undefined) query.items = params.items
      if (params.filters !== undefined) query.filters = serializeFilters(params.filters)
      if (params.withStats !== undefined) query.with_stats = params.withStats
      const data = await request<unknown>({ method: 'get', url: '/subscribers', params: query })
      return flattenDocument(data)
    },

    async getSubscriber(
      subscriberId: string,
      options: { subscriptionListId?: number; dynamicListId?: string; withStats?: boolean } = {},
    ): Promise<unknown> {
      const safeId = validateMarketingUuid(subscriberId, 'subscriberId')
      const query: Record<string, string | number | boolean> = {}
      if (options.subscriptionListId !== undefined) {
        query.subscription_list_id = validateIntegerId(options.subscriptionListId, 'subscriptionListId')
      }
      if (options.dynamicListId !== undefined) {
        query.dynamic_list_id = validateMarketingUuid(options.dynamicListId, 'dynamicListId')
      }
      // The serializer gates statistics on the literal string "true".
      if (options.withStats) query.with_stats = 'true'
      const data = await request<unknown>(
        { method: 'get', url: `/subscribers/${encodeURIComponent(safeId)}`, params: query },
        'Subscriber not found.',
      )
      return flattenDocument(data)
    },

    async createSubscriber(
      subscriber: SubscriberData,
      subscriptionListId?: number,
    ): Promise<unknown> {
      const body: Record<string, unknown> = { subscriber: toSubscriberPayload(subscriber, true) }
      if (subscriptionListId !== undefined) {
        body.subscription_list_id = validateIntegerId(subscriptionListId, 'subscriptionListId')
      }
      const data = await request<unknown>({ method: 'post', url: '/subscribers', data: body })
      return flattenDocument(data)
    },

    async updateSubscriber(
      subscriberId: string,
      subscriber: SubscriberData,
      subscriptionListId?: number,
    ): Promise<unknown> {
      const safeId = validateMarketingUuid(subscriberId, 'subscriberId')
      const body: Record<string, unknown> = { subscriber: toSubscriberPayload(subscriber, false) }
      if (subscriptionListId !== undefined) {
        body.subscription_list_id = validateIntegerId(subscriptionListId, 'subscriptionListId')
      }
      const data = await request<unknown>(
        { method: 'patch', url: `/subscribers/${encodeURIComponent(safeId)}`, data: body },
        'Subscriber not found.',
      )
      return flattenDocument(data)
    },

    async getSubscribedCount(subscriptionListId?: number): Promise<unknown> {
      const query: Record<string, string> = {}
      if (subscriptionListId !== undefined) {
        query.subscription_list_id = validateIntegerId(subscriptionListId, 'subscriptionListId')
      }
      return request<unknown>({
        method: 'get',
        url: '/subscribers/subscribed_count',
        params: query,
      })
    },

    // GET /lists — the unified view over subscription lists and dynamic lists.
    async listLists(params: ListCollectionParams = {}): Promise<unknown> {
      const data = await request<unknown>({
        method: 'get',
        url: '/lists',
        params: collectionQuery(params),
      })
      return flattenDocument(data)
    },

    async listSubscriptionLists(params: ListCollectionParams = {}): Promise<unknown> {
      const data = await request<unknown>({
        method: 'get',
        url: '/subscription_lists',
        params: collectionQuery(params),
      })
      return flattenDocument(data)
    },

    async createSubscriptionList(name: string): Promise<unknown> {
      const data = await request<unknown>({
        method: 'post',
        url: '/subscription_lists',
        data: { name },
      })
      return flattenDocument(data)
    },

    async listDynamicLists(params: ListCollectionParams = {}): Promise<unknown> {
      const data = await request<unknown>({
        method: 'get',
        url: '/dynamic_lists',
        params: collectionQuery(params),
      })
      return flattenDocument(data)
    },

    async listCustomFieldTypes(): Promise<unknown> {
      const data = await request<unknown>({
        method: 'get',
        url: '/subscriber_custom_field_types',
      })
      return flattenDocument(data)
    },

    async listCampaignSends(params: ListCollectionParams = {}): Promise<unknown> {
      const query: Record<string, string | number | boolean> = {}
      if (params.search !== undefined) query.search = params.search
      if (params.orderBy !== undefined) query.order_by = params.orderBy
      if (params.order !== undefined) query.order = params.order
      if (params.page !== undefined) query.page = params.page
      if (params.items !== undefined) query.items = params.items
      const data = await request<unknown>({
        method: 'get',
        url: '/campaign_mailing_sends',
        params: query,
      })
      return flattenDocument(data)
    },

    async listCampaignDeliveries(
      params: {
        campaignMailingId?: number
        campaignMailingSendId?: number
        search?: string
        orderBy?: string
        order?: 'asc' | 'desc'
        page?: number
        items?: number
      } = {},
    ): Promise<unknown> {
      const query: Record<string, string | number> = {}
      if (params.campaignMailingId !== undefined) {
        query.campaign_mailing_id = validateIntegerId(params.campaignMailingId, 'campaignMailingId')
      }
      if (params.campaignMailingSendId !== undefined) {
        query.campaign_mailing_send_id = validateIntegerId(
          params.campaignMailingSendId,
          'campaignMailingSendId',
        )
      }
      if (params.search !== undefined) query.search = params.search
      if (params.orderBy !== undefined) query.order_by = params.orderBy
      if (params.order !== undefined) query.order = params.order
      if (params.page !== undefined) query.page = params.page
      if (params.items !== undefined) query.items = params.items
      const data = await request<unknown>({
        method: 'get',
        url: '/campaign_mailing_deliveries',
        params: query,
      })
      return flattenDocument(data)
    },

    // GET /analytics/<report>. EmailMarketingAnalyticsController#index reads
    // the report name off the end of the path, so the segment carries the
    // routing — hence the closed ANALYTICS_REPORTS enum.
    async getAnalytics(report: AnalyticsReport, params: AnalyticsParams = {}): Promise<unknown> {
      if (!ANALYTICS_REPORTS.includes(report)) {
        throw new PauboxMarketingError(
          `Unknown analytics report "${report}". Valid reports: ${ANALYTICS_REPORTS.join(', ')}.`,
        )
      }
      const query: Record<string, string | number | boolean> = {}
      if (params.campaignMailingId !== undefined) {
        query.campaign_mailing_id = validateIntegerId(params.campaignMailingId, 'campaignMailingId')
      }
      if (params.campaignMailingSendId !== undefined) {
        query.campaign_mailing_send_id = validateIntegerId(
          params.campaignMailingSendId,
          'campaignMailingSendId',
        )
      }
      if (params.dripCampaignId !== undefined) {
        query.drip_campaign_id = validateIntegerId(params.dripCampaignId, 'dripCampaignId')
      }
      if (params.trackingLinkId !== undefined) {
        query.tracking_link_id = validateIntegerId(params.trackingLinkId, 'trackingLinkId')
      }
      if (params.emailType !== undefined) query.email_type = params.emailType
      if (params.search !== undefined) query.search = params.search
      if (params.orderBy !== undefined) query.order_by = params.orderBy
      if (params.order !== undefined) query.order = params.order
      if (params.byDate !== undefined) query.by_date = params.byDate
      if (params.startDate !== undefined) query.start_date = params.startDate
      if (params.endDate !== undefined) query.end_date = params.endDate
      if (params.dateOffset !== undefined) query.date_offset = params.dateOffset
      if (params.withStats !== undefined) query.with_stats = params.withStats
      const data = await request<unknown>({
        method: 'get',
        url: `/analytics/${report}`,
        params: query,
      })
      return flattenDocument(data)
    },

    // GET /bulk_jobs/:bid — poll the async jobs that bulk subscriber writes
    // and CSV exports return as a jid/bid instead of a result.
    async getBulkJob(bulkJobId: string): Promise<unknown> {
      const safeId = validateBulkJobId(bulkJobId)
      return request<unknown>(
        { method: 'get', url: `/bulk_jobs/${encodeURIComponent(safeId)}` },
        'Bulk job not found.',
      )
    },
  }
}

function collectionQuery(
  params: ListCollectionParams,
): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {}
  if (params.search !== undefined) query.search = params.search
  if (params.orderBy !== undefined) query.order_by = params.orderBy
  if (params.order !== undefined) query.order = params.order
  // These endpoints only paginate when use_pagination is set; asking for a
  // page without it silently returns the whole collection.
  if (params.page !== undefined) {
    query.page = params.page
    query.use_pagination = true
  }
  if (params.items !== undefined) {
    query.items = params.items
    query.use_pagination = true
  }
  if (params.usePagination !== undefined) query.use_pagination = params.usePagination
  return query
}

// SubscriberCreator reads snake_case keys off subscriber_data; custom fields
// are a [{name, value}] array keyed by custom field type name.
//
// `requireIdentifier` distinguishes the two server-side code paths.
// SubscriberCreator#create_subscriber matches an existing record by email or
// parsed phone and builds a new Subscriber when neither is given, so a create
// without one produces a record that cannot be identified.
// #update_subscriber assigns each field only `if ... present?`, so a partial
// update carrying just a name is legitimate.
function toSubscriberPayload(
  subscriber: SubscriberData,
  requireIdentifier: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (subscriber.email !== undefined) payload.email = subscriber.email
  if (subscriber.phoneNumber !== undefined) payload.phone_number = subscriber.phoneNumber
  if (subscriber.firstName !== undefined) payload.first_name = subscriber.firstName
  if (subscriber.lastName !== undefined) payload.last_name = subscriber.lastName
  if (subscriber.customFields !== undefined) payload.custom_fields = subscriber.customFields
  if (Object.keys(payload).length === 0) {
    throw new PauboxMarketingError(
      'Provide at least one subscriber field (email, phoneNumber, firstName, lastName, or customFields).',
    )
  }
  if (requireIdentifier && payload.email === undefined && payload.phone_number === undefined) {
    throw new PauboxMarketingError(
      'A new subscriber needs an email or a phoneNumber to be identified.',
    )
  }
  return payload
}

export type PauboxMarketingClient = ReturnType<typeof createMarketingClient>
