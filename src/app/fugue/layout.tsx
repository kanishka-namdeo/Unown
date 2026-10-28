import type { Metadata } from "next";
import "./globals.css";

/**
 * The /fugue route — the Fugue AI-workflow-automation app the agent built
 * (the SOTA round; the receipt is docs/fugue-demo-session.md), embedded live
 * on the landing page (`live-demo.tsx` frames it in browser chrome via an
 * iframe to `/fugue/flows?embed=1`, switchable with the other live demos).
 *
 * A PASS-THROUGH like the /cadence and /bazaar layouts: the landing's root
 * layout owns <html> and <body> (fonts, theme chrome, grain). This layout
 * imports the scoped stylesheet (Next injects it for /fugue routes only) and
 * renders the `.fugue-scope` wrapper carrying the app's element-level rules
 * (the standalone app shipped them on <html>/<body> — under the landing
 * those are shared elements). Fugue is light-by-default, so no `dark` class:
 * first paint is the app's clean SaaS light scheme.
 */
export const metadata: Metadata = {
  title: "Fugue — live demo | unown",
  description:
    "An AI workflow-automation platform — workspaces, flows, deterministic simulated-inference runs — written end-to-end by unown, running live.",
  robots: { index: false, follow: false },
};

export default function FugueLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="fugue-scope min-h-screen">{children}</div>;
}
