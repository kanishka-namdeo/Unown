import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Unown — the self-improving terminal agent",
  description:
    "An open-source terminal coding agent with tiered memory, AutoDreaming and a verify-gated self-improving harness. Works with any OpenAI-compatible model.",
  keywords: [
    "unown",
    "coding agent",
    "self-improving",
    "memory",
    "auto dreaming",
    "terminal agent",
  ],
  authors: [{ name: "Unown" }],
  openGraph: {
    title: "Unown — the self-improving terminal agent",
    description:
      "An open-source terminal coding agent with tiered memory, AutoDreaming and a verify-gated self-improving harness. Works with any OpenAI-compatible model.",
    images: ["/landing/landing-hero.png", "/landing/dash-overview.png"],
  },
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
