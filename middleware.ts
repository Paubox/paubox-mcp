import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Claude.ai uses the connector's base URL (https://mcp.paubox.com/) as the
// MCP endpoint, not the explicit /mcp path. Rewrite non-GET requests at the
// root to /mcp so the [transport] route handler processes them.
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/' && request.method !== 'GET') {
    const url = request.nextUrl.clone()
    url.pathname = '/mcp'
    return NextResponse.rewrite(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/',
}
