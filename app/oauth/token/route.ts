import { createHash } from 'crypto'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  consumeRefreshToken,
  isAuthCodeConsumed,
  issueRefreshToken,
  markAuthCodeConsumed,
  signAccessToken,
  verifyAuthCode,
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

function tokenResponse(accessToken: string, refreshToken: string): Response {
  return Response.json(
    {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
    },
    { headers: NO_STORE_HEADERS },
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

  if (grantType === 'authorization_code') {
    const code = body.get('code')
    const codeVerifier = body.get('code_verifier')
    const redirectUri = body.get('redirect_uri')

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
    const refreshToken = issueRefreshToken(authCodePayload.apiKey, authCodePayload.apiUser)
    return tokenResponse(accessToken, refreshToken)
  }

  if (grantType === 'refresh_token') {
    const refreshTokenParam = body.get('refresh_token')
    if (!refreshTokenParam) return errorJson('invalid_request', 'Missing refresh_token')

    // Rotation: consumeRefreshToken atomically deletes the redeemed token.
    // OAuth 2.1 §6.1 recommends refresh-token rotation for public clients.
    const creds = consumeRefreshToken(refreshTokenParam)
    if (!creds) {
      return errorJson('invalid_grant', 'Refresh token is invalid or expired', 401)
    }

    const accessToken = await signAccessToken({
      apiKey: creds.apiKey,
      apiUser: creds.apiUser,
    })
    const newRefreshToken = issueRefreshToken(creds.apiKey, creds.apiUser)
    return tokenResponse(accessToken, newRefreshToken)
  }

  return errorJson(
    'unsupported_grant_type',
    'Only authorization_code and refresh_token are supported',
  )
}
