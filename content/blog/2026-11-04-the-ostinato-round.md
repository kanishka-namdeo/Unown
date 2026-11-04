---
title: Ostinato: the round where the hardening came first
description: The repo's second user product - a keyboard-first, offline-first spaced-repetition PWA shipped under a harden-first programme, with receipts.
date: 2026-11-04
tags: [pwa, keyboard, hardening, agent-driven]
type: feature
media: [/landing/ostinato/01-fresh-boot.png, /landing/ostinato/02-palette.png, /landing/ostinato/03-review.png, /landing/ostinato/04-revealed.png]
---

Ostinato is the second user product this repo has ever shipped, after Coda: a keyboard-first, offline-first spaced-repetition flashcard PWA at `apps/ostinato/` — markdown decks, SM-2 scheduling, a 17-command palette, crash-safe mid-review resume, and zero package dependencies. But the round that built it is the more interesting story. It ran the A1 engagement's harden-and-prove programme: **hardening first, before feature velocity** — the reliability lanes were exercised, and their defects harvested, before the app was allowed to grow.

## What v1 actually is

- **markdown decks** — cards are front/back markdown, rendered in-app, round-tripping losslessly through byte-stable JSON import and export;
- **SM-2 scheduling** — the Wozniak 1990 algorithm, pinned as the oracle by test receipts and cited, not re-derived;
- **the keyboard surface** — j/k navigation, 1-4 grading, `/` search, Ctrl+K for the 17-command palette, all exercised with zero pointer events;
- **crash-safe resume** — every transition persists to localStorage with atomic writes, so a reload mid-review restores the exact phase;
- **honest scope** — verification is Chromium-desktop only. Firefox, Safari and mobile are untested and recorded as deferred.

## How a round like this runs

The round was planned against a PRD and an eleven-lane reliability matrix, then executed through budgeted agent tickets O-1 through O-6, each green on its own gate before the next started. Before any app code was written, three calibration canaries (C1-C3) ran to baseline the operator lane. The live-execution diagnosis lanes then did the heavy lifting: four rounds of the e2e battery against the real app harvested **nine defects the unit lanes could not see** (B-3 through B-11 — the receipted-but-unwired persist rule, overlays that painted only on the review path, aria attributes dropped on the floor, a stale done session restored over fresh imports, a synchronous blob revoke that killed its own download, a nameless listbox, dimmed contrast, focus destruction by full rerenders, and a grid min-width overflow). Each was root-caused with live probes and fixed with byte-exact briefs. No operator wrote app code; the tickets carried the receipts.

## The hardening receipts

The figures in this post are the ones with receipts, from the closeout re-run (`benchmarks/ostinato/receipts/run-20261104T181704Z/`):

- **the e2e battery — 12 specs across five lanes, 12/12, 8.5 s first run / 7.2 s re-run**, headless Chromium, verified by an external Playwright suite rather than the app's own tests: keyboard-only flow with byte-verified export/import, axe `wcag2a/wcag2aa` in light and dark with zero violations, offline boot from the service worker with the loop completing offline, crash-resume and 375/1280 resize discipline;
- **the precache derivation proof — 18 URLs, 0 missing, PASS**, the three-way disk ladder that no hand-maintained cache list can offer.

The unit lanes ran 93/0 in both their DOM-free and compatibility forms; the app's package.json carries no dependency fields at all, and the dedicated CI job asserts that stays true on every build.

## The engineering spine

Four load-bearing choices, each pinned by a gate:

- **a DOM-free domain core with a boundary-test pair** — `src/domain/` imports nothing outside itself, enforced by a boundary test plus a scoped no-DOM-globals rule, not grep, which is bypassable;
- **every-transition persistence** — the crash-resume claim is true by construction, because every render path rewrites both storage lanes; the one wire that was missing (B-3) is exactly what the crash-resume lane exists to catch;
- **atomic localStorage writes** — write the temp key, then commit-swap, so a crash mid-write never leaves a torn document;
- **the audited capture lane** — the stills on this page and the landing band came from `apps/ostinato/scripts/capture-usage.mjs`, a keyboard-only Playwright lane whose PROVENANCE.md is the receipt for every frame.

The landing page carries the identity pair — the palette and the revealed markdown back — while the four stills below ride here.

![Ostinato on a fresh boot - no decks yet](/landing/ostinato/01-fresh-boot.png)
*Fresh boot: the honest empty state, "No decks yet."*

![The command palette, opened with Ctrl+K](/landing/ostinato/02-palette.png)
*The 17-command palette — the keyboard-first identity shot.*

![The review screen - card front and progress](/landing/ostinato/03-review.png)
*Review: the deck's card front with progress, "1 of 1."*

![The back face revealed, ungraded](/landing/ostinato/04-revealed.png)
*The back revealed with Space — the markdown bold rendered, left ungraded on purpose.*

## Try it

`bun run ostinato:dev` boots Ostinato at `http://127.0.0.1:4013` through a transpiling static server — no build step, no bundler. The full developer and user story is in [`docs/ostinato.md`](/docs/ostinato.md): running it, testing it, the keyboard-first story, and the PWA/offline story.
