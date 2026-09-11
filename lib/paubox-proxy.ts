import axios, { InternalAxiosRequestConfig, AxiosResponse } from 'axios'

// Paubox Proxy Configuration
export const PAUBOX_PROXY_CONFIG = {
  enabled: process.env.PAUBOX_PROXY_ENABLED === 'true',
  customBaseURL: process.env.PAUBOX_CUSTOM_BASE_URL || 'https://app.staging.paubox.net',
  originalAPIDomain: 'https://api.paubox.com'
}

type ProxyTarget = { baseURL?: string; url?: string }

// The request interceptor rewrites whichever field carried the Paubox domain,
// so a proxied response has to be recognized from either one.
const wasProxied = (config?: ProxyTarget): boolean =>
  Boolean(
    config &&
      (config.baseURL?.includes(PAUBOX_PROXY_CONFIG.customBaseURL) ||
        config.url?.includes(PAUBOX_PROXY_CONFIG.customBaseURL))
  )

// Configure axios interceptors to proxy Paubox requests
export const configurePauboxProxy = () => {
  // Only configure if proxy is enabled
  if (!PAUBOX_PROXY_CONFIG.enabled) {
    return
  }

  // Add request interceptor to modify URLs
  axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    // Check if this is a Paubox API request
    if (config.baseURL && config.baseURL.includes('api.paubox.com')) {
      // Replace the base URL with your custom endpoint
      config.baseURL = config.baseURL.replace(
        PAUBOX_PROXY_CONFIG.originalAPIDomain, 
        PAUBOX_PROXY_CONFIG.customBaseURL
      )
      
      console.log(`Proxying Paubox request to: ${config.baseURL}`)
    }

    // Every caller other than lib/paubox-email.ts passes a fully-qualified
    // config.url instead of a baseURL, and axios ignores baseURL once url is
    // absolute — so without the same rewrite here they bypass the proxy.
    if (config.url && config.url.includes('api.paubox.com')) {
      config.url = config.url.replace(
        PAUBOX_PROXY_CONFIG.originalAPIDomain,
        PAUBOX_PROXY_CONFIG.customBaseURL
      )

      console.log(`Proxying Paubox request to: ${config.url}`)
    }

    return config
  })

  // Add response interceptor for debugging
  axios.interceptors.response.use(
    (response: AxiosResponse) => {
      if (wasProxied(response.config)) {
        console.log('Paubox request successfully proxied')
      }
      return response
    },
    (error: { config?: ProxyTarget; message?: string }) => {
      if (wasProxied(error.config)) {
        console.error('Paubox proxied request failed:', error.message)
      }
      return Promise.reject(error)
    }
  )
}

// Auto-initialize only if proxy is enabled
if (PAUBOX_PROXY_CONFIG.enabled) {
  configurePauboxProxy()
} 