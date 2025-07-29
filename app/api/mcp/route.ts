import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import pauboxNode from "paubox-node"

// Initialize Paubox Email Service
const initPauboxClient = () => {
  const apiKey = process.env.PAUBOX_API_KEY
  const apiUser = process.env.PAUBOX_API_USER

  if (!apiKey || !apiUser) {
    throw new Error("Missing Paubox API credentials. Set PAUBOX_API_KEY and PAUBOX_API_USER environment variables.")
  }

  // The CommonJS export is a factory function: emailService({ apiKey, apiUsername })
  return pauboxNode.emailService({ apiKey, apiUsername: apiUser })
}

const handler = createMcpHandler(
  (server) => {
    // Tool to send a secure email via Paubox
    server.tool(
      "send_secure_email",
      "Send a secure email using Paubox",
      {
        from: z.string().email("From must be a valid email address"),
        to: z.array(z.string().email("Each recipient must be a valid email address")),
        subject: z.string().min(1, "Subject is required"),
        message: z.string().min(1, "Message content is required"),
        cc: z.array(z.string().email("Each CC recipient must be a valid email address")).optional(),
        bcc: z.array(z.string().email("Each BCC recipient must be a valid email address")).optional(),
        forceSecureNotification: z.boolean().optional(),
      },
      async ({ from, to, subject, message, cc, bcc, forceSecureNotification }) => {
        try {
          const paubox = initPauboxClient()

          const emailData = {
            from,
            to,
            subject,
            text_content: message,
            html_content: message,
            cc,
            bcc,
            attachments: [],
            options: {
              force_secure_notification: forceSecureNotification,
            },
          }

          const response = await paubox.send(emailData)

          return {
            content: [
              {
                type: "text",
                text: `✅ Email sent successfully!\n\nSource Tracking ID: ${response.sourceTrackingId}\nMessage ID: ${response.data.message_id}`,
              },
            ],
          }
        } catch (error) {
          console.error("Error sending email:", error)
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to send email: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          }
        }
      },
    )

    // Tool to check email delivery status
    server.tool(
      "check_email_status",
      "Check the delivery status of a sent email",
      {
        sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
      },
      async ({ sourceTrackingId }) => {
        try {
          const paubox = initPauboxClient()
          const response = await paubox.getEmailDisposition(sourceTrackingId)

          return {
            content: [
              {
                type: "text",
                text: `📬 Email Status:\n\nMessage ID: ${response.data.message_id}\nStatus: ${response.data.status}\nOpened: ${response.data.opened ? "Yes" : "No"}\nDelivery Details: ${JSON.stringify(response.data.details, null, 2)}`,
              },
            ],
          }
        } catch (error) {
          console.error("Error checking email status:", error)
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to check email status: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          }
        }
      },
    )
  },
  {},
  { basePath: "/api" },
)


import { NextRequest, NextResponse } from 'next/server';

export const GET = (req: NextRequest) => {
  return new NextResponse(
    JSON.stringify({ error: 'Method Not Allowed' }),
    { status: 405, headers: { 'Content-Type': 'application/json' } }
  );
};

export { handler as POST, handler as DELETE };
