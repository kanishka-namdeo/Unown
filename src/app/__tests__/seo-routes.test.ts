// seo-routes.test.ts — the sitemap and robots convention routes, drift-pinned.
//
// Both are tiny pure functions, but they are also the two files a search
// engine reads FIRST (robots.txt names the sitemap; the sitemap names the
// pages), and neither renders anywhere a component test would reach them —
// which is exactly why the changed-line coverage gate flags them until this
// file imports them. The served-output side (HTTP 200, the XML shape, the
// robots.txt bytes) is pinned against the real server by `e2e/seo.spec.ts`
// and against the live deployment by `scripts/verify-deploy.mjs`; this file
// pins the data-level contracts those two inherit from.
//
// Since the blog round (2026-10-25) the sitemap carries more than one URL:
// the landing page, the blog index, and one entry per published post — the
// generated `blog-data.ts` is the single source for the post set, so this
// suite pins the arithmetic (1 + 1 + posts) rather than a hand-counted
// number that would move with every post.
import { describe, expect, test } from "bun:test";
import robots from "../robots";
import sitemap from "../sitemap";
import { CHANGELOG_STOPS, type ChangelogStop } from "@/components/landing/changelog-data";
import { BLOG_POSTS, BLOG_TOTAL_POSTS } from "@/components/blog/blog-data";
import { SITE } from "@/lib/site";

describe("robots.ts (served at /robots.txt)", () => {
  test("one rule group allows everything, and the Sitemap line derives from SITE", () => {
    const r = robots();
    // One group — the old static file's five groups were five copies of
    // "allow everything", and copies drift.
    expect(r.rules).toHaveLength(1);
    expect(r.rules[0].userAgent).toBe("*");
    // `allow` is the string form (Next's MetadataRoute accepts string |
    // string[]); the first draft asserted the array form and failed on a
    // healthy file.
    expect(r.rules[0].allow).toBe("/");
    expect(r.rules[0].disallow).toBeUndefined();
    // The Sitemap line is derived, not typed — a domain move is one edit in
    // site.ts and this line follows (verify-deploy pins the served bytes).
    expect(r.sitemap).toBe(`${SITE.url}/sitemap.xml`);
  });
});

describe("sitemap.ts (served at /sitemap.xml)", () => {
  test("exactly the pages that exist: the landing page, the blog index, one per post", () => {
    const s = sitemap();
    // 1 (landing) + 1 (blog index) + every published post. The count reads
    // off the generated data — the sitemap must not invent routes, and it
    // must not miss a shipped post either.
    expect(s).toHaveLength(2 + BLOG_TOTAL_POSTS);
    // No trailing slash: Next normalizes the root without one, the canonical
    // link emits the same form, and the sitemap must name the canonical URL
    // byte-for-byte.
    expect(s[0].url).toBe(SITE.url);
    expect(s[0].url).not.toMatch(/\/$/);
    expect(s[1].url).toBe(`${SITE.url}/blog`);
    for (const [i, post] of BLOG_POSTS.entries()) {
      expect(s[2 + i].url).toBe(`${SITE.url}/blog/${post.slug}`);
      expect(s[2 + i].url).not.toMatch(/\/$/);
    }
  });

  test("lastmod is the newest CUT release date — never build time, never [Unreleased]", () => {
    const s = sitemap();
    // Type predicate: the filter's null-check narrows the stop type (the
    // bare `!== null` filter leaves `date: string | null` on the element
    // and `new Date(newest!.date)` fails typecheck — found when the 0.0.6
    // fold regenerated the rail under this suite).
    const dated = CHANGELOG_STOPS.filter(
      (stop): stop is ChangelogStop & { date: string } => stop.date !== null,
    );
    const newest = dated[0];
    expect(newest).toBeTruthy(); // a repository with no cut release has no lastmod
    expect(s[0].lastModified).toEqual(new Date(newest!.date));
    // And it is a real date from the changelog, not "now": the assertion
    // above would fail if the generator ever fell back to build time.
  });

  test("blog lastmod is each post's own lastmod-or-date — a post that never changed never bumps", () => {
    const s = sitemap();
    expect(s[1].lastModified).toEqual(
      new Date(BLOG_POSTS[0].lastmod ?? BLOG_POSTS[0].date),
    );
    for (const [i, post] of BLOG_POSTS.entries()) {
      expect(s[2 + i].lastModified).toEqual(new Date(post.lastmod ?? post.date));
    }
  });
});
