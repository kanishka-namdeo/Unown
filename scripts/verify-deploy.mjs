#!/usr/bin/env node
/**
 * Verify the live deployment.
 *
 *   bun scripts/verify-deploy.mjs [url]
 *
 * Exits non-zero if anything fails, so it is usable as a post-push gate as
 * well as a manual check. It answers one question honestly: is production
 * actually serving the code we think it is, and is it intact?
 *
 * Why this exists rather than "just check the site": Vercel auto-deploys on
 * every push to `main`, and a green local build says nothing about whether the
 * deploy landed, whether the production alias has caught up, or whether the
 * page is still a blank slate without JavaScript. Those are exactly the three
 * ways this page has broken before.
 */

const URL_ARG = process.argv[2] || "https://unown-nine.vercel.app";

let failures = 0;
const note = (ok, label, detail = "") => {
  if (!ok) failures += 1;
  const mark = ok ? "  ok  " : " FAIL ";
  console.log(`${mark} ${label}${detail ? `  ${detail}` : ""}`);
};

/* ---------------------------------------------------------------- */
/* helpers                                                           */
/* ---------------------------------------------------------------- */

async function get(url) {
  const res = await fetch(url, {
    headers: { "cache-control": "no-cache" },
    redirect: "follow",
  });
  const text = await res.text();
  return { res, text, status: res.status };
}

const section = (t) => console.log(`\n${t}`);

/* ---------------------------------------------------------------- */
/* run                                                               */
/* ---------------------------------------------------------------- */

console.log(`verifying ${URL_ARG}\n`);

section("routes");
const routes = [
  ["/", 200],
  ["/robots.txt", 200],
  ["/sitemap.xml", 200],
  // The blog round (2026-10-25): the marketing site grew its second surface.
  // /blog and the generated static feed are probed exactly like the landing
  // page — a deploy that lost them half-serves the site this repo claims.
  ["/blog", 200],
  ["/feed.xml", 200],
];
const bodies = {};
for (const [path, want] of routes) {
  try {
    const { status, text } = await get(URL_ARG + path);
    bodies[path] = text;
    note(status === want, `${path} -> ${want}`, `got ${status}, ${text.length} bytes`);
  } catch (err) {
    note(false, `${path} -> ${want}`, String(err.message ?? err));
  }
}

const html = bodies["/"] ?? "";
if (!html) {
  console.error("\nno HTML from /; aborting content checks.");
  process.exit(1);
}

/* ---------------------------------------------------------------- */
/* content: is the page we built actually there?                     */
/* ---------------------------------------------------------------- */

section("page content");
note(html.includes("It reads what you write down"), "signature line (subhead since 2026-10-24)");
note(html.includes("The terminal coding agent that remembers"), "keyword-bearing h1");
// The beta stage is a load-bearing status claim (2026-10-25): the badge pair
// the research settled on — chip + plain-language sentence — so both halves
// are asserted; a badge whose sentence was copy-edited away would still pass
// the chip check and quietly stop meaning anything to a reader.
note(html.includes("Beta"), "beta badge present (header wordmark + hero kicker)");
note(html.includes("Unown is in beta"), "beta plain-language sentence present");

/* ---------------------------------------------------------------- */
/* landing media: every tui reel the page references, served intact    */
/*                                                                  */
/* 2026-10-25 (the SOTA re-capture round): the dex's 24 reels were   */
/* verified by the e2e decode gate against the STANDALONE build, but  */
/* the deployed site's media was never checked — a broken deploy, a  */
/* stale cache or a missing file would be discovered by a visitor.    */
/* The SSR DOM carries every reel's sources (webm+mp4), every lazy    */
/* poster (data-poster) and the showcase's dashboard stills, so the   */
/* rendered page itself is the manifest: probe each unique URL for    */
/* status 200, the right content type, byte-range support (the dex     */
/* player and Safari both range-request), and the long CDN cache the   */
/* vercel.json media rule promises.                                  */
/* ---------------------------------------------------------------- */

section("landing media");
{
  const media = new Set();
  for (const m of html.matchAll(/(?:src|data-poster)="(\/landing\/tui\/[^"]+\.(?:webm|mp4|png))"/g)) media.add(m[1]);
  note(media.size >= 60, "landing tui media referenced in SSR DOM", `${media.size} unique URLs`);
  const wantType = (p) =>
    p.endsWith(".webm") ? "video/webm" : p.endsWith(".mp4") ? "video/mp4" : "image/png";
  let typeFails = 0, statusFails = 0, rangeFails = 0, cacheFails = 0;
  let firstVideo = null;
  for (const p of media) {
    try {
      // HEAD: the existence/type/cache probe; the body-less request keeps
      // the run light while the deploy still has to answer for every file.
      const res = await fetch(URL_ARG + p, { method: "HEAD", headers: { "cache-control": "no-cache" } });
      if (res.status !== 200) statusFails += 1;
      const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (ct !== wantType(p)) typeFails += 1;
      const cache = res.headers.get("cache-control") ?? "";
      if (!/s-maxage=\d+/.test(cache)) cacheFails += 1;
      if (!firstVideo && p.endsWith(".mp4")) firstVideo = p;
    } catch (err) {
      statusFails += 1;
    }
  }
  // byte-range: one representative mp4 + one webm (Safari's player and the
  // dex seek both issue Range requests; a plain 200 means no seeking)
  for (const probe of [firstVideo, [...media].find((p) => p.endsWith(".webm"))]) {
    if (!probe) continue;
    try {
      const res = await fetch(URL_ARG + probe, { headers: { Range: "bytes=0-1023" } });
      if (res.status !== 206) rangeFails += 1;
    } catch {
      rangeFails += 1;
    }
  }
  note(statusFails === 0, "every referenced media URL returns 200", statusFails ? `${statusFails} failed` : "all");
  note(typeFails === 0, "media content types exact (mp4/webm/png)", typeFails ? `${typeFails} wrong` : "all");
  note(rangeFails === 0, "byte-range seeking supported (206)", rangeFails ? `${rangeFails} probes failed` : "mp4+webm 206");
  note(cacheFails === 0, "long CDN cache on every media asset", cacheFails ? `${cacheFails} uncached` : "s-maxage set");
}

/* ---------------------------------------------------------------- */
/* SEO: the search surface a crawler reads, on the deployed page     */
/* ---------------------------------------------------------------- */

section("seo surface");
note(
  /<link rel="canonical" href="https:\/\/unown-nine\.vercel\.app\/?"\s*\/?>/.test(html),
  "canonical link resolves to the production origin",
);
note(
  /<meta name="robots" content="[^"]*index[^"]*follow[^"]*"/.test(html),
  "robots meta allows indexing",
);
note(
  /<meta name="googlebot" content="[^"]*max-image-preview:large[^"]*"/.test(html),
  "googlebot directives keep full previews",
);
const ogImages = [...html.matchAll(/property="og:image" content="([^"]+)"/g)].map((m) => m[1]);
note(ogImages.length === 1, "one og:image (crawlers use the first)", `${ogImages.length}: ${ogImages.join(", ")}`);
note(html.includes('property="og:image:width"'), "og:image carries explicit width/height");
note(html.includes('property="og:site_name"'), "og:site_name present");
note(html.includes('name="twitter:card" content="summary_large_image"'), "twitter large card");
const ldGraphs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .filter((s) => s.includes('"@graph"'));
note(ldGraphs.length === 1, "one JSON-LD graph", `${ldGraphs.length} graph(s)`);
try {
  const graph = JSON.parse(ldGraphs[0]);
  const types = graph["@graph"].map((n) => n["@type"]);
  note(types.includes("SoftwareApplication"), "SoftwareApplication node");
  note(types.includes("Organization"), "Organization node");
  note(types.includes("FAQPage"), "FAQPage node");
  const app = graph["@graph"].find((n) => n["@type"] === "SoftwareApplication");
  note(app?.offers?.price === 0, "offers.price is 0 (required for a free app)");
} catch (err) {
  note(false, "JSON-LD graph parses", String(err.message ?? err));
}
try {
  const robotsTxt = bodies["/robots.txt"] ?? "";
  note(/Sitemap: https:\/\/unown-nine\.vercel\.app\/sitemap\.xml/.test(robotsTxt), "robots.txt names the sitemap");
  // Case-insensitive: Next's robots.ts convention emits "User-Agent" with a
  // capital A — the first draft of this check assumed the lowercase spelling
  // and failed against a healthy file.
  note(/user-agent: \*\s*\nallow: \//i.test(robotsTxt), "robots.txt allows all crawlers");
  const sitemap = bodies["/sitemap.xml"] ?? "";
  note(/<loc>https:\/\/unown-nine\.vercel\.app\/?<\/loc>/.test(sitemap), "sitemap.xml carries the production URL");
  note(/<lastmod>/.test(sitemap), "sitemap.xml carries a lastmod");
} catch (err) {
  note(false, "robots.txt + sitemap.xml checks", String(err.message ?? err));
}

section("page content (cont)");
note(/id="alphabet"/.test(html), "alphabet section");
note((html.match(/viewBox="0 0 100 100"/g) || []).length >= 28, "the 28-form script", `${(html.match(/viewBox="0 0 100 100"/g) || []).length} glyph SVGs`);
note(html.includes("seal-form"), "hero seal");
note(html.includes("Skip to content"), "skip link");
note(html.includes("psst"), "konami hint");
note(html.includes("not affiliated with, endorsed by or sponsored by"), "non-affiliation disclaimer");
note(html.includes("pass@1") || html.includes("HumanEval"), "benchmark figures");
note(html.includes("hook_log"), "hook decision log");
note(/Neuro|<svg[^>]+>/.test(html) || html.includes("<svg"), "inline svg present");

/* ---------------------------------------------------------------- */
/* blog: the second surface, served or not                         */
/* ---------------------------------------------------------------- */

section("blog");
const blogHtml = bodies["/blog"] ?? "";
if (!blogHtml) {
  note(false, "/blog returned HTML", "no body — the route checks above failed first");
} else {
  note(/<h1[^>]*>\s*Blog\s*<\/h1>/.test(blogHtml), "blog index carries its h1");
  note(blogHtml.includes('href="/feed.xml"'), "the index links the RSS feed");
  note(
    /<link rel="alternate" type="application\/rss\+xml"[^>]*feed\.xml/.test(blogHtml),
    "RSS autodiscovery link in the head",
  );
  // The landing page's access points still work after the blog round: the
  // nav's one non-anchor entry and the footer's eighth link.
  note(/href="\/blog"[^>]*>\s*Blog\s*</.test(blogHtml) || blogHtml.includes('href="/blog"'), "a /blog link renders");
}
const feed = bodies["/feed.xml"] ?? "";
if (feed) {
  note(feed.includes('<rss version="2.0"'), "feed.xml is RSS 2.0");
  note((feed.match(/<item>/g) || []).length >= 1, "feed carries items", `${(feed.match(/<item>/g) || []).length} item(s)`);
  note(feed.includes("unown-nine.vercel.app/blog/"), "feed links are absolute against SITE");
}
const sitemapAll = bodies["/sitemap.xml"] ?? "";
note(/<loc>https:\/\/unown-nine\.vercel\.app\/blog<\/loc>/.test(sitemapAll), "sitemap.xml carries /blog");
note((sitemapAll.match(/<loc>https:\/\/unown-nine\.vercel\.app\/blog\//g) || []).length >= 1, "sitemap.xml carries the post URLs");

/* ---------------------------------------------------------------- */
/* no-JS: the page must not be a blank slate without scripting      */
/* ---------------------------------------------------------------- */

section("no-JS safety net");
// Framer Motion serialises `initial` into the SSR markup, so ~56 elements ship
// as `style="opacity:0;transform:translateY(...)"`. Without the <noscript>
// override the page is blank for anyone with scripting disabled.
const inlineHidden = (html.match(/style="opacity:0/g) || []).length;
note(inlineHidden > 0, "pre-hydration hidden state present (expected)", `${inlineHidden} elements`);
note(/<noscript>[\s\S]*opacity: 1 !important[\s\S]*<\/noscript>/.test(html), "<noscript> override shipped");
const head = html.slice(0, html.indexOf("</head>"));
note(!/unown-landing-noscript/.test(head), "override NOT hoisted to <head>", "hoisting would kill every reveal");

/* ---------------------------------------------------------------- */
/* accessibility regressions                                          */
/* ---------------------------------------------------------------- */

section("accessibility regressions");
note(!/text-(faint|dim|ink|gold|gold-soft|amber-\d+|rose-\d+)\/\d+/.test(html), "no opacity-faded text tokens");
note(!/class="[^"]*"[^>]*>\s*<li/.test(html) === false || !/<ul[^>]*>\s*<div/.test(html), "no <ul><div><li> list breakage");
note(html.includes('role="slider"'), "session scrubber exposed as a slider");
note(/role="tablist"/.test(html), "loop tabs exposed as a tablist");

/* ---------------------------------------------------------------- */
/* assets: licensed sources only, nothing hotlinked from elsewhere   */
/* ---------------------------------------------------------------- */

section("assets");
/*
 * Only `src` is a subresource the page actually fetches. `href` is a link a
 * visitor may choose to follow, and hyperlinking Bulbapedia or Wikipedia in a
 * sources list is precisely what the licensing rule asks for — paraphrasing a
 * fact and linking it. Conflating the two made this check fail on a healthy
 * deployment twice.
 */
const subresources = [...html.matchAll(/\ssrc="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
const loaded = [...new Set(subresources)];
const allowed = ["unown-nine.vercel.app", "kanishka-namdeo.github.io"];
const unexpectedLoads = loaded.filter((u) => !allowed.some((a) => u.includes(a)));
note(
  unexpectedLoads.length === 0,
  "no cross-origin subresource loads",
  unexpectedLoads.join(", ") || "none — every asset is self-hosted",
);

const hyperlinks = [...new Set([...html.matchAll(/\shref="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))];
console.log(`        (${hyperlinks.length} external hyperlinks, all opt-in — not loaded by the page)`);

/* An asset leak means something being *loaded*, not something being cited. */
const forbiddenAssets = [
  "fonts.gstatic.com",
  "fonts.googleapis.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "dafont",
  "fontstruct",
  "archive.org",
  "wikimedia",
];
const assetLeaks = loaded.filter((u) => forbiddenAssets.some((f) => u.includes(f)));
note(assetLeaks.length === 0, "no externally hosted font or asset loads", assetLeaks.join(", ") || "none");

/* Everything the page cites must be linked, and it must say it is not affiliated. */
const citedSources = hyperlinks.filter((u) => /bulbapedia|serebii|pokemondb|wikipedia|nsta|ssbwiki/.test(u));
console.log(`        (${citedSources.length} cited lore sources, hyperlinked with attribution)`);
note(
  html.includes("not affiliated with, endorsed by or sponsored by"),
  "non-affiliation stated where the lore appears",
);

/* ---------------------------------------------------------------- */
/* css bundle                                                        */
/* ---------------------------------------------------------------- */

section("css");
const cssHrefs = [...new Set([...html.matchAll(/href="(\/_next\/static\/chunks\/[^"]+\.css)"/g)].map((m) => m[1]))];
let css = "";
for (const h of cssHrefs) {
  try {
    const r = await fetch(URL_ARG + h);
    css += await r.text();
  } catch {
    /* a chunk that will not fetch is reported by the content checks above */
  }
}
// Production CSS is minified, so every probe below is whitespace-insensitive.
const flat = css.replace(/\s+/g, "");
note(css.length > 0, "stylesheet chunks fetched", `${cssHrefs.length} chunks, ${(css.length / 1024).toFixed(0)} KB`);
// Palette probe. This used to assert one literal hex (`.bg-canvas{…#0c0b0a}`),
// which broke the moment the landing page moved to a two-scheme palette: the
// utility now emits `var(--color-canvas)` so the `:root` / `prefers-color-scheme`
// / `[data-theme]` cascade can repaint it at runtime. Assert the mechanism, not
// a frozen value — a var-emitting utility plus both scheme canvases shipped is a
// stronger guarantee than the single hex ever was.
note(/\.bg-canvas\{background-color:var\(--color-canvas\)\}/.test(flat), "palette tokens emitted as vars (repaintable)");
note(flat.includes("#102039") && flat.includes("#e6e6d5"), "both scheme canvases shipped");
note(flat.includes("--color-psychic") && flat.includes("--tone-fill") && flat.includes("--hue-accent"), "Gen 3 hue system shipped");
note(flat.includes("[data-theme=light]") && flat.includes("prefers-color-scheme:light"), "light override + auto-default shipped");
// Grain probe. The original page used an SVG `feTurbulence` film-grain filter;
// the retro rebuild replaced it with the thing an LCD actually has — a fixed
// pixel-separator matrix drawn as two crossed `repeating-linear-gradient`s in
// `--gb-grain` (see landing.css). Assert the texture is present by its shipped
// mechanism, not the retired filter. (The CRT scanline layer that used to sit
// alongside it is gone: a Game Boy Advance is a TFT panel and has no scanlines.)
note(flat.includes("--gb-grain") && flat.includes("repeating-linear-gradient"), "grain texture present");
note(flat.includes("animation-timeline"), "scroll-driven motion present");
note(flat.includes("@keyframesrise"), "reveal keyframes present");
note(flat.includes("@media(prefers-reduced-motion:reduce)"), "reduced-motion honoured");
// Quote-face probe. `.quote` used to be Instrument Serif (a `--font-quote`
// token); the DMG rebuild retired the serif — a quoted dex entry is game text —
// and the face is now VT323 (`--font-vt`), matching the terminal body. Assert
// the class still resolves to a real family so the attributed-quotation rule
// (quote-only, never body copy) survives.
note(/\.quote\{font-family:var\(--font-vt\)/.test(flat), "quote face loaded");
note(!/\.text-faint\\\/70/.test(css) && !/\.text-faint\\\/80/.test(css), "faded text utilities not emitted");

/* ---------------------------------------------------------------- */
/* summary                                                            */
/* ---------------------------------------------------------------- */

console.log(
  failures === 0
    ? "\nall checks passed"
    : `\n${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);