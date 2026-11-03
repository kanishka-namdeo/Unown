---
title: Coda: the round where unown shipped its first user product
description: The Coda round shipped the repo's first installable app - a local-first markdown notes and task-board PWA built entirely by agent tickets.
date: 2026-11-03
tags: [pwa, local-first, agent-driven, testing]
type: feature
media: [/blog/2026-11-03-the-coda-round/coda-fresh.png, /blog/2026-11-03-the-coda-round/coda-app.png]
---

Coda is the first thing this repo has ever shipped that is a user product instead of a tool: a local-first markdown notes and task-board PWA at `apps/coda/`, installable, offline-first, and written in vanilla TypeScript with zero package dependencies. Everything else in the repo is either the marketing landing page or the terminal agent. Coda is something you open in a browser, and your data never leaves it - notes and tasks live in your browser's IndexedDB, and the "local-first" claim has teeth because markdown round-trips losslessly to `.md` files you can export, rename and carry away. No account, no sync server, no lock-in.

## What v1 actually is

The honest shape of Coda v1, exactly as the design doc drew it:

- one board, three task statuses (todo, doing, done - with the state machine deciding which moves are legal),
- a markdown editor with a preview toggle,
- global search, Fuse-backed, with a substring fallback,
- verification on **Chromium desktop only**. Safari, Android and Firefox are recorded as untested and deferred - we do not call that "cross-platform".

## How a round like this runs

Coda was designed by the plan-mode V3 specialist bench: five review agents consulted live on the plan document - drift cut, gaps mitigated, P0s fixed before a single line of code was written. The implementation then landed entirely through budgeted agent ticket sessions, C1 through C5, each one dispatched headless, each one green on its own gate before the next one started. No operator wrote app code; the tickets carried the receipts.

## The engineering spine

Four load-bearing choices, all in the design doc and all pinned by a gate:

- **a pure-TS domain layer with an import-boundary purity proof** - `src/domain/` imports nothing outside itself, enforced by a boundary test plus a scoped `no-restricted-globals` rule, not grep, which is bypassable;
- **the IndexedDB adapter isolated from the domain** - one database, one store, the whole serialized document; the domain stays DOM-free and unit-tests headlessly;
- **a hand-rolled service worker** precaching all 23 emitted assets, stale-while-revalidate on the cache, offline fallback page, and an installable manifest;
- **an isolated Playwright lane** (`bun run coda:e2e`) that runs axe `wcag2a/2aa/21a/21aa` in light and dark and asserts **zero violations**.

## Receipted, not promised

The figures in this post are the ones with receipts:

- 51 domain tests, green in both lanes (`bun test` from the app directory - DOM-free, the purity enforcement lane - and from the root, the compatibility lane);
- 5/5 in the isolated e2e lane, which includes the offline proof: service worker activated, page set offline, reload, the app boots from cache, and a note created offline **survives the return online**;
- a dedicated `coda` CI job with the lockfile-drift assert: install frozen, then the root `bun.lock` hash must be unchanged - any dependency Coda pulls in reds the job.

The PWA installability and offline-load performance figures are not measured; there is no receipt for them yet, and they stay "not measured" until one lands.

## Try it

`bun run coda:dev` boots Coda at `http://127.0.0.1:4012` through a transpiling static server - no build step, no bundler. The full developer and user story is in [`docs/coda.md`](/docs/coda.md): running it, testing it, the PWA/offline story, and the zero-dep vendoring story.

![Coda on a fresh boot - one empty board, ready](/blog/2026-11-03-the-coda-round/coda-fresh.png)
*Fresh boot: the empty board, search, and the install affordance.*

![One note and one task in Coda, through the real UI](/blog/2026-11-03-the-coda-round/coda-app.png)
*One note and one task, created through the real UI.*
