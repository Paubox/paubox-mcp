import { randomUUID } from 'crypto'

// RFC 7591 Dynamic Client Registration stub.
// Claude.ai attempts automatic registration before falling back to a
// manually-configured client ID. Since our security model relies on
// PKCE + redirect_uri allowlist (not client_id validation), we issue
// a unique client_id without storing or validating it.
export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text)
  } catch {
    // proceed with empty body — client metadata is optional
  }

  return Response.json(
    {
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...(Array.isArray(body.redirect_uris) ? { redirect_uris: body.redirect_uris } : {}),
      ...(typeof body.client_name === 'string' ? { client_name: body.client_name } : {}),
      ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
    },
    { status: 201 }
  )
}
