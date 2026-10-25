import { expect, test } from "@playwright/test";

/**
 * The SEO gate (the 2026-10-24 round; the why is in `docs/landing-research.md`,
 * "the search surface"). Everything this spec pins is a claim about what a
 * crawler or link-unfurler reads, and most of it is invisible to every other
 * committed gate: a canonical that points at a preview alias, a missing
 * og:image:width, a JSON-LD graph that stopped parsing — none of it fails a
 * unit test, a contrast audit or an axe pass, and all of it quietly costs the
 * page its search surface.
 *
 * The expectations resolve against `src/lib/site.ts`'s one constant the same
 * way the page does, so a domain move is a one-line edit and this spec
 * follows. The local twin of these checks is `scripts/verify-deploy.mjs`'s
 * "seo surface" section, which runs the same assertions against the LIVE
 * deployment after a push — this spec pins the build, that script pins the
 * deploy.
 *
 * Deliberately NOT checked: meta keywords (Google has ignored the tag since
 * 2009; it is kept for other consumers and asserted nowhere), and any ranking
 * claim — SERP position is not a build result and this page's honesty rule
 * does not extend to promising traffic.
 */

import { SITE } from "@/lib/site";
import { FAQ } from "@/components/landing/faq-data";
import { DEX } from "@/components/landing/dex-data";
import { BLOG_TOTAL_POSTS } from "@/components/blog/blog-data";

const ORIGIN = SITE.url;

test("the head declares canonical, robots, og and twitter tags", async ({ page }) => {
  await page.goto("/");
  const head = await page.evaluate(() => document.head.innerHTML);

  // Canonical: the production origin, not a preview alias, not relative.
  // Next normalizes the root without a trailing slash (trailingSlash: false),
  // so the expectation is ORIGIN — the same byte-for-byte form the sitemap
  // loc and og:url use.
  const canonical = await page.$eval('link[rel="canonical"]', (el) => el.getAttribute("href"));
  expect(canonical).toBe(ORIGIN);

  // Robots meta: indexing allowed, no preview caps.
  const robots = await page.$eval('meta[name="robots"]', (el) => el.getAttribute("content"));
  expect(robots).toContain("index");
  expect(robots).toContain("follow");
  const googlebot = await page.$eval('meta[name="googlebot"]', (el) => el.getAttribute("content"));
  expect(googlebot).toContain("max-image-preview:large");
  expect(googlebot).toContain("max-snippet:-1");

  // Open Graph: exactly one image (crawlers reliably use the first), with
  // dimensions and alt text, plus the identity fields.
  const ogImages = await page.$$eval('meta[property="og:image"]', (els) =>
    els.map((el) => el.getAttribute("content")),
  );
  expect(ogImages).toHaveLength(1);
  expect(ogImages[0]).toBe(`${ORIGIN}${SITE.ogImage.url}`);
  expect(head).toContain('property="og:image:width"');
  expect(head).toContain('property="og:image:height"');
  expect(head).toContain('property="og:image:alt"');
  expect(await page.$eval('meta[property="og:url"]', (el) => el.getAttribute("content"))).toBe(
    ORIGIN,
  );
  expect(await page.$eval('meta[property="og:site_name"]', (el) => el.getAttribute("content"))).toBe(
    SITE.name,
  );
  expect(await page.$eval('meta[property="og:type"]', (el) => el.getAttribute("content"))).toBe(
    "website",
  );

  // Twitter/X card, explicit — inherited-from-OG is true today, but explicit
  // is the robust contract.
  expect(
    await page.$eval('meta[name="twitter:card"]', (el) => el.getAttribute("content")),
  ).toBe("summary_large_image");
  expect(head).toContain('name="twitter:image"');

  // The description is a real sentence in the truncation-safe band.
  const description = await page.$eval('meta[name="description"]', (el) =>
    el.getAttribute("content"),
  );
  expect(description!.length).toBeGreaterThan(70);
  expect(description!.length).toBeLessThanOrEqual(160);
});

test("robots.txt and sitemap.xml are served and cross-reference", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  expect(robotsText).toMatch(/user-agent: \*/i);
  expect(robotsText).toMatch(/allow: \/\s*$/im);
  expect(robotsText).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain(`<loc>${ORIGIN}</loc>`);
  expect(sitemapText).toContain(`<loc>${ORIGIN}/blog</loc>`);
  expect(sitemapText).toContain("<lastmod>");
  // The URL set is exactly the pages that exist: the landing page, the blog
  // index, one per published post (the count derives from the generated
  // data the sitemap itself reads — the sitemap must not invent routes,
  // and it must not miss a shipped post either). Tag pages are a
  // deliberate non-feature while the post count is single-digit.
  expect(sitemapText.match(/<loc>/g)?.length).toBe(2 + BLOG_TOTAL_POSTS);
});

test("the JSON-LD graph parses and carries the required properties", async ({ page }) => {
  await page.goto("/");
  const graphs = await page.$$eval('script[type="application/ld+json"]', (els) =>
    els.map((el) => el.textContent ?? ""),
  );
  expect(graphs.length).toBe(1);

  const parsed = JSON.parse(graphs[0]);
  expect(parsed["@context"]).toBe("https://schema.org");
  const nodes = parsed["@graph"] as Record<string, unknown>[];
  const types = nodes.map((n) => n["@type"]);
  expect(types).toContain("Organization");
  expect(types).toContain("SoftwareApplication");
  expect(types).toContain("FAQPage");

  // SoftwareApplication: Google's required/recommended set for a free
  // developer tool — price 0, category, OS, repo, license.
  const app = nodes.find((n) => n["@type"] === "SoftwareApplication") as Record<string, any>;
  expect(app.name).toBe(SITE.name);
  expect(app.applicationCategory).toBe("DeveloperApplication");
  expect(app.offers.price).toBe(0);
  expect(app.url).toBe(ORIGIN);
  expect(app.codeRepository).toBe(SITE.repo);
  expect(app.license).toBe(SITE.license);
  expect(app.softwareVersion).toMatch(/^\d+\.\d+\.\d+$/);
  // No fabricated rating: a self-review is the spam pattern Google excludes,
  // and the page's honesty rule refuses invented numbers.
  expect(app.aggregateRating).toBeUndefined();
  // featureList derives from the dex — the canonical capability copy.
  expect(app.featureList).toEqual(DEX.map((e) => e.practice[0]));

  // Organization: name, url, sameAs → the repo.
  const org = nodes.find((n) => n["@type"] === "Organization") as Record<string, any>;
  expect(org.name).toBe(SITE.name);
  expect(org.sameAs).toContain(SITE.repo);

  // FAQPage: the seven questions, serialized from the same module the
  // accordion renders — one source, so the markup cannot drift.
  const faq = nodes.find((n) => n["@type"] === "FAQPage") as Record<string, any>;
  expect(faq.mainEntity).toHaveLength(FAQ.length);
  for (const [i, item] of FAQ.entries()) {
    expect(faq.mainEntity[i].name).toBe(item.q);
    expect(faq.mainEntity[i].acceptedAnswer.text).toBe(item.a);
  }
});

test("one keyword-bearing h1, and no skipped heading levels", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const headings = await page.$$eval("main h1, main h2, main h3", (els) =>
    els.map((el) => ({ level: Number(el.tagName.slice(1)), text: el.textContent?.trim() ?? "" })),
  );
  expect(headings.length).toBeGreaterThan(0);

  // Exactly one h1, and it carries the product category — the strongest
  // on-page relevance signal was a purely poetic line before this round.
  const h1s = headings.filter((h) => h.level === 1);
  expect(h1s).toHaveLength(1);
  expect(h1s[0].text).toMatch(/terminal coding agent/i);

  // Heading order: the first heading is the h1, and no heading SKIPS a level
  // going down (h1→h3 with no h2 in between is how an outline silently rots).
  // Going back up (h3→h2 at a section boundary) is valid document flow, not a
  // defect — the first draft of this check got that backwards and flagged
  // three healthy section boundaries.
  expect(headings[0].level).toBe(1);
  for (const [i, h] of headings.slice(1).entries()) {
    const prev = headings[i];
    expect(h.level).toBeLessThanOrEqual(prev.level + 1);
  }

  // The signature line survived the h1 change — it lives in the subhead now.
  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toContain("It reads what you write down");
});
