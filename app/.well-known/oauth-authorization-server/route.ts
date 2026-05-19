export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`

  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
