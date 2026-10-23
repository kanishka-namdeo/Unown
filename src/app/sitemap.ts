import type { MetadataRoute } from "next";
import { CHANGELOG_STOPS } from "@/components/landing/changelog-data";
import { SITE } from "@/lib/site";

/**
 * The site's one sitemap, served at /sitemap.xml by the file convention.
 * Pinned by `e2e/seo.spec.ts` (parses, one URL, lastmod present) and named in
 * robots.ts so crawlers find it without guessing.
 *
 * `lastModified` is the newest CUT release date from `CHANGELOG.md` — read
 * from the generated rail data, not re-parsed here — because the shipping
 * rail renders on this page and a dated release is the last content change
 * the repository can actually prove. Two deliberate refusals:
 *   - `new Date()` (build time) is almost always wrong: a rebuild that changed
 *     no content would bump the date, and Google disregards a `lastmod` it
 *     catches being inflated;
 *   - `[Unreleased]` is excluded because it is undated by design — a promise
 *     the page renders as "Not cut yet", and a date the repository does not
 *     have must not reach a sitemap.
 * Google ignores `changeFrequency` and `priority`; they are kept for the
 * other consumers that still read them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const dated = CHANGELOG_STOPS.filter((s) => s.date !== null);
  const newest = dated[0]?.date ?? undefined;
  return [
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
}
