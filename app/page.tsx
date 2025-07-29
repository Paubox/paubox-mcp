"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Mail, Shield, CheckCircle, Key, Users, Globe } from "lucide-react"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-4xl space-y-8">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Shield className="h-10 w-10 text-blue-600" />
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Paubox MCP Server</h1>
          </div>
          <p className="mt-4 text-lg text-slate-600">
            Official Model Context Protocol server for secure, HIPAA-compliant email communication
          </p>
          <Badge variant="secondary" className="mt-2">
            Multi-tenant • Credential-per-session
          </Badge>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-emerald-500" />
                validate_credentials
              </CardTitle>
              <CardDescription>Validate your Paubox API credentials before sending emails</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-slate-600">
                <p>• Validates API key format</p>
                <p>• Confirms API user credentials</p>
                <p>• Provides secure credential masking</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-500" />
                send_secure_email
              </CardTitle>
              <CardDescription>Send HIPAA-compliant emails with your credentials</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-slate-600">
                <p>• Requires your API key and user per request</p>
                <p>• Supports CC, BCC, and secure notifications</p>
                <p>• Returns tracking ID for status checks</p>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <CheckCircle className="h-5 w-5 text-purple-500" />
                check_email_status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                <p>• Real-time delivery status</p>
                <p>• Open tracking analytics</p>
                <p>• Detailed delivery reports</p>
                <p>• Error handling and diagnostics</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-900">
              <Users className="h-5 w-5" />
              For Paubox Customers
            </CardTitle>
          </CardHeader>
          <CardContent className="text-blue-800">
            <p className="mb-4">
              This MCP server allows you to use your existing Paubox account with AI assistants. Simply provide your API
              credentials when prompted.
            </p>
            <div className="space-y-2 text-sm">
              <p>
                <strong>✅ Secure:</strong> Credentials are only used per-request, never stored
              </p>
              <p>
                <strong>✅ Compliant:</strong> Maintains HIPAA compliance standards
              </p>
              <p>
                <strong>✅ Flexible:</strong> Works with any MCP-compatible AI assistant
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              className="w-full bg-transparent"
              onClick={() => window.open("https://www.paubox.com/solutions/email-api", "_blank")}
            >
              <Globe className="mr-2 h-4 w-4" />
              Get Paubox API Access
            </Button>
          </CardFooter>
        </Card>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">🔐 Security Notice</p>
          <p className="mt-1">
            Your API credentials are transmitted securely and used only for the duration of each request. This server
            does not store or log your credentials.
          </p>
        </div>
      </div>
    </div>
  )
}
