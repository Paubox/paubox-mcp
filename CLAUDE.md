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

- **MCP tools (HTTP server)**: `app/[transport]/route.ts` — three email tools (`validate_credentials`, `send_secure_email`, `check_email_status`), two credential-free forms tools (`get_form`, `submit_form`), and ten forms management tools (`list_forms`, `create_form`, `update_form`, `archive_form`, `unarchive_form`, `copy_form`, `get_form_stats`, `list_form_submissions`, `export_submissions_csv`, `export_submission_pdf`)
- **MCP tools (stdio / npm package)**: `src/stdio.ts` — same tool set as the HTTP server; credentials from `PAUBOX_API_KEY` / `PAUBOX_API_USER` env vars; no per-call credential params
- **Forms auth**: the forms management tools authenticate with a scoped Paubox API key carrying the `forms` scope, sent as `Authorization: Bearer <key>` — they reuse the existing `apiKey` credential; `apiUser` is not required for forms. `get_form` and `submit_form` remain credential-free (though `get_form` uses the authenticated endpoint when an `apiKey` is available, so inactive/archived forms become retrievable)
- **Forms API client**: `lib/paubox-forms.ts` — typed client for the Paubox Forms API (`https://apx.paubox.com/forms`) used by `app/[transport]/route.ts`; `src/stdio.ts` inlines its own minimal fetch-based client because the stdio build cannot import from `lib/`
- **OAuth endpoints**: `app/oauth/authorize/route.ts` and `app/oauth/token/route.ts` — implement OAuth 2.1 + PKCE so Claude shows a credential form when the connector is added
- **Discovery**: `app/.well-known/oauth-authorization-server/route.ts` and `app/.well-known/oauth-protected-resource/route.ts`
- **JWT helpers**: `lib/oauth-jwt.ts` — sign/verify auth codes and access tokens using `jose`
- **Credential resolution priority** (highest first): tool parameters → `x-paubox-*` headers → `Authorization: Bearer <token>`

## Building the stdio package

```bash
pnpm build:stdio   # compiles src/stdio.ts → dist/stdio.js
```

The compiled binary is what `npx @paubox/mcp@latest` runs. Test it locally:

```bash
PAUBOX_API_KEY=xxx PAUBOX_API_USER=yyy node dist/stdio.js
```
