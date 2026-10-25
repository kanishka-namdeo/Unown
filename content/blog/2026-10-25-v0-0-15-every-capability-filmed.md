---
title: v0.0.15 — every capability filmed, the atlas passes review
description: The media-completion and sprite-craft round: the dex ships 24 movies on 22 entries with zero pending plates, and the creature atlas passes its review lane.
date: 2026-10-25
lastmod: 2026-10-25
tags: [release]
type: release
media: []
---

v0.0.15 cut on 2026-10-24, carrying two rounds that closed the landing page's last honest gaps: **every capability in the dex is now filmed**, and the creature artwork passed its own machine review. This post is the release-note longhand — the changelog stop and the GitHub release carry the itemized record; this one explains what the two rounds mean.

## The media-completion round

The capability dex had a standing contract: a capability without footage ships with an honest empty stage — a "pending" plate that says so. As of this release, **the dex ships 24 movies on 22 entries, zero stills, zero pending** — every entry carries a real captured reel, and the gates were hardened from "pending plates are stated honestly" to "no plate may ship unfilmed."

The last two plates:

- **№ 010 Parity** (the SDLC checklist) — one real task drives the session through `/context` and the session workflow end to end: `/sessions list` → `/sessions export --md` → the exported file on disk → `/sessions list --all`. The poster is the sessions list itself: the face of the workflow.
- **№ 011 Browser** (the browser subagent) — the moving cut that retires the older PTY stills: the sync delegation row (`task → browser`), the humanized live tool labels riding it, the child's report quoting live confirmation text from a real rendered page, then the async lane — the fleet widget row and the `/tasks` lifecycle registry.

The arithmetic is pinned by tests: `24 = 22 + 2` (twenty-two single-reel entries plus the browser entry's two labelled reels), and three suites fail if a pending plate ever returns.

## The sprite craft round

The creature sprites are authored pixel art produced by a deterministic pipeline — the script is the art. This round the atlas's own VLM review lane returned **FIX** with three concrete craft defects, all repaired in the atlas code and re-gated:

- **memory** (the archive turtle) — the retrieved card floated six rows above the drawer, reading as a detached fleck; it now rides the drawer mid-pull, outline wrapping card and drawer as one shape.
- **mcp** (the socket golem) — the floating head read as a glitch; a centered gold energy column now bridges head to collar, and the chest sockets and treads read as recessed ports and segments rather than buttons and a skirt.
- **lsp** (the bookwyrm) — the touching spectacle rings read as one gold mask; an explicit bridge bar plus temple arms make them read as glasses.

The review lane's verdict is now **PASS** with IP-safety clean, and all eleven sprites re-gated through the pipeline's own integrity checks (edge outlines, orphan clusters, the 5-bit GBA grid, colour budget, dark ratio).

## What else the release verified

Like every release, this one ran the full verification matrix before the tag: the engine suite green across the board, the integration suite and the bridge suite, the release-artifact plan gate, the six per-OS standalone binaries built with the linux-x64 archive extracted and executed locally (`unown --version` → 0.0.15), the landing production build plus standalone smoke, the full e2e walk with the video-decode gate stepping through all 24 movies, and the 3-OS release matrix the tag triggers.

## Where to verify it yourself

- The changelog stop: [`v0.0.15` in CHANGELOG.md](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md) — the itemized record this post summarizes.
- The GitHub release: [v0.0.15](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.15) — the six per-OS binaries, `sha256sums.txt`, SBOM.
- The dex itself: scroll to the capability dex on the [landing page](https://unown-nine.vercel.app/#dex) and click through — every reel there is one of the 24.

Release posts stay media-light on purpose: the feature posts carry the captures, the changelog carries the itemization, and this post is the connective tissue between them.
