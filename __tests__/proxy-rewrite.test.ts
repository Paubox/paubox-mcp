// The proxy override has to reach every Paubox client, not just the email one.
// lib/paubox-email.ts sets a baseURL, but the forms and marketing clients — and
// the direct axios calls behind validate_credentials, get_form and submit_form —
// pass a fully-qualified url, which axios uses in preference to baseURL.
//
// PAUBOX_PROXY_CONFIG reads its env vars at module load, so lib/paubox-proxy is
// pulled in with a dynamic import after the vars are set rather than statically.

import axios from 'axios'

const CUSTOM_BASE_URL = 'https://proxy.example.test'
const UUID = '11111111-2222-4333-8444-555555555555'
const API_KEY = 'pk_proxy_test_key'

let captured: Array<{ baseURL?: string; url?: string }> = []
let originalAdapter: typeof axios.defaults.adapter

beforeAll(async () => {
  process.env.PAUBOX_PROXY_ENABLED = 'true'
  process.env.PAUBOX_CUSTOM_BASE_URL = CUSTOM_BASE_URL
  await import('../lib/paubox-proxy')

  // Answer every request in-process so the suite stays offline. Interceptors
  // have already run by the time the adapter sees the config.
  originalAdapter = axios.defaults.adapter
  axios.defaults.adapter = async (config) => {
    captured.push({ baseURL: config.baseURL, url: config.url })
    return { status: 200, statusText: 'OK', data: { data: {} }, headers: {}, config }
  }
})

afterAll(() => {
  axios.defaults.adapter = originalAdapter
})

beforeEach(() => {
  captured = []
})

describe('Paubox proxy request rewriting', () => {
  it('redirects the email client, which sets a baseURL', async () => {
    const { getEmailDisposition } = await import('../lib/paubox-email')
    await getEmailDisposition(API_KEY, UUID)

    expect(captured[0].baseURL).toBe(`${CUSTOM_BASE_URL}/v1/email`)
  })

  it('redirects the forms client, which sets an absolute url', async () => {
    const { createFormsClient } = await import('../lib/paubox-forms')
    await createFormsClient({ apiKey: API_KEY }).getFormStats(1)

    expect(captured[0].url).toBe(`${CUSTOM_BASE_URL}/v1/forms/api/forms/stats`)
  })

  it('redirects the marketing client, which sets an absolute url', async () => {
    const { createMarketingClient } = await import('../lib/paubox-marketing')
    await createMarketingClient({ apiKey: API_KEY }).getCurrentCustomer()

    expect(captured[0].url).toBe(`${CUSTOM_BASE_URL}/v1/marketing/current_customer`)
  })

  // validate_credentials, get_form and submit_form skip the clients and call
  // axios with a fully-qualified Paubox URL of their own.
  it('redirects a direct axios call made with an absolute Paubox url', async () => {
    await axios.get('https://api.paubox.com/v1/forms/public/form_data/abc')

    expect(captured[0].url).toBe(`${CUSTOM_BASE_URL}/v1/forms/public/form_data/abc`)
  })

  it('leaves requests to other hosts untouched', async () => {
    await axios.get('https://example.test/v1/forms/api/forms/stats')

    expect(captured[0].url).toBe('https://example.test/v1/forms/api/forms/stats')
  })
})
