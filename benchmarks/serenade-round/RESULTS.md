# The Serenade round — RESULTS (the evidence packet)

> Round: 2026-11-07 → 2026-11-08 · vehicle: **Legato** (apps/legato/,
> the §0.9.5 fallback executed) · DRIVE + AUGMENT both live · every
> number below is operator-verified against the tree or a live probe;
> the receipts are the l-files beside this page.

## 1. The deployed application (the DRIVE deliverable)

**Legato — the offline-first read-later / web-clip PWA** at
`apps/legato/`: the `legato.v1` clip grammar, the 7-lane error
taxonomy (charset-unknown · redirect-loop · js-walled · paywalled ·
oversized · empty-text · fetch-failed — honest degradation, never a
silent loss), IndexedDB behind the `StoragePort` seam, the
browser-side Fetcher/Extractor pipeline (the plan's seam ruling: no
Node runner edge), CJK-bigram-hybrid full-text search, the four-state
reading queue with the concurrent-flip guard, tags + filter combos,
highlights with the no-silent-truncation law, byte-stable JSON
import/export (+ Markdown), the SW-offline PWA, the keyboard-first UI
(j/k · / · Ctrl+K · the Ostinato dialog contract).

- **267 unit tests** (Lane A DOM-free enforcer + Lane B), **14 e2e
  specs** (axe light+dark, tab order, Esc focus-return, the flow, THE
  B-16 RE-RUN, the T-7 timeout pin, io round-trip + the refusal,
  offline ×2, queue ×2) — all green.
- The product surface: `docs/legato.md`, the README section, the
  CHANGELOG entry, **6 REAL usage stills + PROVENANCE**
  (pixel-verified 1291–1569 distinct colors each), the landing band
  (`data-hue="leaf"`, position 10), the root `legato:*` scripts, the
  **CI `legato` job — green on its first run**.
- The B-16 holdout: frozen at L-3 (5/5 sha256 verified), **re-run
  GREEN at L-11** (every manifest row its exact lane).

## 2. The turns-to-done series (the honest cost ledger)

| Ticket | L-0 | L-1 | L-2 | L-3 | L-4 | L-5 | L-6 | L-7 | L-8 | L-9 | L-10 | L-11 | L-12 | L-13 | Σ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Turns | 49 | 54 | 57 | 135 | 102 | 145 | 126 | 197 | 141 | 87 | 296 | 501 | 124 | 48 | **1962** |
| Dispatches | 3 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 3 | 2 | 5 | 8 | 3 | 2 | **47** |

(Turns = session-file assistant-message ground truth, not envelope
estimates.) The class-budget signal: L-9 (pure domain, budget 40)
closed at **87 turns / 2 dispatches** — the cheapest since L-2;
L-7 (mixed domain+UI, mis-budgeted at 40) cost 197/4; L-11's 501
carries six genuine-gap fixes. **Every gap found was fixed in-ticket
and re-verified — zero carried debt.**

## 3. The genuine-gap ledger (the §5 reflection, the round's cargo)

| ID | The gap | The layer it was fixed at | Re-verified |
|---|---|---|---|
| G-IDB | The IDB adapter's 3-arg `open()` (no stores created; PLAN App.B risk #2 fired exactly as pre-registered) | the adapter (two-arg + `req.onupgradeneeded`) | e2e 2/2 |
| G-4 | The fixture server shipped without CORS | the server (headers pinned, the chaconne law) | the battery |
| G-5 | `aria-pressed` on `role="listitem"` (axe critical) | the chip role (native button + group) | axe green |
| G-6 | A wall-timeout killed a session MID-WRITE (app.ts syntax-broken) | the tsc-guided repair brief | typecheck 0 |
| G-7 | The browser-redirect opacity (`manual`+CORS = opaque; loop → `empty-text`) | the fetcher (the manual-first walk) | the B-16 row |
| G-8 | Stale stub-contract palette tests (L-5 pins vs L-6..L-9 reality) | the test contract | 267/0 |
| G-9 | The palette keydown had NO Escape branch (unit tested the function, not the lane) | the keydown + the event-driven pin | the Esc spec |
| — | The filterbar trio (state propagation · chip focus-loss · search-first order) | the re-render lane + the DOM order | 267/0 + the specs |

## 4. The battery deltas (before/after, same tree family)

- Root unit: **2654/0/208 files → 2934/0/234 files** (+280 tests, all
  Legato) · typecheck 0 throughout.
- The five check gates (docs/changelog/claims/blog/benchmarks): green
  at every close, green at the round close.
- The landing composition root: 15 → 16 bands, the hue walk intact
  (no two neighbours share) — **the F-10 ripple class did not recur**
  (the composition test updated in the same ticket as the band).

## 5. The learning loop over the round's own workload (the W2 axis)

Live-probed at close: **66 engine runs / 33 dreams / 125 notes (6
pending) / 20 project-memory versions / 0 auto-promoted skills** —
the quarantine held; the three mint candidates
(hostile-fixture-server-setup, hostile-clip e2e authoring,
byte-stable-export golden pinning) are exercised with receipts and
staged for the human `mv`, per the staged-skills law.

## 6. The honest failures + open items

- **The CI red on main** (filed in the round log): predates the
  round's app work; the failing jobs are the fugue-landing/chaconne/
  rail/coverage surfaces; the Legato job is green; local full battery
  green on the same tree — the failures are runner-environment-shaped
  (the `:3100` fixture boot race the likely shared root). Handed to
  the owning lanes.
- The e2e cross-browser lane stays honestly Chromium-only (the P1
  `[U]`, documented in the app DOX + the spec).
- The 12-rule "blog post" item: the CHANGELOG + README + doc + band +
  captures landed; **a dedicated content/blog post for Legato remains
  unwritten** — the blog lane is the standing next step for the round
  after this close.

## 7. What made A2 better/cheaper to drive (the round's answer to the
directive's final question)

1. The claim-race protocol (push the claim before the brief) — adopted
   from the 34th's V-2 record mid-round; zero duplicate dispatches on
   this lane after adoption (one before: the L-3 dual, stood down per
   the ledger-arbiter law).
2. The class-aware first-chunk budget (domain 40 / UI 46) — L-9's
   87-turn close is the receipt.
3. The operator-diagnosed repair brief (the tsc-guided G-6 fix, the
   G-7 browser-reality diagnosis) — root-cause briefs closed in 9–42
   turns what open-ended "fix the failing test" briefs had been
   burning 100+ turns on.
4. The report-only continuation (L-4 chunk 3: 25 turns to close a
   timed-out verification phase).
5. Six genuine product defects found by the e2e lane that the unit
   lane could never see — the PLAN's only-real-IDB-in-e2e risk and
   the unit/e2e coverage-gap class (G-9) are now receipted laws.
