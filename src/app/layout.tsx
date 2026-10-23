import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Pixelify_Sans,
  Press_Start_2P,
  VT323,
} from "next/font/google";
import { SITE } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The three retro faces, all SIL OFL-1.1 so the license is the same as the
 * two we already ship. Each has exactly one job and none of them is body copy:
 *
 *  - `font-pixel`  (Press Start 2P). Chrome only — eyebrows, buttons, badges,
 *                  nav items, kbd hints. It is a fixed-width 8x8 bitmap face,
 *                  so it looks right at 9-12px and terrible in a sentence.
 *                  Never set more than a few words in it.
 *  - `font-display` (Pixelify Sans). Headings. Pixel-quantized outlines with
 *                  proportional advance widths, which is what makes a
 *                  90-character H2 readable where Press Start 2P would run to
 *                  five ragged lines.
 *  - `font-term`  (VT323). Terminal bodies, dialogue boxes and attributed
 *                  quotations. It replaces the old Instrument Serif: on a Game
 *                  Boy page a refined serif was the one modern note left, and
 *                  a quoted Pokédex entry is game text, not editorial. `.quote`
 *                  still means "someone else's words" — it just says so in the
 *                  face the console would have used.
 *
 * Geist Sans stays for body copy. A pixel body face is a nostalgia trap: it
 * burns the reader by paragraph three and costs the Lighthouse 1.00 the page
 * is contracted to hold. The retro reads from the palette, the boxes and the
 * chrome — not from punishing the paragraphs.
 */
const pixelFont = Press_Start_2P({
  variable: "--font-press",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const displayFont = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
  display: "swap",
});

const termFont = VT323({
  variable: "--font-vt",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

/**
 * The page's search surface. Everything a crawler or link-unfurler reads is
 * declared here against `SITE` (src/lib/site.ts) — the one module that knows
 * the production origin — and pinned end to end by `e2e/seo.spec.ts` plus
 * `scripts/verify-deploy.mjs`'s SEO section.
 *
 * - `alternates.canonical` consolidates every alias (Vercel preview URLs are
 *   platform-noindexed; the canonical is the belt to that braces) onto the
 *   one origin Google should index.
 * - `robots` allows full previews: a snippet cap or a small image cap would
 *   quietly degrade how the page renders in results. `max-image-preview:
 *   large` is what lets the OG screenshot appear at full size.
 * - the OG set is ONE image with explicit dimensions and alt text — crawlers
 *   reliably use the first `og:image` and some ignore the rest, so a second
 *   image was noise, not reach. (The TUI dashboard still stays on the page as
 *   content; it just left the metadata.)
 * - `keywords` is kept for non-Google consumers only; Google has ignored the
 *   tag since 2009 and no ranking claim is made on it.
 * - the description is ~150 characters: Google truncates what it shows by
 *   device width, and the front-loaded sentence carries the search phrases
 *   ("terminal coding agent", "memory", "self-improving") that the fuller
 *   poetic line did not.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: "Unown — the terminal coding agent that remembers",
    template: "%s — Unown",
  },
  description:
    "An open-source terminal coding agent with four-tier memory, AutoDreaming and a verify-gated self-improving harness. Works with any OpenAI-compatible model.",
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
  authors: [{ name: "Unown", url: SITE.repo }],
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE.name,
    title: "Unown — the terminal coding agent that remembers",
    description:
      "It reads what you write down. An open-source terminal coding agent with four-tier memory, AutoDreaming and a verify-gated self-improving harness.",
    images: [
      {
        url: SITE.ogImage.url,
        width: SITE.ogImage.width,
        height: SITE.ogImage.height,
        alt: SITE.ogImage.alt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Unown — the terminal coding agent that remembers",
    description:
      "It reads what you write down. An open-source terminal coding agent with four-tier memory, AutoDreaming and a verify-gated self-improving harness.",
    images: [SITE.ogImage.url],
  },
  icons: {
    icon: "/logo.svg",
  },
};

/**
 * Anti-flash theme bootstrap. Runs synchronously in <head>, before the body
 * paints, so a visitor who chose the light screen never sees a dark frame
 * first (and vice versa). It only reads the persisted override — when there
 * is none it does nothing, and `prefers-color-scheme` decides, which is what
 * keeps the light/dark default working for visitors with JavaScript off.
 * Kept tiny and inline on purpose: an external request here would be a
 * render-blocking round trip on the LCP element.
 */
const THEME_INIT = `try{var t=localStorage.getItem("unown-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${pixelFont.variable} ${displayFont.variable} ${termFont.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}