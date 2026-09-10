# Changelog

All notable changes to this project will be documented in this file.

This changelog tracks the **`@paubox/mcp` npm package** — the stdio server that
AI clients spawn locally. The hosted server at `https://mcp.paubox.com/mcp` is
deployed independently from `main` and is not versioned here.

## [Unreleased]

`@paubox/mcp` has never been published to npm and this repository has never
carried a git tag. `1.0.0` will be the first tagged release, and the first
version for which the `npx @paubox/mcp@latest` instructions in the README
actually resolve.

### 🚀 Features

MCP server exposing the Paubox APIs to AI clients over two transports: a hosted
HTTP server, and a stdio server distributed as this package.

- **Email** — `send_secure_email`, `check_email_status`, `schedule_email`, `get_scheduled_email`, `reschedule_email`, `cancel_scheduled_email`
- **Forms** — `get_form`, `submit_form`, `list_forms`, `create_form`, `update_form`, `copy_form`, `archive_form`, `unarchive_form`, `get_form_stats`, `list_form_submissions`, `export_submissions_csv`, `export_submission_pdf`
- **Marketing** — `list_marketing_lists`, `list_dynamic_lists`, `list_subscription_lists`, `create_subscription_list`, `get_subscribed_count`, `list_subscribers`, `get_subscriber`, `create_subscriber`, `update_subscriber`, `list_subscriber_custom_fields`, `get_campaign_analytics`, `list_campaign_sends`, `list_campaign_deliveries`, `get_marketing_bulk_job`
- **Access** — `validate_credentials`, `validate_marketing_access`

### 📦 Distribution

- Two independent channels. The npm package is versioned by this changelog; the hosted server deploys from `main` on its own cadence, so the npm version does **not** indicate what is running at `mcp.paubox.com`
- Authentication differs by transport. The package reads `PAUBOX_API_KEY` from the environment at spawn time; the hosted server resolves the key from an OAuth token, the `x-paubox-api-key` header, or a tool parameter
