# The doc-truth round — session log

- **Round**: doc-truth (the A1 maintenance track: every documented claim true, every honest null either measured or still honestly null)
- **Started**: 2026-11-03 (opened from `docs/SESSION.md`'s queue, claimed before any dispatch)
- **Status**: OPEN
- **Mission**: the Coda round's graduation carried three honest gaps forward, and the A2 ground truth's §7.4 carries eight doc-drift flags. This round closes ALL of them **through A2 tickets** (the operator writes no content code): (T1) the L1 doc-drift sweep — every drifted count re-derived from its live source and corrected, with the drift-pinned-where-authored question answered per the repo's own patterns; (T2) the PWA installability/offline-load benchmark — the PT-5 plan's honest "not measured" flipped by a REAL measurement under `benchmarks/`, wired to the repo's drift-gate conventions; (T3) the Coda landing usage capture — browser-lane stills through the real UI (the blog capture is the operator-side precedent; this round productizes the lane in-repo) plus the landing's honest Coda presence; (T4) the instruction-surface PR-lane candidate — the Coda retrospective's improvement, evaluated as a decision doc (the write gate stays FINAL; no implementation without an explicit operator decision); (T5) the round closeout per the standing orders.
- **Operator decisions (2026-11-03)**: round scope = T1–T5 above, nothing else (the release-monitor routine's first weekly run is 2026-11-08 and stays the engine's own lane; the hint-digest ranking refinement and the S2 ledger stay queued); push lane = direct to `main` after the full gate set; A2 rides the budgeted-chunk headless protocol (inherited, binding); T4 is EVALUATION-ONLY — the instruction-set write gate is a trust boundary, and weakening it is an operator decision that this round may only PROPOSE.

## The A2 ticket protocol on this host (inherited from the Coda round — binding)

1. **Budgeted chunks + resume chains**: every ticket session runs as
   `unown -p "<ticket>" --permission-mode acceptEdits --max-turns 8` (first
   chunk) then `unown --resume <session-id> -p "Continue (chunk N): …"
   --permission-mode acceptEdits --max-turns 8` until the final summary lands.
   Receipts are written incrementally by the session
   (`.unown/receipts/<ticket>.md`) so nothing is lost at a chunk kill.
2. **No `task`-tool exploration between chunks** — subagents die with their
   parent chunk. Specialist spawns are fine when they complete WITHIN a chunk.
3. **Compile before stopping a chunk** — a chunk that touched code never stops
   before typecheck passes on the touched surface.
4. **No commits by A2** — the tree stays dirty; the operator reviews, gates,
   commits, pushes.
5. The stack (bridge :3031 + engine :3030) is mortal across sandbox recycles:
   `bun run agent:start` first on any resumed session.
6. **Receipts mirror outside the repo immediately**: the operator appends each
   chunk's receipt tail to `~/my-project/tickets/receipt-mirror.md` as chunks
   land. The receipts inside `.unown/receipts/` are mortal to clone loss AND
   `unown-home` loss.
7. **Authoring-class tickets pre-split at ~2 expected chunks** (the C6
   learning: 4 of 7 chunks capped mid-work) — the EFFORT_BUDGET header carries
   the split.

## Ticket queue (in delivery-manager sequence)

1. **T1 — L1 doc-drift sweep (the §7.4 flags)** ✅ (2026-11-03, `e894ccf2`): re-derive and correct every
   drifted count: `docs/usage.md` (slash-commands "thirty-four" vs 48 observed;
   session tools "seventeen" vs 21+3 plan tools), `docs/skills.md` (7 project
   skills vs 13 observed in `.unown/skills/`), `docs/subagents.md` (built-ins
   table 12 rows with a duplicate `browser` row vs `subagent-builtins.ts`;
   project agents "four" vs 6 observed), the dashboard screens count (12 vs
   `dashboard-app.ts`'s 15 — wherever the count is documented). Every number is
   RE-DERIVED at fix time from its live source (the flags were observed
   2026-11-02 and may have drifted further); the receipt carries
   source:line evidence per corrected figure. The drift-pin question (hand-
   corrected + a pinning test per the `built-improved` authored-data pattern,
   vs generated data per the landing's `landing_benchmarks.mjs` pattern) is
   answered per surface in the ticket, honestly minimal.
2. **T2 — the PWA installability/offline-load benchmark (flip the honest null)** ✅ (2026-11-03, `fa31cdf3`):
   the PT-5 plan's own contract (step "benchmark: when real, receipt a PWA
   installable/offline-load measurement under `benchmarks/` wired to
   `check:benchmarks`; otherwise the figure stays 'not measured'"). Build the
   real measurement lane: serve the REAL app (`apps/coda/scripts/serve.mjs`),
   measure (a) installability — manifest fetch + required fields + icons + SW
   controller + display mode, the criteria the e2e lane asserts, now as
   recorded data; (b) offline-load — the offline reload boot-from-cache timing,
   multiple runs, median reported. The receipt lands under `benchmarks/` in the
   repo's receipt format; every "not measured" PWA figure anywhere it is
   printed flips to the receipted number (grep first, cite where); the
   drift-gate wiring follows the repo's conventions (a surface that cites the
   figure gets a pin; `check:benchmarks` stays green).
3. **T3 — the Coda landing usage capture (browser lane)** 🔲: productize the
   capture lane in-repo (the operator's blog-capture script is the precedent:
   serve the real app, drive the same interactions the e2e spec drives, 2× DPI
   stills through the real UI) and land the Coda presence on the landing page.
   The surface choice must be HONEST: the live-demo gallery's apps are landing
   routes; Coda is an app at `apps/coda/` — the ticket consults the repo's
   landing conventions + website-excellence skills and names its band choice
   with the reason. Real media only, never delete existing media; honest copy
   (Chromium-desktop-only verification, local-first/offline-first per
   `docs/coda.md`); authored data drift-pinned where any figure is cited; the
   landing e2e battery green; the deploy-in-parallel exposure (§7.5) means the
   FULL gate set before push.
4. **T4 — the instruction-surface PR-lane candidate (decision doc)** 🔲:
   evaluate the Coda retrospective's improvement: the instruction-set write
   gate (final by design — `guard.ts`, `docs/permissions.md`) forces
   draft-and-operator-land for instruction files, so agent sessions cannot
   propose AGENTS.md edits as reviewable PRs. Deliverable: a decision/design
   doc under `docs/` (the repo's research-doc pattern) covering the current
   gate mechanics (source-verified), the composition candidates (git
   branch/worktree + `gh` CLI + where drafts may land today), the threat model
   (a PR lane must NOT weaken the gate — propose-review-MERGE keeps the human
   as the merger; the gate's FINAL law is the invariant), effort estimate, and
   an honest GO/NO-GO recommendation. NO implementation this round.
5. **T5 — round closeout** 🔲: this log's graduation (Status + queue), the
   SESSION.md ACTIVE ROUND rotation (carry-overs prepended to the next
   round's queue), the capability-utilization report (the A1 directive §7
   frame), the `A2_GROUND_TRUTH.md` refresh (the §7.4 flags retired with
   receipts; new lanes classed per the capability-attribution rule), the
   CHANGELOG entries (T2/T3 content lands under `## [Unreleased]` with the
   rail regenerated in the same commit), and the round's blog post (standing
   orders: every meaningful round gets one; this round receipts three surfaces
   and flips a documented null — it clears the bar).

Each ticket carries the A1 economy header (ALLOWED_INPUTS / FORBIDDEN_INPUTS /
OUTPUT_ARTIFACT / VERIFICATION_EXPECTATION / EFFORT_BUDGET with the pre-split /
chunk protocol notes) — the shape that worked since the fresh-clone round.

## Checkpoint log

- **2026-11-03 (T2 COMPLETE — the PWA benchmark, 6 chunks, session chain
  `01a1a009…`)**: the PT-5 plan's honest null is measured. The lane
  `benchmarks/coda-pwa/` (`run-pwa-bench.mjs` — 304 lines, zero model
  traffic, boots the app's own dev server on a scratch port, drives
  headless chromium): **installability PASS** (manifest 200, all 4
  required fields, 3/3 icons fetched, SW controller active via
  `waitForFunction`, display=standalone, the `beforeinstallprompt` probe
  record-only per the plan's P1 pitfall) and **offline boot-from-cache
  91 ms median vs online 175 ms median (N=5)** — the 84 ms delta
  (~48% faster) is the precache's measured effect, the honest framing the
  receipt caveats carry (headless chromium in the operator's container,
  dev-server transpile — the DELTA is the signal, absolute ms are the
  environment's). Flips: `docs/coda.md` §PWA/offline story (the measured
  paragraph + lane links), `benchmarks/RESULTS.md` master index, CHANGELOG
  `## [Unreleased]` + rail regen (54 stops, 520 entries). NOT flipped (the
  historical artifacts — the PT-5 plan, past round logs, the blog — keep
  their honest-null phrasing as the pre-measure record; T5 retires them
  against the receipt). NO landing figure (the six-track feed contract
  stands — no TRACKS entry; `check:benchmarks` green by not needing a
  change, not by a flip). **The one guard event of the round**: the
  instruction-set write gate REFUSED the in-session `benchmarks/AGENTS.md`
  ownership-list edit — the T4 subject observed in vivo; the edit landed
  operator-side from the receipt's draft-and-land record. Operator gates:
  the lane re-run green on demand (operator receipt
  `run-2026-11-03T06-21-18-517Z`, 194/101 ms medians N=3 — host noise,
  both PASS), check:benchmarks/changelog/docs/claims all rc=0. The
  receipt-first law engaged from chunk 2 (the T1 lesson held); chunks
  5–6 capped on status-block bookkeeping, not work — 6 chunks vs the ~4
  pre-split: measurement tickets carry a +2 chunk overhead for
  run-fix-rerun loops.
- **2026-11-03 (T1 COMPLETE — the L1 doc-drift sweep, 8 chunks in one session
  chain `01a19ffd…`)**: every §7.4 flag closed with TODAY re-derivations
  (source:line in the receipt, mirrored operator-side): usage.md
  "thirty-four"→**forty-seven** commands (the registry grep, 47 = the doc's
  own table), split "eleven"→**twelve**, session tools "seventeen"→**twenty**
  (20 unown registrations excluding the 3 plan-mode-conditional tools — the
  audit's "21+3" reconciled), dashboard "12"→**15 screens** in FOUR docs
  (usage.md ×2, quickstart.md, unown-ux-principles.md;
  `SCREEN_SPECS`@dashboard-app.ts:55-71), skills.md "six website skills"→
  **thirteen project skills** (all 13 named: 6 programme +
  hostile-page-checkout + 6 round-minted), subagents.md duplicate `browser`
  row removed + the **20-builtin breakdown** footnote (2 core@tools.ts:370 +
  1 background@subagent-routing.ts:511 + 9 role + 8 planning@subagent-builtins)
  + project agents "four"→**six** (delegation-auditor, benchmark-curator
  named). **Four receipt-only pin decisions** (no pin tests): every surface
  is legitimately-growing registered content — a count assertion would
  false-positive on each future add; the receipt records the derivation path
  instead. Operator gates: check:docs green on ALL docs, claims 62/62,
  spot-checks reconciled (61 raw registerCommand matches = 47 after
  test/split/pi exclusions; 17 `name:` lines + 2 core + 1 background = 20).
  Deviations receipted: the incremental-receipts law took three chunks to
  engage (chunks 1–2 produced no receipt; fixed from chunk 3); chunks 4–5
  stalled on one-name-per-call enumeration (the metered-tier budget can't
  afford it — the chunk-6 script-first directive unlocked the work); one
  bash call tripped the injection shield on a grep pattern (recovered). The
  8-chunk, 64-turn total is the EFFORT_BUDGET lesson: registry-derivation
  tickets pre-split at ~4 chunks, not ~2.
- **2026-11-03 (ROUND OPENED — the claim, before any dispatch)**: the ledger
  is the arbiter: fetch immediately before this entry showed `main` at
  `16c7bf42` (the Coda round's graduation commit, CI green), no other lineage
  in flight. Stack verified live this session: bridge :3031 upstream 200,
  engine :3030 UP (v0.0.55, dream-check churn observed mid-session), and the
  first `unown -p` probe of the session rode a >120 s stall against the busy
  engine window (metered-queue class, NOT the #30 exit-hang signature — no
  answer was flushed) — the armed watcher then ran 4/4 clean in 2.4–3.4 s
  (`/tmp/issue30/resume-probe/summary.json`, another idle-lane non-repro
  datum for §7.1). Scope fixed by the operator decisions above; T4's
  evaluation-only law recorded. Dispatch order T1 → T5, one ticket at a time
  (metered tier: batching over parallel).
