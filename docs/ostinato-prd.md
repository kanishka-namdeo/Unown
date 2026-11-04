# Ostinato — the DRIVE-track app round's PRD

> **Verdict up front:** Ostinato is a keyboard-first, offline-first
> spaced-repetition flashcard PWA — the DRIVE vehicle of the 2026-11-04 A1
> engagement ("STABILISE A2 × HARDEN A2 × PROVE IT"): a real user product
> whose full SDLC runs through A2 tickets, hardening-first, with every lane
> of [the reliability coverage matrix](reliability-coverage-matrix.md)
> receipted before feature velocity. The app is the vehicle; A2's
> operational quality is the cargo.

One-line purpose: the product requirements + round plan for Ostinato, the
second user product under `apps/` (after [Coda](coda.md)).

- Owner: the A1 operator, authored outside A2 sessions (operator-side docs
  are the operator's lane; A2 exercises them through tickets)
- Status: **OPEN** — round log: [ostinato-round-session.md](ostinato-round-session.md)
- Benchmark lane: [benchmarks/ostinato/](../benchmarks/ostinato/README.md)

**Mini-TOC**

- [Vision](#vision)
- [Users and problem](#users-and-problem)
- [Scope](#scope)
- [Non-goals](#non-goals)
- [Hardening-first requirement](#hardening-first-requirement)
- [Architecture](#architecture)
- [Verification and gates](#verification-and-gates)
- [Deployment](#deployment)
- [Success criteria](#success-criteria)
- [Related pages](#related-pages)

## Vision

Ostinato is a keyboard-first, offline-first spaced-repetition flashcard PWA:
markdown decks, SM-2 review scheduling, and a review runner you can drive
entirely without a mouse — `j`/`k` to browse, `1`–`4` to grade, `/` to
search, `Ctrl+K` for the command palette — with crash-safe mid-review
session resume, JSON import/export, and an installable cross-platform shell.
Every interaction is keyboard-reachable, every state is recoverable, and
nothing is required from the network after first load.

The name names the loop: an ostinato is a persistently repeated musical
figure; cards return on a schedule until they stick. Ostinato deliberately
does not overlap Coda (notes + task-board) or the landing gallery's demo
apps (landing routes, not products) — it is a distinct product with a
distinct job.

## Users and problem

- **The learner** keeps knowledge that decays: language vocabulary,
  APIs, keyboard shortcuts, exam material. Existing tools split into
  heavyweight accounts-and-cloud (Anki and friends) or weightless
  throwaway web quizzes; the middle — a serious, local-first, installable
  trainer that starts in under a second and works on a plane — is thinly
  served.
- **The keyboard-first user** (this repo's own audience: terminal people)
  wants a trainer they never touch the mouse for — the same bar the
  Unown TUI holds itself to.
- **The problem for the programme**: the A1 directive needs an ambitious
  real-world app whose full lifecycle — plan, build, test, harden, ship,
  document — exercises A2 end to end and produces measurable reliability
  evidence. A flashcard trainer has the full UI surface (lists, modals,
  forms, scrolling, persistence, import/export) without invented complexity.

## Scope

**P0 — the round's must-ship (hardening-first order):**

1. Deck + card model (markdown front/back) with invariants enforced in a
   DOM-free domain core.
2. SM-2 review scheduling — deterministic, unit-pinned. `[C]` the SM-2
   spacing family (Wozniak's SuperMemo line) is cited, not re-derived; the
   implementation is ours and pinned by its own tests.
3. Review runner: keyboard-only grading (`1`–`4`), reveal step, queue
   state, interruption-safe.
4. Command palette (`Ctrl+K`), search (`/`), `j`/`k` list navigation,
   visible selection states.
5. Empty, loading and error states for every surface — no blank panels.
6. Atomic persistence + crash-safe review-session resume (a killed
   mid-review session restores its queue and scheduling invariants).
7. JSON import/export (round-trip lossless).
8. PWA: installable, offline-capable, precached boot.
9. Accessibility: axe `wcag2a`/`wcag2aa` clean, visible focus, logical tab
   order, `Esc` closes modals, no color-only cues, reduced-motion honored.

**P1 — after the hardening freeze holds:** stats heatmap, deck-level
review settings, CSV (Anki-style) import, in-app shortcut sheet (`?`).

**P2 — explicitly deferred:** accounts/cloud sync, sharing, sub-decks,
cloze cards, spaced audio.

## Non-goals

No server, no accounts, no multi-user anything, no native shells beyond
the PWA, no dependency-adding framework swap (the zero-dep law below), no
feature that cannot name its verifier.

## Hardening-first requirement

The directive's checklist, mapped to this app (each row gets a pinned test
or an honest `[U]` until it does — tracked in
[the matrix](reliability-coverage-matrix.md)):

| Directive requirement | Ostinato lane |
|---|---|
| keyboard-only workflows | e2e drives create → review → export with keyboard events only; zero pointer events in the spec |
| tab order + focus recovery | focus-order pins; focus returns to the invoking control after every modal/palette close |
| modal open/close + escape handling | `Esc` closes; unsaved-changes guard; no focus trap |
| command palette flows | every command reachable from the palette — pinned by enumeration |
| scrolling + list navigation | long-deck scroll, `j`/`k` wrap, `g`/`G` bounds |
| selection states | selection ring visible; selection survives filtering |
| empty/loading/error states | per-surface honest states; slow-storage loading lane |
| interrupted tasks | SIGKILL mid-review → resume restores queue + invariants |
| resize handling | breakpoint layout tests (wide/narrow) |
| crash recovery + persistence recovery | atomic saves (temp-write + rename), torn-write tolerance, reload consistency |
| cross-session consistency | same data from two sequential boots (byte-stable export) |

## Architecture

- `apps/ostinato/` — a self-contained static PWA, the Coda pattern:
  vanilla TypeScript, **zero runtime dependencies** (no dependency fields
  in the app `package.json`; anything needed is vendored), own dev server
  (`serve.mjs`), own child `AGENTS.md` (operator-landed from A2 drafts per
  the instruction-set gate), DOM-free domain core under `src/domain/`
  (deck/card model, SM-2 scheduler, import/export) with the UI shell over
  it. `[U]` storage choice (IndexedDB vs localStorage-plus-atomic-writes)
  is pinned at the O-2 design gate — not by fiat here.
- Two test lanes, the Coda semantics: Lane A (inside the app dir,
  DOM-free enforcement) + Lane B (root `bun test apps/ostinato`,
  masked-by-design), pairing on the domain-boundary test; isolated
  Playwright e2e with a self-skip guard so the root landing lane is
  untouched.

## Verification and gates

Only external verifiers count (the directive's no-self-grading law; the
repo's own gate culture):

- Per-ticket gate battery: both unit lanes + app `tsc` + the round's
  e2e battery (keyboard-only flow, axe both schemes, offline boot,
  crash-resume) + root gates (`typecheck`, `lint`, `test:unit`,
  `check:docs|changelog|blog|benchmarks|claims`).
- Calibration canaries C1–C3 and the app lanes (K-1 keyboard, A-1 a11y,
  O-1 offline, R-1 crash-resume, I-1 import round-trip) live under
  [benchmarks/ostinato/](../benchmarks/ostinato/README.md) with per-run
  receipts; `null` until a receipt exists — never a guess.
- Cross-platform: the honest receipt is Chromium-desktop (the Coda
  precedent); WebKit/Firefox/mobile are `[U]` until a lane exists for
  them, and the docs say so.

## Deployment

The app ships the way Coda ships: served from this repo (own dev server;
a landing band + committed usage-capture lane land at the round closeout,
the doc-truth T3 precedent), Vercel auto-deploys `main` (deploy-verify
detects). No app-side release machinery. Unown's own version does NOT bump
for app-round commits — the repo's version contract ties `package.json`
to Unown releases; a bump happens when this engagement enhances Unown
itself (then: version + dated heading + rail + tag on the green SHA).

## Success criteria

All of the directive's list, receipted in the round log: the app deployed;
every matrix lane exercised; keyboard workflows validated (zero-mouse e2e
receipt); interaction-quality findings reduced (bug register → fixed →
pinned); genuine failures converted to benchmarks (validation log → lane);
improvements retained (memory/skill promotion receipts); measurable
regression reduction and turns-to-done improvement (canary baselines vs
re-runs); the benchmark suite expanded monotonically; the evidence packet
complete (round log + receipts + this PRD + the matrix + the registry).

## Related pages

- [The round's resumable session log](ostinato-round-session.md)
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The augmentation registry](a1-augmentation-registry.md)
- [Coda](coda.md) — the first user product; the architecture precedent
- [The benchmark suite](../benchmarks/ostinato/README.md)
- [SESSION.md](SESSION.md) — the running checkpoint index
