import { SignJWT, jwtVerify } from 'jose'

export interface AuthCodePayload {
  type: 'auth_code'
  apiKey: string
  apiUser: string
  codeChallenge: string
  redirectUri: string
}

export interface AccessTokenPayload {
  type: 'access_token'
  apiKey: string
  apiUser: string
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is not set')
  return new TextEncoder().encode(secret)
}

export async function signAuthCode(
  payload: Omit<AuthCodePayload, 'type'>
): Promise<string> {
  return new SignJWT({ ...payload, type: 'auth_code' } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getSecret())
}

export async function signAccessToken(
  payload: Omit<AccessTokenPayload, 'type'>
): Promise<string> {
  return new SignJWT({ ...payload, type: 'access_token' } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(getSecret())
}

export async function verifyAuthCode(token: string): Promise<AuthCodePayload> {
  const { payload } = await jwtVerify(token, getSecret())
  if (payload.type !== 'auth_code') throw new Error('Invalid token type')
  return payload as unknown as AuthCodePayload
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret())
  if (payload.type !== 'access_token') throw new Error('Invalid token type')
  return payload as unknown as AccessTokenPayload
}
