# Paubox MCP Server

This is a Model Context Protocol (MCP) server that integrates with the Paubox Email API to enable AI assistants to send secure, HIPAA-compliant emails.

## Features

- Send secure emails with optional encryption
- Check email delivery status
- HIPAA-compliant communication
- Easy integration with AI assistants that support MCP

## Setup

1. Clone this repository
2. Install dependencies:
   \`\`\`
   npm install
   \`\`\`
3. Set up environment variables:
   - `PAUBOX_API_KEY`: Your Paubox API key
   - `PAUBOX_API_USER`: Your Paubox API user/username

4. Run the development server:
   \`\`\`
   npm run dev
   \`\`\`

## Connecting to AI Assistants

### Claude

1. Open Claude desktop and navigate to **Settings**.
2. Under the **Developer** tab, tap **Edit Config** to open the configuration file.
3. Add the following configuration:

\`\`\`json
{
  "mcpServers": {
    "paubox": {
      "url": "https://your-deployed-url.vercel.app/api/mcp"
    }
  }
}
\`\`\`

### Cursor

Add the URL of your MCP server to the configuration file in Streamable HTTP transport format.

`.cursor/mcp.json`:
\`\`\`json
{
  "mcpServers": {
    "paubox": {
      "url": "https://your-deployed-url.vercel.app/api/mcp"
    }
  }
}
\`\`\`

## Available Tools

### send_secure_email

Sends a secure email using Paubox.

Parameters:
- `from`: Sender email address (string, required)
- `to`: Array of recipient email addresses (string[], required)
- `subject`: Email subject (string, required)
- `message`: Email content (string, required)
- `cc`: Array of CC recipient email addresses (string[], optional)
- `bcc`: Array of BCC recipient email addresses (string[], optional)
- `forceSecureNotification`: Force secure notification (boolean, optional)

### check_email_status

Checks the delivery status of a sent email.

Parameters:
- `sourceTrackingId`: Source tracking ID of the sent email (string, required)

## License

MIT
