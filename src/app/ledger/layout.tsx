import type { Metadata } from "next";
import "./globals.css";

/**
 * The /ledger route's layout — the encore pattern: the scoped stylesheet
 * is imported HERE so Next injects it for /ledger routes alone and the
 * landing never downloads it.
 */
export const metadata: Metadata = {
  title: "Ledger — the treasury dashboard fixture",
  description:
    "A fintech treasury dashboard built under the Website Excellence framework's round 2: warm-paper design system, numbers as headlines, every figure receipted in the test suite.",
  robots: { index: false, follow: false },
};

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
