import type { MetadataRoute } from "next";
import { CHANGELOG_STOPS } from "@/components/landing/changelog-data";
import { BLOG_POSTS, BLOG_TOTAL_POSTS } from "@/components/blog/blog-data";
import { SITE } from "@/lib/site";

/**
 * The site's one sitemap, served at /sitemap.xml by the file convention.
 * Pinned by `e2e/seo.spec.ts` (parses, lastmod present, the URL set) and
 * named in robots.ts so crawlers find it without guessing.
 *
 * The URL set is exactly the pages that exist: the landing page, the blog
 * index, and one entry per published post (since 2026-10-25 — the blog
 * round; posts come from the generated `blog-data.ts`, so a post that never
 * shipped cannot be invented here, and a shipped post cannot be missed).
 * Tag pages are deliberately absent: with a single-digit post count they
 * would be thin content pages, not a discovery surface (the decision and
 * the field survey behind it live in docs/landing-research.md).
 *
 * `lastModified` rules, one per entry kind:
 *   - the landing page: the newest CUT release date from `CHANGELOG.md` —
 *     read from the generated rail data, not re-parsed here. Two deliberate
 *     refusals: `new Date()` (build time) is almost always wrong — a rebuild
 *     that changed no content would bump the date, and Google disregards a
 *     `lastmod` it catches being inflated; and `[Unreleased]` is excluded
 *     because it is undated by design.
 *   - the blog index: the newest post's `lastmod ?? date` — the newest
 *     content change the blog can prove.
 *   - a post: its own `lastmod ?? date` — a post that never changed never
 *     bumps.
 * Google ignores `changeFrequency` and `priority`; they are kept for the
 * other consumers that still read them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const dated = CHANGELOG_STOPS.filter((s) => s.date !== null);
  const newest = dated[0]?.date ?? undefined;

  const entries: MetadataRoute.Sitemap = [
    {
      // No trailing slash: Next normalizes the root URL without one
      // (trailingSlash: false), the canonical link emits the same form, and
      // the sitemap's loc should name the canonical URL byte-for-byte.
      url: SITE.url,
      ...(newest ? { lastModified: new Date(newest) } : {}),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  if (BLOG_TOTAL_POSTS > 0) {
    const newestPost = BLOG_POSTS[0];
    entries.push({
      url: `${SITE.url}/blog`,
      lastModified: new Date(newestPost.lastmod ?? newestPost.date),
      changeFrequency: "weekly",
      priority: 0.8,
    });
    for (const post of BLOG_POSTS) {
      entries.push({
        url: `${SITE.url}/blog/${post.slug}`,
        lastModified: new Date(post.lastmod ?? post.date),
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  return entries;
}
