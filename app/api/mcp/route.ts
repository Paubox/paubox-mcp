import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import pauboxNode from 'paubox-node'

// Type definition for Paubox Message
type PauboxMessage = {
  from: string;
  to: string[];
  replyTo: string | null;
  cc: string[] | null;
  bcc: string[] | null;
  subject: string | null;
  customHeaders: Record<string, string>;
  allowNonTLS: boolean;
  forceSecureNotification: boolean;
  attachments: unknown[] | null;
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  plaintext: string | null;
  htmltext: string | null;
  validate(): void;
  toJSON(): unknown;
}

// Add minimal error handler to capture 'h' variable
process.on('uncaughtException', (error) => {
  if (error.message.includes('h.send')) {
    console.error("ding dong")
    //console.error('🔍 DEBUG: Found h.send error at:', error.stack?.split('\n')[1])
  }
})

// Create Paubox service
const createPauboxService = (config: { apiKey: string; apiUsername: string }) => {
  return new pauboxNode.emailService(config)
}

const handler = createMcpHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server: any) => {
    server.tool(
      "send_secure_email",
      "Send a secure email using Paubox with your API credentials",
      {
        apiKey: z.string(),
        apiUser: z.string(),
        from: z.string(),
        to: z.array(z.string()),
        subject: z.string(),
        message: z.string(),
      },
      async ({ apiKey, apiUser, from, to, subject, message }: {
        apiKey: string;
        apiUser: string;
        from: string;
        to: string[];
        subject: string;
        message: string;
      }) => {
        try {
          // Validate that message content is provided
          if (!message || message.trim().length === 0) {
            throw new Error("Message content is required and cannot be empty")
          }

          const pauboxService = createPauboxService({ apiKey, apiUsername: apiUser })
          const emailMessage: PauboxMessage = new pauboxNode.message({
            from,
            to,
            subject,
            text_content: message.trim(),
            html_content: `<p>${message.trim()}</p>`,
            attachments: [],
          })

          const response = await pauboxService.sendMessage(emailMessage)

          return {
            content: [
              {
                type: "text",
                text: `✅ Email sent successfully!\n\n📧 From: ${from}\n📧 To: ${to.join(", ")}\n📋 Subject: ${subject}\n🔍 Source Tracking ID: ${response.sourceTrackingId}\n🆔 Message ID: ${response.data.message_id}\n\n💡 Save the Source Tracking ID to check delivery status later.`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to send email: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'}`,
              },
            ],
          }
        }
      }
    )
  },
  {},
  { basePath: "/api" }
)

export { handler as GET, handler as POST, handler as DELETE } 