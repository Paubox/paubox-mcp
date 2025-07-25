"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail, Shield, CheckCircle } from "lucide-react"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-3xl space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Paubox MCP Server</h1>
          <p className="mt-4 text-lg text-slate-600">
            A Model Context Protocol server for secure email communication via Paubox
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-emerald-500" />
              Secure Email API
            </CardTitle>
            <CardDescription>Connect AI assistants to Paubox's HIPAA-compliant email service</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <h3 className="flex items-center gap-2 font-medium text-slate-900">
                  <Mail className="h-4 w-4 text-blue-500" />
                  send_secure_email
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Send HIPAA-compliant emails with optional encryption and delivery tracking
                </p>
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <h3 className="flex items-center gap-2 font-medium text-slate-900">
                  <CheckCircle className="h-4 w-4 text-blue-500" />
                  check_email_status
                </h3>
                <p className="mt-1 text-sm text-slate-600">Check delivery status and open tracking for sent emails</p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <p className="text-sm text-slate-500">Requires Paubox API credentials</p>
            <Button variant="outline" onClick={() => (window.location.href = "https://github.com/paubox/paubox-node")}>
              View Documentation
            </Button>
          </CardFooter>
        </Card>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">Environment Setup Required</p>
          <p className="mt-1">
            Set <code className="rounded bg-amber-100 px-1">PAUBOX_API_KEY</code> and{" "}
            <code className="rounded bg-amber-100 px-1">PAUBOX_API_USER</code> environment variables to use this MCP
            server.
          </p>
        </div>
      </div>
    </div>
  )
}
