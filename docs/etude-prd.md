# The Tempo PRD (outline — proposed for approval)

> **Status: PROPOSED 2026-11-05** — the A1 directive's APP placeholder
> (`[APP_NAME + ONE-PARAGRAPH VISION + REPO PATH]`) arrived unfilled; this
> outline proposes the vehicle. Nothing below dispatches until the operator
> approves (or substitutes) at the E-0 gate in
> [the round log](etude-round-session.md).

One-line purpose: the PRD outline for **Tempo**, the Etude round's proposed
DRIVE-track application — the production build that doubles as A2's
reliability stress test.

**Mini-TOC**

- [The one-paragraph vision](#the-one-paragraph-vision)
- [Why this app](#why-this-app)
- [Users and jobs](#users-and-jobs)
- [Scope](#scope)
- [Non-goals](#non-goals)
- [Hardening-first mapping](#hardening-first-mapping)
- [Edge cases the PRD names up front](#edge-cases-the-prd-names-up-front)
- [Success criteria](#success-criteria)
- [Approval](#approval)
- [Related pages](#related-pages)

## The one-paragraph vision

**Tempo** (`apps/tempo/`) is a keyboard-first, offline-first time-tracking
and lightweight invoicing PWA for freelancers: start and stop timers per
project with idle detection and midnight rollover, correct or add entries
by hand, see where the week went, and turn unbilled work into a numbered
invoice you can print or export — all without a mouse, without an account,
and without a network, with every transition crash-safe and every export
byte-stable. It is the repo's third user product (after
[Coda](coda.md) and [Ostinato](ostinato.md)), built to the same house
pattern: vanilla TypeScript, zero dependencies, localStorage persistence
with atomic writes, an installable service worker with a static precache
derivation proof, and a full keyboard model verified by an e2e battery.

## Why this app

- **Real-world, not a toy**: money math, timers, and invoices are exactly
  where silent corruption hurts — the domain punishes the defect classes
  (rounding, timezone, crash-mid-write) the engagement exists to hunt.
- **Fills the house gap**: Coda owns notes/tasks, Ostinato owns
  memorization; nothing in `apps/` owns time. The landing gallery's demo
  apps are unshipped proof-of-work; Tempo is a product lane.
- **Exercises every reliability lane**: async timers (state-sync),
  money math (edge cases), invoicing (sequential numbering, void/reissue),
  import/export (byte-stability), offline PWA (recovery), full keyboard
  model (the hardening-first bar).
- **Benchmark-friendly**: every defect class mints a deterministic verifier
  (a timer rollover case, a rounding case, a crash-resume case) — the
  Failure → Benchmark reflex has somewhere to land.

## Users and jobs

- A freelance developer tracking billable hours across 3-8 clients, weekly.
- Jobs: capture time with minimal friction → review/edit the week →
  invoice unbilled work → keep the archive (what was invoiced, when, at
  what rate).

## Scope

**P0 (the shippable core)**:

1. The model: clients → projects → entries (start, stop, note, billable
   flag); rates (hourly per project, default currency, integer-cents
   money math end to end).
2. The timer: start/stop/pause per project; idle detection (a configurable
   prompt after N idle minutes); midnight rollover (an entry spanning
   23:50→00:10 splits at the boundary, both halves queryable); system
   clock via an injected clock (the Ostinato law — testable time).
3. Manual entries: add/edit/delete with validation (no negative durations,
   no overlaps on the same project without an explicit override).
4. The review surface: day/week/month grouping, per-project subtotals,
   unbilled vs billed filtering, keyboard-navigable.
5. Invoicing: draft from unbilled entries (per client), sequential
   per-client numbering with a re-issue path, line items grouped by
   project, totals with per-line and per-invoice rounding rules pinned by
   unit tests, markdown + HTML export, print-to-PDF via the browser.
6. Import/export: canonical-JSON export (byte-stable, the Ostinato
   canonicalization law), CSV export of entries, JSON import with
   validation and a dry-run report.
7. The PWA: offline-complete, installable, precache with a static
   derivation proof (`apps/tempo/scripts/verify-precache.ts`).

**P1 (post-freeze candidates)**: CSV import, per-entry tags, a `?`
shortcut sheet derived from the palette table, invoice templates,
multi-currency.

**P2 (explicitly deferred)**: cloud sync, accounts, team/time-approval
flows, native mobile.

## Non-goals

- No backend, no accounts, no telemetry — local-first, full stop.
- No dependency additions (the zero-dep house law; vendored libs only if a
  P0 need is proven).
- No WebKit/Firefox/mobile claims in P0 — Chromium-desktop is the honest
  scope (the Ostinato precedent); the others stay `[U]` in the matrix.

## Hardening-first mapping

The directive's hardening-first requirement, mapped (the Ostinato PRD
pattern — every lane gets its test before its feature):

| Directive lane | Tempo coverage |
|---|---|
| keyboard-only workflows | the K-1 law: create client → project → run a timer → edit an entry → draft an invoice, zero pointer events, an e2e spec pins it |
| tab order + focus recovery | axe wcag2a/2aa both schemes; the tab-order pin; Esc focus-return on every overlay |
| modal open/close, escape handling | the invoice-draft and entry-edit modals on the create-form's contract (role=dialog, aria-modal, attach-before-focus) |
| command palette flows | the palette (Ctrl+K) with every P0 action reachable from it |
| scrolling, list navigation, selection states | the review surface's grouped lists; arrow/RoR navigation; selection semantics pinned |
| empty states | no clients / no entries / no unbilled work / no invoices — honest panels, never blank |
| loading states | timer ticks and invoice drafting are synchronous-local but the PWA boot and import lanes get their honest intermediate states |
| interrupted tasks, crash recovery, persistence recovery | the Ostinato R-1 law: every-transition persistence, atomic writes (temp-key + commit-swap), corrupt-store recovery to a fresh state, the crash-resume e2e (kill mid-invoice-draft) |
| terminal resize handling | the responsive lane re-run at 3 viewport classes |
| cross-session consistency | the import/export round-trip pin (byte-stable canonical JSON) |

## Edge cases the PRD names up front

DST transitions (spring forward / fall back — a timer running across the
gap), entries spanning midnight, the system clock jumping backwards while
a timer runs, idle detection firing during a long legitimate pause,
currency rounding at line vs invoice level, invoice numbering after a
void, overlapping-entry overrides, importing a store from a future schema
version, an empty invoice draft, a deleted project with live entries, and
the print stylesheet at odd paper sizes. Each becomes a unit pin or an
e2e case in the ticket that ships the feature — named here so no ticket
discovers them late.

## Success criteria

- The app deploys (the landing gallery band + the PWA served from the
  repo's site), the full battery green: Lane A/B unit, tsc, the
  zero-dependency hash, the precache derivation proof, the e2e battery
  (K-1 zero-mouse, A-1 axe both schemes, O-1 offline, R-1 crash-resume,
  resize, the invoice round-trip).
- The engagement's own bars: turns-to-done trending down across the E-
  tickets; every harvested defect converted to a pinned regression; the
  reliability lanes re-receipted at teardown ([the matrix](reliability-coverage-matrix.md)).
- Honest scope stated on the landing surface (Chromium-desktop-only P0).

## Approval

The E-0 gate: approve Tempo as proposed, substitute another vehicle, or
amend scope. Until then, only the harness tickets (A2H-5, A2H-6) dispatch.

## Related pages

- [The Etude round log](etude-round-session.md)
- [The Ostinato PRD](ostinato-prd.md) — the house pattern this follows
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [Coda](coda.md) · [Ostinato](ostinato.md) — the sibling products
