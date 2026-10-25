# Blog content (content/)

## Purpose

The source of truth for the blog: one markdown file per post under `content/blog/`, rendered into the site by the generator. The blog is the longhand record the landing page's changelog rail is the shorthand of — each meaningful feature or release gets a post that says what it does, why it exists, and shows the media that proves it.

## Ownership

- Owns: `content/blog/*.md` (the posts), `content/blog/TEMPLATE.md` (the authoring template), and this doc.
- The generator (`scripts/landing_blog.mjs`), the generated data (`src/components/blog/blog-data.ts`), the feed (`public/feed.xml`) and the pages (`src/app/blog/`) are owned elsewhere — see their docs. Media a post embeds lives under `public/` (already-owned landing assets reused where they fit, or new captures from the owning lane).

## Local Contracts

- One post = one file = one URL: `content/blog/<slug>.md` renders at `/blog/<slug>`. The slug MUST be `YYYY-MM-DD-kebab-name` (publication date; the generator refuses anything else).
- Frontmatter grammar is a strict subset of YAML — `key: value` strings, `key: [a, b]` flow lists, booleans. Required: `title` (<=96 chars), `description` (70-160 chars, the meta band), `date` (ISO), `tags` (1-4 lowercase kebab words), `type` (`feature` | `release` | `announcement`). Optional: `lastmod` (>= date), `draft: true` (hidden entirely), `media` (list of `/`-rooted public/ paths the post embeds — the generator fails the build on a dead path).
- The body is GFM markdown. Raw HTML passes through (repo-authored, PR-reviewed — the same trust boundary MDX has); use it for `<video>` embeds. Never embed viewer-supplied content.
- Every post edit requires regenerating: `node scripts/landing_blog.mjs` (writes `blog-data.ts` + `public/feed.xml`; `bun run check:blog` is the CI gate). Drafts never generate.
- Honesty rules inherit from the landing page: claims cite repo artifacts (CHANGELOG entries, docs pages, receipts under `benchmarks/`), measured figures need a receipt, and TUI media comes from the `scripts/tui-capture/` lane — never a browser screenshot.
- Media reuse: prefer existing audited captures under `public/landing/tui/**` over new media; new TUI footage must go through the capture lane and land in `public/landing/tui/` (or `public/blog/<slug>/` for non-TUI images like diagrams), never be hotlinked.

## Work Guidance

- Start from `content/blog/TEMPLATE.md` — it carries the frontmatter reference, the body structure, and the per-type media checklist.
- The media checklist is part of the post: a `feature` post without at least one capture, still or diagram should say why in the post itself.
- Tag vocabulary is free-form kebab-case but should stay small; check existing tags in `blog-data.ts` before inventing a near-synonym.

## Verification

- `node scripts/landing_blog.mjs --check` (CI: `bun run check:blog`) — generation matches the sources.
- `node --test scripts/landing_blog.test.mjs` — the generator's own grammar/validation pins.
- `bun test src` (the blog page suites) and the e2e blog spec cover the rendered surface.

## Child DOX Index

(none — flat directory)
