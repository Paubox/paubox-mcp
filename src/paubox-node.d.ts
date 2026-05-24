/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "paubox-node" {
  const pauboxNode: {
    emailService: new (config: { apiKey: string; apiUsername: string }) => any
    message: new (config: {
      from: string
      to: string[]
      cc?: string[] | null
      bcc?: string[] | null
      subject?: string | null
      text_content?: string | null
      html_content?: string | null
      forceSecureNotification?: boolean
      attachments?: unknown[]
    }) => any
  }
  export = pauboxNode
}
