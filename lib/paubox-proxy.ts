import axios, { InternalAxiosRequestConfig, AxiosResponse } from 'axios'

// Paubox Proxy Configuration
export const PAUBOX_PROXY_CONFIG = {
  enabled: process.env.PAUBOX_PROXY_ENABLED === 'true',
  customBaseURL: process.env.PAUBOX_CUSTOM_BASE_URL || 'https://app.staging.paubox.net',
  originalAPIDomain: 'https://api.paubox.com'
}

// Configure axios interceptors to proxy Paubox requests
const configurePauboxProxy = () => {
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
    return config
  })

  // Add response interceptor for debugging
  axios.interceptors.response.use(
    (response: AxiosResponse) => {
      if (response.config?.baseURL && response.config.baseURL.includes(PAUBOX_PROXY_CONFIG.customBaseURL)) {
        console.log('Paubox request successfully proxied')
      }
      return response
    },
    (error: { config?: { baseURL?: string }; message?: string }) => {
      if (error.config?.baseURL && error.config.baseURL.includes(PAUBOX_PROXY_CONFIG.customBaseURL)) {
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