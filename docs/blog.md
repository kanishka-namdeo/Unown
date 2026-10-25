# The blog

The blog is the longhand record: the changelog says what shipped, the landing page argues why it matters, and a blog post explains how a feature actually works — with the captures to show it and the receipts to back it. It lives at [`/blog`](https://unown-nine.vercel.app/blog), is generated from markdown in the repo, and deploys with the landing page on every push to `main`.

- [How it works](#how-it-works)
- [Writing a post](#writing-a-post)
- [The frontmatter reference](#the-frontmatter-reference)
- [The media a post needs](#the-media-a-post-needs)
- [Verification](#verification)

## How it works

Posts are plain markdown files under [`content/blog/`](../content/blog/) — one file per post, one URL per file. A generator ([`scripts/landing_blog.mjs`](../scripts/landing_blog.mjs), the same pattern the changelog rail uses) parses them and writes two **generated, tracked** artifacts:

- `src/components/blog/blog-data.ts` — typed post metadata plus the rendered HTML the pages render;
- `public/feed.xml` — the RSS 2.0 feed, served as a static file.

The pages (`src/app/blog/`) are static by construction: the index and every post are prerendered at build time, unknown slugs 404, and there is no request-time rendering anywhere. Markdown renders through `marked` (dev-only dependency, GFM on). Raw HTML in a post passes through — the content is repo-authored and PR-reviewed, the same trust boundary MDX has.

After editing any post (or adding one), regenerate and let the gate go green:

```bash
node scripts/landing_blog.mjs        # writes blog-data.ts + feed.xml
bun run check:blog                   # the CI gate: fail if either is stale
```

## Writing a post

Start from [`content/blog/TEMPLATE.md`](../content/blog/TEMPLATE.md) — copy it, rename the copy to `YYYY-MM-DD-kebab-name.md` (the publication date MUST prefix the slug; the generator refuses anything else), and fill it in. The template carries the full frontmatter reference, the body structure, and the media checklist inline.

The body structure that reads best:

1. **Lede** — two or three sentences: what this is and who it is for.
2. **How it works** — the mechanism, concrete: commands, files, formats.
3. **Why** — the alternative it replaces and what that cost.
4. **Receipts** — links to the CHANGELOG entry, the docs page, the benchmark receipt. Every measured number cites its receipt; a number with no receipt is a bug, not a style choice.
5. **Media** — the embeds (see below).
6. **What ships next** — optional; one sentence, no promises with dates.

House rules inherited from the landing page: concrete, confident, honest about limits; no emojis; no invented numbers; no promises with dates. Write in the voice the landing page and this repo's docs already use.

## The frontmatter reference

A strict subset of YAML — `key: value` strings, `key: [a, b]` flow lists, booleans. Anything else fails the build (an unknown key fails rather than being silently dropped, which is how a post would otherwise ship without its tags).

| Key | Required | Rules |
|---|---|---|
| `title` | yes | up to 96 chars; the h1, the `<title>`, `og:title`, the RSS item title |
| `description` | yes | 70–160 chars (the meta description band); also the index-card copy |
| `date` | yes | ISO `YYYY-MM-DD`; must prefix the slug |
| `lastmod` | no | ISO date, `>= date`; bump it when the CONTENT changes (it feeds sitemap `lastmod` and JSON-LD `dateModified`) |
| `tags` | yes | 1–4 lowercase kebab words |
| `type` | yes | `feature` \| `release` \| `announcement` |
| `draft` | no | `true` = never rendered, never generated, never in the feed |
| `media` | no | list of `/`-rooted `public/` paths the post embeds — every path's existence is verified at generation; a dead image path is a red build |

The reading time on every card and post header is derived (rendered words / 200) — never authored.

## The media a post needs

The checklist the template carries, by post type:

- **Feature post** — at least one of:
  - a capture of the capability in motion: an existing reel from `public/landing/tui/<feature>/` (embed `<video controls muted playsinline poster="...">` with the mp4 + webm sources — the template has the snippet);
  - 2–4 stills from that scenario's `stills/` directory, each with a one-line caption;
  - a diagram, for architecture posts (new file under `public/blog/<slug>/`).
  New TUI footage goes through the `scripts/tui-capture/` lane — the same rule the landing page's dex holds: never a browser screenshot of a TUI.
- **Release post** — usually no new media: link the GitHub release and the changelog stop, reuse the feature posts' captures inline where they help; a before/after pair only when the release fixes something visual.
- **Announcement post** — the social card is generated automatically (title, date, palette — `opengraph-image.tsx`); body media optional.

Reuse first: prefer existing audited captures under `public/landing/tui/**` over minting new media, and never hotlink — everything the blog loads is self-hosted from `public/`, which the deploy gate asserts.

## Verification

- `node scripts/landing_blog.mjs --check` (CI: `bun run check:blog`) — the data and the feed match the sources.
- `node --test scripts/landing_blog.test.mjs` — the generator's own grammar and validation pins.
- `bun test src` — the blog page suites (index, post, routing, metadata, JSON-LD).
- `bunx playwright test` — `e2e/blog.spec.ts`: the index, the feed, the article SEO surface, the generated PNG social card, the 404.
- `bun scripts/verify-deploy.mjs` — after a push: the live deployment serves `/blog`, `/feed.xml`, the sitemap entries.
