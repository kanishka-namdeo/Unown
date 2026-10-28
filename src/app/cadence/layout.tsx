import type { Metadata } from "next";
import "./globals.css";

/**
 * The /cadence route — the Cadence habit & streak tracker app the agent
 * built (the cadence round: plan→build→review→browser-QA, receipts in
 * docs/cadence-demo-session.md), embedded live on the landing page
 * (`live-demo.tsx` frames it in browser chrome via an iframe to
 * `/cadence?embed=1`, switchable with the other live demos).
 *
 * A PASS-THROUGH like the /bazaar layout: the landing's root layout owns
 * <html> and <body> (fonts, theme chrome, grain). This layout imports the
 * scoped stylesheet (Next injects it for /cadence routes only) and renders
 * the `.cadence-scope` wrapper carrying the app's element-level rules
 * (the standalone app shipped them on <html>/<body> — under the landing
 * those are shared elements) plus the starting `dark` class so first paint
 * matches the app's dark default even before hydration.
 */
export const metadata: Metadata = {
  title: "Cadence — live demo | unown",
  description:
    "A habit & streak tracker — check-offs, streaks, a 52-week heatmap — written end-to-end by unown, running live.",
  icons: { icon: [{ url: "/cadence/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};

export default function CadenceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="cadence-scope dark min-h-screen">{children}</div>;
}
