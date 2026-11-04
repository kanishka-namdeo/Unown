# The Ostinato round — session log

> **Status: OPEN** — opened 2026-11-04 by the eighth lineage. The
> DRIVE-track app round of the 2026-11-04 A1 engagement: **Ostinato**, a
> keyboard-first, offline-first spaced-repetition flashcard PWA at
> `apps/ostinato/`, planned by [the PRD](ostinato-prd.md), gated by [the
> reliability coverage matrix](reliability-coverage-matrix.md), measured
> by [the benchmark suite](../benchmarks/ostinato/README.md), augmented
> only through [the registry](a1-augmentation-registry.md).

One-line purpose: the round's resumable checkpoint log — mission, operator
decisions, validation log, ticket queue, gate receipts.

**Mini-TOC**

- [Mission](#mission)
- [Operator decisions](#operator-decisions)
- [Phase 0 artefacts](#phase-0-artefacts)
- [Environment checkpoint](#environment-checkpoint)
- [Validation log](#validation-log)
- [Ticket queue](#ticket-queue)
- [O-1 dispatch brief](#o-1-dispatch-brief)
- [Gate run](#gate-run)
- [Resume instructions](#resume-instructions)
- [Related pages](#related-pages)

## Mission

The engagement directive (2026-11-04, user-issued): STABILISE A2 × HARDEN
A2 × PROVE IT. One ambitious real-world project doubles as the production
build, the stress test of A2's reliability, and the benchmark programme
that measures whether A2 became more reliable, predictable and cheaper to
operate while doing meaningful work. Two tracks, shared learnings, never
shared hands: **DRIVE** (harden and ship the app through A2 tickets — A1
never writes app code; tickets succeed through A2 or fail informatively)
and **AUGMENT** (improve A2 itself from receipted failures, via the
registry's lifecycle). Hardening-first: keyboard-only workflows, focus,
modals, palette, scrolling, selection, empty/loading states, interruption,
resize, crash and persistence recovery — all exercised before feature
velocity. Every verifier is external (build, tests, lint, typecheck,
deterministic checks); loops capped at 4 with validation-revert; every
genuine failure enters the failure→benchmark reflex.

## Operator decisions

Dated 2026-11-04, this round-opening session:

- **APP = Ostinato** — keyboard-first, offline-first spaced-repetition
  flashcard PWA; **path `apps/ostinato/`** (the Coda pattern); push lane
  **direct to `main`**; hardening-first order per the PRD.
- **Version-bump policy**: Unown's `package.json` version bumps only when
  Unown itself is enhanced (repo law: version + dated heading + rail + tag
  on the green SHA). App-round commits ride `## [Unreleased]`.
- **Pre-split pricing** inherited from the doc-truth round's deviation
  ledger: authoring tickets ~4 chunks; measurement tickets +2;
  registry-derivation tickets +4; landing-amendment tickets +6.
- The queue's standing items (S2-7/S2-8/S2-9, the S2-3/S2-16 L-pair,
  S2-22, the injection-scanner ML classifier, the delegation reuse axis,
  OB-7, the landing queue, the term.ts follow-up, the release-monitor
  routine's first weekly run 2026-11-08) stay queued in
  [SESSION.md](SESSION.md) — this engagement does not resume them; it
  opens its own round per the directive.

## Phase 0 artefacts

All landed in the round-opening commit:

1. [The PRD](ostinato-prd.md) — vision, scope P0/P1/P2, non-goals, the
   hardening-first mapping table, architecture, verification, deployment,
   success criteria.
2. [The reliability coverage matrix](reliability-coverage-matrix.md) — the
   directive's eleven lanes with today's receipted coverage and the round's
   additions.
3. [The augmentation registry](a1-augmentation-registry.md) — opened
   EMPTY per Phase 0, with three PROPOSE-stage hypotheses (H-1..H-3).
4. [The benchmark suite scaffold](../benchmarks/ostinato/README.md) — the
   C1–C3 calibration canaries defined and armed; app lanes K-1/A-1/O-1/
   R-1/I-1 named; RESULTS carries honest nulls.
5. The recon refresh — [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md)
   header/§1/§2/§5/§10 re-verified live on the eighth lineage.
6. This log + SESSION.md rotation + the CHANGELOG entry + regenerated
   rail + the README/DOX index updates.

## Environment checkpoint

The twelfth lineage's resume state, 2026-11-04 (the O-5 session — the
PWA tooling + capture + wiring + CI round):

- **The V-24 bring-up**: this lineage began with an accidental full
  re-clone (`rm -rf Unown && git clone`) that destroyed the gitignored
  runtime state while the eleventh lineage's stack was STILL RUNNING on
  it (engine + bridge alive since 12:31, their DBs already unlinked).
  Recovery before the stop: the SQLite stores copied out of
  `/proc/10101/fd` (selflearning.db + WAL, the three mem0 stores +
  the engine log), the tree rebuilt (`bun install`, `.env` re-staged
  from `.creds/agnes.env`, `UNOWN_NO_LINK=1
  UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts`), the stores
  placed back, `bun run agent:start` — `/api/overview` receipts the
  full history intact (**111 runs / 106 passed / 79 dreams / 66 memory
  versions / 218 notes**), engine `v0.0.56 · e1822465` (no drift),
  H-1 smoke `UNOWN_OK` rc 0 in 2.1 s. The O-4 receipt file was lost
  (gitignored runtime state — the round log's O-4 row carries its
  essence; the receipt-mirror re-staged this session).
- **O-5 economics**: 3 dispatches on ONE pinned session
  (`01a1a6f8-c07d-7500-b4fd-930359c93100`): chunk 1 (8 turns — both
  scripts authored, verify-precache RUN at 18/0, the count drift
  reported not fixed), chunk 2 (8 turns, capped — all three edits
  landed byte-exact, the receipt not yet updated), finalization (6
  turns — gates re-run, receipt COMPLETE). The operator verified
  every diff before the finalization brief (V-17's byte-exact law
  held throughout: zero failed edits).
- The capture lane's ZERO-defect first live run — the round's first
  greenfield lane with no defect harvest, receipted as the V-17
  payoff: the interaction contract was byte-copied from the proven
  flow spec instead of re-authored.

The eleventh lineage's resume state, 2026-11-04 (the O-4 session — the
hardening e2e battery; [SESSION.md](SESSION.md) keeps the index):

- **No recycle**: the tenth lineage's filesystem survived intact
  (repo at `d5c853f4` clean, `.tools/`, `.creds/`, `tickets/`, the
  stack up). The engine build-drift was restart-aligned onto
  `d5c853f4` at resume (V-6's idle-window law, the lane's fourth
  live catch); the H-1 smoke re-armed in a scratch cwd (`UNOWN_OK`,
  exit 0, 2.1 s).
- **The O-4 economics**: 13 dispatches across five sessions (the
  fresh-session-per-chunk-class discipline — no session exceeded ~2
  chunks of fatness; every continuation PINNED `--session <id>`,
  V-12's law); four operator live-run rounds (5/3/4 → 5/3/4 → 9/3/0 →
  **12/12**) with every defect root-caused operator-side (DOM probes,
  computed-style probes, a localStorage instrumentation spec, a
  domain-level reproduction) and fixed through byte-exact briefs
  (V-17's law — no fix round exceeded 6 turns).

The tenth lineage's resume state, 2026-11-04 (the O-2
session; the prior lineage checkpoint):

- **No recycle this time**: the ninth lineage's filesystem SURVIVED
  (repo at `03541d34` clean, `.creds`, `tickets/`, `download/`,
  `unown-home/`, and the stack's bridge/engine processes still up —
  engine 1h21m old). The recycle had earlier taken `.tools/`, pip's
  `pyte`, and `/home/z/my-project/scripts/` (V-1's class, a THIRD
  occurrence): rebuilt byte-fresh — bun 1.4.3 re-pinned, `pyte`
  re-installed, `dispatch-bg.py` re-authored, `.env` re-staged, and the
  `dispatch-file.py` wrapper re-authored WITH the new `--session <id>`
  pin (V-12's cure). An accidental fresh clone nested at `Unown/unown`
  was removed before any gate ran against it.
- Engine build drift re-caught the V-6 way: engine @`15430eb5` vs agent
  @`03541d34` → idle-window `unown engine restart` → aligned
  (`v0.0.55 · 03541d34`), the receipt lane's second live use.
- H-1 smoke re-armed: `UNOWN_OK` exit 0 in 2.7 s (the fastest yet).
- O-2 dispatched from the surviving tree without re-cloning.

The eighth lineage's bring-up state, 2026-11-04 (the prior lineage
checkpoint):

- Sandbox recycled before this session; re-cloned @ `189fa033` =
  `origin/main` into `/home/z/my-project/Unown`; PAT rewired into the git
  remote + the off-repo credential store `/home/z/my-project/.creds`
  (exposed as `/home/z/my-project/.secrets`).
- bun **1.4.3** project-local at `/home/z/my-project/.tools/bun-linux-x64`
  (the sandbox ships 1.3.14 — sub-1.4 bun rewrites the root lockfile
  down; prior lineages lost a global upgrade to the recycle, a
  project-local binary does not). Export PATH ahead of every bun call.
- `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` —
  7/7 green. `.env` authored minimal + duplicate-free at the repo root
  (Agnes lane: `BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key
  set, `BRIDGE_KNOWN_MODELS=agnes-3.0-flash,agnes-2.5-flash`,
  `PI_MODEL_ID=agnes-3.0-flash`, `UNOWN_HOME=/home/z/my-project/unown-home`).
- Stack: bridge `:3031` (upstream 200, 6 agnes models), engine `:3030`
  (v0.0.55/`189fa033`, fresh DB). `bun bin/unown doctor` → "ready to
  chat" (20✓/2⚠: model-spec + LSP — the honest first-session pair).
- Operator tools rebuilt (the recycle reclaimed the seventh lineage's):
  `/home/z/my-project/scripts/dispatch-bg.py` (double-fork daemonizer,
  PPID-1 supervisor, log/pid/exit receipts), `/home/z/my-project/tickets/`
  (logs, receipts, receipt-mirror.md). Smoke 1/1 `UNOWN_OK` exit 0, 3.7 s.
- Operator-side raw receipts: `/home/z/my-project/tickets/receipts/`
  (`doctor.txt`, `help.txt`, `engine-status.txt`, `smoke-1.log/.json`).

## Validation log

| ID | Event (dated) | Class (directive taxonomy) | Disposition |
|---|---|---|---|
| V-1 | The recycle reclaimed `/home/z/my-project/scripts/` + `tickets/` + `.secrets/` despite the survival convention (2026-11-04) | infra-flake (environmental) | Rebuilt byte-fresh: daemonizer re-validated (PID detached, supervisor PPID 1); mirror re-staged. H-1..H-3 armed. |
| V-2 | Sandbox ships bun 1.3.14 (sub-1.4 rewrites the root lockfile) | stale-assumption (environmental) | Project-local 1.4.3 pin at `.tools/` — new pattern, survives recycles; recorded in A2_GROUND_TRUTH §10. |
| V-3 | Print-mode pipe-hold quirk (the issue #30 class): the outer tool call stalls after the answer flushes | infra-flake (environmental; #30 upstream OPEN) | Avoided by construction — every `-p` dispatch rides the daemonizer; the #30 live-hang capture remains pending upstream (armed watcher + `UNOWN_PRINT_EXIT_TRACE=1` stand). |
| V-4 | doctor's 2 ⚠ (model-spec unverified, no LSP) | honest first-session state, not a failure | No action; both documented doctor lanes. |
| V-5 | The docs gate caught the round log's three parenthetical headings hashing to unguessable anchors (2026-11-04, at the round-opening gate) | prompt-brittleness (operator-side authoring) | Headings simplified to bare names; the gate's catch IS the receipt — the check:docs lane holds operator-authored docs to the same anchor law. |
| V-6 | The quiet-footer lane failed A2/A3 ("two rows at rest", "ambient silence") because the engine build drift (engine @`189fa033` vs agent @`15430eb5`) surfaces as the `memory: up · old build` ambient warning chip at rest (2026-11-04, ninth-lineage resume) | state-desync (environmental) | Waited for an idle router window, `unown engine restart` → build aligned; lane re-run 9/9. The lane doubled as a build-drift detector — receipted as a standing use. |
| V-7 | The recycle reclaimed pip state (`pyte` gone) — the PTY lanes cannot even import (2026-11-04) | infra-flake (environmental, the V-1 class) | `pip install pyte` + recorded in the operator bootstrap: the lane bring-up now installs pyte explicitly. |
| V-8 | The resume-picker lane's step-1 boot timed out at 90 s waiting for the TUI header (07:05:30); green on re-run at 07:20 with themes at t+5 s in the same cwd | infra-flake (momentary; likely bridge slowness in the engine-restart window) | Receipted as flake; if it recurs, arm a boot-timing watcher before filing. |
| V-9 | **The PTY backpressure law**: keystrokes sent to a streaming TUI are silently dropped unless the parent concurrently drains PTY output. Differential receipt: X1/X2 (no-read-while-typing) lost the probe chars 2/2; Y1/Y2 (read-while-typing) landed them 2/2; the six-run race matrix and the two-run determinism matrix lost `/abort` 8/8 the same way (2026-11-04, `/tmp/repro-abort/`) | infra-flake (harness law; product-robustness note B-2) | Operator harness rule: pump while typing during active streams. `pty_common.send` fix queued as A2H-2/H-4. |
| V-10 | The C2 canary's variant B run: A2 authored the module + tests but hit the 8-turn cap with 2 of 8 authored tests still red (`bun test` rc 1 at scoring) — the first A2-lane measured failure of the baseline (2026-11-04, receipt `run-20261104T*/c2.jsonl`) | genuine-gap (A2 capacity on small-code tickets at the chunk cap) | Receipted as the baseline's honest spread (C2 2/3); no fix ticket — the measurement IS the artefact; the round's chunk economics exist to manage this class. |
| V-11 | The O-1 receipt's closing prose said "exactly the 12 files above" while listing 13 — the operator tree-verify (H-2) caught the count slip; all 13 listed files exist, nothing extra on the tree | prompt-brittleness (A2 receipt prose; no overclaim — every named file verified) | The catch receipted here; H-2's first live catch of the round. |
| V-12 | **The continuation hijack**: `unown -c` ("continue this directory's latest session") attached the O-2 chunk-3 dispatch to the SMOKE canary's session (`01a1a5a9`, created 25 min earlier in the same cwd) instead of the O-2 session — 8 turns burned in the wrong context, error-during-execution at the cap (2026-11-04, tenth lineage) | operator-lane dispatch defect (prompt-brittleness class: ambient state wins over intent) | Not charged to A2 (the fairness law — operator contamination). Laws landed: continuation dispatches PIN the session (`--resume <id>`, now first-class in `dispatch-file.py`); the H-1 smoke canary runs in a scratch cwd so it can never become the repo's "latest session". |
| V-13 | O-2's original session hit the 4-chunk ticket cap with the context at ~502k cache-read tokens — the last chunks spent turns on edit-atomicity confusion ("the whole edit call failed"), the fat-session degradation the seventh lineage priced | genuine-gap (A2 capacity; the known economics) | The fresh-context-worker remedy (same receipt lane): a NEW session took the ticket finalization self-contained (operator ground-truth brief: the exact 4 reds, the oracle formula, the missing files) and closed it in 3 chunks (8+8+7 turns, the last under cap). Operator amendment: the ticket's 5th+ chunks priced to the fat-session lesson, receipted here. |
| V-14 | **The boundary verifier false positive**: `DOM_GLOBS` (`/\b(document|window|indexedDB|localStorage|sessionStorage)\./`) matched SENTENCE-ENDING PROSE — io.ts's comments "…an import document." / "…a JSON document." — redding the boundary lane against clean code; the earlier storage.ts catch ("window.localStorage" in a comment) was the same class | prompt-brittleness (verifier defect — the scanner was the bug, not the domain code) | Fixed at the verifier: the regex now requires an identifier after the dot (`\.\w` — genuine member access trips, prose is immune), plus the belt (no `window.`/`localStorage.` literal anywhere in `src/domain/*.ts`, comments included). A2 landed both layers + the receipt's D4 records the class. Standing lesson: when an external verifier reds against prose-clean code, diagnose the verifier FIRST (queued as H-7). |
| V-15 | The `check:claims` lane failed once inside the O-2→A2H-1 gate battery run (rc 1) then passed 3/3 standalone seconds later, same tree (2026-11-04) | infra-flake (gate-battery context; the standalone lane is deterministic green) | Receipted as flake; the battery re-run at the A2H-1 push passed all lanes. If it recurs inside batteries only, suspect cross-lane load (the unit suite runs adjacent), not the claims data. |
| V-16 | **The src-vs-dist law**: A2H-1's unit lanes ran green against SOURCE (vitest imports `src/`) while the LIVE repro still showed B-1 0/3 — the TUI boots the coding-agent from the built `dist/`, so pi-repo changes need `bun run build:unbundled` before live PTY verification (2026-11-04) | stale-assumption (environmental; the unit-green/live-red gap) | Rebuilt the package → the same repro flipped to FIXED 3/3 immediately. Standing law: any ticket touching `pi-repo/**` adds "rebuild the package, then re-verify live" to the operator gate; the engine restart (V-6) rides the same window. |
| V-17 | **The A2H-1 dispatch thrash**: 4 chunks (32 turns) of pure exploration — 25 tool calls (15 bash + 10 read), ZERO edits; chunk 4 obeyed the edit-first directive but its edit failed on an old_str mismatch and re-orientation burned the rest; chunk 7 burned 662 s of turns running the heavy package gates (the operator's job) | prompt-brittleness (operator-side brief design + A2 turn granularity at the 8-turn cap) | Cured in one chunk by the operator-supplied BYTE-EXACT region text + a single-action brief. Standing laws: (1) located-defect briefs embed the exact current source region (sed-verified) so the first edit cannot miss; (2) the first instructed action is the edit; (3) A2 receipts never gate on lanes the operator re-runs anyway — the receipt records "operator gate re-runs"; (4) the fresh-context economics of V-13 apply at ~4 chunks of session fatness. |
| V-18 | **The unit-lane sandbox pollution**: `bun test src` is a SUBSTRING path filter — it matched the engine's freshly minted self-learning sandbox at `data/self-learning/sandboxes/mint-assert-rejects-*/workspace/src/assertUtils.test.mjs` (a learning-job fixture whose asserts deliberately fail), redding the repo lane with a non-repo test (2026-11-04, at the A2H-2 push gate; the sandboxes are gitignored runtime data) | genuine-gap (gate hygiene: the lane's filter is not root-anchored) | Immediate: the two polluted sandboxes removed (runtime artifacts, housekeeping) → the lane re-ran **2152/0 across 154 files**, the family baseline exactly. Durable fix QUEUED as ticket A2H-3 (anchor the `test:unit` filter so `data/**` can never match; the engine mints `*.test.mjs` fixtures continuously). |
| V-19 | **The init-script re-seed clobber + the stale-session poison** (O-4's first live rounds): `page.addInitScript` re-runs on EVERY navigation — the crash-resume spec's unguarded `setItem("ostinato.data", SEED)` re-seeded the sm2-less seed over the app's own persisted graded data at every reload (a live localStorage instrumentation spec proved the app's write path CORRECT — the data key held the sm2 between grade and reload); the twin: the a11y spec's empty-state boot persisted a done session (via B-3's every-transition fix) that then restored over the re-seeded data ("All cards reviewed" on a fresh content boot) | prompt-brittleness (spec-side harness law) | Standing laws: seeding specs GUARD the seed (`if (getItem === null) setItem`) whenever a reload can follow; a re-seed must ALSO clear `ostinato.session` (the app's own boot persists it). Both landed in the specs; the diagnosis receipts live in o4.md's chunk 7. |
| V-20 | **The blob-download law + the armed-wait law** (O-4's flow lane): the export's `URL.revokeObjectURL(a.href)` ran SYNCHRONOUSLY after `a.click()` — cancelling the download the click had just scheduled (and a DETACHED anchor never dispatched it) → `waitForEvent("download")` never fired; the spec-side twin: `const dl = await armDownload(page)` AWAITS the event before its trigger exists — a self-deadlock (the 30 s test timeout kills the run) | genuine product defect (B-7) + spec-side harness law | Product: attach → click → remove → revoke LATE (30 s timeout). Spec: ARM (create the promise) → trigger → await. Both landed; a live probe proved the fixed export fires (`FIRED:ostinato-export.json`). |
| V-21 | **The overlay-owns-its-paint law** (O-4's Esc lane): `closePalette` focused `app.invokingEl` — but the Ctrl+K branch had called `rerender()`, whose `root.replaceChildren()` DESTROYED the captured element (focusing a detached node is a no-op → "inactive"); reading the same code found the palette's ArrowDown/ArrowUp branches mutating the selection WITHOUT any repaint (a latent D10-class bug no spec had driven) | genuine product defect (B-10; the D10 class recurring) | Standing law: body-level overlays (palette, create form) render via their OWN functions from the open-paths — never through a full-root rerender (which also resets form fields mid-typing). Landed across five sites; the arrow repaint came free. |
| V-22 | **The grid intrinsic-min-width overflow** (O-4's resize lane): after boot-wide → resize-narrow, `scrollWidth` = 394 — a computed-style probe pinned the implicit grid column at 377.5 px: the search input's size-20 INTRINSIC width (grid items' `min-width: auto` never shrinks below content minimums; `width: 100%` resolves against the track, but the track sizes from the item's min-content first) | genuine product defect (B-11; CSS layout law) | `.ostinato-review > * { min-width: 0 }` — the classic grid/flex shrink discipline; the resize lane re-ran green (375 and 1280, zero overflow, the two-pane geometry verified). |
| V-23 | **The receipted-but-unwired design** (B-3): O-3's receipt D2 claimed "the render's persistAll writes both lanes — the every-transition rule"; the CALL never existed (`renderBoot` received `persistAll` and passed it onward, never invoked it) — reveal/grade/nav transitions never persisted, and the crash-resume lane's first live run caught it (a mid-reveal reload lost the phase) | genuine product defect + receipt-overclaim class (H-2's tree-verify law extends to call-sites, not just files) | The `persistAll()` call landed in renderBoot's ready path; the crash-resume + offline lanes green. Standing lesson: a receipt's behavioral CLAIM is verified only by a live lane that exercises it — units pinned the seam (saveSession/readSession), not the wiring. |
| V-24 | **The re-clone law** (the twelfth lineage's bring-up): the session began by `rm -rf`-ing the live checkout and re-cloning from origin — destroying the gitignored runtime state the stack was still running on (engine DBs, `.run/`, the receipts dir; the O-4 receipt's file lost — its essence lives in the round log's O-4 row, the gitignored-receipts contract's designed containment) while the engine and bridge processes held their now-unlinked inodes open | operator-lane infra hazard (V-1's class, operator-caused this time) | Recovered BEFORE the stop: the engine's SQLite stores copied out of `/proc/10101/fd/{6,8,10,11,13}` (selflearning.db + WAL, mem0 history/vector stores), placed back after the reinstall, stack re-booted — `/api/overview` receipts **111 runs / 79 dreams / 66 memory versions intact**, engine aligned at `v0.0.56 · e1822465` (V-6's alignment by construction), H-1 smoke 2.1 s. Standing laws: (1) NEVER `rm -rf` a live checkout — the resume protocol is `git fetch && git pull --ff-only`; (2) when a process holds unlinked DB files, recover via `/proc/<pid>/fd` BEFORE killing it (SQLite WAL recovery makes the snapshot crash-safe); (3) off-repo mirrors (`tickets/`, `.creds/`, `.tools/`) are the recycle hedge — keep them current. |

Bug register (user-visible findings, the failure→benchmark reflex's
input):

- **B-1 — the first-flight settle tip overwrites the `/abort` notify**
  (2026-11-04, genuine product defect). When a brand-new user aborts
  their first-ever turn, `agent_settled` fires the flights extension's
  "You're flying" tip through the same `ctx.ui.notify` → `showStatus`
  path the `/abort` command's notice just used; `showStatus`'s dedup
  branch reuses the last status line and `setText`-replaces the abort
  feedback with the onboarding tip. Evidence: the abort lane's 07:07 run —
  `firstTaskAt` latched at 07:07:13.090Z (the lane's own prompt submit),
  "You're flying" on the pane, pi's message-level "Operation aborted"
  present, the unown notify absent; source trace: `flights.ts` agent_settled
  handler vs `tools.ts` /abort handler vs `interactive-mode.ts` showStatus
  dedup. Repro family: `/home/z/my-project/scripts/repro_abort_*.py`,
  `diag_abort_keys.py` (the healthy path shows both lines painting and
  persisting). **FIXED 2026-11-04 (A2H-1, v0.0.56)**: the repro
  re-authored (`scripts/repro_abort_notice.py` off-repo, fresh isolated
  UNOWN_HOME per run, pump-while-typing per V-9, the first-run provider
  prompt answered `n`) receipted **BEFORE 2/3 defect** (the tip
  overwrote the notify; run 3 painted both — the collision is a timing
  race, honestly receipted) and **AFTER 3/3 both lines persist** after
  the showStatus identical-text-keyed dedup landed + the package
  rebuild (V-16's src-vs-dist law).
- **B-2 — keystroke loss under output backpressure** (2026-11-04,
  harness-first with a product-robustness edge). V-9's law: a TUI whose
  output writes block (undrained PTY) drops typed input. A real user with
  a paused terminal (flow control / scroll lock) could lose keystrokes
  the same way. Fix ticket A2H-2 (harness: pump-while-typing in
  `pty_common`; product: investigate input preservation while writes
  block). **FIXED 2026-11-04 (A2H-2)**: the harness side landed
  (`_send_drained` on send/key/type_prompt — the standing lanes re-ran
  green on the fixed harness); the product-side investigation RECEIPTED
  A FAVORABLE FINDING — on v0.0.56, input preservation holds across the
  tested volume ladder (probes land at 3s/15s/45s undrained windows,
  49–146KB accumulated, the stream completes, no deadlock; /abort typed
  without draining executes 2/2). The morning's V-9 receipts stand — the
  failure mode is condition-dependent, not unconditional; no product
  defect reproducible tonight, no product change made.
- **B-3 — the every-transition persistence rule was receipted but never wired** (2026-11-04, O-4's first live battery run; genuine product defect). `renderBoot` received `persistAll` and passed it onward to the grade-button closures — but never CALLED it: reveal/grade/skip/navigate/restart transitions rerendered without persisting, so a killed-mid-review session lost its phase and the graded card's sm2 state. Evidence: the crash-resume lane's first live run — a mid-reveal reload rendered the FRONT (the "revealed" phase lost). **FIXED 2026-11-04 (O-4)**: `persistAll()` now runs in renderBoot's ready path — every ready render rewrites both storage lanes, exactly as O-3's D2 receipt claimed (V-23).
- **B-4 — the overlays painted only on the review-screen path** (2026-11-04, the flow lane's step-2 red). The palette/create-form render tails lived AFTER the empty-state early returns — on a fresh boot ("No decks yet"), Ctrl+K set state and rerendered, but renderBoot returned early and the overlay never painted (`#ostinato-palette` absent — the K-1 create flow begins from the empty state by design). **FIXED 2026-11-04 (O-4)**: the early returns became if/else-if/else; then B-10's durable cure moved the overlay paint to the open-paths entirely.
- **B-5 — `el()` dropped `aria-*` attributes on the floor** (2026-11-04, the axe palette-open scan). The DOM helper's property loop assigned `e["aria-label"] = …` — a junk expando (the reflected property is `ariaLabel`); the ATTRIBUTE never landed. The palette input (no placeholder) was nameless under axe; the search input survived only via its placeholder; the grade row's `aria-label` and every `aria-selected`/`aria-current`/`aria-controls` prop were equally silent. **FIXED 2026-11-04 (O-4)**: the attribute lane now routes `aria-*` (the law: hyphenated ARIA names are not DOM properties).
- **B-6 — the import restored a stale done session over just-imported cards** (2026-11-04, the flow lane's step-7 diagnosis). `startSession(next, now, app.boot.session)` with a done session kept the done phase — "All cards reviewed" for data never reviewed in any session. **FIXED 2026-11-04 (O-4)**: the D7 session-restart law applied to import — `startSession(next, now, null)`.
- **B-7 — the export's synchronous blob-URL revoke cancelled the download** (2026-11-04, the flow lane's 30 s `waitForEvent("download")` timeout). `URL.revokeObjectURL(a.href)` ran immediately after `a.click()` on a DETACHED anchor — the revoke killed the not-yet-started download; the detached click never dispatched. **FIXED 2026-11-04 (O-4)**: attach → click → remove → revoke LATE (30 s); a live probe receipted `FIRED:ostinato-export.json`.
- **B-8 — the palette listbox lacked an accessible name and keyboard-scroll** (2026-11-04, axe `aria-input-field-name` + `scrollable-region-focusable`, both serious, on the same `ul[role=listbox]`). A live DOM probe proved the palette INPUT's label had landed (B-5's fix works) — the flagged element was the LIST. **FIXED 2026-11-04 (O-4)**: `aria-label="Commands"` + `tabindex="0"` (the max-height/overflow list is keyboard-scrollable).
- **B-9 — the disabled command rows were dimmed by opacity below contrast** (2026-11-04, axe `color-contrast` on the four disabled grade-* labels). `.ostinato-disabled { opacity: 0.55 }` blended the muted color toward the background below 4.5:1. **FIXED 2026-11-04 (O-4)**: dimmed by COLOR (the muted token at full opacity, ≥4.5:1 in both schemes) — never by opacity.
- **B-10 — the overlays painted through full-root rerenders, destroying the focus-return target** (2026-11-04, the Esc lane's "inactive"). `closePalette` focused `app.invokingEl` — a reference into a DOM the intervening `rerender()` had torn down (`root.replaceChildren()`). **FIXED 2026-11-04 (O-4)**: the overlays own their paint — `renderPalette`/`renderCreateForm` called directly from the open-paths, never via renderBoot (which also stops resetting the create form's fields mid-typing); the arrow-branch repaint came free (V-21).
- **B-11 — the review grid's implicit column was held open by the search input's intrinsic width** (2026-11-04, the resize lane's 19 px overflow at 375). A computed-style probe pinned the track at 377.5 px (the size-20 input's min-content; grid items' `min-width: auto` never shrinks below it). **FIXED 2026-11-04 (O-4)**: `.ostinato-review > * { min-width: 0 }`.

## Ticket queue

| Ticket | Scope | Verifier | Status |
|---|---|---|---|
| O-1 | Calibration canaries C1–C3 (baseline turns-to-done/cost) + the app skeleton at `apps/ostinato/` (zero-dep PWA scaffold + AGENTS.md draft) | canary receipts + both unit lanes boot | **LANDED 2026-11-04** — canaries C1 3/3 · C2 2/3 (B cap-overflow receipted) · C3 3/3; skeleton 13 files, Lane A 5/5, Lane B 5/5, receipt tree-verified |
| O-2 | Domain core: deck/card model, SM-2 scheduler, import/export + Lane A/B tests | both unit lanes + app tsc + invariants pins | **LANDED 2026-11-04** — 27/27 both lanes (unit family 2152/0 = 2130 + 22); receipt tree-verified 10/10 FILES, no extras; storage [U] DECIDED (localStorage + atomic-writes, D1); SM-2 = Wozniak 1990 pinned (D2); V-12/V-13/V-14 receipted; 7 dispatches (4 on the original session + 3 fresh-context finalization, one hijacked chunk operator-priced) |
| O-3 | Review runner + keyboard surface (palette, search, j/k, selection, states) | unit lanes + keyboard-focused e2e stub | **LANDED 2026-11-04** — the review stack at src/ui/ (runner-core, queue-nav, palette, app wiring); app suite 72/0 (+45), unit family 2197/0; the e2e lane LIVE: **3/3 keyboard-only in 1.5 s** after the operator's execution chain caught 5 defects (serve.mjs js→ts swap, the main() bootstrap, the palette render gap, the focus-before-attach order, the spec's init-script closure bug — Playwright serializes init functions, module constants ride as arguments); receipt tree-verified; 17 dispatches across two sessions (V-13 applied) |
| O-4 | Hardening e2e battery: zero-mouse flow, axe both schemes, offline, crash-resume, resize | the e2e battery green | **LANDED 2026-11-04** — the battery **12/12 in 7.2 s** across five specs: K-1 flow (create → review → export → import, keyboard-only, the download + filechooser via `waitForEvent`), A-1 axe `wcag2a`/`wcag2aa` both schemes × empty/content/palette-open (six zero-violation scans) + the tab-order + Esc focus-return pins, O-1 offline (SW-controlled first load, the 17-entry install precache, offline reload + the loop completing offline, the offline fallback page), R-1 crash-resume (reveal-phase restore + queue recompute + cursor advance, honestly asserted) + resize (375/1280, overflow discipline, two-pane geometry); the app-side work the battery demanded: the 454-line token stylesheet (light/dark, focus rings, two-pane grid, reduced-motion), the SW registration (never landed despite index.html's claim), the install precache, the create surface (17-command palette + the modal form), `app.notice`, `palette.test.ts` (closing O-3's never-landed count pin); **four live rounds harvested NINE defects (B-3..B-11)**, each operator-root-caused (DOM/computed-style probes, a localStorage instrumentation spec, a domain reproduction) and fixed via byte-exact briefs; 13 dispatches across five sessions; app suite 93/0 (+21), unit family 2218/0; receipt `.unown/receipts/o4.md` COMPLETE |
| O-5 | PWA + capture lane + root wiring + CI job (the Coda C5 pattern) | CI coda-style job + capture receipts | **LANDED 2026-11-04** — `apps/ostinato/scripts/` (new dir): `verify-precache.ts` (the Coda C3 derivation proof — the three-way disk ladder + three honesty pins; first run caught the 17→18 count drift, the three spec comments fixed comment-only, `18/0 PASS`) + `capture-usage.mjs` (the Coda T3 lane — the KEYBOARD-ONLY law extended from the flow spec, four stills 01-fresh-boot/02-palette/03-review/04-revealed + PROVENANCE at `public/landing/ostinato/`); root wiring: `ostinato:dev/test/e2e` in package.json + the **`ostinato` CI job** (the coda job's structure — SHA pins byte-copied, frozen-lockfile + zero-dep assert, Lane A/B 93/93, Chromium, the self-skip-guarded battery, artifacts — PLUS the `Precache derivation proof` step, an improvement over the coda job); the operator's first live capture run **rc 0, ZERO defects** (the interaction contract byte-copied from the proven flow spec — V-17 applied to a greenfield lane); gates: e2e battery **12/12 in 7.4 s** regression-free, app lanes 93/0 both forms, unit family 2218/0/157, tsc 0, lint 0/143, check:changelog 56→55 stops/534; 3 dispatches on one pinned session (8 + 8 capped + 6 finalization); V-24 receipted (the lineage's re-clone recovery); receipt `.unown/receipts/o5.md` COMPLETE, tree-verified 10/10 |
| O-6 | Closeout: landing band, usage captures, blog post, README/DOX, graduation | full gate set + check:blog | queued |
| A2H-1 | Fix B-1: the `/abort` notice must survive the first-flight settle tip (status-line collision guard — notify dedup keyed by source, tip deferral, or notice-as-message-note) | the abort PTY lane under a fresh isolated UNOWN_HOME, 3/3 runs with the notify visible | **LANDED 2026-11-04 (v0.0.56)** — showStatus dedup keyed on identical text (refresh-only); BEFORE receipt 2/3 defect → AFTER **3/3 both lines persist**; standing lanes footer 9/9 · picker PASS · resume-hint ALL HELD (zero regressions); unit: status 34/34 · self-learning 5561/0 · root 2152/0; the 17 vitest package failures verified PRE-EXISTING via stash; receipt tree-verified 5/5; 8 chunks (V-17's thrash receipted) |
| A2H-2 | Fix B-2: `pty_common.send/type_prompt` pump-while-typing (harness law V-9) + a product-side investigation of input preservation while output writes block | X/Y differential re-run: keystroke loss 0/4 without read-while-typing | **LANDED 2026-11-04** — `_send_drained` (reader-thread concurrent drain) on send/key/type_prompt; footer 9/9 · resume-hint ALL HELD · resume-picker PASS with the fixed harness; the investigation's finding: input preservation HOLDS on v0.0.56 across the volume ladder (3/15/45s undrained, 49–146KB; /abort-no-drain 2/2 executes) — the law is condition-dependent, the fix is determinism insurance; receipt tree-verified; 2 chunks (the single-action receipt brief landed in 17 s) |
| A2H-3 | Anchor the `test:unit` filter (V-18: `bun test src` substring-matches the engine's sandbox `workspace/src/*.test.mjs` fixtures — the repo lane executed a learning-job fixture and red) | `bun run test:unit` stays 2152/0 with a fresh `mint-assert-rejects-*` sandbox present | **LANDED 2026-11-04** — `bun test src --path-ignore-patterns=data/self-learning/**` (bun 1.4.3 flag, Windows-safe, one line); A2 reproduced the pollution (2153/1 fail with its fixture), fixed, verified 2152/0/154 with the fixture present; the OPERATOR re-verified with its own fixture (2152/0/154, rc 0); CI checked — the workflows run literal `bun test src` on runners with no data trees, no workflow edit needed; 1 chunk (under cap, receipt-first); receipt tree-verified |

Pre-ticket PTY audit (H-3): re-run the standing `scripts/tui-capture/`
verify lanes on this lineage before O-1 dispatch.

## O-1 dispatch brief

The prompt-economy header the directive mandates, pre-baked for the first
dispatch (fresh session per ticket; incremental receipt from chunk 1):

- **ALLOWED_INPUTS**: `docs/ostinato-prd.md`,
  `benchmarks/ostinato/README.md`, `apps/ostinato/` (to create), `/tmp`
  scratch, the repo's own docs under `docs/` read-only.
- **FORBIDDEN_INPUTS**: `AGENTS.md` at any depth (draft as
  `apps/ostinato/AGENTS.draft.md` — the instruction-set gate is final);
  `.unown/memory/**`; `pi-repo/packages/self-learning/src/**` (app code
  only this round); `src/**`; `content/**`; `benchmarks/**` except
  reading its own README.
- **OUTPUT_ARTIFACT**: the `apps/ostinato/` skeleton (index.html, sw.js
  stub, manifest, `src/domain/` with the model stubs, `package.json` with
  NO dependency fields, `serve.mjs`, Lane A test boot) +
  `.unown/receipts/o1.md` with `STATUS`, `FILES` (tree-verified at the
  operator gate), `GATES`, `DECISIONS`.
- **HANDOFF_SCHEMA**: receipt markdown; STATUS ∈ COMPLETE | PARTIAL |
  BLOCKED; every FILE claim verified against the tree by the operator.
- **EFFORT_BUDGET**: ≤4 chunks × ≤8 turns (`--max-turns 8`).
- **NON-OVERLAP**: no landing surfaces, no CI wiring (O-5), no e2e (O-4),
  no scheduling logic (O-2 — stubs only).

## Gate run

The O-4 push battery (eleventh lineage, run on the tree before the
push — the hints-round lesson honored, unit suite after the rail
regen):

- `bun run typecheck` — **rc 0** (root tsc covers the app + the e2e
  specs — `e2e/**/*.ts` rides the root include).
- `bun run lint` — **rc 0**, 0 errors / 143 warnings (the vendored
  baseline, unchanged).
- `bun run check:docs` — **rc 0**.
- `bun run check:changelog` — **rc 0**, 55 stops / 533 entries (the
  O-4 entry is the 533rd; Unreleased undated, v0.0.56 latest dated).
- `bun run check:blog` — **rc 0**, 45 posts / 112 tags.
- `bun run check:benchmarks` — **rc 0**, 6 tracks, 6 resolved.
- `bun run check:claims` — **rc 0**, 62 page literals resolve.
- `bun run test:unit` — **rc 0, 2218 pass / 0 fail** across 157 files
  (the 2197 family + 21 new palette pins).
- The e2e battery — **12 pass / 0 fail in 7.2 s** (`bunx playwright
  test --config=playwright.ostinato.config.ts`; chromium-1248): the
  four axe scans, the tab-order + Esc pins, the K-1 flow, both
  offline lanes, crash-resume, resize, and the O-3 trio.
- App lanes: `cd apps/ostinato && bun test` **93/0**; `bun test
  apps/ostinato` **93/0** — the same 93 in both forms.

The O-2 push battery (tenth lineage, run on the tree before the push —
the hints-round lesson honored, unit suite after the rail regen):

- `bun run typecheck` — **rc 0**.
- `bun run lint` — **rc 0**, 0 errors / 143 warnings (the vendored 142
  baseline + 1 from the app's new domain files; warnings never block,
  the count receipted honestly).
- `bun run check:docs` — **rc 0**.
- `bun run check:changelog` — **rc 0**, rail matches (54 stops / 528
  entries after the O-2 entry, 53 dated).
- `bun run check:blog` — **rc 0**, 45 posts / 112 tags.
- `bun run check:benchmarks` — **rc 0**, 6 tracks, 6 resolved.
- `bun run check:claims` — **rc 0**, 62 page literals resolve.
- `bun run test:unit` — **rc 0, 2152 pass / 0 fail** (the O-1 family
  baseline 2130 + the O-2 domain core's 22 new tests).
- App lanes: `cd apps/ostinato && bun test` **27/0**; `bun test
  apps/ostinato` **27/0** — the same 27 in both forms (the masked-lane
  pair the Coda pattern pins).
- CI on the O-1 push (`03541d34`): **state success** (Vercel ✓) —
  checked via the API before this push.

The round-opening commit's own gate battery, run on this tree before the
push (the hints-round lesson honored — the unit suite ran AFTER the rail
regen):

- Rail regen: `node scripts/landing_changelog.mjs` — **rc 0**, 54 stops /
  526 entries (this round's entry is the 526th; Unreleased undated,
  v0.0.55 the latest dated).
- `bun run typecheck` — **rc 0** (tsc --noEmit, clean).
- `bun run lint` — **rc 0**, 0 errors / 142 warnings (the vendored
  baseline, unchanged).
- `bun run check:docs` — **rc 0**, 147 docs ok — after one live catch:
  the round log's three parenthetical headings hashed to unguessable
  anchors (exactly the docs/AGENTS.md anchor warning); headings
  simplified, re-run green (see V-5).
- `bun run check:changelog` — **rc 0**, rail matches CHANGELOG.md: 54
  stops, 526 entries, 53 dated.
- `bun run check:blog` — **rc 0**, 45 posts / 112 tags.
- `bun run check:benchmarks` — **rc 0**, 6 tracks, 6 resolved.
- `bun run check:claims` — **rc 0**, 9 jobs; 62 page literals resolve in
  the engine sources.
- `bun run test:unit` — **rc 0, 2125 pass / 0 fail**, 15792 expect()
  calls across 150 files, 158.68 s — the family baseline exactly.

A red gate blocks the push; none red.

## Resume instructions

1. `export PATH=/home/z/my-project/.tools/bun-linux-x64:$PATH`
2. `cd /home/z/my-project/Unown` — verify `git log --oneline -1` is the
   round-opening commit; `git fetch origin --tags --prune` + ff-only pull
   if a parallel lineage moved `main`.
3. Stack: `bun run agent:start` (bridge :3031 + engine :3030; mortal
   across recycles); health: `curl -s localhost:3031/health`.
4. Doctor: `bun bin/unown doctor` — expect "ready to chat" (2 ⚠ honest).
5. Dispatch: `python3 /home/z/my-project/scripts/dispatch-file.py <name>
   <cwd> <prompt.md> [--session <id>]` then poll
   `/home/z/my-project/tickets/logs/<name>.exit`. **Pin the session on
   every continuation** (`--session <id>` — V-12's law: bare `-c`
   attaches to whatever session is "latest" in the cwd, and the smoke
   canary's own session can win that race).
6. Pre-dispatch: run the H-1 smoke canary + the H-3 PTY audit lanes.
7. This log owns the round state; `A2_GROUND_TRUTH.md` owns capability
   truth; [SESSION.md](SESSION.md) owns the index.

## Related pages

- [The Ostinato PRD](ostinato-prd.md)
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The augmentation registry](a1-augmentation-registry.md)
- [The benchmark suite](../benchmarks/ostinato/README.md)
- [Coda](coda.md) — the architecture precedent
- [SESSION.md](SESSION.md) — the running index
