import type { Metadata } from "next";
import "./globals.css";

/**
 * The /encore route — Encore, the Website Excellence showcase
 * (gallery app #8), the round's own measured story: the critique
 * baseline, the iteration receipts, the tools built, the failures
 * ledgered, the learning retained.
 *
 * A PASS-THROUGH like the /cadence + /nocturne sibling layouts: the
 * landing's root layout owns <html> and <body> (fonts, theme chrome).
 * This layout imports the scoped stylesheet (Next injects it for
 * /encore routes only) and renders the `.encore-scope` wrapper carrying
 * the app's element-level rules plus the starting `dark` class so
 * first paint matches the app's dark default even before hydration.
 *
 * **NO API routes here, deliberately (plan §3.5).** Encore ships
 * zero `src/app/encore/api/`: the data is static receipt-derived
 * constants — nothing is created, mutated, or synced, so the reset
 * handshake is a pure client-state wipe, not a POST. This is the
 * deliberate divergence from cadence (whose API exists only for
 * fire-and-forget sync of non-seeded habits). A future session
 * should not "add the missing sync."
 */
export const metadata: Metadata = {
  title: "Encore — the Website Excellence showcase | unown",
  description:
    "Every great performance earns an encore — the round's measured story: baseline 6.40, 11 gates, the critique loop, failures ledgered.",
  icons: { icon: [{ url: "/encore/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};

export default function EncoreLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="encore-scope dark min-h-screen">{children}</div>;
}
