import { createHash } from 'crypto'
import {
  verifyAuthCode,
  signAccessToken,
  isAuthCodeConsumed,
  markAuthCodeConsumed,
} from '../../../lib/oauth-jwt'

// RFC 6749 §5.1 / OAuth 2.1: any response containing tokens (or token errors)
// must be uncacheable.
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
} as const

function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const digest = createHash('sha256').update(codeVerifier).digest()
  const computed = digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return computed === codeChallenge
}

function errorJson(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: NO_STORE_HEADERS },
  )
}

export async function POST(request: Request) {
  let body: URLSearchParams
  try {
    body = new URLSearchParams(await request.text())
  } catch {
    return errorJson('invalid_request', 'Could not parse request body')
  }

  const grantType = body.get('grant_type')
  const code = body.get('code')
  const codeVerifier = body.get('code_verifier')
  const redirectUri = body.get('redirect_uri')

  if (grantType !== 'authorization_code') {
    return errorJson('unsupported_grant_type', 'Only authorization_code is supported')
  }
  if (!code) return errorJson('invalid_request', 'Missing code')
  if (!codeVerifier) return errorJson('invalid_request', 'Missing code_verifier')
  if (!redirectUri) return errorJson('invalid_request', 'Missing redirect_uri')

  let authCodePayload
  try {
    authCodePayload = await verifyAuthCode(code)
  } catch {
    return errorJson('invalid_grant', 'Authorization code is invalid or expired', 401)
  }

  // OAuth 2.1 §4.1.2: authorization codes MUST be single-use.
  if (isAuthCodeConsumed(authCodePayload.jti)) {
    return errorJson('invalid_grant', 'Authorization code has already been used', 401)
  }

  if (!verifyPKCE(codeVerifier, authCodePayload.codeChallenge)) {
    return errorJson('invalid_grant', 'PKCE verification failed', 401)
  }

  if (redirectUri !== authCodePayload.redirectUri) {
    return errorJson('invalid_grant', 'redirect_uri mismatch', 401)
  }

  markAuthCodeConsumed(authCodePayload.jti)

  const accessToken = await signAccessToken({
    apiKey: authCodePayload.apiKey,
    apiUser: authCodePayload.apiUser,
  })

  return Response.json(
    { access_token: accessToken, token_type: 'bearer' },
    { headers: NO_STORE_HEADERS },
  )
}
