import type { Metadata } from "next";
import "./globals.css";

/**
 * The /aria route — the Aria enterprise-CRM demo (gallery app #6),
 * embedded live on the landing page (Phase 4). The UI is Phase 3;
 * this layout just mounts the routes: it imports the scoped
 * stylesheet (Next injects it for /aria routes only) and renders
 * the `.aria-scope` wrapper carrying the app's element-level rules.
 */
export const metadata: Metadata = {
  title: "Aria — live demo | unown",
  description:
    "An enterprise CRM — accounts, deals, sequences and forecasts, with tenancy, RBAC, an immutable audit log and a deterministic sequence engine — written end-to-end by unown, running live.",
  icons: { icon: [{ url: "/aria/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};

export default function AriaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="aria-scope dark min-h-screen">{children}</div>;
}
