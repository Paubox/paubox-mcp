import { createHash, randomBytes, randomUUID } from 'crypto'
import { EncryptJWT, jwtDecrypt } from 'jose'

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

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days
const CONSUMED_CODE_TTL_SECONDS = 600 // 10 min (> auth code 5m exp + slack)

// SHA-256 always emits 32 bytes, so jose's A256GCM key-length requirement
// is satisfied for any non-empty JWT_SECRET — but operator entropy is the
// real bottleneck. `.env.example` documents the 32-char minimum; enforce
// it as a hard error so a misconfigured secret manager doesn't silently
// produce a brute-forceable secret.
const MIN_SECRET_BYTES = 32

// A256GCM direct encryption requires a 32-byte key. Derive it from
// JWT_SECRET via SHA-256 so any operator-supplied length still produces
// a properly sized key, with domain separation from any future use.
function getEncryptionKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is not set')
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes (256 bits)`,
    )
  }
  return createHash('sha256').update(`paubox-mcp-jwe:${secret}`).digest()
}

// Auth codes ride in the redirect URL (browser history, proxy logs).
// Encrypt the payload (JWE) instead of just signing it (JWS) so the
// apiKey/apiUser are not base64-decodable from a leaked URL.
export async function signAuthCode(
  payload: Omit<AuthCodePayload, 'type' | 'jti'>
): Promise<string> {
  return new EncryptJWT({ ...payload, type: 'auth_code' } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .encrypt(getEncryptionKey())
}

export async function verifyAuthCode(token: string): Promise<AuthCodePayload> {
  // Pin algorithms (RFC 8725 §3.1) so the verifier never broadens its
  // accepted set if jose defaults change or getEncryptionKey is refactored.
  const { payload } = await jwtDecrypt(token, getEncryptionKey(), {
    keyManagementAlgorithms: ['dir'],
    contentEncryptionAlgorithms: ['A256GCM'],
  })
  if (payload.type !== 'auth_code') throw new Error('Invalid token type')
  if (typeof payload.jti !== 'string' || !payload.jti) throw new Error('Missing jti')
  return payload as unknown as AuthCodePayload
}

// Access tokens are encrypted (JWE) rather than signed (JWS) so the
// apiKey/apiUser are not base64-decodable from a leaked Bearer header
// (Sentry capture, HAR exports, MCP client debug logs, etc.). The 1h
// `exp` bounds the JWT itself; encryption bounds the embedded credential.
export async function signAccessToken(
  payload: Omit<AccessTokenPayload, 'type'>
): Promise<string> {
  return new EncryptJWT({ ...payload, type: 'access_token' } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .encrypt(getEncryptionKey())
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtDecrypt(token, getEncryptionKey(), {
    keyManagementAlgorithms: ['dir'],
    contentEncryptionAlgorithms: ['A256GCM'],
  })
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

export function markAuthCodeConsumed(jti: string, ttlSeconds = CONSUMED_CODE_TTL_SECONDS): void {
  consumedAuthCodes.set(jti, Date.now() + ttlSeconds * 1000)
}

// Refresh-token store. Tokens are opaque random strings (not JWTs) — they
// are credentials, not assertions, and revocation requires server-side
// state anyway. Same single-process caveat as consumedAuthCodes applies.
interface RefreshTokenRecord {
  apiKey: string
  apiUser: string
  expiresAt: number
}

const refreshTokens = new Map<string, RefreshTokenRecord>()

function pruneRefreshTokens(now: number) {
  for (const [token, rec] of refreshTokens) {
    if (rec.expiresAt <= now) refreshTokens.delete(token)
  }
}

export function issueRefreshToken(
  apiKey: string,
  apiUser: string,
  ttlSeconds = REFRESH_TOKEN_TTL_SECONDS,
): string {
  const token = randomBytes(32).toString('base64url')
  refreshTokens.set(token, {
    apiKey,
    apiUser,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
  return token
}

// Consume rotates: the redeemed token is deleted so a replay returns null.
// Caller issues a fresh refresh token alongside the new access token.
export function consumeRefreshToken(token: string): { apiKey: string; apiUser: string } | null {
  pruneRefreshTokens(Date.now())
  const rec = refreshTokens.get(token)
  if (!rec) return null
  refreshTokens.delete(token)
  return { apiKey: rec.apiKey, apiUser: rec.apiUser }
}
