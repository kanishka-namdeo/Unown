// Blog generator: content/blog/*.md -> src/components/blog/blog-data.ts + public/feed.xml.
//
//   node scripts/landing_blog.mjs           write the data file and the feed
//   node scripts/landing_blog.mjs --check   CI gate: fail if either no longer matches
//
// Why generated instead of a CMS (the decision docs/landing-research.md
// "2026-10-25 — the blog" records in full): this repository's whole honesty
// posture is that the page renders artifacts the repo owns. A post is an
// artifact — it lives beside the code it describes, reviews in the same PR,
// and regenerates the same way the changelog rail does. The one dependency
// this script allows itself is `marked` (dev-only, zero transitive deps,
// MIT) because hand-writing a markdown renderer is where sloppiness would
// enter; everything else — the frontmatter grammar, the validation, the
// reading time, the RSS — is node builtins so the gate stays honest.
//
// Rules it encodes, in one place so the pages stay dumb:
//   - a post is a `content/blog/<slug>.md` file whose slug MUST be
//     `YYYY-MM-DD-kebab-name` (Linear-style dated slugs: chronological URLs,
//     no collision possible between a re-run title and an old one).
//   - the frontmatter grammar is a deliberate subset of YAML: `key: value`
//     strings, `key: [a, b]` flow lists, booleans. Anything else — nesting,
//     quotes-with-colons, unknown keys — FAILS the run instead of being
//     silently dropped. A subset parser that quietly accepts a typo'd key
//     is how a post ships without its tags.
//   - `title` (<= 96 chars) and `description` (70-160 chars, the meta band)
//     are required; `date` is ISO and required; `lastmod` >= `date` when
//     present; `tags` is 1-4 lowercase kebab words; `type` is one of
//     feature | release | announcement; `draft: true` hides a post entirely
//     (it never reaches the data file, the feed or the sitemap).
//   - `media:` lists the public/ paths a post embeds (leading `/`); each
//     must exist — the same contract the dex-media test holds the capability
//     footage to. A post that ships with a dead image path is a red build,
//     not a 404 discovered by a visitor.
//   - the body renders through marked (GFM, no raw-HTML sanitising: content
//     is repo-authored and reviewed, the same trust boundary MDX has), the
//     reading time is the rendered word count / 200 (min 1), and the sort is
//     date desc then slug asc — deterministic, so a regenerate cannot
//     reshuffle the index.
//   - the feed is RSS 2.0 written as a static tracked file in public/ —
//     served by every host including the standalone build, discoverable via
//     the layout's <link rel="alternate">, and diffable by --check.
//
// The comparison is EOL-normalised so the gate cannot fail purely over line
// endings (this checkout is CRLF under core.autocrlf while the blobs are LF).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "content", "blog");
const TARGET = join(ROOT, "src", "components", "blog", "blog-data.ts");
const FEED = join(ROOT, "public", "feed.xml");
const SITE_TS = join(ROOT, "src", "lib", "site.ts");

const TYPES = ["feature", "release", "announcement"];
const SLUG_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The keys the grammar accepts. A key outside this set fails the run. */
const KNOWN_KEYS = ["title", "description", "date", "lastmod", "tags", "type", "draft", "media"];

/** Thrown, not exited: the failure modes are the point of the unit test. */
class BlogError extends Error {}
const fail = (msg) => {
  throw new BlogError(`landing_blog: ${msg}`);
};

/* ------------------------------------------------------------------ */
/* site origin                                                         */
/* ------------------------------------------------------------------ */

/** The production origin, read out of src/lib/site.ts so a domain move is
 *  still one edit — the generator has no second copy to drift. */
function readSiteUrl() {
  const ts = readFileSync(SITE_TS, "utf8");
  const m = ts.match(/url:\s*"([^"]+)"/);
  if (!m) fail("cannot read SITE.url out of src/lib/site.ts");
  return m[1];
}

/* ------------------------------------------------------------------ */
/* frontmatter: a deliberate YAML subset                               */
/* ------------------------------------------------------------------ */

/**
 * `key: value` strings, `key: [a, b]` flow lists, booleans — nothing else.
 * Returns `{ meta, body }`. Multi-word string values need no quotes in this
 * subset (the grammar has no colons-in-values); a value that wants to carry
 * a colon must be rephrased, which is the right pressure for descriptions.
 */
function parseFrontmatter(raw, slug) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) fail(`${slug}.md has no --- frontmatter block`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) fail(`${slug}.md: unparsable frontmatter line: "${line.trim()}"`);
    const [, key, value] = kv;
    if (!KNOWN_KEYS.includes(key)) {
      fail(`${slug}.md: unknown frontmatter key "${key}" — known keys: ${KNOWN_KEYS.join(", ")}`);
    }
    if (meta[key] !== undefined) fail(`${slug}.md: frontmatter key "${key}" appears twice`);
    if (value.startsWith("[")) {
      if (!value.endsWith("]")) fail(`${slug}.md: unterminated list for "${key}"`);
      const items = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      meta[key] = items;
    } else if (value === "true" || value === "false") {
      meta[key] = value === "true";
    } else {
      meta[key] = value.trim();
    }
  }
  return { meta, body: m[2] };
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

const isPlainString = (v) => typeof v === "string" && v.length > 0;

function validateMeta(meta, slug) {
  if (!isPlainString(meta.title)) fail(`${slug}.md: title is required`);
  if (meta.title.length > 96) fail(`${slug}.md: title is ${meta.title.length} chars (max 96)`);
  if (!isPlainString(meta.description)) fail(`${slug}.md: description is required`);
  if (meta.description.length < 70 || meta.description.length > 160) {
    fail(
      `${slug}.md: description is ${meta.description.length} chars — the meta description band is 70-160`,
    );
  }
  if (!isPlainString(meta.date) || !ISO_RE.test(meta.date)) {
    fail(`${slug}.md: date must be an ISO YYYY-MM-DD string`);
  }
  if (Number.isNaN(Date.parse(meta.date))) fail(`${slug}.md: date is not a real calendar date`);
  if (meta.lastmod !== undefined) {
    if (!isPlainString(meta.lastmod) || !ISO_RE.test(meta.lastmod)) {
      fail(`${slug}.md: lastmod must be an ISO YYYY-MM-DD string`);
    }
    if (meta.lastmod < meta.date) fail(`${slug}.md: lastmod ${meta.lastmod} predates date ${meta.date}`);
  }
  if (!Array.isArray(meta.tags) || meta.tags.length < 1 || meta.tags.length > 4) {
    fail(`${slug}.md: tags must be a list of 1-4 entries`);
  }
  for (const t of meta.tags) {
    if (typeof t !== "string" || !TAG_RE.test(t)) {
      fail(`${slug}.md: tag "${t}" must be lowercase kebab-case`);
    }
  }
  if (!isPlainString(meta.type) || !TYPES.includes(meta.type)) {
    fail(`${slug}.md: type must be one of ${TYPES.join(" | ")}`);
  }
  if (meta.draft !== undefined && typeof meta.draft !== "boolean") {
    fail(`${slug}.md: draft must be a boolean`);
  }
  if (meta.media !== undefined) {
    if (!Array.isArray(meta.media)) fail(`${slug}.md: media must be a list of public/ paths`);
    for (const p of meta.media) {
      if (typeof p !== "string" || !p.startsWith("/")) {
        fail(`${slug}.md: media path "${p}" must start with / (a public/ URL path)`);
      }
      if (!existsSync(join(ROOT, "public", p.slice(1)))) {
        fail(`${slug}.md: media path "${p}" does not exist under public/`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* reading time                                                        */
/* ------------------------------------------------------------------ */

/** Words of rendered text / 200, minimum 1 — the industry-standard wpm the
 *  research round measured (Medium 200-265, dev blogs print 200). */
function readingMinutes(html) {
  const words = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/* ------------------------------------------------------------------ */
/* parsing a post                                                      */
/* ------------------------------------------------------------------ */

function parsePost(raw, slug) {
  if (!SLUG_RE.test(slug)) {
    fail(`${slug}.md: slug must be YYYY-MM-DD-kebab-name (got "${slug}")`);
  }
  const { meta, body } = parseFrontmatter(raw, slug);
  validateMeta(meta, slug);
  if (meta.draft === true) return null;

  const html = marked.parse(body, { gfm: true, breaks: false });
  if (!isPlainString(html) || html.trim().length === 0) fail(`${slug}.md: body rendered to nothing`);

  return {
    slug,
    title: meta.title,
    description: meta.description,
    date: meta.date,
    lastmod: isPlainString(meta.lastmod) ? meta.lastmod : null,
    tags: meta.tags,
    type: meta.type,
    readingMinutes: readingMinutes(html),
    media: Array.isArray(meta.media) ? meta.media : [],
    html,
  };
}

/* ------------------------------------------------------------------ */
/* feed                                                                */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** RSS 2.0 with an Atom-style self link, hand-emitted so the feed has no
 *  dependency and --check can diff it byte-for-byte like the data file. */
function buildFeed(posts, origin) {
  const items = posts
    .map(
      (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${origin}/blog/${p.slug}</link>
      <guid isPermaLink="true">${origin}/blog/${p.slug}</guid>
      <pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
      ${p.tags.map((t) => `<category>${esc(t)}</category>`).join("\n      ")}
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Unown blog</title>
    <link>${origin}/blog</link>
    <atom:link href="${origin}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>How each feature and release works, what it does, and the receipts behind it — the longhand record of the self-improving terminal coding agent Unown.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

/* ------------------------------------------------------------------ */
/* emitting                                                            */
/* ------------------------------------------------------------------ */

function emit(posts, origin) {
  const tags = [...new Set(posts.flatMap((p) => p.tags))].sort();
  return `// GENERATED by scripts/landing_blog.mjs from content/blog/*.md — do not hand-edit.
// Regenerate after any post edit:  node scripts/landing_blog.mjs
// CI gate (also \`bun run check:blog\`): node scripts/landing_blog.mjs --check
//
// The blog index and post pages render this file. Posts are repo-authored
// markdown under content/blog/ (see content/AGENTS.md and docs/blog.md for
// the authoring template and the media rules); drafts never reach this
// file, dates come from the frontmatter, and the reading time is derived —
// nothing on the pages was typed twice.

export type BlogType = ${TYPES.map((t) => `"${t}"`).join(" | ")};

export interface BlogPost {
  /** \`2026-10-25-unown-is-in-beta\` — date-prefixed, the URL segment. */
  slug: string;
  title: string;
  /** The meta description band (70-160 chars); also the index card copy. */
  description: string;
  /** ISO publication date from the frontmatter. */
  date: string;
  /** ISO last-contentful-edit date; null when the post never changed. */
  lastmod: string | null;
  tags: string[];
  type: BlogType;
  /** Words of rendered body / 200, minimum 1. Derived, never authored. */
  readingMinutes: number;
  /** public/ paths the post embeds; existence-validated at generation. */
  media: string[];
  /** The rendered markdown body. Repo-authored and PR-reviewed, trusted the
   *  way MDX output is trusted — never visitor input. */
  html: string;
}

export const BLOG_TOTAL_POSTS = ${posts.length};

export const BLOG_TAGS: string[] = ${JSON.stringify(tags)};

export const BLOG_POSTS: BlogPost[] = ${JSON.stringify(posts, null, 2)};
`;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

function loadPosts() {
  if (!existsSync(SOURCE_DIR)) fail("content/blog/ does not exist — no posts to render");
  const files = readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (!files.length) fail("content/blog/ carries no .md posts — the blog would be an empty page");
  const drafts = [];
  const posts = [];
  for (const f of files) {
    if (f === "TEMPLATE.md") continue; // the authoring template is not a post
    const slug = f.replace(/\.md$/, "");
    const post = parsePost(readFileSync(join(SOURCE_DIR, f), "utf8"), slug);
    if (post) posts.push(post);
    else drafts.push(slug);
  }
  if (!posts.length) fail("every post is a draft — the blog would be an empty page");
  // date desc, then slug asc: deterministic across regenerations.
  posts.sort((a, b) => (a.date === b.date ? (a.slug < b.slug ? -1 : 1) : a.date < b.date ? 1 : -1));
  const slugs = new Set(posts.map((p) => p.slug));
  if (slugs.size !== posts.length) fail("duplicate slug parsed — the filesystem disagrees");
  if (drafts.length) console.log(`        (${drafts.length} draft(s) skipped: ${drafts.join(", ")})`);
  return posts;
}

function run(check) {
  const origin = readSiteUrl();
  const posts = loadPosts();
  const out = emit(posts, origin);
  const feed = buildFeed(posts, origin);

  if (check) {
    for (const [path, current, want] of [
      [TARGET.replace(ROOT + "/", ""), existsSync(TARGET) ? readFileSync(TARGET, "utf8") : null, out],
      [FEED.replace(ROOT + "/", ""), existsSync(FEED) ? readFileSync(FEED, "utf8") : null, feed],
    ]) {
      if (current === null) fail(`${path} is missing — run \`node scripts/landing_blog.mjs\``);
      if (current.replace(/\r\n/g, "\n") !== want.replace(/\r\n/g, "\n")) {
        fail(
          `${path} no longer matches content/blog/.\n` +
            "                 A post changed (or this script did) without the data being\n" +
            "                 regenerated. Run: node scripts/landing_blog.mjs",
        );
      }
    }
    console.log(
      `ok  blog matches content/blog: ${posts.length} posts, ${posts.reduce((n, p) => n + p.tags.length, 0)} tags`,
    );
    return posts;
  }

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, out);
  mkdirSync(dirname(FEED), { recursive: true });
  writeFileSync(FEED, feed);
  console.log(
    `wrote src/components/blog/blog-data.ts + public/feed.xml: ${posts.length} posts ` +
      `(${posts.map((p) => `${p.slug} ${p.date}`).join(", ")})`,
  );
  return posts;
}

export { parseFrontmatter, validateMeta, parsePost, readingMinutes, buildFeed, emit, loadPosts, run, TYPES };

// Importable so its extraction rules can be pinned by
// scripts/landing_blog.test.mjs; a gate that re-derives its own output
// cannot catch a parser that quietly drops a frontmatter key.
const self = fileURLToPath(import.meta.url).replace(/\\/g, "/").toLowerCase();
const invoked = process.argv[1] ? resolve(process.argv[1]).replace(/\\/g, "/").toLowerCase() : "";
if (invoked === self) {
  try {
    run(process.argv.includes("--check"));
  } catch (err) {
    console.error(err instanceof BlogError ? err.message : err);
    process.exit(1);
  }
}
