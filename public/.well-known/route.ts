import { NextRequest, NextResponse } from 'next/server';
import aiPluginConfig from './ai-plugin.json';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  
  // Handle the ai-plugin.json route
  if (url.pathname === '/.well-known/ai-plugin.json') {
    return NextResponse.json(aiPluginConfig, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
  
  return new NextResponse('Not Found', { status: 404 });
} 