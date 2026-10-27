---
title: "The builder round: one prompt, a whole app, filmed end to end"
description: "One prompt into an empty directory; 47 tool calls later a full-stack app with a green 39-test suite and a live-verified API. The whole build, on film."
date: 2026-10-27
lastmod: 2026-10-27
tags: [landing, media]
type: feature
media: [/landing/tui/build-session/build-session.mp4, /landing/tui/build-session/build-session.webm, /landing/tui/build-session/stills/04-writing-the-app.png, /landing/tui/build-session/stills/05-tests-running.png, /landing/tui/build-session/stills/06-verifying-the-server.png, /landing/tui/build-session/stills/07-app-built.png]
---

Every lane in the capture catalog compresses a story into seconds — a bugfix, a
rename, a wiki. The lane nobody had filmed was the whole point of the product:
**give the agent one prompt in an empty project and let it build the entire
app.** The builder round filmed exactly that, start to finish, and the cut is
now the landing page's capability dex № 023 — "The builder round."

<video controls muted playsinline width="880"
       poster="/landing/tui/build-session/stills/04-writing-the-app.png">
  <source src="/landing/tui/build-session/build-session.mp4" type="video/mp4"/>
  <source src="/landing/tui/build-session/build-session.webm" type="video/webm"/>
</video>

## The fixture

The world the camera boots into is an empty directory holding exactly one
file: `PRODUCT-BRIEF.md`. The brief describes **Glyph Quests** — a small
full-stack quest tracker with an architecture contract, not a TODO list:

- a JSON file store with validation, seeding, atomic persist and corrupt-file
  recovery (`store.ts`);
- a REST API layer over it (`api.ts`) and a Bun HTTP server (`server.ts`) on a
  fixed port;
- a dependency-free vanilla frontend (`public/index.html`, `styles.css`,
  `app.js`) that must also work standalone — opened from disk, with no server,
  on localStorage;
- a test suite (`quest.test.ts`) covering store CRUD, validation, atomic
  persist, reload and end-to-end API tests over a real `Bun.serve` on an
  ephemeral port;
- and a mission section: run the tests until they all pass, verify every
  endpoint with curl, fix what is broken, and end with a one-paragraph summary.

The only keystroke a human sends is the mission prompt itself. Everything
after it — every read, write, edit, test run, server boot and curl — is the
agent's own work, at 30 characters per second, the speed a person types.

## The session

The filmed run (against the live stack: bridge + engine, `agnes-3.0-flash`
through the Agnes AI upstream) is a 12-minute session the receipt records
event by event: 97 events, **47 tool calls**, 13:16:11 to 13:28:12. The agent
read the brief, planned **four todos** — backend, frontend, tests, verify —
and then worked the list:

- wrote `store.ts`, `api.ts`, `server.ts` and the three frontend files, plus
  `README.md` and a `.gitignore` that keeps `data/` out of git — **eleven
  files** by the closing inventory, `+2211 −47` lines on the session footer;
- wrote `quest.test.ts` (39 tests) and ran the suite — green on the first
  completed run, then **kept hardening it**: cleaned a stale field and an
  unused import out of `store.ts`, rewrote the `server.ts` fetch handler to
  pass the raw body string into the API layer so JSON validation errors
  surface as 400s, converted flaky `it.each` blocks to plain `it` blocks, and
  made the `updatedAt` assertion millisecond-safe — each fix followed by
  another suite run, five and then seven times in a row to prove stability;
- booted the server on :8787 with a clean data dir and ran the **live curl
  round-trip**: seeded list, stats, a 201 create → PATCH → delete round-trip
  with the id confirmed gone afterward, a 404 on an unknown id, a 400 on a
  validation error, and the statics (`/`, `styles.css`, `app.js`) checked for
  content-type — unknown paths falling back to the index;
- then killed the server and **verified the kill** — a two-second curl probe
  for "STILL UP" before calling it dead — and closed with the one-paragraph
  summary the brief asks for, all four todos checked.

![The suite's first green run, mid-fix-iteration — the todo panel still shows test work in progress](/landing/tui/build-session/stills/05-tests-running.png)

![The verification beat: the curl round-trip script and its 404/400 JSON answers on screen, the fourth todo in progress](/landing/tui/build-session/stills/06-verifying-the-server.png)

![The closing summary — 39 tests green, five endpoints verified live, 4/4 todos](/landing/tui/build-session/stills/07-app-built.png)

An earlier session the same morning (run 3 of the round) built the same brief
with a different plan — eight todos, 68 tool calls — and also finished green
with the same curl verification. Two independent sessions, two different
plans, one outcome; the shipped cut is the second one.

## What the camera saw — and what it took to film it

The lane is honest, and so is this section: filming a 12-minute build tested
the capture harness harder than anything before it. The four cuts it took are
now lessons in the workflow contract (`docs/tui-capture-workflow.md`):

- **Cut one** anchored stills on bare filenames and fired on the model's
  *plan text* minutes before any work happened. **Cut two** anchored on the
  todo panel header and died — the header scrolls off the 36-row fold while
  the panel's rows stay. **Cut three** made every wait soft (a miss logs and
  captures the pane as-is — a long real session is worth more than a perfect
  anchor) but its green-suite anchor excluded `" fail"`… and **cut four**
  shipped that exclude: bun renders a ` 0 fail` row on a *green* piped run,
  so the wait excluded its own match for ten full minutes. The stills for
  "verifying the server" and "app built" came out byte-identical — both the
  same idle summary, captured twice after the session had already ended.
- The fix for the shipped cut was not an image edit: still 06 was **re-curated
  from the frame record** — frame 568 of 1514, timestamped mid-round-trip by
  the session receipt and verified by the vision lane (the curl script, its
  404/400 answers, the live spinner, the todo panel). The substitution and
  its evidence are documented in the capture root's `CURATION.md`; the
  superseded still is preserved, not deleted.
- The assembler learned the same lesson: the frames *after* the session ends
  are harness time, not story, and the video now trims that trailing idle to
  one final dwell (rule 2b in `assemble.py`). The shipped cut is 651 frames
  at 8fps — **81 seconds** paced from 1514 captured frames.
- And the launch itself: this sandbox reaps the launching shell's process
  tree, which killed two silent `nohup`/`setsid` attempts eight seconds in.
  The round's driver runs detached inside tmux, which survives.

Every shipped still passed the three-layer audit (pane truth, pixel
verification, vision check) and the video passed frame-sampled vision audit
5/5 — the same gates as every other lane; the curated still carries its
receipt-timeline evidence alongside.

## What ships

- **The lane**: `public/landing/tui/build-session/` — seven audited stills
  plus the mp4/webm pair, catalogued in the tui README.
- **The dex entry**: capability № 023, "The builder round," on the landing
  page — the reel plays the whole build, muted, from the writing-app poster.
- **The harness fixes**: the fifth-cut anchors (the green wait anchors on the
  green-unique ` 0 fail` row with no exclude; the verify wait reads the
  session receipt — the agent's own record — instead of screen text), the
  assembler's trailing-idle rule, and the workflow contract's new failure
  playbook rows. The next builder round films on the first cut that matters.

## Receipts

- The lane and its audits: `public/landing/tui/build-session/` +
  `public/landing/tui/README.md` (capture workflow:
  `docs/tui-capture-workflow.md`).
- The scenario spec (fifth cut): `scripts/tui-capture/scenarios/index.js`.
- The session receipt: 97 events, 47 tool calls — the curation note quotes
  the timeline (`CURATION.md` in the capture root, outside the repo).
- The changelog: the round ships in the 0.0.33 release entry (folded with the live-preview round).

## What ships next

The catalog's next lane candidates are the ones the dex still marks pending —
each gets the same treatment: one real session, one honest cut.
