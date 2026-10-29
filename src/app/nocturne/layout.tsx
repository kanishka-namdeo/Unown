import type { Metadata } from "next";
import "./globals.css";

/**
 * The /nocturne route — the Nocturne AI-native incident-ops demo
 * (gallery app #7), embedded live on the landing page (Phase 4).
 * The UI is Phase 3; this layout just mounts the routes: it imports
 * the scoped stylesheet (Next injects it for /nocturne routes only)
 * and renders the `.nocturne-scope` wrapper carrying the app's
 * element-level rules.
 */
export const metadata: Metadata = {
  title: "Nocturne — live demo | unown",
  description:
    "An AI-native incident-ops platform — alerts, on-call rotations, escalations and postmortems, with tenancy, RBAC, an immutable audit log and deterministic SLA math — written end-to-end by unown, running live.",
  icons: { icon: [{ url: "/nocturne/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};

export default function NocturneLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="nocturne-scope dark min-h-screen">{children}</div>;
}
