---
title: Unown is in beta — here is what that means
description: The self-improving terminal coding agent is in beta: what works, what moves, and where to report what breaks while the 0.0.x line grows up.
date: 2026-10-25
tags: [meta, beta]
type: announcement
---

The landing page now says it plainly — a **Beta** badge rides the header wordmark and the hero, with one sentence under the subhead: *"expect rough edges and moving formats; report what breaks."* This post is the longhand version of that badge: what "beta" means for Unown specifically, why we label it at all, and what you can hold us to while it lasts.

## What beta means here

Unown is open source, MIT licensed, free, and ungated — there is no waitlist, no seat count, no "contact sales" between you and the binary. So "beta" here is not a scarcity signal; it is an **accuracy** signal, and it makes three specific promises:

1. **The release line is 0.0.x.** Fifteen patch releases shipped in October alone. Patch-order versioning is honest about maturity: the version number itself says "the surface is still settling."
2. **Formats move.** The changelog records format changes under release after release — the note format gained fields, the session export changed shape, memory rendering was re-platformed. Anything you build against Unown's files or output should pin a version and read the changelog before upgrading.
3. **Rough edges are expected and wanted.** The issue tracker is the reporting lane. Every report becomes a session note for the engine's harness on our side — the project's whole mechanism is turning what happened into remembered, verified practice.

## What beta does NOT mean

It does not mean the core is speculative. The parts the landing page argues are the parts with receipts: the four-tier memory stack is files on disk you can `cat`, the consolidation pipeline is measured in committed benchmark receipts, and every quoted engine literal on the landing page is gated against the source that writes it. Beta means **the seams move**, not that the floor is soft.

It also does not mean "preview" in the softened corporate sense. We chose the plain word on purpose: the product is open and ungated, so the accurate label for "shipped, usable, still changing" is beta — not "early access" (there is no gate) and not "preview" (nothing is being previewed; it is running).

## What you can hold us to

While the badge is up:

- **Every release keeps a changelog entry** — the landing page's shipping rail is generated from `CHANGELOG.md`, so a release that skipped its entry fails CI, not just etiquette.
- **Every measured claim keeps its receipt** — benchmark figures without a committed receipt are printed as "not measured", never estimated.
- **Memory stays inspectable** — the terminal agent never opens a database; project memory is a markdown file in your repo, versioned and diffable.

## When the badge comes off

Graduation is not a date on a calendar — it is a state of the seams. The 0.0.x line grows up when the formats that external tools might depend on (the note format, the session export, the print-mode JSON envelope) have each survived a stretch of releases without a breaking change. The changelog will say so when it happens, and this post will get a `lastmod` bump.

Until then: use it, break it, report it. The badge is a contract, and the issue tracker is where it is enforced.
