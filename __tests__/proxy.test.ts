import { PAUBOX_PROXY_CONFIG } from '../lib/paubox-proxy'

describe('Paubox Proxy Configuration', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv }
    delete process.env.PAUBOX_PROXY_ENABLED
    delete process.env.PAUBOX_CUSTOM_BASE_URL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('PAUBOX_PROXY_CONFIG', () => {
    test('should have default configuration when environment variables are not set', () => {
      expect(PAUBOX_PROXY_CONFIG.enabled).toBe(false)
      expect(PAUBOX_PROXY_CONFIG.customBaseURL).toBe('https://app.staging.paubox.net')
      expect(PAUBOX_PROXY_CONFIG.originalAPIDomain).toBe('https://api.paubox.com')
    })

    test('should have correct configuration structure', () => {
      expect(PAUBOX_PROXY_CONFIG).toHaveProperty('enabled')
      expect(PAUBOX_PROXY_CONFIG).toHaveProperty('customBaseURL')
      expect(PAUBOX_PROXY_CONFIG).toHaveProperty('originalAPIDomain')
      expect(typeof PAUBOX_PROXY_CONFIG.enabled).toBe('boolean')
      expect(typeof PAUBOX_PROXY_CONFIG.customBaseURL).toBe('string')
      expect(typeof PAUBOX_PROXY_CONFIG.originalAPIDomain).toBe('string')
    })

    test('should have valid URL formats', () => {
      expect(PAUBOX_PROXY_CONFIG.customBaseURL).toMatch(/^https?:\/\/.+/)
      expect(PAUBOX_PROXY_CONFIG.originalAPIDomain).toMatch(/^https?:\/\/.+/)
    })
  })

  // The email API no longer embeds the API username in the path — endpoints
  // live directly under /v1 (e.g. /v1/messages, /v1/message_receipt).
  describe('URL Replacement Logic', () => {
    test('should replace original base URL with custom base URL', () => {
      const originalAPIDomain = 'https://api.paubox.com'
      const customBaseURL = 'https://my-custom-api.com'

      const originalURL = 'https://api.paubox.com/v1/messages'
      const expectedURL = 'https://my-custom-api.com/v1/messages'

      const replacedURL = originalURL.replace(originalAPIDomain, customBaseURL)
      expect(replacedURL).toBe(expectedURL)
    })

    test('should handle different custom base URLs', () => {
      const originalAPIDomain = 'https://api.paubox.com'
      const customBaseURL = 'http://localhost:8080'

      const originalURL = 'https://api.paubox.com/v1/messages'
      const expectedURL = 'http://localhost:8080/v1/messages'

      const replacedURL = originalURL.replace(originalAPIDomain, customBaseURL)
      expect(replacedURL).toBe(expectedURL)
    })

    test('should preserve path and query parameters', () => {
      const originalAPIDomain = 'https://api.paubox.com'
      const customBaseURL = 'https://staging-api.paubox.com'

      const originalURL = 'https://api.paubox.com/v1/message_receipt?sourceTrackingId=123'
      const expectedURL = 'https://staging-api.paubox.com/v1/message_receipt?sourceTrackingId=123'

      const replacedURL = originalURL.replace(originalAPIDomain, customBaseURL)
      expect(replacedURL).toBe(expectedURL)
    })

    test('should handle complex API paths', () => {
      const originalAPIDomain = 'https://api.paubox.com'
      const customBaseURL = 'https://test-api.company.com'

      const originalURL = 'https://api.paubox.com/v1/dynamic_templates/123'
      const expectedURL = 'https://test-api.company.com/v1/dynamic_templates/123'

      const replacedURL = originalURL.replace(originalAPIDomain, customBaseURL)
      expect(replacedURL).toBe(expectedURL)
    })

    test('should not replace URLs that do not contain the original domain', () => {
      const originalAPIDomain = 'https://api.paubox.com'
      const customBaseURL = 'https://my-custom-api.com'

      const otherURL = 'https://other-api.com/v1/messages'
      const replacedURL = otherURL.replace(originalAPIDomain, customBaseURL)

      expect(replacedURL).toBe(otherURL) // Should remain unchanged
    })

    test('should handle multiple replacements correctly', () => {
      const originalAPIDomain = 'https://api.paubox.com'
      const customBaseURL = 'https://my-custom-api.com'

      const originalURL = 'https://api.paubox.com/v1/messages'
      const expectedURL = 'https://my-custom-api.com/v1/messages'

      // Test that the replacement works consistently
      const replacedURL1 = originalURL.replace(originalAPIDomain, customBaseURL)
      const replacedURL2 = originalURL.replace(originalAPIDomain, customBaseURL)

      expect(replacedURL1).toBe(expectedURL)
      expect(replacedURL2).toBe(expectedURL)
      expect(replacedURL1).toBe(replacedURL2)
    })
  })

  describe('Configuration Validation', () => {
    test('should validate proxy configuration structure', () => {
      expect(PAUBOX_PROXY_CONFIG).toHaveProperty('enabled')
      expect(PAUBOX_PROXY_CONFIG).toHaveProperty('customBaseURL')
      expect(PAUBOX_PROXY_CONFIG).toHaveProperty('originalAPIDomain')
      expect(typeof PAUBOX_PROXY_CONFIG.enabled).toBe('boolean')
      expect(typeof PAUBOX_PROXY_CONFIG.customBaseURL).toBe('string')
      expect(typeof PAUBOX_PROXY_CONFIG.originalAPIDomain).toBe('string')
    })

    test('should have valid URL formats', () => {
      expect(PAUBOX_PROXY_CONFIG.customBaseURL).toMatch(/^https?:\/\/.+/)
      expect(PAUBOX_PROXY_CONFIG.originalAPIDomain).toMatch(/^https?:\/\/.+/)
    })

    test('should have non-empty URL strings', () => {
      expect(PAUBOX_PROXY_CONFIG.customBaseURL.length).toBeGreaterThan(0)
      expect(PAUBOX_PROXY_CONFIG.originalAPIDomain.length).toBeGreaterThan(0)
    })

    test('should have different URLs for custom and original', () => {
      expect(PAUBOX_PROXY_CONFIG.customBaseURL).not.toBe(PAUBOX_PROXY_CONFIG.originalAPIDomain)
    })
  })

  describe('Integration Tests', () => {
    test('should use configuration values in URL replacement', () => {
      const originalURL = `https://api.paubox.com/v1/messages`
      const expectedURL = `https://app.staging.paubox.net/v1/messages`

      const replacedURL = originalURL.replace(
        PAUBOX_PROXY_CONFIG.originalAPIDomain,
        PAUBOX_PROXY_CONFIG.customBaseURL
      )

      expect(replacedURL).toBe(expectedURL)
    })

    test('should handle URL with query parameters', () => {
      const originalURL = `https://api.paubox.com/v1/message_receipt?sourceTrackingId=123&status=delivered`
      const expectedURL = `https://app.staging.paubox.net/v1/message_receipt?sourceTrackingId=123&status=delivered`

      const replacedURL = originalURL.replace(
        PAUBOX_PROXY_CONFIG.originalAPIDomain,
        PAUBOX_PROXY_CONFIG.customBaseURL
      )

      expect(replacedURL).toBe(expectedURL)
    })
  })
})