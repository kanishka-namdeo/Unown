import type { Metadata } from "next";
import "./globals.css";

/**
 * The /parley route — the Parley multi-tenant support-inbox app the
 * agent built (the parley round: plan → lib → api → ui, receipts in
 * docs/parley-demo-session.md), embedded live on the landing page
 * (`live-demo.tsx` frames it in browser chrome via an iframe to
 * `/parley?embed=1`, switchable with the other live demos).
 *
 * A PASS-THROUGH like the /bazaar + /cadence layouts: the landing's
 * root layout owns <html> and <body> (fonts, theme chrome, grain).
 * This layout imports the scoped stylesheet (Next injects it for
 * /parley routes only) and renders the `.parley-scope` wrapper
 * carrying the app's element-level rules + the starting `dark`
 * class so first paint matches the app's dark default even before
 * hydration.
 */
export const metadata: Metadata = {
  title: "Parley — live demo | unown",
  description:
    "A multi-tenant customer-support inbox — tenancy, auth, RBAC, SLA countdowns — written end-to-end by unown, running live.",
  icons: { icon: [{ url: "/parley/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};

export default function ParleyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="parley-scope dark min-h-screen">{children}</div>;
}
