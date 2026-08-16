// Unit tests for lib/paubox-marketing.ts. We inject a fake HttpRequest rather
// than mocking the axios module so behavior is deterministic and independent
// of jest's ESM-mode module-mock quirks (same pattern as
// __tests__/paubox-forms.test.ts).

import {
  ANALYTICS_REPORTS,
  createMarketingClient,
  flattenDocument,
  flattenResource,
  HttpRequest,
  MARKETING_BASE_URL,
  PauboxMarketingError,
  validateBulkJobId,
  validateIntegerId,
  validateMarketingUuid,
} from '../lib/paubox-marketing'

type HttpConfig = Parameters<HttpRequest>[0]

const UUID = '11111111-2222-4333-8444-555555555555'

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

function client(fn: HttpRequest, apiKey = 'pk_marketing_test') {
  return createMarketingClient({ apiKey, http: fn })
}

async function captureError(promise: Promise<unknown>): Promise<PauboxMarketingError> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject')
    },
    (e) => e,
  )
  expect(error).toBeInstanceOf(PauboxMarketingError)
  return error as PauboxMarketingError
}

describe('MARKETING_BASE_URL', () => {
  // The gateway is only routed under /v1; a bare /marketing base returns the
  // gateway's HTML 404 instead of reaching Rails.
  it('targets the username-less /v1/marketing gateway', () => {
    expect(MARKETING_BASE_URL).toBe('https://api.paubox.com/v1/marketing')
  })
})

describe('identifier validation', () => {
  it('accepts a well-formed UUID and trims it', () => {
    expect(validateMarketingUuid(`  ${UUID}  `, 'subscriberId')).toBe(UUID)
  })

  it.each([
    ['', /required/i],
    ['   ', /required/i],
    ['..', /must be a UUID/i],
    ['not-a-uuid', /must be a UUID/i],
    [`${UUID}/../current_customer`, /must be a UUID/i],
    [`${UUID}?x=1`, /must be a UUID/i],
    [`${UUID}#frag`, /must be a UUID/i],
  ])('rejects %p so it cannot splice the request path', (raw, pattern) => {
    expect(() => validateMarketingUuid(raw, 'subscriberId')).toThrow(pattern)
  })

  it('names the offending field in the error', () => {
    expect(() => validateMarketingUuid('nope', 'dynamicListId')).toThrow(/dynamicListId/)
  })

  it('accepts Sidekiq-style bulk job ids but rejects path separators', () => {
    expect(validateBulkJobId('abc123_XY-Z')).toBe('abc123_XY-Z')
    expect(() => validateBulkJobId('../../secrets')).toThrow(/letters, numbers/i)
    expect(() => validateBulkJobId('')).toThrow(/required/i)
  })

  it('accepts positive integer ids and rejects everything else', () => {
    expect(validateIntegerId(42, 'subscriptionListId')).toBe('42')
    expect(validateIntegerId(' 7 ', 'subscriptionListId')).toBe('7')
    expect(() => validateIntegerId(0, 'subscriptionListId')).toThrow(/positive integer/i)
    expect(() => validateIntegerId(-1, 'subscriptionListId')).toThrow(/positive integer/i)
    expect(() => validateIntegerId(1.5, 'subscriptionListId')).toThrow(/positive integer/i)
    expect(() => validateIntegerId('3; DROP', 'subscriptionListId')).toThrow(/positive integer/i)
  })
})

describe('fast_jsonapi flattening', () => {
  it('collapses a resource into id + attributes', () => {
    expect(
      flattenResource({ id: UUID, type: 'subscriber', attributes: { email: 'a@b.com' } }),
    ).toEqual({ id: UUID, email: 'a@b.com' })
  })

  it('leaves non-resource shapes untouched', () => {
    expect(flattenResource({ total: 3 })).toEqual({ total: 3 })
    expect(flattenResource('plain')).toBe('plain')
    expect(flattenResource(null)).toBe(null)
  })

  it('flattens a collection document and preserves sibling metadata', () => {
    const payload = {
      data: [
        { id: '1', type: 'subscriber', attributes: { email: 'a@b.com' } },
        { id: '2', type: 'subscriber', attributes: { email: 'c@d.com' } },
      ],
      total_count: 2,
      page_info: { page: 1 },
    }
    expect(flattenDocument(payload)).toEqual({
      data: [
        { id: '1', email: 'a@b.com' },
        { id: '2', email: 'c@d.com' },
      ],
      total_count: 2,
      page_info: { page: 1 },
    })
  })

  it('flattens a single-resource document', () => {
    expect(
      flattenDocument({ data: { id: '9', type: 'subscription_list', attributes: { name: 'VIPs' } } }),
    ).toEqual({ data: { id: '9', name: 'VIPs' } })
  })

  it('drops null metadata so page_info: null does not clutter output', () => {
    expect(flattenDocument({ data: [], page_info: null, total_count: 0 })).toEqual({
      data: [],
      total_count: 0,
    })
  })

  it('passes through payloads that have no data key', () => {
    // Analytics and bulk_jobs render plain hashes rather than fast_jsonapi.
    expect(flattenDocument({ totals: { sent: 5 } })).toEqual({ totals: { sent: 5 } })
  })
})

describe('request construction', () => {
  it('sends the API key as a Bearer token against the marketing base URL', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn, 'secret-key').getCurrentCustomer()
    expect(calls[0].url).toBe(`${MARKETING_BASE_URL}/current_customer`)
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer secret-key' })
  })

  it('maps camelCase params onto the snake_case query the Rails controller reads', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listSubscribers({
      search: 'jane',
      subscriptionListId: 12,
      orderBy: 'email',
      order: 'asc',
      page: 2,
      items: 25,
      withStats: true,
    })
    expect(calls[0].params).toEqual({
      search: 'jane',
      subscription_list_id: '12',
      order_by: 'email',
      order: 'asc',
      page: 2,
      items: 25,
      with_stats: true,
    })
  })

  it('omits params the caller did not supply', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listSubscribers({})
    expect(calls[0].params).toEqual({})
  })

  it('serializes structured subscriber filters to the JSON string Rails parses', async () => {
    const { fn, calls } = fakeHttp()
    const filters = [[{ field: 'email', op: 'contains', terms: ['@paubox.com'] }]]
    await client(fn).listSubscribers({ filters })
    expect(calls[0].params).toEqual({ filters: JSON.stringify(filters) })
  })

  it('passes an already-encoded filters string through unchanged', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listSubscribers({ filters: '[[{"field":"email"}]]' })
    expect(calls[0].params).toEqual({ filters: '[[{"field":"email"}]]' })
  })

  it('validates the dynamic list UUID before it reaches the query string', async () => {
    const { fn, calls } = fakeHttp()
    await expect(client(fn).listSubscribers({ dynamicListId: '../x' })).rejects.toThrow(
      /dynamicListId must be a UUID/,
    )
    expect(calls).toHaveLength(0)
  })

  it('URL-encodes the subscriber id into the path', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).getSubscriber(UUID)
    expect(calls[0].url).toBe(`${MARKETING_BASE_URL}/subscribers/${UUID}`)
  })

  it('sends with_stats as the literal string the serializer checks for', async () => {
    // SubscriberSerializer gates statistics on params[:with_stats] == "true",
    // so a boolean true would silently produce no statistics.
    const { fn, calls } = fakeHttp()
    await client(fn).getSubscriber(UUID, { withStats: true })
    expect(calls[0].params).toEqual({ with_stats: 'true' })
  })

  it('enables use_pagination when a page or items is requested', async () => {
    // The list endpoints ignore page/items unless use_pagination is set.
    const { fn, calls } = fakeHttp()
    await client(fn).listSubscriptionLists({ page: 3 })
    expect(calls[0].params).toMatchObject({ page: 3, use_pagination: true })

    const second = fakeHttp()
    await client(second.fn).listDynamicLists({ items: 10 })
    expect(second.calls[0].params).toMatchObject({ items: 10, use_pagination: true })
  })

  it('does not force pagination when neither page nor items is given', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).listLists({ search: 'vip' })
    expect(calls[0].params).toEqual({ search: 'vip' })
  })
})

describe('subscriber writes', () => {
  it('wraps fields in the subscriber envelope with snake_case keys', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).createSubscriber(
      {
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phoneNumber: '+15551234567',
        customFields: [{ name: 'Clinic', value: 'North' }],
      },
      12,
    )
    expect(calls[0].method).toBe('post')
    expect(calls[0].data).toEqual({
      subscriber: {
        email: 'jane@example.com',
        phone_number: '+15551234567',
        first_name: 'Jane',
        last_name: 'Doe',
        custom_fields: [{ name: 'Clinic', value: 'North' }],
      },
      subscription_list_id: '12',
    })
  })

  it('requires an email or phone number when creating', async () => {
    // SubscriberCreator#create_subscriber identifies the record by email or
    // parsed phone; without either it builds an unidentifiable Subscriber.
    const { fn, calls } = fakeHttp()
    await expect(client(fn).createSubscriber({ firstName: 'Jane' })).rejects.toThrow(
      /needs an email or a phoneNumber/i,
    )
    expect(calls).toHaveLength(0)
  })

  it('allows a partial update with neither email nor phone', async () => {
    // #update_subscriber assigns each field only `if ... present?`, so
    // changing just a name is a legitimate update.
    const { fn, calls } = fakeHttp()
    await client(fn).updateSubscriber(UUID, { firstName: 'Janet' })
    expect(calls[0].method).toBe('patch')
    expect(calls[0].data).toEqual({ subscriber: { first_name: 'Janet' } })
  })

  it('rejects an update that changes nothing', async () => {
    const { fn } = fakeHttp()
    await expect(client(fn).updateSubscriber(UUID, {})).rejects.toThrow(/at least one/i)
  })

  it('validates the subscriber id before sending an update', async () => {
    const { fn, calls } = fakeHttp()
    await expect(
      client(fn).updateSubscriber('../../current_customer', { firstName: 'X' }),
    ).rejects.toThrow(/subscriberId must be a UUID/)
    expect(calls).toHaveLength(0)
  })
})

describe('analytics', () => {
  it.each(ANALYTICS_REPORTS)('routes %s to its own path segment', async (report) => {
    const { fn, calls } = fakeHttp()
    await client(fn).getAnalytics(report)
    expect(calls[0].url).toBe(`${MARKETING_BASE_URL}/analytics/${report}`)
  })

  it('rejects an unknown report instead of triggering a server-side KeyError', async () => {
    // EmailMarketingAnalyticsService.request_types.fetch raises on an unknown
    // key, which surfaces as an opaque 500.
    const { fn, calls } = fakeHttp()
    await expect(
      client(fn).getAnalytics('totals' as (typeof ANALYTICS_REPORTS)[number]),
    ).rejects.toThrow(/Unknown analytics report/)
    expect(calls).toHaveLength(0)
  })

  it('maps date-range and scoping params to snake_case', async () => {
    const { fn, calls } = fakeHttp()
    await client(fn).getAnalytics('campaign_mailing_send_totals', {
      byDate: true,
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      dripCampaignId: 4,
      withStats: true,
    })
    expect(calls[0].params).toEqual({
      by_date: true,
      start_date: '2026-01-01',
      end_date: '2026-02-01',
      drip_campaign_id: '4',
      with_stats: true,
    })
  })

  it('flattens the analytics document', async () => {
    const { fn } = fakeHttp(async () => ({
      status: 200,
      data: { data: [{ id: '1', type: 'send', attributes: { sent_count: 10 } }] },
    }))
    await expect(client(fn).getAnalytics('campaign_mailing_sends_table')).resolves.toEqual({
      data: [{ id: '1', sent_count: 10 }],
    })
  })
})

describe('error mapping', () => {
  it('maps 401 to a message naming the shared email API key', async () => {
    const { fn } = fakeHttp(async () => ({ status: 401, data: {} }))
    const error = await captureError(client(fn).listSubscribers())
    expect(error.status).toBe(401)
    expect(error.message).toMatch(/same API key as the email tools/i)
  })

  it('maps 403 to a customer-access message', async () => {
    const { fn } = fakeHttp(async () => ({ status: 403, data: {} }))
    const error = await captureError(client(fn).listSubscribers())
    expect(error.status).toBe(403)
    expect(error.message).toMatch(/cannot access/i)
  })

  it('distinguishes an unprovisioned marketing account from a missing record', async () => {
    // ApplicationController renders 404 "Customer Not Found" when the API key
    // authenticates but no PauboxMarketingCustomer matches it — a
    // provisioning gap, which needs a different fix than a bad ID.
    const { fn } = fakeHttp(async () => ({
      status: 404,
      data: { errors: [{ message: '404 Customer Not Found' }] },
    }))
    const error = await captureError(client(fn).listSubscribers())
    expect(error.status).toBe(404)
    expect(error.message).toMatch(/does not have Email Marketing provisioned/i)
  })

  it('maps an ordinary 404 to the endpoint-specific not-found message', async () => {
    const { fn } = fakeHttp(async () => ({ status: 404, data: {} }))
    const error = await captureError(client(fn).getSubscriber(UUID))
    expect(error.message).toBe('Subscriber not found.')
  })

  it('surfaces the Rails error envelope on other statuses', async () => {
    const { fn } = fakeHttp(async () => ({
      status: 422,
      data: { errors: [{ message: 'Name has already been taken' }] },
    }))
    const error = await captureError(client(fn).createSubscriptionList('VIPs'))
    expect(error.status).toBe(422)
    expect(error.message).toMatch(/HTTP 422/)
    expect(error.message).toMatch(/Name has already been taken/)
  })

  it('surfaces ActiveModel validation hashes', async () => {
    const { fn } = fakeHttp(async () => ({
      status: 422,
      data: { errors: { email: ['is invalid'] } },
    }))
    const error = await captureError(
      client(fn).createSubscriber({ email: 'nope' }),
    )
    expect(error.message).toMatch(/email is invalid/)
  })

  it('truncates a long non-JSON error body', async () => {
    const { fn } = fakeHttp(async () => ({ status: 500, data: 'x'.repeat(1000) }))
    const error = await captureError(client(fn).listSubscribers())
    expect(error.message.length).toBeLessThan(400)
  })
})

describe('read-only surface', () => {
  it('exposes no destructive or sending operations', () => {
    // Campaign sending, scheduling, and bulk delete are intentionally left
    // out of this tranche — they mail or destroy whole lists.
    const methods = Object.keys(createMarketingClient({ apiKey: 'k', http: fakeHttp().fn }))
    for (const method of methods) {
      expect(method).not.toMatch(/^(send|schedule|delete|destroy|archive|unsubscribe)/i)
    }
  })

  it('only ever issues get, post, or patch requests', async () => {
    const { fn, calls } = fakeHttp()
    const c = client(fn)
    await c.getCurrentCustomer()
    await c.listSubscribers()
    await c.getSubscriber(UUID)
    await c.createSubscriber({ email: 'a@b.com' })
    await c.updateSubscriber(UUID, { firstName: 'A' })
    await c.getSubscribedCount()
    await c.listLists()
    await c.listSubscriptionLists()
    await c.createSubscriptionList('VIPs')
    await c.listDynamicLists()
    await c.listCustomFieldTypes()
    await c.listCampaignSends()
    await c.listCampaignDeliveries()
    await c.getAnalytics('campaign_mailing_sends_table')
    await c.getBulkJob('abc123')
    expect(calls).toHaveLength(15)
    for (const call of calls) {
      expect(['get', 'post', 'patch']).toContain(call.method)
    }
  })
})
