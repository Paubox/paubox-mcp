export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`

  return Response.json(
    {
      resource: origin,
      authorization_servers: [origin],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
