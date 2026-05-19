# Paubox MCP Server

## After making changes

Always run the linter after editing any file:

```bash
pnpm lint
```

Fix any errors before considering the task complete.

## Local development

Copy `.env.example` to `.env.local` and set `JWT_SECRET` before running the dev server:

```bash
cp .env.example .env.local
# edit .env.local and set JWT_SECRET to a random 32+ char string
# generate one with: openssl rand -base64 32
pnpm dev
```

`JWT_SECRET` is required for the OAuth credential flow (`/oauth/authorize`, `/oauth/token`). The server starts without it, but OAuth endpoints will return 500 until it is set.

## Architecture notes

- **MCP tools**: `app/[transport]/route.ts` — three tools (`validate_credentials`, `send_secure_email`, `check_email_status`)
- **OAuth endpoints**: `app/oauth/authorize/route.ts` and `app/oauth/token/route.ts` — implement OAuth 2.1 + PKCE so Claude shows a credential form when the connector is added
- **Discovery**: `app/.well-known/oauth-authorization-server/route.ts` and `app/.well-known/oauth-protected-resource/route.ts`
- **JWT helpers**: `lib/oauth-jwt.ts` — sign/verify auth codes and access tokens using `jose`
- **Credential resolution priority** (highest first): tool parameters → `x-paubox-*` headers → `Authorization: Bearer <token>`
