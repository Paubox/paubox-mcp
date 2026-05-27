import { type NextRequest } from 'next/server'
import { signAuthCode } from '../../../lib/oauth-jwt'
import { checkPauboxCredentials } from '../../../lib/paubox-credentials'

function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri)
    if (uri === 'https://claude.ai/api/mcp/auth_callback') return true
    if (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.protocol === 'http:'
    )
      return true
    return false
  } catch {
    return false
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeJs(str: string): string {
  // `<` is escaped to prevent `</script>` from terminating the inline script
  // block — the HTML tokenizer ends a <script> element at the first literal
  // `</script>` regardless of JavaScript string context.
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003C')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

interface FormParams {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  codeChallengeMethod: string
  responseType: string
  error?: string
}

function renderForm(p: FormParams): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Configure Paubox</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #F2F2F2;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .card {
      background: #fff;
      border-radius: 20px;
      padding: 32px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 4px 32px rgba(0,0,0,0.10);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
    }
    .header img { height: 28px; width: auto; }
    .header h1 { font-size: 20px; font-weight: 700; color: #111; }
    .error-banner {
      background: #FEF2F2;
      border: 1px solid #FECACA;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      color: #B91C1C;
      margin-bottom: 20px;
    }
    .field { margin-bottom: 22px; }
    .field label {
      display: block;
      font-size: 15px;
      font-weight: 600;
      color: #111;
      margin-bottom: 4px;
    }
    .field label .required { font-size: 13px; font-weight: 400; color: #999; margin-left: 4px; }
    .field .desc { font-size: 13px; color: #888; margin-bottom: 8px; line-height: 1.45; }
    .field input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #D1D5DB;
      border-radius: 8px;
      font-size: 14px;
      color: #111;
      outline: none;
      transition: border-color 0.15s;
      background: #fff;
    }
    .field input:focus { border-color: #2E70FF; box-shadow: 0 0 0 3px rgba(46,112,255,0.12); }
    .buttons {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
    }
    .btn-cancel {
      background: #fff;
      border: 1px solid #D1D5DB;
      border-radius: 8px;
      padding: 10px 22px;
      font-size: 14px;
      font-weight: 500;
      color: #374151;
      cursor: pointer;
    }
    .btn-cancel:hover { background: #F9FAFB; }
    .btn-save {
      background: #2E70FF;
      border: none;
      border-radius: 8px;
      padding: 10px 28px;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-save:hover { background: #0247DC; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <img src="/paubox.png" alt="Paubox">
      <h1>Configure Paubox</h1>
    </div>

    ${p.error ? `<div class="error-banner">${escapeHtml(p.error)}</div>` : ''}

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id"             value="${escapeHtml(p.clientId)}">
      <input type="hidden" name="redirect_uri"          value="${escapeHtml(p.redirectUri)}">
      <input type="hidden" name="state"                 value="${escapeHtml(p.state)}">
      <input type="hidden" name="code_challenge"        value="${escapeHtml(p.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(p.codeChallengeMethod)}">
      <input type="hidden" name="response_type"         value="${escapeHtml(p.responseType)}">

      <div class="field">
        <label>Paubox API Username <span class="required">(Required)</span></label>
        <p class="desc">The endpoint username for your sending domain. In the Paubox dashboard, go to Email API → your domain → the "Endpoint Username" field (e.g. <strong>api_user</strong>).</p>
        <input type="text" name="apiUser" placeholder="api_user" autocomplete="username" required>
      </div>

      <div class="field">
        <label>Paubox API Key <span class="required">(Required)</span></label>
        <p class="desc">An API key for your sending domain. In the Paubox dashboard, go to Email API → your domain → API Keys.</p>
        <input type="password" name="apiKey" placeholder="Your API key" autocomplete="current-password" required>
      </div>

      <div class="buttons">
        <button type="button" class="btn-cancel" onclick="handleCancel()">Cancel</button>
        <button type="submit" class="btn-save">Save</button>
      </div>
    </form>
  </div>

  <script>
    function handleCancel() {
      var redirectUri = '${escapeJs(p.redirectUri)}';
      var state = '${escapeJs(p.state)}';
      if (redirectUri) {
        try {
          var url = new URL(redirectUri);
          url.searchParams.set('error', 'access_denied');
          if (state) url.searchParams.set('state', state);
          window.location.href = url.toString();
          return;
        } catch (e) { /* fall through */ }
      }
      window.location.href = '/';
    }
  </script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Clickjacking protection: the form collects API credentials, so it
      // must not be framable by any origin. Both headers are sent for
      // defense-in-depth across legacy and modern browsers.
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const redirectUri = searchParams.get('redirect_uri') ?? ''
  const responseType = searchParams.get('response_type') ?? ''
  const codeChallenge = searchParams.get('code_challenge') ?? ''
  const codeChallengeMethod = searchParams.get('code_challenge_method') ?? 'S256'

  if (responseType !== 'code') {
    return new Response('unsupported_response_type', { status: 400 })
  }
  if (!isValidRedirectUri(redirectUri)) {
    return new Response('invalid_redirect_uri', { status: 400 })
  }
  // PKCE is mandatory (OAuth 2.1 §4.1.1) and the discovery metadata only
  // advertises S256. Reject here so non-spec clients see the failure at
  // the authorize step instead of a confusing PKCE error at token redemption.
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return new Response('invalid_request', { status: 400 })
  }

  return renderForm({
    clientId: searchParams.get('client_id') ?? '',
    redirectUri,
    state: searchParams.get('state') ?? '',
    codeChallenge,
    codeChallengeMethod,
    responseType,
  })
}

export async function POST(request: NextRequest) {
  // request.formData() rejects with TypeError on a non-form Content-Type
  // or a malformed multipart body. Without this guard the rejection
  // bubbles up as a generic 500 + Sentry alert; the OAuth-correct
  // response is `invalid_request`.
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return new Response('invalid_request', { status: 400 })
  }

  const clientId = formData.get('client_id')?.toString() ?? ''
  const redirectUri = formData.get('redirect_uri')?.toString() ?? ''
  const state = formData.get('state')?.toString() ?? ''
  const codeChallenge = formData.get('code_challenge')?.toString() ?? ''
  const codeChallengeMethod = formData.get('code_challenge_method')?.toString() ?? 'S256'
  const responseType = formData.get('response_type')?.toString() ?? 'code'
  const apiKey = formData.get('apiKey')?.toString().trim() ?? ''
  const apiUser = formData.get('apiUser')?.toString().trim() ?? ''

  if (!isValidRedirectUri(redirectUri)) {
    return new Response('invalid_redirect_uri', { status: 400 })
  }
  // Mirror the GET-side PKCE check so a tampered/no-PKCE form post also
  // fails at the authorize step rather than minting an unredeemable code.
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return new Response('invalid_request', { status: 400 })
  }

  if (!apiKey || !apiUser) {
    return renderForm({
      clientId, redirectUri, state, codeChallenge, codeChallengeMethod, responseType,
      error: 'Both API Username and API Key are required.',
    })
  }

  // Fail fast on typos / expired keys. A Paubox outage or 5xx soft-passes
  // here (see checkPauboxCredentials) so a backend incident doesn't block
  // all new connector adds.
  const credCheck = await checkPauboxCredentials(apiKey, apiUser)
  if (!credCheck.ok) {
    return renderForm({
      clientId, redirectUri, state, codeChallenge, codeChallengeMethod, responseType,
      error: credCheck.reason,
    })
  }

  const code = await signAuthCode({ apiKey, apiUser, codeChallenge, redirectUri })

  const callbackUrl = new URL(redirectUri)
  callbackUrl.searchParams.set('code', code)
  if (state) callbackUrl.searchParams.set('state', state)

  return Response.redirect(callbackUrl.toString(), 302)
}
