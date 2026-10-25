# Blog components (src/components/blog/)

## Purpose

The blog's shared UI pieces: the header that renders on every blog route, the derived meta row every post surface prints, and the BlogPosting structured-data node. The pages that render these live in `src/app/blog/` (owned by `src/AGENTS.md`); the posts themselves and their grammar live in `content/` (owned by its own AGENTS.md); the generated data these render comes from `scripts/landing_blog.mjs`.

## Ownership

- Owns: every file in `src/components/blog/` (`blog-shell.tsx`, `blog-ui.tsx`) and this doc. The generated `blog-data.ts` in this directory is written by `scripts/landing_blog.mjs` — never hand-edit it.
- Reuses from the landing tree (never duplicated): `BetaBadge`, `GithubMark`, `ThemeToggle` from `landing/shell.tsx` and `Glyph` from `landing/glyph.tsx` — the blog is the same console, not a second design system.

## Local Contracts

- `blog-shell.tsx` owns `BlogNav` — the compact header: the landing wordmark (which is the way home), the beta badge, the `blog` tag, the theme toggle, the GitHub mark and the "Get started" jump to `/#quickstart`. Server component; no section menu (the seven in-page anchors belong to the one-page landing argument, not to an article).
- `blog-ui.tsx` owns: `TypeChip` + `TagChips` (plain text chips — tags are deliberately not links while the post count is single-digit; the decision is in `docs/landing-research.md`), `PostMeta` (the date/reading-time/type row; `shortDate` built by hand like the changelog rail's, because `toLocaleDateString` reads the runtime locale and can disagree between a UTC prerender and a browser hydration), and `BlogPostingJsonLd` (one server-rendered `<script>` node, `<` escaped the way the landing graph does it, no invented fields).
- Reading time, tags, dates and every post fact render off the generated `blog-data.ts` — the components never hardcode a post.
- The blog's typography lives in `src/app/blog/blog.css` (`.prose-unown` — element-scoped under the rendered-markdown wrapper): palette tokens through `var(--color-*)`, square corners, fonts by role, no motion.

## Work Guidance

- New shared blog UI belongs here, not in the page files; the pages stay composition.
- If a post needs a component markdown cannot express, prefer raw HTML in the post (the trust boundary is repo-authored content) over growing this folder.
- The landing contracts that apply verbatim: no `dark:` variants (theming is `data-theme`), no hand-picked hexes, AA contrast in both schemes, no emojis, honesty rules for every claim.

## Verification

- `bun test src` — `src/app/blog/__tests__/blog-pages.test.tsx` renders these components through the real pages (index, post, metadata, JSON-LD, prev/next).
- `bunx playwright test` — `e2e/blog.spec.ts` pins the served surface; `bun scripts/contrast_audit.mjs` and the axe lane cover both schemes on the blog routes.

## Child DOX Index

(none — flat directory)
