# The Tempo PRD (outline — E-0 approved in a dual-incarnation event, then parked)

> **Status: E-0 APPROVED 2026-11-06, then PARKED the same day** — a
> parallel lineage approved Tempo as proposed, amended by the five
> amendments from [the round's market
> research](etude-round-market-research.md) (the platform-scope rewording,
> the storage budget + migration seam, the invoice invariants pinned to
> the legal floor, the shortcut sheet promoted to P0, the portfolio
> metrics — all folded into this PRD below); the same day, the Rondo
> round's §0.9 selection (a fresh scored comparison that treated this
> proposal as ONE candidate, scoring it 1×1×2 — comfort-zone under the
> anti-gaming bar) chose **Chaconne** instead and landed on `main` first —
> the ledger-arbiter law gives that selection precedence. This PRD, the
> amendments and the frozen E-1..E-6 queue stand as the parked round's
> record; Tempo remains a carry-over candidate. The full event chain is
> receipted in [the round log](etude-round-session.md).

One-line purpose: the PRD for **Tempo**, the Etude round's DRIVE-track
application (E-0 approved with amendments in a dual-incarnation event,
then parked) — the production build that doubles as A2's
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
   per-client numbering — strictly monotonic, gapless, no reuse, immutable
   after issue, never user-editable post-issue (amendment 3, the legal
   floor) — with a void-and-reissue path and corrections only via linked
   credit notes; issue date mandatory, optional supply date when different;
   per-line VAT rate, VAT-ID fields for both parties, a reverse-charge
   toggle; line items grouped by project, totals with per-line and
   per-invoice rounding rules pinned by unit tests; markdown + HTML export
   with the issued-invoice snapshot embedded in the canonical-JSON export
   (the 7-year retention rationale); print-to-PDF via the browser; and a
   short jurisdiction checklist doc (EU/UK/US invoice requirements) shipped
   beside the app.
6. Import/export: canonical-JSON export (byte-stable, the Ostinato
   canonicalization law), CSV export of entries, JSON import with
   validation and a dry-run report.
7. The PWA: offline-complete, installable, precache with a static
   derivation proof (`apps/tempo/scripts/verify-precache.ts`); a byte
   budget with headroom under the ~5 MB localStorage cap,
   `QuotaExceededError` handling with user-facing remediation, and the
   IndexedDB migration seam defined up front (amendment 2 — the Coda
   pattern at `apps/coda/src/db/idb.ts`, the storage adapter the proven
   Ostinato atomic-write pattern).
8. The shortcut sheet: a `?`-invoked keyboard reference derived from the
   palette table (promoted from P1 by amendment 4 — keyboard-first is the
   wedge and ships with the core, not after it).

**P1 (post-freeze candidates)**: CSV import, per-entry tags, invoice
templates, multi-currency.

**P2 (explicitly deferred)**: cloud sync, accounts, team/time-approval
flows, native mobile.

## Non-goals

- No backend, no accounts, no telemetry — local-first, full stop.
- No dependency additions (the zero-dep house law; vendored libs only if a
  P0 need is proven).
- No unsupported-browser claims in P0 — v1 is tested and supported on
  Chrome and Edge desktop; Safari (macOS 14+) and Firefox (with extension)
  also install PWAs but are unsupported in v1, stated as a support policy
  and never as a platform claim (amendment 1). No Chromium-only web API
  without feature detection and a graceful path; an explicit
  unsupported-browser screen instead of silent breakage. WebKit, Firefox
  and mobile stay `[U]` in the coverage matrix.

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
- Success is measured as portfolio outcomes, not a SaaS funnel (amendment
  5): installs, 30-day installed-PWA retention, and export usage as the
  no-telemetry real-usage proxy (locally counted); no revenue targets in
  v1.
- The engagement's own bars: turns-to-done trending down across the E-
  tickets; every harvested defect converted to a pinned regression; the
  reliability lanes re-receipted at teardown ([the matrix](reliability-coverage-matrix.md)).
- Honest scope stated on the landing surface (the support-policy wording
  above).

## Approval

**APPROVED at E-0 on 2026-11-06** (a parallel lineage's operator gate):
Tempo as proposed, with the five market-research amendments folded into
this PRD above — the platform-scope rewording, the storage budget +
migration seam, the invoice invariants pinned to the legal floor, the
shortcut sheet promoted to P0, and the portfolio metrics. The market
evidence and the rejected/counter-signal analysis live in
[the research record](etude-round-market-research.md); the vehicle selection
scoring (against the sibling candidates) is the seventeenth lineage's
Phase-0 record in [the round log](etude-round-session.md). The app queue
E-1..E-6 formed at approval. **Superseded the same day**: the Rondo
round's §0.9 selection (Chaconne) landed on `main` first and the Etude
round parked — this section records an approval that was real, receipted,
and then outrun by a fuller selection pass on a parallel lineage; the
queue never dispatched (the V-10 dual-incarnation event, in the round
log).

## Related pages

- [The Etude round log](etude-round-session.md)
- [The Etude round market research](etude-round-market-research.md) — the
  E-0 evidence base
- [The Ostinato PRD](ostinato-prd.md) — the house pattern this follows
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [Coda](coda.md) · [Ostinato](ostinato.md) — the sibling products
