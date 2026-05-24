# Official Paubox MCP Server

This is the official Model Context Protocol (MCP) server for Paubox Email API, designed to be hosted by Paubox and used by customers with their own API credentials.

## Overview

This MCP server enables AI assistants to send secure, HIPAA-compliant emails through the Paubox Email API and to retrieve and submit Paubox Forms. Users provide their API credentials per session, ensuring security and multi-tenant support.

## Features

- Send secure emails with optional encryption
- Check email delivery status
- Retrieve Paubox Form metadata and field schemas
- Submit Paubox Form responses (with optional file attachments)
- HIPAA-compliant communication
- Easy integration with AI assistants that support MCP
- Paubox-branded UI with official components and styling
- **Proxy support for custom endpoints** (development/testing)

## For Paubox Customers

You don't host or clone anything to use Paubox MCP — Paubox runs the server at `https://mcp.paubox.com/mcp`. Add it as a connector in your AI client and enter your Paubox API credentials in the connector configuration form when prompted. See [Connecting to AI Assistants](#connecting-to-ai-assistants) below for client-specific setup.

The rest of this README covers self-hosting and local development.

## Proxy Configuration (Development/Testing)

For development or testing purposes, you can configure the MCP server to proxy requests to a custom endpoint instead of the official Paubox API.

### Manual Setup

To enable the proxy, you need to manually import the proxy module in your application. Add this import to your main application file or where you initialize your server:

```typescript
// Import this in your main app file to enable proxy functionality
import './lib/paubox-proxy'
```

### Environment Variables

Set these environment variables to enable proxy functionality:

```bash
# Enable proxy mode
PAUBOX_PROXY_ENABLED=true

# Custom base URL for proxying requests
PAUBOX_CUSTOM_BASE_URL=https://your-custom-endpoint.com
```

### How It Works

The proxy system uses axios interceptors to automatically redirect all Paubox API requests from:
- `https://api.paubox.net/v1/{apiUser}/`

To your custom endpoint:
- `https://your-custom-endpoint.com/v1/{apiUser}/`

The proxy replaces the original API domain (`https://api.paubox.net`) with your custom base URL while preserving the API path structure.

### Use Cases

- **Testing**: Point to a mock API server for testing
- **Development**: Use a local development server
- **Custom Deployment**: Route through your own proxy server
- **Staging**: Use a staging environment

### Example Configuration

```bash
# For local development
PAUBOX_PROXY_ENABLED=true
PAUBOX_CUSTOM_BASE_URL=http://localhost:8080

# For staging environment
PAUBOX_PROXY_ENABLED=true
PAUBOX_CUSTOM_BASE_URL=https://staging-api.paubox.com
```

### Implementation Details

The proxy is implemented in `lib/paubox-proxy.ts` and only initializes when the `PAUBOX_PROXY_ENABLED` environment variable is set to `true`. It intercepts all HTTP requests made by the paubox-node package and modifies the base URL accordingly.

**Note**: The proxy is not automatically loaded by the MCP server to avoid test interference. You must manually import it if you want to use proxy functionality.

## Styling & Components

This project uses Paubox's official design system:

- **Brand Colors**: Implements Paubox's official color palette
- **Logo**: Features the official Paubox logo
- **Typography**: Uses Paubox's design tokens and spacing

### Color System

The application uses Paubox's official color palette:
- **Primary (Blue)**: `#2E70FF` - Main brand color
- **Success (Green)**: `#0EA472` - Success states
- **Warning (Yellow)**: `#FFCA2F` - Warning states  
- **Danger (Red)**: `#E02D3C` - Error states
- **Neutral (Gray)**: Various shades for text and backgrounds

### Components

Available Paubox components include:
- Buttons with various styles and states
- Cards with branded headers and content areas
- Alerts for notifications and warnings
- Typography components
- Form inputs and controls

### Connecting to AI Assistants

There are three ways to provide your Paubox API credentials, in resolution priority order:

- **Per-call tool parameters** (highest priority): Pass `apiKey` and `apiUser` directly in each tool call. Useful for one-off use or scripted clients.
- **Custom connector headers**: Set `x-paubox-api-key` and `x-paubox-api-user` as custom request headers on the connector. Some MCP clients expose this in Advanced Settings when adding a custom connector.
- **OAuth (recommended for Claude.ai and Claude Desktop)**: Add the connector URL and a "Configure Paubox" form appears automatically. Enter your credentials once — the client stores a short-lived encrypted Bearer token and sends it on every future request. Credentials are validated against the Paubox API at the moment you submit the form, so typos or expired keys are caught immediately.

#### Claude.ai — Claude Connectors (recommended)

1. Go to [claude.ai](https://claude.ai) and open **Settings → Integrations**
2. Click **Add connector** and enter URL `https://mcp.paubox.com/mcp`
3. A "Configure Paubox" form opens — enter your API username and API key
4. Click **Save**

Claude stores your credentials as a secure token in the system keychain and sends it automatically on every request. You never need to include credentials in your prompts.

#### Claude Desktop

1. Open Claude Desktop and navigate to **Settings**
2. Under the **Developer** tab, tap **Edit Config**
3. Add this configuration:

```json
{
  "mcpServers": {
    "paubox": {
      "url": "https://mcp.paubox.com/mcp"
    }
  }
}
```

4. Save the file — Claude Desktop will open a browser window to the "Configure Paubox" form to collect your credentials.

#### Cursor (for local testing)

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "paubox": {
      "url": "https://mcp.paubox.com/mcp"
    }
  }
}
```

## Available Tools

### validate_credentials

Validates your Paubox API credentials.

**Parameters:**
- `apiKey`: Your Paubox API key (string, optional if provided via connector headers)
- `apiUser`: Your Paubox API user (string, optional if provided via connector headers)

**Example Usage:**
\`\`\`
Validate my Paubox credentials with API key "pk_live_..." and API user "user@company.com"
\`\`\`

### send_secure_email

Sends a secure email using your Paubox credentials.

**Parameters:**
- `apiKey`: Your Paubox API key (string, optional if provided via connector headers)
- `apiUser`: Your Paubox API user (string, optional if provided via connector headers)
- `from`: Sender email address (string, required)
- `to`: Recipient email addresses (array, required)
- `subject`: Email subject (string, required)
- `message`: Email content (string, required)
- `cc`: CC recipients (array, optional)
- `bcc`: BCC recipients (array, optional)
- `forceSecureNotification`: Force secure notification (boolean, optional)

**Example Usage (credentials via connector):**
\`\`\`
Send a secure email from "doctor@clinic.com" to "patient@example.com" with subject "Test Results" and message "Your results are ready."
\`\`\`

**Example Usage (credentials as parameters):**
\`\`\`
Send a secure email using my API key "pk_live_..." and API user "user@company.com" from "doctor@clinic.com" to "patient@example.com" with subject "Test Results" and message "Your results are ready."
\`\`\`

### check_email_status

Checks the delivery status of a sent email.

**Parameters:**
- `apiKey`: Your Paubox API key (string, optional if provided via connector headers)
- `apiUser`: Your Paubox API user (string, optional if provided via connector headers)
- `sourceTrackingId`: Tracking ID from sent email (string, required)

**Example Usage:**
\`\`\`
Check the status of email with tracking ID "abc123"
\`\`\`

### get_form

Retrieves metadata and the field schema for a Paubox Form. No API credentials required.

**Parameters:**
- `formId`: UUID of the Paubox Form (string, required)

**Returns:** id, title, description, field definitions (`form_json`), active status, signable flag, submission count, and timestamps.

**Example Usage:**
\`\`\`
Get the form schema for Paubox form "550e8400-e29b-41d4-a716-446655440000"
\`\`\`

### submit_form

Submits a response to a Paubox Form. No API credentials required.

**Parameters:**
- `formId`: UUID of the Paubox Form (string, required)
- `formData`: Key-value pairs matching the form's field schema (object, required)
- `attachments`: Optional file attachments (array of `{ name, content }` where `content` is base64-encoded)

**Example Usage:**
\`\`\`
Submit form "550e8400-e29b-41d4-a716-446655440000" with first_name "Jane", last_name "Smith", and email "jane@example.com"
\`\`\`

## Security & Compliance

- **HIPAA Compliant**: All emails are sent through Paubox's HIPAA-compliant infrastructure
- **Credential Security**: API credentials are never stored or logged
- **Encrypted Transit**: All communications use HTTPS/TLS encryption
- **Audit Trail**: Email sending and status checking activities are logged (without credentials)

## Support

For technical support or API access questions, contact Paubox support at support@paubox.com.

## Development

### Environment variables

Copy `.env.example` to `.env.local` and fill in the required value:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Signing secret for OAuth tokens. Generate with: `openssl rand -base64 32` |
| `PAUBOX_API_KEY` | No | Local-dev fallback. Honored only when `NODE_ENV !== 'production'` and no OAuth token / `x-paubox-*` headers / tool parameters are present. Deliberately ignored in production to prevent cross-user credential bleed. |
| `PAUBOX_API_USER` | No | Local-dev fallback (same semantics as `PAUBOX_API_KEY`). |

### Testing

Run the test suite:
```bash
pnpm test
```

### Building

Build for production:
```bash
pnpm build
```

### Deployment

This project uses GitHub Actions for automated deployment to AWS ECR with three distinct deployment workflows:

#### Deployment Workflows

1. **Staging Deployment** (`.github/workflows/deploy-staging.yml`)
   - **Trigger**: Pushes to `develop` branch and pull requests to `develop`
   - **Purpose**: Builds and pushes Docker images to staging ECR for testing
   - **Repository**: `paubox-mcp-server-staging`
   - **Tags**: Git SHA, branch name, PR number, and `latest` for develop branch

2. **Production Deployment** (`.github/workflows/deploy-prod.yml`)
   - **Trigger**: Pull request merges to `main` branch
   - **Purpose**: Automatically deploys approved changes to production
   - **Repository**: `paubox-mcp-server-production`
   - **Tags**: Git SHA and `latest`
   - **Process**: Builds Docker image directly from source code

3. **Hotfix Deployment** (`.github/workflows/deploy-hotfix.yml`)
   - **Trigger**: Manual workflow dispatch
   - **Purpose**: Emergency deployments and urgent fixes
   - **Repository**: `paubox-mcp-server-production`
   - **Use Cases**: Critical bug fixes, security patches, rollbacks

#### GitHub Secrets

The deployment workflows use the following secrets configured at the organization level:

1. **AWS_GITHUB_ACTIONS_ACCESS_KEY_ID**: AWS access key ID
2. **AWS_GITHUB_ACTIONS_SECRET_ACCESS_KEY**: AWS secret access key

These credentials have permissions to:
- Push to staging ECR repository: `285263271540.dkr.ecr.us-west-2.amazonaws.com/paubox-mcp-server-staging`
- Push to production ECR repository: `285263271540.dkr.ecr.us-west-2.amazonaws.com/paubox-mcp-server-production`
- Authenticate with ECR

#### Deployment Process

**Staging Flow:**
1. Code pushed to `develop` branch or PR created
2. GitHub Actions builds Docker image
3. Image pushed to staging ECR with appropriate tags
4. Available for testing and validation

**Production Flow:**
1. PR merged to `main` branch
2. GitHub Actions automatically builds production Docker image
3. Image pushed to production ECR with git SHA and latest tags
4. Ready for production deployment

**Hotfix Flow:**
1. Manual workflow trigger
2. Builds and deploys specific code version
3. Bypasses normal PR process for urgent situations

#### Manual Deployment

To deploy a feature branch manually to staging:
1. Go to the **Actions** tab in GitHub
2. Select **Deploy to Staging** workflow
3. Click **Run workflow**
4. Enter the branch name you want to deploy
5. Click **Run workflow**

For production hotfixes:
1. Go to the **Actions** tab in GitHub
2. Select **Deploy Hotfix** workflow
3. Click **Run workflow**
4. Follow the workflow prompts

### Styling

The project uses a hybrid approach:
- **Tailwind CSS**: For layout and responsive design
- **Paubox Colors**: Official brand colors via `lib/paubox-colors.ts`
- **Component Styling**: Inline styles for Paubox-specific theming

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

Copyright © 2026 Paubox, Inc.
