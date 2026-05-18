import { createHash } from 'crypto'
import { verifyAuthCode, signAccessToken } from '../../../lib/oauth-jwt'

function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const digest = createHash('sha256').update(codeVerifier).digest()
  const computed = digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return computed === codeChallenge
}

function errorJson(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status })
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

  if (!verifyPKCE(codeVerifier, authCodePayload.codeChallenge)) {
    return errorJson('invalid_grant', 'PKCE verification failed', 401)
  }

  if (redirectUri !== authCodePayload.redirectUri) {
    return errorJson('invalid_grant', 'redirect_uri mismatch', 401)
  }

  const accessToken = await signAccessToken({
    apiKey: authCodePayload.apiKey,
    apiUser: authCodePayload.apiUser,
  })

  return Response.json({
    access_token: accessToken,
    token_type: 'bearer',
  })
}
