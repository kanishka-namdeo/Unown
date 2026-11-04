# Unown — Session Log (running index)

The repo keeps one session log per engineering round (`docs/*-session.md`).
This file is the **resumable checkpoint index** for in-flight work: each entry
records the mission state so any session can be resumed later without
archaeology. When a round completes, its log graduates to a round-specific
`docs/<round>-session.md` and this index keeps only the pointer.

---

## ACTIVE ROUND — the Ostinato round (2026-11-04, opened by the eighth lineage)

The DRIVE-track app round of the new A1 engagement (STABILISE × HARDEN ×
PROVE, opened 2026-11-04): **Ostinato** — a keyboard-first, offline-first
spaced-repetition flashcard PWA at `apps/ostinato/` (the Coda pattern),
planned by `docs/ostinato-prd.md`, gated by the eleven-lane
`docs/reliability-coverage-matrix.md`, measured by `benchmarks/ostinato/`
(the C1–C3 calibration canaries armed, honest nulls), augmented only
through `docs/a1-augmentation-registry.md` (opened empty per Phase 0).
The round log `docs/ostinato-round-session.md` owns the mission, the
validation log, the ticket queue (O-1..O-6) and the resume state. Push
lane direct to `main`; hardening-first; Unown's version bumps only on
Unown changes (app-round commits ride `## [Unreleased]`).

Progress: **O-1 LANDED** (`03541d34` — the skeleton + the C1–C3
calibration baselines + the B-1/B-2 bug-register harvest; CI success)
and **O-2 LANDED** (2026-11-04 — the domain core: the Wozniak SM-2
scheduler, the deck/card model, byte-stable import/export, the storage
[U] gate decided localStorage + atomic-writes; 27/27 both lanes, unit
family 2152/0; V-12/V-13/V-14 receipted; receipt tree-verified 10/10).
**A2H-1 LANDED (v0.0.56)** — B-1 fixed: showStatus dedup keyed on
identical text; BEFORE 2/3 defect → AFTER 3/3 both lines persist;
footer 9/9 · picker PASS · resume-hint ALL HELD (zero regressions);
the registry's FIRST PROMOTED row (H-6); V-15/V-16/V-17 receipted.
**A2H-2 LANDED** — B-2/V-9's harness half: `_send_drained`
pump-while-typing on send/key/type_prompt; the product-side
investigation receipted input preservation HOLDING on v0.0.56 across
the volume ladder (the law is condition-dependent; the fix is
determinism insurance); standing lanes green on the fixed harness;
the registry's SECOND PROMOTED row (H-4).
Next in the queue: O-3 (the review runner + keyboard surface).

The spend-and-memory-health round (2026-11-04) is COMPLETE and graduated to
its own log: `docs/spend-and-memory-health-round-session.md` — the
settings-evolution lineage's S2-ledger head, both pinned BM-3 search misses
flipped to **12/12, 100%** (receipted): **S2-11** the automation spend
meter + ceilings (the governor's ledger covers engine learning jobs only —
routine spend is now metered per-routine + globally over rolling 24h/7d
windows through `GET /api/automations/spend`, `unown routines spend`, and
the hub's Automation spend meter card; boundable via per-routine
`--spend-cap` + the global `PI_AUTOMATION_MAX_TOKENS_DAY`, both default OFF
by the governor-asymmetry ruling; enforcement graduated with recorded
`spend_ceiling` skips, never a lifecycle change; manual run-now bypasses
but counts) and **S2-4** the memory health card (the fail-open reconcile
pass gained a durable failure record that survives restarts; duplicate
count over normalized text, conflict count over supersede links; warnings
reconcile-failing/tier-at-cap/reconcile-stale; `GET /api/memory/health` +
the hub card). 31 new pins (10 + 21); full package 5454/0/105-skip;
package tsc parity 77=77 both tickets; root tsc 0 / lint 0-142 / unit
2125/0 / check:* all ok at the close (the rail regenerated at 54 stops/525
entries + the blog at 45 posts/112 tags in the same commit). The round's
A2 lane: 16 budgeted chunks across two sessions, with the operator's
completions receipted in each ticket's DECISIONS — including the at-cap
tick-loop deadlock the gate test caught (fixed with the `held` exclusion
set) and the schema layer the chunk-3 receipt had overclaimed (tsc cannot
see SQL strings; the tests exposed it). The round also receipted the
programme's first DUAL-INCARNATION event of this shape: a seventh parallel
lineage brought itself up mid-round (`a380ff19`) and both claimed SM-1 per
the ledger law — the sixth landed first (`061384bb`), the rebase was clean,
and the seventh's in-flight dispatch reconciles on its next fetch. The
S2-11 and S2-4 rows are CLOSED; the release-monitor routine's first weekly
run (2026-11-08) and everything else below still stands.

The hints-ranking round (2026-11-03) is COMPLETE and graduated to its own
log: `docs/hints-ranking-round-session.md` — the browser-autonomy
lineage's polish lane, taken from this queue's own carry-over: the #45
tool-time browser-memory hint digest became **category-balanced** (the
render is newest-first and a mid-round dream's burst of same-class facts
pushed the oldest load-bearing entry — the stress-checkout dialog lesson
— below the 8-entry cap; the selection is now round-robin across the new
ordered `BROWSER_HINT_CLASSES` classifier, file order within a class,
exhausted classes drop out — the lexical cousin of MMR's diversity
constraint, grounded by the round's research receipt: hermes-agent #677's
composite scoring, MMR (Carbonell & Goldstein 1998), PrecisionMemBench).
HR-1 (the implementation, via A2 in 4 budgeted chunks on a fresh session)
shipped: the classifier + round-robin `collectHints` shared by both
digests, 6 new pins in the browser suite (59/0; baseline 53/0), the
`.env.example` `UNOWN_BROWSER_HINTS` doc (the recon drift-finding — the
every-env-var-documented contract), and `docs/browser.md`'s
Category-balanced property bullet. HR-2 (the closeout) landed the
CHANGELOG Agent Behavior entry (`## [Unreleased]` — the first v0.0.56
content) + the rail regenerated in the same commit (54 stops/523
entries), the README round-table row, the round's blog post (the 44th —
44 posts/109 tags), the `A2_GROUND_TRUTH.md` drift-log entry, and this
rotation. Full gate set green at the close: root tsc 0, lint 0/142
baseline, unit 2125/0, check:docs|changelog|blog|benchmarks|claims ok
(claims 62/62), pi-repo self-learning tsc 651=651 pristine parity (zero
new errors). The round also receipted the programme's FIFTH
fresh-lineage bring-up: a full sandbox recycle ate the tree MID-TICKET
(the first dispatch's chunk 4); nothing on `main` was lost because the
round-opening commit (claim, design, research receipt) was pushed before
dispatch — the recovery was a re-dispatch with all learnings baked in,
not a re-plan. The queue's hint-digest ranking item is CLOSED (this
round); the release-monitor routine's first weekly run (2026-11-08) and
everything else below still stands.

The doc-truth round (2026-11-03) is COMPLETE and graduated to its own log:
`docs/doc-truth-round-session.md` — the A1 maintenance track that closed
every honest null and every documented drift the Coda round's graduation
carried forward: (T1) the L1 doc-drift sweep — every §7.4 flag re-derived
from its live source and corrected (the four receipt-only pin decisions,
no pin tests added this round); (T2) the PWA installability/offline-load
benchmark — the PT-5 plan's honest "not measured" null flipped by a real
receipted measurement under `benchmarks/coda-pwa/` (offline boot-from-cache
91 ms median vs online 175 ms median, N=5, the 84 ms delta is the
precache's measured effect; re-runnable on demand, zero model traffic);
(T3) the Coda landing usage capture — the first user-product band on the
landing page (`CodaSection` after `LiveDemoSection`, aqua, `#coda`),
framing the two stills from the new committed in-repo capture lane
(`apps/coda/scripts/capture-usage.mjs` → `public/landing/coda/`, the
e2e spec's own interactions, 1280×800 @2×, PROVENANCE.md sidecar),
plus the thirteenth scroll-budget amendment (15.5 → 16.5vh,
3,950 → 4,060 words — compressed first, canonical e2e twin measured
16.3vh / 4,033w, both gate files moved together, OG shots regenerated);
(T4) the instruction-surface PR-lane candidate — a decision doc
(`docs/instruction-pr-lane-research.md`, evaluation only) that prices
the three live guard events of the round (E1 T2's `benchmarks/AGENTS.md`
ownership-list edit refused and operator-landed; E2 T3's landing
`AGENTS.md` amendment-ledger entry refused and operator-landed; E3 the
Coda round's `apps/coda/AGENTS.md` child DOX operator-landed) and lands
the scoped recommendation: NO-GO on a new standing session-side
`git push` / `gh pr create` primitive, GO zero-cost on documenting the
propose-via-PR path through tools that already exist operator-side — the
gate stays FINAL in-session, byte-for-byte. The T5 closeout (this
graduation) landed the round's blog post
(`content/blog/2026-11-03-the-doc-truth-round.md` — the 43rd post,
`check:blog` green at 43 posts / 106 tags, media reusing the two
committed `public/landing/coda/` stills), the permissions.md's
propose-via-PR paragraph (the Zero-Cost GO's doc edit), the CHANGELOG
`## [Unreleased]` entries for the T4 decision doc + the T5 closeout
content (the blog post rides the round's entries, no double-listing),
and the `A2_GROUND_TRUTH.md` drift-log entry (§7.4's eight flags
RETIRED with T1's receipts; §8 gains the `benchmarks/coda-pwa/` lane
+ the landing capture lane classed per the capability-attribution rule
— both Level-3 compositions of existing mechanisms, no new class).
36 chunks across T1–T5 (8+6+12+3+7, the pre-split law the
round's deviation record prices: registry-derivation +4, measurement
+2, landing-amendment +6 over the authoring baseline, the closeout's
five-file graduation surface +3); 2 operator
unblocks (the amendment ruling + the one-line hue revert, both
operator-side from the receipt's draft-and-land record); 2 instruction-
guard events (the round's E1/E2, the T4 evidence set); the full gate
set green at the gate (typecheck 0, lint 0/142 baseline,
check:docs/changelog/blog/benchmarks/claims all rc=0, the e2e battery
15 passed / 5 skipped (the CODA_E2E marker, by design) / 0 failed).
The round's capability-utilization report + the queue carry-overs
landed at the bottom of the round log.

The Coda app round (2026-11-02 → 2026-11-03) is COMPLETE and graduated to its
own log: `docs/coda-app-round-session.md` — the DRIVE track's app round: the
repo's first user product, **Coda** — a local-first markdown notes + task-board
PWA (offline-first, installable, cross-platform) at `apps/coda/`, planned by
the PT-5 lane (7 live specialist spawns, verdicts applied, 87/100) and
delivered through C1–C5 agent ticket sessions plus the C6 closeout. Receipts:
51/51 domain tests in both bun lanes, 5/5 isolated e2e (the CODA_E2E-guarded
Playwright lane), the offline proof end to end, the CI `coda` job green,
the C6-3a blog post, and the V3-contract retrospective merged into the PT-5
plan via the PTY lane. The next round opens from the queue below.

The exit-resume round (2026-11-02) is COMPLETE and graduated to its own log:
`docs/exit-resume-round-session.md` — the Ctrl+C-exit → resume lane, opened
by the operator's report that the exit hint printed `pi --session-dir 'C:\…'`
on Windows: the hint now names the launcher you actually ran (`unown --resume
<id>`), quotes for the host shell (double quotes on win32 — single quotes are
literal characters in cmd.exe), prints on BOTH exit paths (interactive quit
and SIGTERM/SIGHUP) after terminal restore, and the first Ctrl+C on an empty
editor shows the "Press Ctrl+C again to exit" notice. The round's deeper fix:
an exit DURING a running turn rode a fire-and-forget abort that raced
`process.exit()` — a first turn with no finalized assistant message yet was
lost entirely (the no-assistant guard buffers in memory: no file, no hint);
the exit now runs the same cooperative abort matrix as Esc//abort and awaits
idle (bounded 2 s) before disposing, with the aborted marker normalized at
the agent-loop boundary. Receipt: `scripts/tui-capture/verify_resume_hint.py`
(boot → double Ctrl+C → parse the printed command → run it VERBATIM →
history visible; the same for a mid-stream-interrupted session), plus 50 unit
tests across the three touched packages. Research record:
`docs/exit-resume-round-research.md`.

The fresh-clone round (2026-11-01 → 2026-11-02) is COMPLETE and graduated to
its own log: `docs/fresh-clone-round-session.md` — the operator-directed
bring-up (clone → setup → run, proven on two cold machines including a
recycled lineage) plus both lanes it surfaced, both closed: issue #30 (the
`unown -p` exit hang — the armed /proc watcher committed as
`scripts/issue30_watcher.mjs` with 22/22 clean-run non-repro receipts across
idle + dream-churn lanes, and the issue's request (b) shipped as the
`UNOWN_PRINT_EXIT_TRACE=1` exit-path instrumentation through an eleven-chunk
A2 ticket) and PT-5 (the live plan-mode V3 specialist-spawn receipt, above).
Its `A2_GROUND_TRUTH.md` (the dated capability snapshot, 8 doc-drift flags)
stays the operator's recon reference until the next teardown refresh.

The browser autonomy round 2 (2026-11-01) is complete and graduated to its
own log: `docs/browser-autonomy-round-2-session.md` — the continuation round
that closed round 1's entire carries-over queue: #46 fixed on all three
fronts (the claims gate's memory route is now EXACT with a
Manual-notes-remedy failure line — the silent-drift half root-caused to
`extractTemplates` reading markdown code spans as template segments, so a
pruned line passed on an unrelated 12-char window; the renderer's
Manual-notes preservation pinned against cap-pruning renders; the convention
documented in loop.tsx and docs/memory.md), #44 fixed (screenshot extension
honored, format clashes fail loudly — pinned unit/live/e2e), **#45
implemented and measured** (the tool-time browser-memory hint lane: the
first browser call carries a bounded digest of browser-relevant memory, the
first navigate to a known host carries its slice — stress-checkout run 6
PRE-ARMED the dialog accept before the triggering click, the trap prevented
for the first time in six runs; BROWSER-7's proactive-application verdict
moves to VALIDATED), the warm docs-navigation benchmark run on a second
technology (MDN Canvas roundRect: 12 calls / 39.5 s, all overloads +
exception verified, zero interventions, plus a fresh-project control where
the lane correctly stays silent), and the hostile-page-checkout skill
promoted and session-verified. Commits: `6224668c` → `fe8b5f9c` →
`c1272620` + the closeout.

The browser autonomy round (2026-11-01) is complete and graduated to its
own log: `docs/browser-autonomy-round-session.md` — the browser dogfooding
& self-improvement mission: nine lanes receipted (research, PM ops, docs
navigation, user simulation, long-horizon monitoring, memory, failure-driven
improvement, self-dogfooding), two real defects found AND fixed in-round
(the F3 iframe fill_form silent-loss race — live-pinned against a real
Chromium; the F4 dev-server no-hydration-by-IP-literal trap — config-pinned),
the memory loop receipted both ways, a systemic dream-drift class filed
(#46, second occurrence), the competitor research committed (nobody
persists failure memory — the open axis), and the ten-benchmark suite with
honest nulls under `benchmarks/browser-autonomy-round/`. The parallel plan
mode V3 round (`docs/plan-mode-v3-session.md`) raced this round on main
(two rebases, zero conflicts) and has since completed (M1–M8, with the
round retrospective) — its status line now says so.

The security round (v0.0.55, 2026-11-01) is complete and graduated to its
own log: `docs/security-round-session.md` — every open Dependabot advisory
(follow-redirects 1.16.2 HIGH, minimatch 11.0.1 MEDIUM, regenerated on all
five vendored surfaces) and every open CodeQL finding (CSPRNG task ids, the
linear trailing-slash sweep across eleven sites) addressed, the
coverage-v8 PR declined on its exact-pin peer contract, v0.0.55 tagged on
green 3-OS CI and published.

The dependency round (v0.0.54, 2026-11-01) is complete and graduated to its
own log: `docs/dependency-round-session.md` (research and decisions:
`docs/dependency-round-research.md`) — six within-policy updates, each stage
gated, the framer-motion bump proven by an A/B pixel diff, v0.0.54 tagged on
green 3-OS CI and published.

The completed rounds before it: the Settings Evolution round (v0.0.49 +
v0.0.52 — `docs/settings-evolution-session.md`), the plan-mode todo
unification + footer quiet rounds (v0.0.53 —
`docs/plan-mode-todo-unification-round-session.md` +
`docs/footer-quiet-round-session.md`), and the release-recovery round that
re-cut v0.0.53 after its first tag landed against red CI
(`docs/release-recovery-session.md`).

**The next round's queue (recorded, in priority order)**: the doc-truth round
(2026-11-03) closed its whole scope — the Coda round's three carries-forwards
(the landing usage capture, the instruction-surface PR-lane candidate, the PWA
benchmark receipt) plus the L1 doc-drift sweep are all DONE and receipted in
`docs/doc-truth-round-session.md`; what IT carries forward: the
`docs/permissions.md` propose-via-PR paragraph's follow-up is a drift-trip
trigger only (NOT a scheduled ticket — the convention works at 3-for-3 clean
landings; the trigger is an observed receipt-drift incident tied to a
guard-event draft, per the decision doc's §9), and the four T1 receipt-only
pin surfaces stay a deliberate no-pin (legitimately-growing registered
content). Then the
browser autonomy round 2 closed its predecessor's carries-overs (#46, #45, #44, the
warm docs-navigation benchmark, the skill promotion) — what remains of the
browser-autonomy lineage: the release-monitoring routine's first weekly run
(`auto-mvxw0wne-onkwcn`, 2026-11-08 — the multi-day lane's first real
datum); the hint-digest ranking refinement is CLOSED (the hints-ranking
round, 2026-11-03 — the category-balanced round-robin selection, see the
graduated log above); the S2 ledger's head — S2-11 (the spend meter) and
S2-4 (the memory health card) — is CLOSED (the spend-and-memory-health
round, 2026-11-04, both misses flipped 12/12 — see the graduated log
above); then the pre-existing queue: S2-7/S2-8/S2-9, the
S2-3/S2-16 L-pair, S2-22 (see the settings log's "Resume-from-here"); the
injection-scanner ML classifier (the production TODO); the delegation
round's subagent-reuse axis; OB-7 (fleet outcomes in the brief); the
landing next-round queue (cmd-K search, blog hover-previews); the term.ts
snapshot-class follow-up (release-recovery CP2); the plan mode V3 round's
own milestones (its session log owns that queue). When the first v0.0.56
content lands, re-add `## [Unreleased]` to CHANGELOG.md and regenerate the
rail in the same commit; the version bump itself is the release commit
(package.json version + dated heading + rail + tag on the green SHA).

### Environment checkpoint (2026-11-04, the Ostinato round — eighth lineage bring-up)

- Sandbox recycled again; re-cloned @ `189fa033` (=`origin/main`) into
  `/home/z/my-project/Unown`; PAT rewired into the remote + the off-repo
  credential store (`/home/z/my-project/.creds`, exposed as
  `/home/z/my-project/.secrets` per the survival convention). bun **1.4.3**
  re-pinned **project-locally** at `/home/z/my-project/.tools/bun-linux-x64`
  (a new pattern — prior lineages' global upgrades died with recycles; a
  project-local binary survives). `UNOWN_NO_LINK=1
  UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` green; `.env` authored
  minimal + duplicate-free (the Agnes lane: upstream URL, key,
  `BRIDGE_KNOWN_MODELS`, `PI_MODEL_ID=agnes-3.0-flash`,
  `UNOWN_HOME=/home/z/my-project/unown-home`).
- Stack: bridge `:3031` (upstream 200, 6 agnes models), engine `:3030`
  (v0.0.55/`189fa033`, fresh DB). Doctor "ready to chat" (20✓/2⚠:
  model-spec + LSP — the honest first-session pair). Smoke 1/1 `UNOWN_OK`
  exit 0 in 3.7 s, dispatched through the REBUILT daemonizer (the recycle
  had reclaimed `scripts/dispatch-bg.py` + `tickets/`; rebuilt and
  re-validated: PPID-1 supervisor, log/pid/exit receipts, mirror
  re-staged).
- The round-opening commit (this one) lands the Phase 0 artefact set: the
  PRD, the reliability coverage matrix, the augmentation registry (empty
  per Phase 0), the benchmark scaffold (canaries armed, honest nulls), the
  ground-truth refresh, this rotation, the CHANGELOG entry + the
  regenerated rail. O-1 (canaries + the app skeleton) dispatches next,
  after the H-1 smoke and the H-3 PTY-audit pre-checks.
- **O-1 LANDED 2026-11-04 (the ninth lineage's first push)**: canaries
  C1 3/3 · C2 2/3 (variant B's cap-overflow receipted — the honest
  baseline spread) · C3 3/3; the skeleton at `apps/ostinato/` (13 files,
  Lane A 5/5, Lane B 5/5, receipt tree-verified). The H-3 pre-dispatch
  audit harvested bug-register B-1 (the first-flight tip overwrites the
  `/abort` notice) + B-2/V-9 (the PTY backpressure law) — fix tickets
  **A2H-1/A2H-2** join the queue after O-2. The registry's PROPOSE rows:
  H-4 (pump-while-typing), H-5 (isolated UNOWN_HOME per lane), H-6 (the
  status-line collision guard). Next: O-2 (the domain core), then the
  A2H pair.
- Operator tools that must survive recycles:
  `/home/z/my-project/scripts/dispatch-bg.py` +
  `/home/z/my-project/tickets/` + `/home/z/my-project/.secrets` + the
  project-local bun at `/home/z/my-project/.tools/`.

### Environment checkpoint (2026-11-04, the spend-and-memory-health round — seventh lineage bring-up)

- Sandbox recycled again after the round-opening commit; re-cloned @ `b66014cf` (=`origin/main`) into `/home/z/my-project/Unown`. bun **1.4.3** re-pinned (the sandbox ships 1.3.14). `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` green; `.env` from `.env.example` with the Agnes lane set IN PLACE (key set, `UNOWN_HOME=/home/z/my-project/unown-home`).
- Stack: bridge `:3031` (upstream 200, 6 agnes models), engine `:3030` (v0.0.55/`b66014cf`, fresh DB — the known recycle limit). Doctor "ready to chat" (LSP + model-spec the honest ⚠). Smokes 3/3 `UNOWN_OK`; the pipe-holding quirk reconfirmed environmental — long dispatches ride the rebuilt `/home/z/my-project/scripts/dispatch-bg.py` daemonizer (validated end-to-end: PPID 1, log/pid/exit receipts), and A2 receipts mirror at `/home/z/my-project/tickets/receipt-mirror.md`.
- Pre-ticket baseline ALL green: typecheck 0, lint 0 errors, unit **2125/0** (157.9 s), check:docs|changelog|blog|benchmarks|claims ok (claims 62/62). SM-1 (S2-11 via A2, ~4 chunks) dispatches next.
- Reconciliation update: the seventh lineage's in-flight SM-1 (chunks 1–2, tree preserved on `sm1-wip` @ `46cc2f8c`) is superseded by the sixth lineage's SM-1 @ `061384bb` + SM-2 @ `2efef3e9` (the dual-incarnation arbiter: first-on-main wins; adopt on fetch — receipted in the round log). The round's remaining ticket: **SM-3, the closeout**. Operator tools that must survive recycles: `/home/z/my-project/scripts/dispatch-bg.py` + `/home/z/my-project/tickets/` (receipt mirror, prompts, logs) + `/home/z/my-project/.secrets/` (PAT + Agnes key).

### Environment checkpoint (2026-11-02, the fresh-clone round — resume + ground truth)

- Sandbox recycled after the round's M1; re-cloned @ `5fe50ca8` into
  `/home/z/my-project/Unown`. bun **1.4.3** re-pinned (1.4.4 still has the
  frozen-lockfile regression). `UNOWN_NO_ENGINE_SERVICE=1 bun run agent:install`
  7/7 green again; `.env` with the Agnes upstream +
  `UNOWN_HOME=/home/z/my-project/unown-home` (persistent across recycles).
- Stack re-up: bridge :3031 (upstream ok 200, 6 agnes models), engine :3030
  (phase ready, v0.0.55). Doctor green (1 expected ⚠: no LSP).
- **Issue #30 probe: 6/6 clean headless runs** against an idle engine — the
  issue's correlation is active-engine-harness windows, so the M2 repro lane
  now pairs `unown -p` loops with live engine churn plus an armed /proc
  watcher (see the round log's refined M2 plan).
- `A2_GROUND_TRUTH.md` opened at the repo root — the A1 operator's dated
  capability snapshot (8 doc-drift flags recorded; the utilization audit
  classifies #30 as triggered-but-unverified → Level 4 instrumentation
  first).
- Operator decisions (2026-11-02): the DRIVE app is **Coda** (local-first
  markdown notes + task-board PWA) at `apps/coda/` in this monorepo; push
  lane direct to `main`; this round finishes (#30 → PT-5 → closeout) before
  the Coda round opens.

### Environment checkpoint (2026-11-01, the browser autonomy round — closeout)

- Sandbox lineage `/home/z/my-project/unown`, the round's commits `e7e0a43d`
  (open) → `5eb1b973` (receipts) → `0e9eca7e` (F4+F5 fixes, CI green) →
  `0d0c64ff` (F3 fix, rebased) → `7c2ae976` (the birthday-flake freeze +
  occurrence-2 restoration, rebased).
- **Parallel-round discipline** (new, earned the hard way): the plan mode
  V3 round pushed twice mid-flight; both reconciled by fetch → rebase
  (zero conflicts — disjoint surfaces) → fast gates → push. A rejected
  push is a fetch, never a force.
- Engine-suite sandbox honesty: full-suite runs under a live engine +
  concurrent agent sessions flake in engine-adjacent timing tests
  (outbox/automations/PLM) on BOTH trees — the control experiments
  (isolation runs, pristine-tree runs, quiet-sandbox reruns) are the
  receipts; CI is the authoritative gate.
- The round's stack facts: bridge + engine mortal across recycles (re-run
  `bun run agent:start`); the fixture server `python3 -m http.server 8090
  --directory benchmarks/browser-autonomy-round/fixtures`; the release
  monitor routine `auto-mvxw0wne-onkwcn` lives in the engine DB (weekly,
  read-only).

### Environment checkpoint (2026-11-01, the browser autonomy round)

- Sandbox lineage `/home/z/my-project/unown` (fresh lineage — prior
  workspaces reclaimed), clone @ `22d3e725` (main, v0.0.55). bun **1.4.4**
  (upgraded in-sandbox from 1.3.14 — the 1.4 lockfileVersion-3 floor).
- `UNOWN_NO_ENGINE_SERVICE=1 bun run agent:install` 7/7 green; `.env` with
  the Agnes upstream (key set, `agnes-3.0-flash`); `UNOWN_HOME` at its
  default. Stack: bridge :3031 (upstream ok 200), engine :3030 (phase
  ready). `unown doctor` green (1 expected ⚠: no LSP in the container).
- Baseline gates green on the pristine tree: typecheck 0, lint 0 errors,
  unit 2067/0, all five `check:*` gates ok.
- Playwright `chromium-1200` in the ms-playwright cache — the browser
  tool's discovery path; headless default in the sandbox.

### Environment checkpoint (2026-11-01, the dependency round)

- Sandbox lineage `/home/z/my-project/Unown`, clone @ `72110634` (8 commits
  past `v0.0.53` — the CI-gate rounds). bun **1.4.3** (CI's pin; the
  sandbox's 1.3.14 was upgraded before any install — sub-1.4 bun rewrites
  the root bun.lock down to v1-with-dropped-overrides).
- `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` green;
  `.env` from `.env.example` with the Agnes upstream
  (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key set,
  `BRIDGE_MODEL=agnes-3.0-flash`), `UNOWN_HOME=/home/z/my-project/unown-home`.
- Playwright chromium installed for the e2e + shot lanes. A stale
  `next-server` process on :3111 serves the previous build's chunk names —
  kill with `pkill -9 -f next-server` (the renamed process defeats a
  `standalone/server.js` pattern).
- Real-user smokes green: bridge upstream ok 200 (6 agnes models), engine
  v0.0.53, `unown -p` round trip `UNOWN_OK`, doctor green (2 expected ⚠).

### Environment checkpoint (2026-11-01, the recovery session — updated)

- Sandbox recycled between sessions (the prior workspace was reclaimed);
  the repo re-cloned @ `53b8d766` (v0.0.53's first tag) into
  `/home/z/repos/Unown` — the PTY harness needs
  `UNOWN_ROOT=/home/z/repos/Unown` (its default points at the prior
  sandbox's path).
- bun **1.4.3** (CI's exact pin; `npm i -g bun@1.4.3`).
- `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` green;
  `.env` from `.env.example` with the Agnes upstream
  (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key set,
  `BRIDGE_MODEL=agnes-3.0-flash`); `bun run agent:start` — bridge :3031
  (upstream ok 200, 6 agnes models), engine :3030 (v0.0.53).
- Playwright chromium installed for the e2e lane (the sandbox ships without
  it); `python3 -m pip install pyte pillow` for the PTY harness.
- The prior settings-round environment notes (bun 1.4.4, the
  `/home/z/my-project/Unown` lineage) are history — superseded above.

- Round 1 cloned @ `68055455` (v0.0.48); round 2 cloned @ `499a9412` (v0.0.50,
  main) — one sandbox lineage, `/home/z/my-project/Unown`.
- bun **1.4.4** (floor 1.4 — lockfileVersion 3; upgraded in-sandbox from 1.3.14).
- `bun run agent:install` 7/7 green — `unown` linked → `~/.local/bin/unown`;
  engine OS service skipped in the container (no systemd user bus — the
  agent-side auto-start fallback carries it, per docs/routines.md).
- `.env` from `.env.example`; `BRIDGE_UPSTREAM_KEY` set (Agnes AI);
  upstream `https://apihub.agnes-ai.com/v1`, model `agnes-3.0-flash`;
  `UNOWN_HOME=/home/z/my-project/unown-home` (the documented override —
  sandbox containment).
- `bun run agent:start` — bridge :3031 (upstream ok 200, 6 agnes models),
  engine :3030 (phase ready, token auth, v0.0.50).
- `unown doctor` — green (2 expected warnings: unverified model spec, no LSP).
- Real-user smokes: `unown -p "Reply with exactly: UNOWN_OK"` → `UNOWN_OK`;
  PTY lane `verify_settings_hub.py` EXIT=0 (hub opens, editor persists,
  subcommands answer).

### Architecture facts established (read before resuming)

- The TUI's built-in `/settings` is hard-intercepted in
  `pi-repo/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
  (`setupEditorSubmitHandler`) BEFORE extension dispatch; extension commands
  dispatch through `session.prompt()` → `_tryExecuteExtensionCommand`, and
  the autocomplete provider FILTERS OUT extension commands whose names clash
  with built-ins. An extension-registered `/settings` is therefore shadowed
  in the editor path — overriding requires the two minimal vendored patches
  (guard the interception with `!isExtensionCommand(text)`; let the extension
  command replace the built-in in autocomplete). The repo DOES patch vendored
  files when justified (precedent: `/abort` round 68055455 touched
  agent-session.ts + runner.ts + interactive-mode.ts with tests + PTY lane).
- Unown's settings surface (post-hub): the `/settings` control centre
  (`src/settings/` — 89 registry items across the ten IA sections; the
  cross-cutting search/health/diff/recent/transfer surfaces) plus the
  surfaces it links: `/permissions`, `/project-settings`, `/providers`, the
  ~65 other Unown slash commands, env vars (`.env.example`), CLI flags
  (`cli.ts` HELP), and the config files (`settings.json`, `addons.json`,
  `models.json`, `auth.json`, `mcp.json`, hooks config, permissions config,
  `.unown/settings.json`, and the hub-owned `settings-hub.json` +
  `settings-history.jsonl`). The open items live in the S2 ledger
  (`docs/settings-evolution-session.md`).
- Round conventions (from `/abort` + PLM rounds): competitor research doc,
  session log, code (self-learning ± vendored pi), unit tests BOTH suites,
  PTY verification script under `scripts/tui-capture/`, CHANGELOG entry,
  landing/blog/DOX updates, push per milestone.

### Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| 0 setup + run | ✅ done (rounds 1+2) | this file |
| 1 inventory | ✅ shipped | `docs/settings_inventory.md` |
| 2 competitor research | ✅ shipped (+ round-2 pass) | `docs/settings_competitor_review.md` · `docs/settings-round2-research.md` |
| 3 user journeys | ✅ shipped | `docs/settings_user_journeys.md` |
| 4 IA redesign | ✅ shipped | `docs/settings_ia_redesign.md` |
| 5 edge-case catalogue | ✅ shipped | `docs/settings_edge_case_catalogue.md` |
| 6 trust engineering | ✅ shipped | `docs/settings_trust_recovery_framework.md` |
| 7 missing settings | ✅ partial — the rest is the S2 ledger | `src/settings/` + `dream-review.ts` |
| 8 TUI redesign | ✅ shipped | `src/settings/` + vendored patches + `verify_settings_hub.py` |
| 9 benchmarks | 🔜 round 2 M2 | `benchmarks/settings-ux/` (to be built) |
| 10 self-improvement | 🔜 round 2 M6 | learning artifacts |
