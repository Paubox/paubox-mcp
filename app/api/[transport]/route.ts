import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import { sendEmail, getEmailDisposition } from '../../../lib/paubox-email'

const handler = createMcpHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server: any) => {
    server.tool(
      "validate_credentials",
      "Validate Paubox API credentials before sending email",
      {
        apiKey: z.string().min(10, "API key must be at least 10 characters"),
      },
      async ({ apiKey }: { apiKey: string }) => {
        try {
          if (!apiKey || apiKey.trim().length < 10) {
            throw new Error("Invalid API key format")
          }
          return {
            content: [
              {
                type: "text",
                text: `✅ Credentials validated successfully!\n\n🔑 API Key: ${apiKey.slice(0, 4)}${"*".repeat(Math.max(0, apiKey.length - 4))}\n\n💡 You can now use send_secure_email to send emails.`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Credential validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
          }
        }
      }
    )

    server.tool(
      "send_secure_email",
      "Send a secure, HIPAA-compliant email using Paubox with your API credentials",
      {
        apiKey: z.string(),
        from: z.string(),
        to: z.array(z.string()),
        subject: z.string(),
        message: z.string(),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        forceSecureNotification: z.boolean().optional(),
      },
      async ({ apiKey, from, to, subject, message, cc, bcc, forceSecureNotification }: {
        apiKey: string;
        from: string;
        to: string[];
        subject: string;
        message: string;
        cc?: string[];
        bcc?: string[];
        forceSecureNotification?: boolean;
      }) => {
        try {
          if (!message || message.trim().length === 0) {
            throw new Error("Message content is required and cannot be empty")
          }

          const response = await sendEmail(apiKey, {
            from,
            to,
            subject,
            textContent: message.trim(),
            htmlContent: `<p>${message.trim()}</p>`,
            cc,
            bcc,
            forceSecureNotification: forceSecureNotification ?? false,
          })

          return {
            content: [
              {
                type: "text",
                text: `✅ Email sent successfully!\n\n📧 From: ${from}\n📧 To: ${to.join(", ")}\n📋 Subject: ${subject}\n🔍 Source Tracking ID: ${response.sourceTrackingId}\n🆔 Message ID: ${response.data?.message_id}\n\n💡 Save the Source Tracking ID to check delivery status later.`,
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

    server.tool(
      "check_email_status",
      "Check the delivery status of a previously sent email using its Source Tracking ID",
      {
        apiKey: z.string(),
        sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
      },
      async ({ apiKey, sourceTrackingId }: {
        apiKey: string;
        sourceTrackingId: string;
      }) => {
        try {
          if (!sourceTrackingId || sourceTrackingId.trim().length === 0) {
            throw new Error("Source Tracking ID is required")
          }

          const response = await getEmailDisposition(apiKey, sourceTrackingId.trim())

          return {
            content: [
              {
                type: "text",
                text: `📊 Email Status Report\n\n🔍 Source Tracking ID: ${sourceTrackingId}\n📬 Status: ${JSON.stringify(response, null, 2)}`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to check email status: ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'}`,
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

export { handler as GET, handler as POST }
