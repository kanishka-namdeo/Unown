---
title: The end-user round: what a red main was hiding
description: Every entry lane, command, service and artifact driven like a real user — and the substring filter, the quoted titles and the fresh-clone trap it caught.
date: 2026-11-10
lastmod: 2026-11-10
tags: [release, ux, ci]
type: feature
media: [/landing/tui/dashboard/stills/01-overview.png]
---

The plan-mode rounds tested plan mode. The memory round tested the
memory engine. This round's directive was the widest sentence yet:
**test all possible usecases and combinations of unown's end user
experience, fix whatever is not up to latest standards.** The matrix:
entry lanes (interactive, print, resume, plan) × management commands ×
services (bridge, engine, landing, six apps) × platform artifacts
(install, update, completions) — grounded in
[a late-2026 standards brief](https://github.com/kanishka-namdeo/Unown/blob/main/docs/end-user-standards-2026-11.md)
that reads Claude Code, Codex CLI, Gemini, opencode, Amp and clig.dev so
the bar is the field's, not our own.

The matrix's first finding was not subtle: **main was red.** Six
consecutive CI runs, the loudest not-performing state a repo can be in.
Three root causes, each a story about honesty.

## The substring filter that let the apps into the test battery

`bun test src` does not mean "the src directory". Bun treats the
argument as a **substring filter on test-file paths** — so the landing
suite's battery quietly collected eighty-six `apps/*/src/**` test files
into the *same process*, where the root bunfig registers one shared
happy-dom document. The evidence was sitting in the CI logs the whole
time: encore's gate-chip count expected 11 and received 12 (a bolero
`<li>` had leaked into the document), `getByRole("heading")`
multi-matched bolero's "Board unavailable" h2s, and something kept
fetching `localhost:3100` — a bolero lane whose server was never
started in that job.

The Rondo round had found this class once before and point-fixed the
one polluter it could see. The class stayed open; every new app
re-armed it. The fix closes the class: `bun test ./src` — the path form,
exactly the 148 landing files, in CI, in `package.json`, and in the
coverage gate script.

## The browser test that ran before the browser existed

Chaconne's plan promised its real-browser smoke would "fail loudly"
when chromium was missing. It did — inside the app's Lane A, the
DOM-free unit gate that runs *before* CI installs any browser. A
plan-contract at war with its own job layout. The smoke now self-skips
unless `CHACONNE_REAL_SMOKE=1` arms it, and CI runs it armed, after
the browser exists — loudness where a browser was promised, green
lanes where none was.

## The page that grew without asking

Three product bands (Chaconne, Fugue, Legato) had landed since the
scroll budget's last amendment, each about a viewport tall. The page
measured 20.4 viewports and 4,582 words against ceilings of 17.5 and
4,170. The contract's order was followed to the letter: compress
first (the two newest bands' ledes, every unique claim kept), then
the fifteenth amendment — 20.5vh / 4,570w, in both twins, with the
receipt in the ledger.

## Forty-three titles wearing their quotes

The blog's frontmatter grammar says titles need no quotes; forty-three
of forty-nine posts wore them anyway, and the parser's plain trim let
the marks ride into **every rendered surface** — the h1, `<title>`,
og:title, JSON-LD, the RSS feed, the index cards — on production. The
parser now strips one matching pair and rejects strays; the sources
are normalized; the feed regenerated. Same round, the `/blog` index
got its og:image back (the layout's openGraph object had replaced the
root's wholesale) and every post's twitter card now mirrors the post's
own title instead of the landing's.

## The fresh clone that said "✓ Unown is up"

The last one is the trap I fell into myself, live: run `bun install`
then `bun run agent:start` and the launcher prints **"✓ Unown is up."**
— with the engine dead in the water, because the root install never
touches the vendored pi workspace and the engine dies on a module
resolution error while the 65-second health wait burns down. The
launcher now fail-fasts a preflight with the exact remediation, and
the success banner is conditional on both services actually answering.
The docs were innocent the whole time — every surface already said
`agent:install` first; the launcher was the one lying.

---

The smaller craft items ride the same commit: `unown models <typo>`
exits 2 with a did-you-mean instead of silently printing the overview;
`unown note --help` prints the note's own page (and every paged command
routes `--help` to its nearest surface); `-p` without a prompt and
`repomap` outside a git repo exit in the class scripts can detect; the
doctor's engine-skew message finally shows the *build hashes* it
compares instead of two identical version strings. The management
surface itself came through the sweep clean — 38 commands, no crash,
no hang, nothing slower than 1.5 seconds, `NO_COLOR` honored.

The receipts, as always:
[the round log](https://github.com/kanishka-namdeo/Unown/blob/main/docs/end-user-combo-round-session.md),
[the standards brief](https://github.com/kanishka-namdeo/Unown/blob/main/docs/end-user-standards-2026-11.md),
and the eight pinning tests in `test/cli/end-user-craft.test.ts`.
