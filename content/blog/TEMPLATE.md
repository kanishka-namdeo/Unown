---
title: TEMPLATE — copy me, then delete this line (title, max 96 chars)
description: The one-line summary a reader sees on the index card and a crawler shows in results; 70-160 characters, front-loaded.
date: 2026-10-25
lastmod: 2026-10-25
tags: [template]
type: announcement
draft: true
media: []
---

<!--
  THE TEMPLATE — copy this file, rename it YYYY-MM-DD-kebab-name.md, fill it in.

  frontmatter reference (the generator fails the build on any violation):
    title        required string, <= 96 chars. Renders as the h1, the <title>,
                 the og:title and the RSS item title.
    description  required string, 70-160 chars (the meta description band).
                 Also the index-card copy — write it for the reader first.
    date         required ISO YYYY-MM-DD (publication date; must prefix the slug).
    lastmod      optional ISO date, >= date. Bump when the CONTENT changes
                 (it feeds sitemap lastmod and JSON-LD dateModified).
    tags         required list, 1-4 lowercase kebab words ([memory, engine]).
    type         required: feature | release | announcement
                 feature       — a capability, how it works, why it exists
                 release       — a cut release and what shipped in it
                 announcement  — stage/position changes, calls for feedback
    draft        optional boolean, default false. true = never rendered.
    media        optional list of /-rooted public/ paths the post embeds.
                 The generator verifies every path EXISTS — a post cannot
                 ship with a dead image. List every embed here.

  body structure (all sections optional except the lede; delete the comment
  block before committing):
    1. lede         — 2-3 sentences: what this is, who it is for.
    2. how it works — the mechanism, concrete: commands, files, formats.
    3. why          — the alternative it replaces and what that cost.
    4. receipts     — links to CHANGELOG.md entries, docs/ pages, benchmark
                      receipts. Every measured number cites its receipt.
    5. media        — the embeds (see checklist below).
    6. what ships next — optional; one sentence, no promises with dates.

  media checklist per type (the "kind of media needed to support each post"):
    feature post
      - one capture of the capability in motion: an existing reel from
        public/landing/tui/<feature>/ (mp4 + webm; embed via the <video>
        snippet below, poster = one of that scenario's audited stills), OR
      - 2-4 stills from public/landing/tui/<feature>/stills/, embedded with
        ![alt](path) and a one-line caption each, OR
      - a diagram for architecture posts (new, under public/blog/<slug>/).
      - new TUI footage: the scripts/tui-capture/ lane, never a screenshot.
    release post
      - usually NO new media: link the GitHub release, the changelog stop,
        and reuse the feature posts' captures inline where they help.
      - a before/after pair only when the release fixes something visual.
    announcement post
      - the OG card is generated automatically (title + date + palette) —
      - body media optional; the beta announcement shipped text-only.

  video embed snippet (raw HTML passes through; poster avoids the poster-
  frame flash; muted+controls follows the landing dex contract):
    <video controls muted playsinline width="880"
           poster="/landing/tui/<feature>/stills/01-....png">
      <source src="/landing/tui/<feature>/<feature>.mp4" type="video/mp4"/>
      <source src="/landing/tui/<feature>/<feature>.webm" type="video/webm"/>
    </video>

  house rules: cite repo artifacts for every claim; no invented numbers;
  no promises with dates; write in the landing page's voice (concrete,
  confident, honest about limits); no emojis.
-->

## Section heading

Body text. Markdown here renders through marked with GFM — tables, task
lists and fenced code blocks all work:

```bash
unown --version
```

Delete this file's body when you use it; keep the frontmatter block.
