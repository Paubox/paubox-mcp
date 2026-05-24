"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Mail, Shield } from "lucide-react";
import Image from "next/image";
import { pauboxColors, pauboxTheme } from "@/lib/paubox-colors";
import Script from "next/script";

export default function Home() {
  const isProd = process.env.NODE_ENV === "production";
  return (
    <>
      {/* Google Analytics (only in production) */}
      {isProd && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=G-KX3YN04LKV`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-KX3YN04LKV');
            `}
          </Script>
        </>
      )}
      {/* Main content */}
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-indigo-100 p-4">
        <div className="w-full max-w-4xl space-y-8">
          <div className="text-center">
            {/* Paubox Logo */}
            <div className="flex justify-center mb-6">
              <Image
                src="/paubox.png"
                alt="Paubox Logo"
                width={120}
                height={120}
                className="h-10 w-auto"
              />
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              MCP Server
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              Official MCP server which allows AI agents to interact with Paubox
              Email API.
            </p>
          </div>

          <Card className="border-2 border-[#2E70FF]/20 shadow-lg">
            <CardHeader
              className="border-b border-[#2E70FF]/10"
              style={{
                background: pauboxTheme.card.header.background,
              }}
            >
              <CardTitle
                className="flex items-center gap-2"
                style={{ color: pauboxTheme.card.header.text }}
              >
                <Shield
                  className="h-5 w-5"
                  style={{ color: pauboxColors.primary[500] }}
                />
                Secure Email API
              </CardTitle>
              <CardDescription style={{ color: pauboxColors.text.primary }}>
                Connect AI assistants to Paubox&apos;s HIPAA compliant email
                service
              </CardDescription>
            </CardHeader>
            <CardContent className="bg-white">
              <div className="space-y-4">
                <div
                  className="rounded-lg p-4 border"
                  style={{
                    background: pauboxColors.neutral[100],
                    borderColor: pauboxColors.neutral[200],
                  }}
                >
                  <h3
                    className="flex items-center gap-2 font-medium"
                    style={{ color: pauboxColors.text.primary }}
                  >
                    <Mail
                      className="h-4 w-4"
                      style={{ color: pauboxColors.primary[500] }}
                    />
                    send_secure_email
                  </h3>
                  <p
                    className="mt-1 text-sm"
                    style={{ color: pauboxColors.text.secondary }}
                  >
                    Send HIPAA compliant emails with optional encryption and
                    delivery tracking
                  </p>
                </div>

                {/* <div 
                  className="rounded-lg p-4 border"
                  style={{
                    background: pauboxColors.neutral[100],
                    borderColor: pauboxColors.neutral[200],
                  }}
                >
                  <h3 className="flex items-center gap-2 font-medium" style={{ color: pauboxColors.text.primary }}>
                    <CheckCircle className="h-4 w-4" style={{ color: pauboxColors.success[600] }} />
                    check_email_status
                  </h3>
                  <p className="mt-1 text-sm" style={{ color: pauboxColors.text.secondary }}>
                    Check delivery status and open tracking for sent emails
                  </p>
                </div> */}
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <Shield className="h-5 w-5" />
                For Paubox Customers
              </CardTitle>
            </CardHeader>
            <CardContent className="text-blue-800">
              <p className="mb-4">
                This MCP server allows you to use your existing Paubox account
                with AI assistants. Simply provide your API credentials when
                prompted.
              </p>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>✅ Secure:</strong> Credentials are only used
                  per-request, never stored
                </p>
                <p>
                  <strong>✅ Compliant:</strong> Maintains HIPAA compliance
                  standards
                </p>
                <p>
                  <strong>✅ Flexible:</strong> Works with any MCP-compatible AI
                  assistant
                </p>
              </div>
            </CardContent>
            <CardFooter
              className="flex justify-between border-t"
              style={{
                background: pauboxTheme.card.footer.background,
                borderColor: pauboxTheme.card.footer.border,
              }}
            >
              <p
                className="text-sm"
                style={{ color: pauboxTheme.card.footer.text }}
              >
                Requires Paubox Email API credentials
              </p>
              <Button
                variant="outline"
                className="hover:text-white transition-colors"
                style={{
                  borderColor: pauboxTheme.button.outline.border,
                  color: pauboxTheme.button.outline.text,
                }}
                onClick={() =>
                  (window.location.href =
                    "https://docs.paubox.com/paubox_email_api/docs/quickstart")
                }
              >
                View Documentation
              </Button>
            </CardFooter>
          </Card>

          <div
            className="rounded-lg border-2 p-4 text-sm"
            style={{
              borderColor: pauboxTheme.alert.warning.border,
              background: pauboxTheme.alert.warning.background,
              color: pauboxTheme.alert.warning.text,
            }}
          ></div>
        </div>
      </div>
    </>
  );
}
