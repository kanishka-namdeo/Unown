// seo-routes.test.ts — the sitemap and robots convention routes, drift-pinned.
//
// Both are tiny pure functions, but they are also the two files a search
// engine reads FIRST (robots.txt names the sitemap; the sitemap names the
// page), and neither renders anywhere a component test would reach them —
// which is exactly why the changed-line coverage gate flags them until this
// file imports them. The served-output side (HTTP 200, the XML shape, the
// robots.txt bytes) is pinned against the real server by `e2e/seo.spec.ts`
// and against the live deployment by `scripts/verify-deploy.mjs`; this file
// pins the data-level contracts those two inherit from.
import { describe, expect, test } from "bun:test";
import robots from "../robots";
import sitemap from "../sitemap";
import { CHANGELOG_STOPS } from "@/components/landing/changelog-data";
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
  test("exactly one URL — this is a one-page site, and the sitemap must not invent routes", () => {
    const s = sitemap();
    expect(s).toHaveLength(1);
    // No trailing slash: Next normalizes the root without one, the canonical
    // link emits the same form, and the sitemap must name the canonical URL
    // byte-for-byte.
    expect(s[0].url).toBe(SITE.url);
    expect(s[0].url).not.toMatch(/\/$/);
  });

  test("lastmod is the newest CUT release date — never build time, never [Unreleased]", () => {
    const s = sitemap();
    const dated = CHANGELOG_STOPS.filter((stop) => stop.date !== null);
    const newest = dated[0];
    expect(newest).toBeTruthy(); // a repository with no cut release has no lastmod
    expect(s[0].lastModified).toEqual(new Date(newest!.date));
    // And it is a real date from the changelog, not "now": the assertion
    // above would fail if the generator ever fell back to build time.
  });
});
