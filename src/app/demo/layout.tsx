import type { Metadata } from "next";
import "./globals.css";

/**
 * The /demo route — the Sigil Focus app the agent built, embedded live on
 * the landing page (`live-demo.tsx` frames it in browser chrome via an
 * iframe to `/demo?embed=1`).
 *
 * This layout is a PASS-THROUGH: the landing's root layout owns <html> and
 * <body> (fonts, theme chrome, grain). The demo's stylesheet is imported
 * HERE so Next only injects it for /demo routes — the landing page never
 * downloads a byte of it, and its `@source` directives keep the Tailwind
 * pass scoped to the sigil trees (see the CSS header comment).
 *
 * The wrapper div carries the demo's own scope class (background, text,
 * font, min-height — the element-level `html`/`body` rules the standalone
 * app ships were dropped for embedding: they would style the LANDING's
 * shared elements) plus the starting `dark` class so first paint matches
 * the app's dark default even before hydration.
 */
export const metadata: Metadata = {
  title: "Sigil Focus — live demo | unown",
  description:
    "A fullstack kanban + focus-timer app written end-to-end by one unown session, running live.",
  icons: { icon: [{ url: "/sigil/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};

export default function DemoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="sigil-scope dark min-h-screen">{children}</div>;
}
