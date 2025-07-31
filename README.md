# Official Paubox MCP Server

This is the official Model Context Protocol (MCP) server for Paubox Email API, designed to be hosted by Paubox and used by customers with their own API credentials.

## Overview

This MCP server enables AI assistants to send secure, HIPAA-compliant emails through the Paubox Email API. Users provide their API credentials per session, ensuring security and multi-tenant support.

## Features

- Send secure emails with optional encryption
- Check email delivery status
- HIPAA-compliant communication
- Easy integration with AI assistants that support MCP
- Paubox-branded UI with official components and styling
- **Proxy support for custom endpoints** (development/testing)

## For Paubox Customers

1. Clone this repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Set up environment variables:
   - `PAUBOX_API_KEY`: Your Paubox API key
   - `PAUBOX_API_USER`: Your Paubox API user/username

4. Run the development server:
   ```bash
   pnpm dev
   ```

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

#### Claude Desktop

1. Open Claude desktop and navigate to **Settings**
2. Under the **Developer** tab, tap **Edit Config**
3. Add this configuration:

```json
{
  "mcpServers": {
    "paubox": {
      "url": "https://mcp.paubox.com/api/mcp"
    }
  }
}
```

#### Cursor (for local testing)

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "paubox": {
      "url": "https://mcp.paubox.com/api/mcp"
    }
  }
}
```

## Available Tools

### validate_credentials

Validates your Paubox API credentials.

**Parameters:**
- `apiKey`: Your Paubox API key (string, required)
- `apiUser`: Your Paubox API user (string, required)

**Example Usage:**
\`\`\`
Validate my Paubox credentials with API key "pk_live_..." and API user "user@company.com"
\`\`\`

### send_secure_email

Sends a secure email using your Paubox credentials.

**Parameters:**
- `apiKey`: Your Paubox API key (string, required)
- `apiUser`: Your Paubox API user (string, required)
- `from`: Sender email address (string, required)
- `to`: Recipient email addresses (array, required)
- `subject`: Email subject (string, required)
- `message`: Email content (string, required)
- `cc`: CC recipients (array, optional)
- `bcc`: BCC recipients (array, optional)
- `forceSecureNotification`: Force secure notification (boolean, optional)

**Example Usage:**
\`\`\`
Send a secure email using my API key "pk_live_..." and API user "user@company.com" from "doctor@clinic.com" to "patient@example.com" with subject "Test Results" and message "Your results are ready."
\`\`\`

### check_email_status

Checks the delivery status of a sent email.

**Parameters:**
- `apiKey`: Your Paubox API key (string, required)
- `apiUser`: Your Paubox API user (string, required)
- `sourceTrackingId`: Tracking ID from sent email (string, required)

**Example Usage:**
\`\`\`
Check the status of email with tracking ID "abc123" using my API credentials
\`\`\`

## Security & Compliance

- **HIPAA Compliant**: All emails are sent through Paubox's HIPAA-compliant infrastructure
- **Credential Security**: API credentials are never stored or logged
- **Encrypted Transit**: All communications use HTTPS/TLS encryption
- **Audit Trail**: Email sending and status checking activities are logged (without credentials)

## Support

For technical support or API access questions, contact Paubox support at support@paubox.com.

## Development

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

### Styling

The project uses a hybrid approach:
- **Tailwind CSS**: For layout and responsive design
- **Paubox Colors**: Official brand colors via `lib/paubox-colors.ts`
- **Component Styling**: Inline styles for Paubox-specific theming

## License

Copyright © Paubox, Inc. All rights reserved.
