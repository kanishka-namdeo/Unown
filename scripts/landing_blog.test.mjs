// landing_blog.test.mjs — pins for the blog generator itself.
//
// A gate that re-derives its own output cannot catch a parser that quietly
// drops a frontmatter key or an overlong description that should have failed
// — these tests hold the extraction rules the way landing_changelog.test.mjs
// holds the rail's. Every failure mode below was either hit during the
// round (two real descriptions over 160 chars were caught by the band rule)
// or constructed to pin a rule that would otherwise be decorative.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFrontmatter,
  validateMeta,
  parsePost,
  readingMinutes,
  buildFeed,
  emit,
  TYPES,
} from "./landing_blog.mjs";

/* ------------------------------------------------------------------ */

const VALID = `---
title: A real post title
description: A description that sits inside the seventy-to-one-sixty character band, which is what the meta description field wants.
date: 2026-10-25
tags: [memory, engine]
type: feature
media: []
---

Body with **bold** and a list:

- one
- two
`;

test("parseFrontmatter reads the subset grammar: strings, lists, booleans", () => {
  const { meta, body } = parseFrontmatter(VALID, "2026-10-25-a-real-post");
  assert.equal(meta.title, "A real post title");
  assert.deepEqual(meta.tags, ["memory", "engine"]);
  assert.equal(meta.type, "feature");
  assert.deepEqual(meta.media, []);
  assert.ok(body.trim().startsWith("Body with"));
});

test("parseFrontmatter refuses what the grammar does not cover", () => {
  const slug = "2026-10-25-x";
  assert.throws(() => parseFrontmatter("no frontmatter here", slug), /no --- frontmatter/);
  assert.throws(
    () => parseFrontmatter("---\ntitle: x\nunknown-key: 1\n---\n\nbody", slug),
    /unknown frontmatter key "unknown-key"/,
  );
  assert.throws(
    () => parseFrontmatter("---\ntitle: x\ntitle: y\n---\n\nbody", slug),
    /"title" appears twice/,
  );
  assert.throws(
    () => parseFrontmatter("---\n: broken line\n---\n\nbody", slug),
    /unparsable frontmatter line/,
  );
  // The boolean grammar is the literal words, nothing cleverer.
  const { meta } = parseFrontmatter("---\ndraft: true\ntags: [a]\n---\n\nb", slug);
  assert.equal(meta.draft, true);
});

/* ------------------------------------------------------------------ */

const baseMeta = {
  title: "A real post title",
  description:
    "A description that sits inside the seventy-to-one-sixty character band, which is what the meta description field wants.",
  date: "2026-10-25",
  tags: ["memory"],
  type: "feature",
};

test("validateMeta enforces every required field and band", () => {
  validateMeta({ ...baseMeta }); // does not throw

  for (const [key, re] of [
    ["title", /title is required/],
    ["description", /description is required/],
    // date/tags/type carry their own shape messages when absent — the
    // required-ness shows up as the shape failure, and pinning the actual
    // message is what keeps a reworded error honest.
    ["date", /date must be an ISO/],
    ["tags", /tags must be a list/],
    ["type", /type must be one of/],
  ]) {
    const broken = { ...baseMeta };
    delete broken[key];
    assert.throws(() => validateMeta(broken, "s"), re);
  }

  assert.throws(
    () => validateMeta({ ...baseMeta, date: "2026-13-45" }, "s"),
    /not a real calendar date/,
  );
  assert.throws(
    () => validateMeta({ ...baseMeta, lastmod: "2026-10-24" }, "s"),
    /predates date/,
  );
  assert.throws(() => validateMeta({ ...baseMeta, tags: [] }, "s"), /1-4/);
  assert.throws(() => validateMeta({ ...baseMeta, tags: ["UPPER"] }, "s"), /kebab/);
  assert.throws(() => validateMeta({ ...baseMeta, tags: ["a", "b", "c", "d", "e"] }, "s"), /1-4/);
  assert.throws(() => validateMeta({ ...baseMeta, type: "essay" }, "s"), /feature \| release \| announcement/);
  assert.throws(
    () => validateMeta({ ...baseMeta, title: "x".repeat(97) }, "s"),
    /max 96/,
  );
  // The meta description band — the rule that caught two real posts in the
  // round that shipped this generator.
  assert.throws(
    () => validateMeta({ ...baseMeta, description: "short" }, "s"),
    /70-160/,
  );
  assert.throws(
    () => validateMeta({ ...baseMeta, description: "x".repeat(161) }, "s"),
    /70-160/,
  );
});

test("validateMeta refuses media paths that do not exist under public/", () => {
  // A real, tracked asset (the memory-learn capture lane's poster).
  validateMeta({ ...baseMeta, media: ["/landing/tui/memory-learn/memory-learn.mp4"] });
  assert.throws(
    () => validateMeta({ ...baseMeta, media: ["/landing/tui/no-such-reel.mp4"] }, "s"),
    /does not exist under public\//,
  );
  assert.throws(
    () => validateMeta({ ...baseMeta, media: ["landing/tui/memory-learn/memory-learn.mp4"] }, "s"),
    /must start with \//,
  );
});

/* ------------------------------------------------------------------ */

test("parsePost enforces the dated slug shape and skips drafts", () => {
  assert.throws(() => parsePost(VALID, "my-post"), /YYYY-MM-DD-kebab-name/);
  assert.throws(() => parsePost(VALID, "2026-10-25_my_post"), /YYYY-MM-DD-kebab-name/);

  const post = parsePost(VALID, "2026-10-25-a-real-post");
  assert.equal(post.slug, "2026-10-25-a-real-post");
  assert.ok(post.html.includes("<strong>bold</strong>"));
  assert.ok(post.html.includes("<li>one</li>"));

  const draft = parsePost(
    VALID.replace("type: feature", "type: feature\ndraft: true"),
    "2026-10-25-a-real-post",
  );
  assert.equal(draft, null);
});

test("readingMinutes is derived from the rendered words, floored at one minute", () => {
  assert.equal(readingMinutes("<p>ten words here only</p>"), 1);
  // The derivation rounds word-count / 200: 300 words is 1.5 -> 2, 450 is
  // 2.25 -> 2, 600 is 3 exactly. Rounded, not ceiling — a 201-word post is
  // still a one-minute read.
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  assert.equal(readingMinutes(`<p>${words(200)}</p>`), 1);
  assert.equal(readingMinutes(`<p>${words(201)}</p>`), 1);
  assert.equal(readingMinutes(`<p>${words(300)}</p>`), 2);
  assert.equal(readingMinutes(`<p>${words(450)}</p>`), 2);
  assert.equal(readingMinutes(`<p>${words(600)}</p>`), 3);
});

/* ------------------------------------------------------------------ */

const POSTS = [
  {
    slug: "2026-10-25-a",
    title: "Ampersand & <angled> title",
    description: "Escaping probe.",
    date: "2026-10-25",
    lastmod: null,
    tags: ["memory"],
    type: "feature",
    readingMinutes: 2,
    media: [],
    html: "<p>body</p>",
  },
  {
    slug: "2026-10-24-b",
    title: "Older post",
    description: "Escaping probe.",
    date: "2026-10-24",
    lastmod: "2026-10-25",
    tags: ["release"],
    type: "release",
    readingMinutes: 1,
    media: [],
    html: "<p>body</p>",
  },
];

test("buildFeed escapes XML entities and links every item by guid", () => {
  const feed = buildFeed(POSTS, "https://example.com");
  assert.ok(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(feed.includes("<rss version=\"2.0\""));
  assert.ok(feed.includes('href="https://example.com/feed.xml" rel="self"'));
  // The title with an ampersand and angle brackets must not break the XML.
  assert.ok(feed.includes("<title>Ampersand &amp; &lt;angled&gt; title</title>"));
  assert.ok(feed.includes("<guid isPermaLink=\"true\">https://example.com/blog/2026-10-25-a</guid>"));
  assert.equal(feed.match(/<item>/g)?.length, 2);
  assert.ok(feed.includes("<category>memory</category>"));
  // RSS dates are RFC-822 UTC, derived from the ISO date.
  assert.ok(feed.includes("Sun, 25 Oct 2026 00:00:00 GMT"));
});

test("emit writes the typed module with totals, tags and the posts in order", () => {
  const out = emit(POSTS, "https://example.com");
  assert.ok(out.startsWith("// GENERATED by scripts/landing_blog.mjs"));
  assert.ok(out.includes("export type BlogType = \"feature\" | \"release\" | \"announcement\";"));
  assert.ok(out.includes("export const BLOG_TOTAL_POSTS = 2;"));
  assert.ok(out.includes('export const BLOG_TAGS: string[] = ["memory","release"];'));
  // date-desc order survives into the emitted array.
  assert.ok(out.indexOf("2026-10-25-a") < out.indexOf("2026-10-24-b"));
});

test("the type vocabulary is closed — a fourth type cannot slip in", () => {
  assert.deepEqual(TYPES, ["feature", "release", "announcement"]);
});
