import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Pixelify_Sans,
  Press_Start_2P,
  VT323,
} from "next/font/google";
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
    images: ["/landing/landing-hero.png", "/landing/tui/dashboard/stills/01-overview.png"],
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