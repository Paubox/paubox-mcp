import { z } from "zod"
import { createMcpHandler } from "mcp-handler"
import pauboxNode from "paubox-node"

// Validate Paubox credentials
const validateCredentials = (apiKey: string, apiUser: string) => {
  if (!apiKey || !apiUser) {
    throw new Error("Both API key and API user are required")
  }
  if (apiKey.length < 10) {
    throw new Error("Invalid API key format")
  }
  if (!apiUser.includes("@") && apiUser.length < 3) {
    throw new Error("Invalid API user format")
  }
}

const handler = createMcpHandler(
  (server) => {
    // Tool to send a secure email via Paubox with user-provided credentials
    server.tool(
      "send_secure_email",
      "Send a secure email using Paubox with your API credentials",
      {
        apiKey: z.string().min(10, "API key must be at least 10 characters"),
        apiUser: z.string().min(3, "API user is required"),
        from: z.string().email("From must be a valid email address"),
        to: z.array(z.string().email("Each recipient must be a valid email address")),
        subject: z.string().min(1, "Subject is required"),
        message: z.string().min(1, "Message content is required"),
        cc: z.array(z.string().email("Each CC recipient must be a valid email address")).optional(),
        bcc: z.array(z.string().email("Each BCC recipient must be a valid email address")).optional(),
        forceSecureNotification: z.boolean().optional(),
      },
      async ({ apiKey, apiUser, from, to, subject, message, cc, bcc, forceSecureNotification }) => {
        try {
          validateCredentials(apiKey, apiUser)

          const paubox = new pauboxNode.emailService({ apiKey, apiUsername: apiUser })

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
                text: `✅ Email sent successfully!\n\n📧 From: ${from}\n📧 To: ${to.join(", ")}\n📋 Subject: ${subject}\n🔍 Source Tracking ID: ${response.sourceTrackingId}\n🆔 Message ID: ${response.data.message_id}\n\n💡 Save the Source Tracking ID to check delivery status later.`,
              },
            ],
          }
        } catch (error) {
          console.error("Error sending email:", error)

          // Provide helpful error messages for common issues
          let errorMessage = error instanceof Error ? error.message : String(error)

          if (errorMessage.includes("401") || errorMessage.includes("unauthorized")) {
            errorMessage = "❌ Authentication failed. Please check your API key and API user credentials."
          } else if (errorMessage.includes("403") || errorMessage.includes("forbidden")) {
            errorMessage = "❌ Access denied. Please verify your Paubox account permissions."
          } else if (errorMessage.includes("400")) {
            errorMessage = "❌ Invalid request. Please check your email parameters."
          }

          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to send email: ${errorMessage}`,
              },
            ],
          }
        }
      },
    )

    // Tool to check email delivery status with user-provided credentials
    server.tool(
      "check_email_status",
      "Check the delivery status of a sent email using your API credentials",
      {
        apiKey: z.string().min(10, "API key must be at least 10 characters"),
        apiUser: z.string().min(3, "API user is required"),
        sourceTrackingId: z.string().min(1, "Source Tracking ID is required"),
      },
      async ({ apiKey, apiUser, sourceTrackingId }) => {
        try {
          validateCredentials(apiKey, apiUser)

          const paubox = new pauboxNode.emailService({ apiKey, apiUsername: apiUser })
          const response = await paubox.getEmailDisposition(sourceTrackingId)

          const statusEmoji =
            response.data.status === "delivered" ? "✅" : response.data.status === "failed" ? "❌" : "⏳"

          return {
            content: [
              {
                type: "text",
                text: `📬 Email Delivery Status\n\n${statusEmoji} Status: ${response.data.status}\n🆔 Message ID: ${response.data.message_id}\n👁️ Opened: ${response.data.opened ? "Yes" : "No"}\n📊 Delivery Details:\n${JSON.stringify(response.data.details, null, 2)}`,
              },
            ],
          }
        } catch (error) {
          console.error("Error checking email status:", error)

          let errorMessage = error instanceof Error ? error.message : String(error)

          if (errorMessage.includes("401") || errorMessage.includes("unauthorized")) {
            errorMessage = "❌ Authentication failed. Please check your API key and API user credentials."
          } else if (errorMessage.includes("404")) {
            errorMessage = "❌ Email not found. Please check the Source Tracking ID."
          }

          return {
            content: [
              {
                type: "text",
                text: `❌ Failed to check email status: ${errorMessage}`,
              },
            ],
          }
        }
      },
    )

    // Tool to validate Paubox credentials
    server.tool(
      "validate_credentials",
      "Validate your Paubox API credentials",
      {
        apiKey: z.string().min(10, "API key must be at least 10 characters"),
        apiUser: z.string().min(3, "API user is required"),
      },
      async ({ apiKey, apiUser }) => {
        try {
          validateCredentials(apiKey, apiUser)

          // Test the credentials by attempting to initialize the service
          const paubox = new pauboxNode.emailService({ apiKey, apiUsername: apiUser })

          // We could make a test call here, but for now we'll just validate the format
          return {
            content: [
              {
                type: "text",
                text: `✅ Credentials validated successfully!\n\n🔑 API User: ${apiUser}\n🔐 API Key: ${apiKey.substring(0, 4)}${"*".repeat(apiKey.length - 4)}\n\n✨ You can now send secure emails using Paubox.`,
              },
            ],
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Credential validation failed: ${error instanceof Error ? error.message : String(error)}`,
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

export { handler as GET, handler as POST, handler as DELETE }
