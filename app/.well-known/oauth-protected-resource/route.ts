import { getPublicOrigin } from '../../../lib/origin'

export async function GET(request: Request) {
  const origin = getPublicOrigin(request)

  return Response.json(
    {
      resource: origin,
      authorization_servers: [origin],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
