# Changelog

All notable changes to this project will be documented in this file.

This changelog tracks the **`@paubox/mcp` npm package** — the stdio server that
AI clients spawn locally. The hosted server at `https://mcp.paubox.com/mcp` is
deployed independently from `main` and is not versioned here.

## [1.0.2](https://github.com/Paubox/paubox-mcp/compare/v1.0.1...v1.0.2) (2026-09-10)


### Bug Fixes

* declare repository metadata so provenance can be verified ([#68](https://github.com/Paubox/paubox-mcp/issues/68)) ([2246a63](https://github.com/Paubox/paubox-mcp/commit/2246a6315823ed31cc6844257aa661a719de39e9))

## [1.0.1](https://github.com/Paubox/paubox-mcp/compare/v1.0.0...v1.0.1) (2026-09-10)

**No functional changes.** The package contents are identical to `1.0.0`.

This release exists to exercise the automated publish path. `1.0.0` was
published by hand, because npm cannot configure a trusted publisher for a
package that does not yet exist — so this is the first release to go out over
OIDC, and the first to prove the pipeline works end to end.

### Release tooling

- Publish job runs on Node 22 with npm upgraded in place, rather than Node 24. `engines.node` is `22.x` and pnpm enforces it, so Node 24 failed at install before reaching the publish step ([#66](https://github.com/Paubox/paubox-mcp/issues/66))

## 1.0.0 (2026-09-10)

First tagged release, and the first version for which the `npx @paubox/mcp@latest`
instructions in the README resolve — the package had never been published.

The hosted server at `https://mcp.paubox.com/mcp` has been running throughout;
this version number describes the npm package only.

**Tools exposed**, over both transports:

- **Email** — `send_secure_email`, `check_email_status`, `schedule_email`, `get_scheduled_email`, `reschedule_email`, `cancel_scheduled_email`
- **Forms** — `get_form`, `submit_form`, `list_forms`, `create_form`, `update_form`, `copy_form`, `archive_form`, `unarchive_form`, `get_form_stats`, `list_form_submissions`, `export_submissions_csv`, `export_submission_pdf`
- **Marketing** — `list_marketing_lists`, `list_dynamic_lists`, `list_subscription_lists`, `create_subscription_list`, `get_subscribed_count`, `list_subscribers`, `get_subscriber`, `create_subscriber`, `update_subscriber`, `list_subscriber_custom_fields`, `get_campaign_analytics`, `list_campaign_sends`, `list_campaign_deliveries`, `get_marketing_bulk_job`
- **Access** — `validate_credentials`, `validate_marketing_access`

**Authentication differs by transport.** The npm package reads `PAUBOX_API_KEY`
from the environment at spawn time; the hosted server resolves the key from an
OAuth token, the `x-paubox-api-key` header, or a tool parameter.

### Features

* add RFC 7591 dynamic client registration endpoint ([#31](https://github.com/Paubox/paubox-mcp/issues/31)) ([8594a86](https://github.com/Paubox/paubox-mcp/commit/8594a86b8ecb274c208e82247c28ed0aa77b2b25))
* add scheduled send support ([#60](https://github.com/Paubox/paubox-mcp/issues/60)) ([9d431ad](https://github.com/Paubox/paubox-mcp/commit/9d431ad36fc02980b7de25720dab1324e19f1ad6))
* add Sentry error monitoring and performance tracking ([f911e33](https://github.com/Paubox/paubox-mcp/commit/f911e33315247c9cd57bb11b7540c1c805317929))
* attachments on send_secure_email / schedule_email; render message as real HTML ([#61](https://github.com/Paubox/paubox-mcp/issues/61)) ([2904c95](https://github.com/Paubox/paubox-mcp/commit/2904c9561c568cabe764828eba7c570b42c3dc31))
* optional `html` body on send_secure_email / schedule_email ([#62](https://github.com/Paubox/paubox-mcp/issues/62)) ([4db93e7](https://github.com/Paubox/paubox-mcp/commit/4db93e71474573038610a1fcc0f51ebb19335891))


### Bug Fixes

* add .npmrc to disable pnpm minimumReleaseAge supply-chain check ([1dfad63](https://github.com/Paubox/paubox-mcp/commit/1dfad632e6ebb69da0b807c10154ce27f9c7e711))
* add vercel.json to use pnpm 9 and skip frozen-lockfile ([b6b7634](https://github.com/Paubox/paubox-mcp/commit/b6b7634538a4e66484e6abde4ccdeed83267bf66))
* correct OAuth form credential descriptions and remove wrong placeholder ([40767fd](https://github.com/Paubox/paubox-mcp/commit/40767fdb4d7212ca99cbc11a816d78bcac361728))
* enforce the Node 22 requirement instead of warning about it ([f3c4706](https://github.com/Paubox/paubox-mcp/commit/f3c47066da6564d06c11d0942f255ad034099f1f))
* guard the MCP tool list against doc drift and document the marketing tools ([4f8eed3](https://github.com/Paubox/paubox-mcp/commit/4f8eed3aeafd8e4ecf3a8df1c35c351f63169c9f))
* guard the MCP tool list against doc drift and document the marketing tools ([615a741](https://github.com/Paubox/paubox-mcp/commit/615a7412a14595228fab52ff8b7b4356f6fad86b))
* let the OS pick test server ports instead of hard coding them ([763c8ee](https://github.com/Paubox/paubox-mcp/commit/763c8eea48a11eb845303d311d3e3b45974c6ab9))
* normalize formJson so string input is stored as an object ([3b29881](https://github.com/Paubox/paubox-mcp/commit/3b298815bd4c2f4ac0557e6c4a9274896d9e9ede))
* normalize req.url to /mcp before passing to mcp-handler ([a16fd44](https://github.com/Paubox/paubox-mcp/commit/a16fd44d7b6dbada17c795e146710e93203b5e9a))
* normalize req.url to /mcp before passing to mcp-handler ([8d1123c](https://github.com/Paubox/paubox-mcp/commit/8d1123c9571f0f39e1fad64324dcdbe361e68077))
* pin pnpm to v9 in CI to avoid minimumReleaseAge policy on browserify-sign ([9249f28](https://github.com/Paubox/paubox-mcp/commit/9249f28c02a44a02cf3c4b9d561e26ad3f0fdd46))
* require transport-level auth, return 401 + WWW-Authenticate when unauthenticated ([40c9691](https://github.com/Paubox/paubox-mcp/commit/40c9691362b90045431dc6626e23698f493c48da))
* resolve internal AWS IP in OAuth discovery metadata ([6d4d2f0](https://github.com/Paubox/paubox-mcp/commit/6d4d2f0a811ca83ecaea68ffe0e3e46ca51359fb))
* resolve internal AWS IP in OAuth discovery metadata ([0e309d5](https://github.com/Paubox/paubox-mcp/commit/0e309d56be3faa40843e5fdbc1c5f1716163996b))
* return 401 when unauthenticated so Claude.ai triggers OAuth ([abbc0b6](https://github.com/Paubox/paubox-mcp/commit/abbc0b6eace01a8edbcd6889a18f2f47ccdcf73e))
* rewrite POST / to /mcp for Claude.ai connector ([7905887](https://github.com/Paubox/paubox-mcp/commit/7905887c7f0b1fdc8684a6622d5b579c3f7982e0))
* rewrite POST / to /mcp for Claude.ai connector compatibility ([58187af](https://github.com/Paubox/paubox-mcp/commit/58187afe1c104c3fb7a5465041f67b4cd22d09e6))
* run jest --runInBand to fix CI timeout failures ([dee0af3](https://github.com/Paubox/paubox-mcp/commit/dee0af3ea8f352389bccfeab1f421c026e0687d0))
* run jest --runInBand to prevent parallel server startup timeouts in CI ([a0b5f00](https://github.com/Paubox/paubox-mcp/commit/a0b5f00c32605c0374bedc425e49db657b8feb21))
* serialize deploys and bound the stability wait ([#57](https://github.com/Paubox/paubox-mcp/issues/57)) ([9d882e4](https://github.com/Paubox/paubox-mcp/commit/9d882e46f53e19e1a3ea3fe138bd94aef5e87d64))
* set minimumReleaseAge policy to 0 in pnpm-workspace.yaml ([20799d5](https://github.com/Paubox/paubox-mcp/commit/20799d5a09142511e8a7c6c89645e1b704477393))
* stateless JWE refresh tokens + disable SSE transport ([c3efb58](https://github.com/Paubox/paubox-mcp/commit/c3efb58fa6b5a081e602c0e9d01a433cdcfdc651))
* stateless JWE refresh tokens + disable SSE transport ([#33](https://github.com/Paubox/paubox-mcp/issues/33)) ([dff7fe6](https://github.com/Paubox/paubox-mcp/commit/dff7fe61ad7af8bd9fecd107a35d368698d83d15))
* switch to pnpm install --no-frozen-lockfile in CI ([746a0c1](https://github.com/Paubox/paubox-mcp/commit/746a0c1b5953ecfa460be93413b11873ddfcdd00))
* update API username example from paubox_api to api_user ([ba48216](https://github.com/Paubox/paubox-mcp/commit/ba4821699c549e5e3a58d45937d3769c911f44ee))
* update API username example from paubox_api to api_user ([6f475b7](https://github.com/Paubox/paubox-mcp/commit/6f475b7681ed78c9fdb517385369ac62b042a3e9))
* use --frozen-lockfile in CI to prevent pnpm auto-resolving new packages ([55ac832](https://github.com/Paubox/paubox-mcp/commit/55ac832b0d6d61f1995680cd5e7ed86f8f9b5d08))
* use pnpm 9 in CI with packages field in workspace file ([444c5c6](https://github.com/Paubox/paubox-mcp/commit/444c5c6d5e29c4e385f11af828c6559dccf33cd2))
* wait for ECS stability so a deploy job can actually fail ([#56](https://github.com/Paubox/paubox-mcp/issues/56)) ([b532081](https://github.com/Paubox/paubox-mcp/commit/b532081365a11b03632b6edfb60d989d6eedf0b2))
