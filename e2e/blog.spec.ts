import { expect, test } from "@playwright/test";

/**
 * The blog surface gate (the 2026-10-25 blog round). Everything here pins a
 * claim about what a reader or a crawler gets from the blog routes — the
 * same split the landing specs hold: `e2e/seo.spec.ts` pins the landing
 * build, `scripts/verify-deploy.mjs` pins the live deployment, and this file
 * pins the blog build in between them.
 *
 * What this spec holds:
 *   - /blog serves the index: one h1, every published post's title as a
 *     link, the RSS chip pointing at the generated static feed, and the RSS
 *     autodiscovery <link> in the head;
 *   - /feed.xml serves parseable RSS 2.0 with one item per post, titles
 *     escaped and links absolute;
 *   - a post page carries the article SEO surface: its own canonical, the
 *     opengraph-image route's og:image with dimensions, article og:type, and
 *     a BlogPosting JSON-LD node;
 *   - an unknown slug 404s (dynamicParams = false — there is no request-time
 *     post rendering to serve one from).
 *
 * The expectations read the same generated data the pages render, so a new
 * post moves the counts without touching this file.
 */

import { SITE } from "@/lib/site";
import { BLOG_POSTS, BLOG_TOTAL_POSTS } from "@/components/blog/blog-data";

test("the blog index lists every post and points at the feed", async ({ page }) => {
  await page.goto("/blog");

  const h1 = await page.$eval("main h1", (el) => el.textContent?.trim());
  expect(h1).toBe("Blog");

  // Every published post, by title link.
  const links = await page.$$eval("main a", (els) =>
    els.map((el) => ({ href: el.getAttribute("href"), text: el.textContent?.trim() })),
  );
  for (const post of BLOG_POSTS) {
    const entry = links.find((l) => l.href === `/blog/${post.slug}`);
    expect(entry, `the index must link ${post.slug}`).toBeTruthy();
    expect(entry?.text).toContain(post.title);
  }

  // The RSS chip.
  const feedLink = await page.$('a[href="/feed.xml"]');
  expect(feedLink).toBeTruthy();

  // The autodiscovery link lives in the head of every blog route.
  const alternate = await page.$eval(
    'link[rel="alternate"][type="application/rss+xml"]',
    (el) => el.getAttribute("href"),
  );
  expect(alternate).toContain("/feed.xml");

  // The index's own canonical.
  const canonical = await page.$eval('link[rel="canonical"]', (el) => el.getAttribute("href"));
  expect(canonical).toBe(`${SITE.url}/blog`);
});

test("the feed is parseable RSS with one item per post", async ({ request }) => {
  const res = await request.get("/feed.xml");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain('<rss version="2.0"');
  expect(body).toContain("<channel>");
  // One item per published post, newest first.
  expect(body.match(/<item>/g)?.length).toBe(BLOG_TOTAL_POSTS);
  for (const post of BLOG_POSTS) {
    expect(body).toContain(`<link>${SITE.url}/blog/${post.slug}</link>`);
  }
  // The self link — the atom:link every validator looks for.
  expect(body).toContain(`href="${SITE.url}/feed.xml" rel="self"`);
  // XML declaration first, no stray bytes before it.
  expect(body.startsWith("<?xml")).toBe(true);
});

test("a post page carries the article SEO surface", async ({ page }) => {
  const post = BLOG_POSTS[0];
  await page.goto(`/blog/${post.slug}`);

  // Its own canonical, byte-for-byte the URL it is served from.
  const canonical = await page.$eval('link[rel="canonical"]', (el) => el.getAttribute("href"));
  expect(canonical).toBe(`${SITE.url}/blog/${post.slug}`);

  // og:type article + the generated social card with dimensions.
  expect(await page.$eval('meta[property="og:type"]', (el) => el.getAttribute("content"))).toBe(
    "article",
  );
  const ogImage = await page.$eval('meta[property="og:image"]', (el) => el.getAttribute("content"));
  expect(ogImage).toContain(`/blog/${post.slug}/opengraph-image`);
  expect(await page.$eval('meta[property="og:image:width"]', (el) => el.getAttribute("content"))).toBe(
    "1200",
  );
  expect(
    await page.$eval('meta[property="og:image:height"]', (el) => el.getAttribute("content")),
  ).toBe("630");
  expect(await page.$eval('meta[property="og:title"]', (el) => el.getAttribute("content"))).toBe(
    post.title,
  );

  // The title is the page's one h1.
  const h1 = await page.$eval("main h1", (el) => el.textContent?.trim());
  expect(h1).toBe(post.title);

  // The BlogPosting node parses and says what the post factually is.
  const graphs = await page.$$eval('script[type="application/ld+json"]', (els) =>
    els.map((el) => el.textContent ?? ""),
  );
  expect(graphs.length).toBe(1);
  const parsed = JSON.parse(graphs[0]);
  expect(parsed["@type"]).toBe("BlogPosting");
  expect(parsed.headline).toBe(post.title);
  expect(parsed.datePublished).toBe(post.date);
  expect(parsed.dateModified).toBe(post.lastmod ?? post.date);

  // The body rendered — the prose wrapper carries real content.
  const proseWords = await page.$$eval(".prose-unown *", (els) =>
    els.filter((el) => el.tagName === "P").length,
  );
  expect(proseWords).toBeGreaterThan(3);
});

test("the generated social card actually renders an image", async ({ request }) => {
  const post = BLOG_POSTS[0];
  const res = await request.get(`/blog/${post.slug}/opengraph-image`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/");
  const buf = await res.body();
  // A real PNG: the magic bytes, and not a zero-byte error card.
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf[0]).toBe(0x89);
  expect(buf.slice(1, 4).toString()).toBe("PNG");
});

test("an unknown slug 404s — there is no request-time post rendering", async ({ request }) => {
  const res = await request.get("/blog/1999-01-01-no-such-post");
  expect(res.status()).toBe(404);
});
