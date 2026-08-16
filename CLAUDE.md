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

- **MCP tools (HTTP server)**: `app/[transport]/route.ts` — three email tools (`validate_credentials`, `send_secure_email`, `check_email_status`), two credential-free forms tools (`get_form`, `submit_form`), ten forms management tools (`list_forms`, `create_form`, `update_form`, `archive_form`, `unarchive_form`, `copy_form`, `get_form_stats`, `list_form_submissions`, `export_submissions_csv`, `export_submission_pdf`), and fifteen email marketing tools (`validate_marketing_access`, `list_subscribers`, `get_subscriber`, `create_subscriber`, `update_subscriber`, `get_subscribed_count`, `list_marketing_lists`, `list_subscription_lists`, `create_subscription_list`, `list_dynamic_lists`, `list_subscriber_custom_fields`, `list_campaign_sends`, `list_campaign_deliveries`, `get_campaign_analytics`, `get_marketing_bulk_job`)
- **MCP tools (stdio / npm package)**: `src/stdio.ts` — same tool set as the HTTP server; API key from the `PAUBOX_API_KEY` env var; no per-call credential params
- **Email auth**: the email tools authenticate with the API key alone, sent as `Authorization: Bearer <apiKey>` — no API username is required anywhere. (The legacy `Token token=<apiKey>` scheme is still accepted by the API, but Bearer is the documented preference.)
- **Email API client**: `lib/paubox-email.ts` — axios-based client for the Paubox Email API (`https://api.paubox.com/v1/email`); it replaced the `paubox-node` npm package. Uses axios with `baseURL` so the interceptors in `lib/paubox-proxy.ts` still apply. The `/email` path segment is required — the bare `/v1` prefix is unrouted and returns an HTML 404 from the gateway
- **Forms auth**: the forms management tools authenticate with a scoped Paubox API key carrying the `forms` scope, sent as `Authorization: Bearer <key>` — they reuse the existing `apiKey` credential. `get_form` and `submit_form` remain credential-free (though `get_form` uses the authenticated endpoint when an `apiKey` is available, so inactive/archived forms become retrievable)
- **Forms API client**: `lib/paubox-forms.ts` — typed client for the Paubox Forms API (`https://api.paubox.com/v1/forms`) used by `app/[transport]/route.ts`; `src/stdio.ts` inlines its own minimal fetch-based client because the stdio build cannot import from `lib/`. As with email, the `/v1` prefix is required — a bare `/forms` base is unrouted
- **Marketing auth**: the marketing tools reuse the same `apiKey` as the email tools — no extra scope or credential. They call the *username-less* Marketing API gateway, whose `ApplicationController#token_authenticate_keyless` resolves the customer by asking the Email API's `/v1/paubox_marketing/auth_check` who the Bearer token belongs to, then loads the `PauboxMarketingCustomer` by the returned `endpoint_username`. A valid key with no marketing customer yields a 404 `Customer Not Found`, which the client maps to an explicit "Marketing is not provisioned for this account" message rather than a generic not-found
- **Marketing API client**: `lib/paubox-marketing.ts` — typed client for the Paubox Marketing API (`https://api.paubox.com/v1/marketing`) used by `app/[transport]/route.ts`; `src/stdio.ts` inlines its own fetch-based equivalent, same as forms. The `/v1` prefix is required here too. Notes that bit us and are encoded in the client:
  - Responses are `fast_jsonapi` documents (`{data: [{id, type, attributes}], total_count, page_info}`); `flattenDocument` collapses them to `{id, ...attributes}` so the model sees flat records
  - ID types are inconsistent upstream: subscribers, dynamic lists, and custom field types key on **uuid**; subscription lists, campaign mailings, and campaign sends key on integer **id**
  - `/lists`, `/subscription_lists`, and `/dynamic_lists` ignore `page`/`items` unless `use_pagination` is also set
  - `SubscriberSerializer` gates statistics on the literal string `"true"`, not a boolean
  - `EmailMarketingAnalyticsController#index` derives the report from the **last path segment**, and `request_types.fetch` raises on an unknown key (an opaque 500) — hence the closed `ANALYTICS_REPORTS` enum. Bare `/analytics` is not a valid report
  - Bulk operations return a job id (`jid`/`bid`) rather than a result; poll with `get_marketing_bulk_job`
- **Marketing scope (deliberate)**: this tranche is read-only plus safe subscriber/list writes. Campaign sending, scheduling, and bulk deletion are *not* exposed — they mail or destroy entire lists and need a confirmation model first. `__tests__/mcp-server.test.ts` asserts those tool names stay absent
- **OAuth endpoints**: `app/oauth/authorize/route.ts` and `app/oauth/token/route.ts` — implement OAuth 2.1 + PKCE so Claude shows a credential form when the connector is added
- **Discovery**: `app/.well-known/oauth-authorization-server/route.ts` and `app/.well-known/oauth-protected-resource/route.ts`
- **JWT helpers**: `lib/oauth-jwt.ts` — sign/verify auth codes and access tokens using `jose`
- **Credential resolution priority** (highest first): tool parameters → `x-paubox-api-key` header → `Authorization: Bearer <token>`. Only the API key is needed; a legacy `x-paubox-api-user` header or an old OAuth token carrying `apiUser` is tolerated and ignored

## Building the stdio package

```bash
pnpm build:stdio   # compiles src/stdio.ts → dist/stdio.js
```

The compiled binary is what `npx @paubox/mcp@latest` runs. Test it locally:

```bash
PAUBOX_API_KEY=xxx node dist/stdio.js
```

`package.json`'s `files` must stay `["dist"]`, not `["dist/stdio.js"]`. `src/stdio.ts` imports sibling modules (e.g. `./validate-form-id.js`), which `tsc` emits alongside `dist/stdio.js`; narrowing `files` to the single entry point publishes a package that dies at startup with `Cannot find module './validate-form-id.js'`. Verify with:

```bash
npm pack --dry-run   # dist/stdio.js AND its siblings must be listed
```
