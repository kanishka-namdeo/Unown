import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
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

/**
 * One serif, used only for attributed pull-quotes on the landing page — the
 * Pokédex entries and the name story. Instrument Serif (OFL-1.1) is a display
 * face, so it never carries body copy. Warp's design system made the same call
 * for the same reason: a serif italic signals "these are someone else's words,
 * quoted", which is exactly the semantic the lore sections need.
 */
const quoteSerif = Instrument_Serif({
  variable: "--font-quote",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://unown-nine.vercel.app"),
  title: "Unown — the terminal coding agent that remembers",
  description:
    "An open-source terminal coding agent with four-tier memory, AutoDreaming and a verify-gated self-improving harness. It reads what you write down, and refuses to keep a rule it cannot prove. Works with any OpenAI-compatible model.",
  keywords: [
    "unown",
    "coding agent",
    "self-improving",
    "agent memory",
    "tiered memory",
    "auto dreaming",
    "terminal agent",
    "pi coding agent",
    "open source ai agent",
    "bubblewrap sandbox",
  ],
  authors: [{ name: "Unown" }],
  openGraph: {
    type: "website",
    title: "Unown — the terminal coding agent that remembers",
    description:
      "It reads what you write down. An open-source terminal coding agent with four-tier memory, AutoDreaming and a verify-gated self-improving harness.",
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
        className={`${geistSans.variable} ${geistMono.variable} ${quoteSerif.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}