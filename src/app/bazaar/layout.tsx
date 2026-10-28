import type { Metadata } from "next";
import "./globals.css";

/**
 * The /bazaar route — the Sigil Bazaar app the agent built (the commerce
 * round: plan→build→review→browser-QA, receipts in docs/bazaar-demo-session.md),
 * embedded live on the landing page (`live-demo.tsx` frames it in browser
 * chrome via an iframe to `/bazaar?embed=1`, switchable with the Sigil Focus
 * demo at /demo).
 *
 * A PASS-THROUGH like the /demo layout: the landing's root layout owns
 * <html> and <body> (fonts, theme chrome, grain). This layout imports the
 * scoped stylesheet (Next injects it for /bazaar routes only) and renders
 * the `.bazaar-scope` wrapper carrying the app's element-level rules (the
 * standalone app shipped them on <html>/<body> — under the landing those
 * are shared elements) plus the starting `dark` class so first paint
 * matches the app's dark default even before hydration.
 */
export const metadata: Metadata = {
  title: "Sigil Bazaar — live demo | unown",
  description:
    "A fullstack e-commerce app — storefront, checkout wizard, owner analytics — written end-to-end by unown, running live.",
  icons: { icon: [{ url: "/bazaar/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};

export default function BazaarLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="bazaar-scope dark min-h-screen">{children}</div>;
}
