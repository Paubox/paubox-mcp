# Official Paubox MCP Server

This is the official Model Context Protocol (MCP) server for Paubox Email API, designed to be hosted by Paubox and used by customers with their own API credentials.

## Overview

This MCP server enables AI assistants to send secure, HIPAA-compliant emails through the Paubox Email API. Users provide their API credentials per session, ensuring security and multi-tenant support.

## Features

- **Multi-tenant Architecture**: Each user provides their own API credentials
- **Credential Validation**: Validate API credentials before sending emails  
- **Secure Email Sending**: Send HIPAA-compliant emails with encryption
- **Delivery Tracking**: Check email delivery status and open rates
- **Error Handling**: Comprehensive error messages and troubleshooting
- **No Credential Storage**: Credentials are used per-request only

## For Paubox Customers

### Getting Your API Credentials

1. Log into your Paubox account
2. Navigate to API settings
3. Generate or retrieve your API key and API user
4. Use these credentials when prompted by your AI assistant

### Connecting to AI Assistants

#### Claude Desktop

1. Open Claude desktop and navigate to **Settings**
2. Under the **Developer** tab, tap **Edit Config**
3. Add this configuration:

\`\`\`json
{
  "mcpServers": {
    "paubox": {
      "url": "https://mcp.paubox.com/api/mcp"
    }
  }
}
\`\`\`

#### Cursor

Add to `.cursor/mcp.json`:

\`\`\`json
{
  "mcpServers": {
    "paubox": {
      "url": "https://mcp.paubox.com/api/mcp"
    }
  }
}
\`\`\`

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

## License

Copyright © Paubox, Inc. All rights reserved.
