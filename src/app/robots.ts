import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Served at /robots.txt by the file convention. It replaced the old static
 * `public/robots.txt` (deleted in the same commit — a static file and the
 * convention must not both exist, the static one wins the route) for one
 * reason: the `Sitemap:` line now derives from `SITE` with the metadata, the
 * canonical and every absolute URL, instead of being a second hand-typed
 * copy that could drift. Pinned by `e2e/seo.spec.ts`.
 *
 * One rule group replaces the old file's five identical ones: every bot it
 * named was allowed everything, so the extra groups were four copies of the
 * same fact. Google's robots.txt guidance is explicit that `Sitemap:` is a
 * directive crawlers rely on to find the sitemap without guessing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
