#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import pauboxNode from "paubox-node"

const apiKey = process.env.PAUBOX_API_KEY
const apiUser = process.env.PAUBOX_API_USER

if (!apiKey || apiKey.trim().length < 10) {
  process.stderr.write(
    "Error: PAUBOX_API_KEY environment variable is required (minimum 10 characters)\n"
  )
  process.exit(1)
}
if (!apiUser || apiUser.trim().length === 0) {
  process.stderr.write("Error: PAUBOX_API_USER environment variable is required\n")
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pauboxService: any = new pauboxNode.emailService({
  apiKey: apiKey.trim(),
  apiUsername: apiUser.trim(),
})

const server = new McpServer({ name: "paubox", version: "1.0.0" })

server.tool(
  "validate_credentials",
  "Confirm that the Paubox API credentials configured via environment variables are present and correctly formatted",
  {},
  async () => {
    const masked = apiKey!.slice(0, 4) + "*".repeat(Math.max(0, apiKey!.length - 4))
    return {
      content: [
        {
          type: "text" as const,
          text: `Credentials configured\n\nAPI User: ${apiUser}\nAPI Key: ${masked}\n\nReady to send email with send_secure_email.`,
        },
      ],
    }
  }
)

server.tool(
  "send_secure_email",
  "Send a secure, HIPAA-compliant email using Paubox",
  {
    from: z.string().email("Must be a valid email address"),
    to: z.array(z.string().email()).min(1, "At least one recipient is required"),
    subject: z.string().min(1, "Subject is required"),
    message: z.string().min(1, "Message content is required"),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    forceSecureNotification: z.boolean().optional(),
  },
  async ({
    from,
    to,
    subject,
    message,
    cc,
    bcc,
    forceSecureNotification,
  }: {
    from: string
    to: string[]
    subject: string
    message: string
    cc?: string[]
    bcc?: string[]
    forceSecureNotification?: boolean
  }) => {
    try {
      const emailMessage = new pauboxNode.message({
        from,
        to,
        cc: cc ?? null,
        bcc: bcc ?? null,
        subject,
        text_content: message.trim(),
        html_content: `<p>${message.trim()}</p>`,
        forceSecureNotification: forceSecureNotification ?? false,
        attachments: [],
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await pauboxService.sendMessage(emailMessage)

      return {
        content: [
          {
            type: "text" as const,
            text: `Email sent\n\nFrom: ${from}\nTo: ${to.join(", ")}\nSubject: ${subject}\nSource Tracking ID: ${response.sourceTrackingId}\nMessage ID: ${response.data.message_id}\n\nSave the Source Tracking ID to check delivery status later.`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to send email: ${error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"}`,
          },
        ],
      }
    }
  }
)

server.tool(
  "check_email_status",
  "Check the delivery status of a previously sent email using its Source Tracking ID",
  {
    sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
  },
  async ({ sourceTrackingId }: { sourceTrackingId: string }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await pauboxService.getEmailDisposition(sourceTrackingId.trim())

      return {
        content: [
          {
            type: "text" as const,
            text: `Email Status\n\nSource Tracking ID: ${sourceTrackingId}\nStatus: ${JSON.stringify(response, null, 2)}`,
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to check email status: ${error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"}`,
          },
        ],
      }
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
