import type { Metadata } from "next";
import "../landing.css";
import "./blog.css";
import { Footer } from "@/components/landing/shell";
import { BlogNav } from "@/components/blog/blog-shell";
import { SITE } from "@/lib/site";

/**
 * The blog's chrome and shared metadata. Two deliberate inheritances from
 * the landing page and one deliberate divergence:
 *
 * - It imports `landing.css` so the shared furniture (gb-label, gb-btn,
 *   rule-hair, the grain texture, the pixel chips) renders identically —
 *   the blog is the same console, not a second design system.
 * - `Footer` is reused with an `anchorPrefix` so its in-page anchors
 *   (#showcase, #alphabet, #quickstart, #changelog) resolve from /blog/* to
 *   the landing page instead of dying as /blog#showcase.
 * - The pages themselves carry NO framer motion: an article is reading, not
 *   a scroll argument, and a no-JS visitor gets the whole thing for free.
 *
 * Metadata: the layout owns what every blog route shares — the title
 * template's "Blog" default, the RSS alternate (feed.xml is a tracked
 * generated static file, served by every host including the standalone
 * build), and the /blog canonical that page-level metadata overrides per
 * post.
 */
export const metadata: Metadata = {
  title: "Blog",
  description:
    "How each feature and release works, what it does, and the receipts behind it — the longhand record of Unown, the self-improving terminal coding agent.",
  alternates: {
    canonical: "/blog",
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
  openGraph: {
    siteName: SITE.name,
    type: "website",
  },
};

export default function BlogLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="grain grain-fixed relative isolate flex min-h-screen flex-col overflow-x-clip bg-canvas text-ink">
      <a
        href="#main"
        className="skip-link bg-gold px-4 py-2 text-sm font-medium text-canvas"
      >
        Skip to content
      </a>
      <BlogNav />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer anchorPrefix="/" />
    </div>
  );
}
