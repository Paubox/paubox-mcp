import { randomUUID } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'

export interface AuthCodePayload {
  type: 'auth_code'
  jti: string
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
  payload: Omit<AuthCodePayload, 'type' | 'jti'>
): Promise<string> {
  return new SignJWT({ ...payload, type: 'auth_code' } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
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
  if (typeof payload.jti !== 'string' || !payload.jti) throw new Error('Missing jti')
  return payload as unknown as AuthCodePayload
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret())
  if (payload.type !== 'access_token') throw new Error('Invalid token type')
  return payload as unknown as AccessTokenPayload
}

// Single-use enforcement for authorization codes (OAuth 2.1 §4.1.2).
// In-memory store works for a single Node process; for multi-instance
// serverless deployments this should be backed by a shared store
// (Redis/Upstash) so a code can't be redeemed once per worker.
const consumedAuthCodes = new Map<string, number>()

function pruneConsumed(now: number) {
  for (const [jti, expiry] of consumedAuthCodes) {
    if (expiry <= now) consumedAuthCodes.delete(jti)
  }
}

export function isAuthCodeConsumed(jti: string): boolean {
  const now = Date.now()
  pruneConsumed(now)
  const expiry = consumedAuthCodes.get(jti)
  return expiry !== undefined && expiry > now
}

export function markAuthCodeConsumed(jti: string, ttlSeconds = 600): void {
  consumedAuthCodes.set(jti, Date.now() + ttlSeconds * 1000)
}
