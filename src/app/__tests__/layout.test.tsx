// layout.test.tsx — the root layout's search-surface contract, drift-pinned.
//
// The layout itself renders only inside Next's runtime (next/font/google
// exports are compiler-generated — a direct metadata import is a SyntaxError
// under bun), so the honest pin is the source text plus the asset files:
// the OG image set, the canonical and the robots directives are what social
// cards and crawlers actually consume, and a dead path or a missing directive
// here would ship a broken card or a capped snippet with every green gate
// behind it (the a11y/budget specs never render the <head>; Vercel serves
// whatever the metadata says).
//
// 2026-10-24 (the search-surface round): the OG set became ONE image with
// explicit dimensions and alt — crawlers reliably use the first og:image and
// some ignore the rest, so the TUI dashboard still left the metadata (it
// stays on the page as content). The full head is asserted against the
// SERVED page by e2e/seo.spec.ts and against the LIVE deployment by
// scripts/verify-deploy.mjs; this file pins the authored source.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LAYOUT = readFileSync(join(import.meta.dir, "..", "layout.tsx"), "utf8");

describe("root layout metadata (drift-pinned)", () => {
  test("the OG set is the ONE hero screenshot with dimensions and alt", () => {
    // The exact image entry — a stale path (the retired /landing/dash-
    // overview.png) or a dropped width/alt fails here instead of 404-ing or
    // under-sizing in every social card embed. Dimensions are 1512×900, the
    // size scripts/landing_og_shots.mjs shoots — larger than the 1200×630
    // minimum in both axes.
    expect(LAYOUT).toContain("url: SITE.ogImage.url");
    expect(LAYOUT).toContain("width: SITE.ogImage.width");
    expect(LAYOUT).toContain("alt: SITE.ogImage.alt");
    expect(LAYOUT).not.toContain("dash-overview");
    // One image: a second og:image is noise some scrapers mishandle.
    const ogImageUrls = LAYOUT.match(/url: SITE\.ogImage\.url/g) ?? [];
    expect(ogImageUrls.length).toBe(1);
  });

  test("the head carries the canonical and the robots directives", () => {
    expect(LAYOUT).toContain("alternates: { canonical: \"/\" }");
    expect(LAYOUT).toContain('"max-image-preview": "large"');
    expect(LAYOUT).toContain('"max-snippet": -1');
    expect(LAYOUT).toContain("twitter: {");
    expect(LAYOUT).toContain('card: "summary_large_image"');
  });

  test("every metadata asset exists in public/", () => {
    for (const img of ["/landing/landing-hero.png", "/logo.svg"]) {
      const p = join(import.meta.dir, "..", "..", "..", "public", img.replace(/^\//, ""));
      expect(existsSync(p), `${img} must exist in public/`).toBe(true);
    }
  });

  test("the description stays in the truncation-safe band", () => {
    // ~150 characters: Google truncates by device width, and the description
    // front-loads the search phrases. The band is what e2e/seo.spec.ts also
    // asserts against the served page.
    const m = LAYOUT.match(/description:\s*\n?\s*"([^"]+)"/);
    expect(m?.[1]?.length ?? 0).toBeGreaterThan(70);
    expect(m?.[1]?.length ?? 0).toBeLessThanOrEqual(160);
  });
});
