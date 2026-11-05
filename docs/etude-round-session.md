# The Etude round — session log

> **Status: OPEN 2026-11-05 · E-0 approved then PARKED 2026-11-06** —
> opened by the **seventeenth lineage** under a FRESH A1 directive (the
> standing shape: STABILISE A2 × HARDEN A2 × PROVE IT); a parallel
> lineage passed the E-0 gate on 2026-11-06 (Tempo approved with the five
> market-research amendments) — and the same day the **Rondo round's §0.9
> selection (Chaconne over Tempo)** landed on `main` first and superseded
> it per the ledger-arbiter law (the dual-incarnation event, receipted
> below). The round is PARKED with its queue frozen; its receipts (the
> H-9 promotion, the learning baseline, the market research, the
> fresh-install truth law) all stand. The prior Reprise round stays
> PARKED with its queue intact — see [SESSION.md](SESSION.md).

One-line purpose: the Etude round's resumable checkpoint log — mission,
operator decisions, environment checkpoint, validation log, ticket queue,
dispatch briefs, gate receipts, resume instructions.

**Mini-TOC**

- [Mission](#mission)
- [Operator decisions](#operator-decisions)
- [Environment checkpoint](#environment-checkpoint)
- [Validation log](#validation-log)
- [Bug register](#bug-register)
- [Ticket queue](#ticket-queue)
- [First keyboard and TUI audit brief](#first-keyboard-and-tui-audit-brief)
- [First bug-hunt brief](#first-bug-hunt-brief)
- [Resume instructions](#resume-instructions)
- [Related pages](#related-pages)

## Mission

A new A1 engagement opened 2026-11-05 with the standing directive: one
ambitious real-world project serving simultaneously as (a) production
build, (b) stress test of A2's reliability, (c) validation of A2's learning
architecture, (d) benchmark programme measuring whether A2 became more
reliable, predictable, and easier to operate while doing meaningful work.
The app is the vehicle; operational quality is the cargo.

The directive's APP placeholder arrived unfilled (`[APP_NAME + ONE-PARAGRAPH
VISION + REPO PATH]`) — the PRD therefore PROPOSES the vehicle for approval:
**Tempo**, a keyboard-first, offline-first time-tracking and lightweight
invoicing PWA at `apps/tempo/` (the repo's third user product, after Coda
and Ostinato). See [the PRD](etude-prd.md).

Phase 0 (this lineage's scope): §0 Recon refresh → PRD outline →
Reliability Coverage Matrix refresh → baseline benchmark suite → calibration
canaries → the augmentation registry re-opened empty for this round → the
first bug-hunt brief → the first keyboard/TUI audit brief (EXECUTED — it is
this round's opening harvest) → the first augmentation hypothesis (H-9, for
approval).

## Operator decisions

Dated rulings opening the round (2026-11-05):

- **Round name: Etude** — a study piece: the round's centre of gravity is
  the benchmark programme and reliability evidence, exactly what an etude
  is (a musical study built through disciplined repetition). The proposed
  app takes the name **Tempo** (both names verified unclaimed in-repo).
- **New task, not a resume.** The directive says a new engagement; the
  Reprise round is PARKED (not closed — its R-2..R-5 queue and freeze law
  stand recorded in its log). Nothing standing was deleted or rewritten;
  inherited artifacts (registry rows, ground truth, matrix) are refreshed
  in place per the anti-rot law.
- **Fresh-install truth is the round's first law** (inherited from H-8,
  hardened by this round's V-2/V-3 findings): every PTY lane claim must
  hold on the FIRST boot of a wiped home, not only on pre-warmed homes.
- **Version-bump policy (inherited)**: Unown's `package.json` bumps only
  when Unown itself changes; docs/benchmark/app-round commits ride
  `## [Unreleased]`. A version bump lands with the first Unown-code
  enhancement this round ships.
- **Queue discipline**: the Reprise carry-overs (R-2..R-5), the #30
  live-hang capture, and the standing SESSION.md items stay queued; this
  round opens with the two harness tickets the Phase-0 audit harvested
  (A2H-5, A2H-6) and forms the app queue at PRD approval.
- **E-0 APPROVED (2026-11-06, the eighteenth lineage's operator gate).**
  Tempo as proposed, with the five amendments from [the round's market
  research](etude-round-market-research.md) folded into [the
  PRD](etude-prd.md): the platform-scope honesty rewording (a support
  policy, never a platform claim), the storage budget + IndexedDB
  migration seam, the invoice invariants pinned to the EU/UK/US legal
  floor, the shortcut sheet promoted to P0, the portfolio metrics. The
  research base validated the wedge as unoccupied — every load-bearing
  claim source-tagged `[V]/[C]/[U]` — before the gate; the approval is
  evidence-backed.
- **H-9 PROMOTED (2026-11-06, the same operator gate).** All five registry
  gate requirements met (the cold-home 0/2 → 2/2 measurable improvement;
  regression-detection neutral-or-better; the V-7 variance root-caused
  environment-class; $0 metered; retention by construction) — the Etude
  round's first promotion, the registry's fourth ([the
  registry](a1-augmentation-registry.md)).
- **Phase-1 queue discipline (2026-11-06)**: the app queue E-1..E-6 forms
  at approval (below); fresh sessions per ticket, ≤8-turn chunks,
  byte-exact continuation briefs (the standing economics); the C1–C3
  canaries arm before every dispatch; the push-before-dispatch law holds
  (this decision package lands on `main` before E-1 dispatches).

## Environment checkpoint

The seventeenth lineage (this round's opening lineage), 2026-11-05:

- Fresh clone @ `f3f0176e` = `origin/main` (the sixteenth lineage's
  bring-up commit, one docs-only commit past A2H-4's `0c57548c`); 54 tags,
  980 commits, no shallow-clone repair needed this time.
- bun **1.4.3** npm-global (`/home/z/.npm-global/bin/bun`) — the ≥1.4
  floor honored (install 7/7). `fd` 10.2.0 re-installed to the same bin
  dir and `chromium_headless_shell-1248` via `bunx playwright install
  chromium` — both the known recycle-reclamation taxes (V-1), honored from
  the bring-up checklist.
- Install **7/7** (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun
  scripts/install.ts`), `.env` with the Agnes lane IN PLACE
  (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`,
  `BRIDGE_MODEL=agnes-3.0-flash`, `BRIDGE_UPSTREAM_KEY` set,
  `UNOWN_HOME=/home/z/my-project/unown-home`), stack up via the rebuilt
  operator daemonizer (`.a1/scripts/dispatch-bg.py`, PPID-1): bridge
  `:3031` upstream **200**, 6 agnes models live, default `agnes-3.0-flash`;
  engine `:3030` ready @ v0.0.56/`f3f0176e`, bearer token active, 9 router
  jobs scheduled (fresh DB — the known recycle limit).
- Doctor: **"unown is ready to chat"**, 19 ✓ / 2 ⚠ (model-spec — self-heals
  after first session; LSP — the container's honest pair), instruction-set
  audit clean.
- Headless smoke (the C1 canary): `UNOWN_OK`, exit 0, `subtype:"success"`,
  1 turn, 2.5 s, 19.5k in / 4 out tokens, `cost_usd: 0`.
- Pre-ticket baseline ALL GREEN at `f3f0176e`: tsc 0 · lint 0 errors/143
  warnings · unit **2235/0** across 160 files (160.7 s) · check:docs ok ·
  rail **55 stops/539 entries/54 dated** · blog **46 posts/116 tags** ·
  benchmarks 6/6 · claims **62/62** · the ostinato e2e battery **14/14 in
  7.6 s**.
- The H-3 PTY audit ritual (fresh-side): **footer-quiet 9/9**;
  **resume-hint and resume-picker BOTH harvest fresh-home cold-boot
  defects** (V-2, V-3 below) then PASS on warm homes — the audit paid for
  itself before the first dispatch, again.

The eighteenth lineage (2026-11-06 — the E-0 / Phase-1-opening lineage):

- Fresh clone @ `18e4a98a` = `origin/main` (A2H-6's close, one commit past
  A2H-5); the PAT rewired through a file-reading git credential helper
  (never in the remote URL, never in the tree).
- bun **1.4.3** re-pinned via the GitHub-release binary into
  `/home/z/my-project/.npm-global/bin` (the npm lane timed out at 300 s —
  V-8; the direct CDN download cured it in under a minute). `fd` 10.2.0
  the same way; the PTY venv (pyte/pexpect/pillow) at
  `/home/z/my-project/.a1-venv`; playwright browsers pinned under
  `/home/z/my-project/.playwright` (`PLAYWRIGHT_BROWSERS_PATH`) — the V-1
  recycle taxes cured structurally by moving the toolchain onto the
  persistent `my-project/` tree.
- Install **7/7** (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun
  scripts/install.ts`), `.env` with the Agnes lane IN PLACE (upstream URL,
  key set, `UNOWN_HOME=/home/z/my-project/unown-home`), stack up via the
  rebuilt operator daemonizer (`.a1/scripts/dispatch-bg.py`, PPID-1):
  bridge `:3031` upstream **200**, 6 agnes models, default
  `agnes-3.0-flash`; engine `:3030` UP @ v0.0.56/`18e4a98a`, 9 router jobs
  scheduled (fresh DB — the known recycle limit), breaker closed.
- Operator home provisioned (`unown setup --provider bridge`); the
  canaries: **C1 `UNOWN_OK`** exit 0, `subtype:"success"`, 1 turn, 2.0 s,
  7.2k in / 4 out tokens, cost 0 · **C2 doctor "ready to chat" 19 ✓ / 1 ⚠**
  (LSP — the container's honest pair; the model-spec pair green on first
  verify this lineage, no self-heal needed) · **C3 engine UP**, version
  SHA = the checkout HEAD `18e4a98a`.
- The H-3 PTY ritual on this lineage (fresh-install truth, pre-E-1):
  **resume-hint ALL HELD** (wiped home) · **resume-picker PASS** (wiped
  home, the first-run gate answered by the H-9 helper) · **footer-quiet
  9/9** — zero operator cures; the H-9 promotion's retention extends to a
  fresh lineage.
- The learning-layer baseline captured pre-E-1 (the Phase-1 opening law):
  the engine snapshot at
  [snapshots/etude-baseline-2026-11-06.json](../benchmarks/etude-round/snapshots/etude-baseline-2026-11-06.json)
  (drained; 6 tasks passing; terminal memory v2, 107 bullets) + the
  standing receipts pinned (ops-accuracy 2026-10-26, quality-axes, the
  selfimprove v3-notes).

## Validation log

| ID | Event (dated) | Class | Disposition |
|---|---|---|---|
| V-1 | Sandbox recycle reclaimed `fd` and the playwright chromium-1248 build (2026-11-05, bring-up) | infra-flake (known class) | Cured from the bring-up checklist: fd 10.2.0 → npm-global bin; `bunx playwright install chromium`. NOT the root cause of the resume-lane failures (V-2/V-3 are) — recorded so the next lineage does not re-diagnose |
| V-2 | `verify_resume_hint.py` failed `wait_ready` (PaneTimeout, 120 s) on a wiped VERIFY_HOME; the provision step `unown setup --provider bridge` ran with the ambient `UNOWN_HOME` leaked into its subprocess env (`env={**os.environ, **env_extra()}`) and provisioned the OPERATOR's home instead of the isolated one; the isolated home booted cold into the pre-TUI first-run gate (2026-11-05) | genuine-gap (harness) | **A2H-5 opened**: apply the H-8 subprocess env filter (drop `UNOWN_HOME`) to the lane's setup call. Root-caused with a controlled experiment: a correctly-targeted `setup` writes `settings.json`, which flips `created:false` and suppresses the gate (live-verified on a scratch home). Receipt: [V-2 repro log](../benchmarks/etude-round/validation-log.md) |
| V-3 | `verify_resume_picker.py` failed `wait_ready` (PaneTimeout, 90 s) on a wiped VERIFY_HOME — the lane provisions nothing, and the FIRST boot of any fresh home deterministically blocks on the pre-TUI first-run gate (`cli.ts:3595-3618`; `created: models.fresh \|\| !settingsExisted` at `term.ts:276`). Cold-home FAIL ×2 → warm-home PASS ×2 (2026-11-05) | genuine-gap (harness + receipt correction) | **A2H-6 opened**: the lane must either provision its VERIFY_HOME via an env-filtered `setup` or — the better coverage — answer the gate pane-aware (the helper proposed as H-9), so the lane exercises the product's real first-run flow. The H-8 receipt's "fresh install 3/3 PASS" is corrected: it holds only for pre-warmed homes. Receipt: [V-3 repro matrix](../benchmarks/etude-round/validation-log.md) |
| V-4 | The full pre-ticket baseline re-run (2026-11-05): every gate green on the fresh tree — the numbers in the environment checkpoint above | receipt | Filed as the Etude round's baseline snapshot ([the round's benchmark README](../benchmarks/etude-round/README.md)); the Phase-1 holdout forms against it |
| V-5 | A PARALLEL lineage closed Reprise R-2 (`782f090b`, deck-level review settings, 9 A2 dispatches, battery → 17/17) mid-Etude-Phase-0; the push rejected, the rebase reconciled (memory render taken theirs — the newer dream; SESSION.md merged semantically: R-2 CLOSED folded into the parked section) | upstream-change (the known parallel-lineage class) | Reconciled 2026-11-05: rebase clean after 3 semantic resolutions; gates re-verified green post-rebase; the battery figure drift (14/14 → 17/17) noted wherever the `f3f0176e` baseline is quoted |
| V-6 | The A2H-5 dispatch's chunk 1 hit the `--max-turns 8` cap mid-work (`capped:true`, `error_during_execution` — no answer produced); chunk 2 resumed the SAME session byte-exact and closed in 5 turns (2026-11-05) | receipt (the standing chunking economics) | The pattern works as designed: capped chunks are errors, never silent; the continuation brief carries the state; the round's first DRIVE ticket closed in exactly its ≤2-chunk budget with 0 operator unblocks |
| V-7 | footer-quiet returned **7/9** mid-A2H-6 (the A2 two-rows-at-rest + A3 ambient-silence checks red) — root-caused by A2 via git-stash isolation (identical failures on the pre-helper tree) and confirmed by the operator: the pane showed `memory: up · old build` — the ENGINE-BUILD-DRIFT class (the checkout had moved 2 commits past the running engine's SHA, so the footer's engine chip broke the ambient-silence assumptions); `unown engine restart` re-aligned onto `ae125402` → **9/9 re-verified** (2026-11-05) | infra-flake (the reprise round's V-6 class, reconfirmed) | The standing cure holds (restart-align at every checkout move that crosses a dispatch); the variance is receipted as environment-class, NOT a helper regression — the H-9 gate's regression bar is met |
| V-8 | The bun 1.4.3 re-pin via `npm install -g` timed out at 300 s on the eighteenth lineage's bring-up (registry slowness — a 17 MB partial cache, nothing installed; 2026-11-06) | infra-flake (the toolchain-pin class) | Cured by the direct GitHub-release binary (`bun-v1.4.3/bun-linux-x64.zip` → `/home/z/my-project/.npm-global/bin/bun`, ~40 s); `fd` 10.2.0 the same way; the ≥1.4 floor honored. Logged so the next lineage goes straight to the CDN lane when npm stalls |
| V-9 | The eighteenth lineage's full bring-up + checkpoint verification (2026-11-06): install 7/7, stack up, C1/C2/C3 green, engine SHA = HEAD `18e4a98a`, the learning baseline captured | receipt | The Phase-1-opening environment receipt — the E-0 decision package (the PRD amendments + the H-9 promotion + the E-1..E-6 queue) lands on this state |
| V-10 | The E-0 push was REJECTED — a PARALLEL lineage (the third dual-incarnation event of the programme, after Coda-C4 and SM-1) had opened the **Rondo round** on `main` (`77dfb6f6`) mid-session: a fresh §0.9 scored selection approving **Chaconne** (a keyboard-first browser-recipe runner, `apps/chaconne/`) over the Tempo proposal (scored 1×1×2, comfort-zone) — both lineages had also promoted H-9 independently (the convergent decision) (2026-11-06) | upstream-change (the known parallel-lineage class) | Reconciled 2026-11-06 per the ledger-arbiter law: the Rondo landing stands (it reached `main` first); this round PARKED with the E-0 approval, the amended PRD, the frozen E-1..E-6 queue and all receipts standing as its record; the rebase resolved semantically (memory render taken theirs; SESSION/README/AGENTS/registry merged with the dual event receipted; the H-9 promotion row records both decisions); the live queue is the Rondo round's (A2H-9 → C-0 → C-1..C-11) |

## Bug register

User/operator-visible findings of this round (the B register continues the
lineage numbering — B-1..B-12 live in the Ostinato and Reprise logs):

- **B-13 — the resume-hint lane's provision step leaks ambient
  `UNOWN_HOME`** (`scripts/tui-capture/verify_resume_hint.py`, the setup
  subprocess). Failure: every run on a wiped home provisions the wrong
  home and then PaneTimeouts at the TUI header. Root cause: the H-8 env
  filter was applied to the picker lane's subprocesses but not to this
  lane's setup call. **FIXED 2026-11-05 (A2H-5, CLOSED)** — the H-8 filter
  applied to the setup subprocess; wiped-home ×3 + the operator's
  independent rerun all exit 0. Found 2026-11-05 (V-2).
- **B-14 — the resume-picker lane cannot pass a genuinely fresh home's
  first boot** (`scripts/tui-capture/verify_resume_picker.py`). Failure:
  the pre-TUI first-run gate blocks the header on any home without
  `settings.json`, deterministically. Root cause: the lane provisions
  nothing and the harness has no gate awareness. **FIXED 2026-11-05
  (A2H-6, CLOSED)** — the pane-aware `answer_first_run_gate` helper in
  `pty_common.py` + the picker's two call sites; wiped-home ×3 + the
  operator's independent rerun all exit 0 with the gate answered. Found
  2026-11-05 (V-3).

## Ticket queue

| Ticket | Scope | Verifier (external, named) | State |
|---|---|---|---|
| A2H-5 | The resume-hint lane's provision env filter: drop `UNOWN_HOME` from the setup subprocess env in `verify_resume_hint.py` (the H-8 pattern already in the picker lane), so the isolated home is provisioned and the lane passes a WIPED home on the first boot | The lane on a wiped VERIFY_HOME ×3 consecutive (exit 0 each); the warm-home runs stay green; `rg -l "my-project/Unown" scripts/tui-capture/` still empty | **CLOSED 2026-11-05** — two A2 chunks (session `01a1aa60…`: chunk 1 capped at 8 turns mid-work after landing the 5+/1- env filter, chunk 2 resumed byte-exact and finished in 5 turns — the standing economics, 0 operator unblocks); A2's verifies 3/3 exit 0 on wiped homes with ambient `UNOWN_HOME` deliberately exported; the operator gate re-verified independently (fresh wiped-home rerun exit 0, ALL ASSERTIONS HELD, the ambient home's `model-specs.json` mtime byte-identical); receipt [a2h5.md](../benchmarks/etude-round/receipts/a2h5.md) tree-verified (one file, 5+/1-) |
| A2H-6 | The picker lane's fresh-boot truth: provision VERIFY_HOME via an env-filtered `setup --provider bridge` (A2H-5's pattern) OR add the pane-aware first-run-gate helper to `pty_common.py` (send `n` + Enter when the gate text is on the pane — the H-9 candidate; preferred: it exercises the product's real first-run flow) | The lane on a wiped VERIFY_HOME ×3 consecutive; if the helper lands, footer-quiet and resume-hint re-run green with zero cures; unit/test lanes untouched | **CLOSED 2026-11-05** — the PREFERRED shape landed (three A2 chunks on session `01a1aa68…`: the `answer_first_run_gate` helper in `pty_common.py` +24, the picker's two call sites +3/-1; 0 operator unblocks); A2's verifies: picker ×3 exit 0 (wiped-first, the gate-answered log lines receipted), resume-hint wiped exit 0, py_compile OK; the footer-quiet 7/9 mid-ticket variance root-caused BY A2 via git-stash isolation (the two A-checks fail identically on the pre-helper tree — the engine-build-drift class, V-7) and cured by the operator's `engine restart` → **9/9 re-verified**; the operator gate re-verified independently (picker wiped-home exit 0 with the gate answered, footer 9/9 post-cure); receipt [a2h6.md](../benchmarks/etude-round/receipts/a2h6.md) tree-verified (two files, +27/-1) |
| E-0 | The PRD approval gate: the Tempo proposal (or the operator's substitute) approved — the app queue E-1..E-n forms at approval | The PRD's approval section signed in this log | **APPROVED 2026-11-06, then superseded** — Tempo with the five market-research amendments ([the research record](etude-round-market-research.md)); the PRD's approval section signed; H-9 promoted at the same operator gate; the learning baseline captured; the queue below formed — then the Rondo round's §0.9 selection landed first (V-10) and the round PARKED with this queue frozen as its record |
| E-1 | The Tempo skeleton + calibration canaries: `apps/tempo/` scaffolded to the house pattern — index.html, the PWA manifest + icon + offline page, sw.js, serve.mjs, the src seams (storage/domain/ui stubs to the Ostinato pattern), the bun-test lane, the tempo:* script rows, the boot e2e spec | `bun run tempo:test` green; `tempo:dev` serves (curl the port → the HTML); app tsc 0; the boot e2e passes; zero new dependencies; `git status` clean outside the named lanes | **QUEUED** (the dispatch brief below) |
| E-2 | The domain core: the model (clients → projects → entries, billable flags, rates, integer-cents money end to end), the storage adapter (atomic writes, corrupt-store recovery, the byte budget + `QuotaExceededError` handling + the IDB migration seam), the injected clock, the timer engine (start/stop/pause, idle detection, midnight rollover split, DST + backwards-clock handling), manual-entry validation (negative durations, overlap guard + override) | Lane A unit battery green incl. the PRD's named edge cases (DST spring/fall, the midnight split, the clock-jump-back, idle-during-legitimate-pause, the negative duration, the overlap + override); tsc 0 | QUEUED |
| E-3 | The review surface + keyboard model: day/week/month grouping, per-project subtotals, billed/unbilled filtering, the entry-edit modal, the palette (Ctrl+K, every P0 action reachable), the `?` shortcut sheet (palette-derived), arrow/RoR list navigation, selection semantics, the empty states | K-1 zero-mouse e2e (create client → project → run a timer → edit an entry); axe wcag2a/2aa zero violations both schemes; the tab-order pin; the Esc focus-return pin | QUEUED |
| E-4 | Invoicing: draft-from-unbilled per client, per-client gapless monotonic numbering (immutable post-issue, never user-editable), line items grouped by project, per-line + per-invoice rounding pinned, the VAT scaffolding (per-line rate, VAT-ID fields, the reverse-charge toggle), linked credit notes, markdown + HTML export, the print stylesheet, the jurisdiction checklist doc | The numbering/rounding/VAT unit pins (incl. void-then-reissue, the empty draft, the deleted-project-with-live-entries case); the invoice round-trip e2e; tsc 0 | QUEUED |
| E-5 | Import/export + the PWA tooling: canonical-JSON export (byte-stable), CSV export, JSON import with validation + a dry-run report, `verify-precache.ts` (the derivation proof), `capture-usage.mjs` (the landing capture lane), the CI tempo job, offline-complete | The precache proof green; the offline boot e2e (O-1); the import round-trip byte-stability pin; the CI tempo lane green | QUEUED |
| E-6 | The hardening battery + closeout: R-1 crash-resume (kill mid-invoice-draft), resize at 3 viewport classes, the full battery sweep, the landing gallery band + `docs/tempo.md` + the README row + the blog post, the matrix + ground-truth refresh, the round graduation | The full battery green (K-1, A-1, O-1, R-1, resize, the round-trip); all check:* gates; the docs/blog gates | QUEUED |
| (carry) | Reprise R-3..R-5 (R-2 closed by the parallel lineage, V-5), the #30 live-hang capture, the standing SESSION.md items | per their own logs | PARKED (candidates) |

**EFFORT_BUDGET**: A2H-5 ≤2 chunks · A2H-6 ≤4 chunks — each chunk ≤8 turns
(`--max-turns 8`), fresh session per ticket, byte-exact continuation briefs
on every resume (the standing economics). The app queue: E-1 ≤4 · E-2 ≤6 ·
E-3 ≤6 · E-4 ≤8 · E-5 ≤6 · E-6 ≤8 chunks, the same chunk laws.

### A2H-5 dispatch brief

```
ROLE: A2 executor — one scoped harness fix, no scope creep.
ALLOWED_INPUTS: scripts/tui-capture/verify_resume_hint.py (the setup
  subprocess env), scripts/tui-capture/pty_common.py (read-only context),
  the H-8 pattern in verify_resume_picker.py lines 104-124 (read-only).
FORBIDDEN_INPUTS: every other file; product code; DOX; the picker lane;
  any env-var semantics change beyond the subprocess filter.
OUTPUT_ARTIFACT: the edited lane script; a receipt at
  .unown/receipts/a2h5.md listing the diff and the three wiped-home runs
  (exit codes + the setup log lines).
HANDOFF_SCHEMA: plain text — what changed, the three run receipts.
EFFORT_BUDGET: <=2 chunks x <=8 turns.
NON-OVERLAP: A2H-6 owns the picker lane and any pty_common helper.
ACCEPTANCE: verify_resume_hint.py exits 0 on a WIPED VERIFY_HOME, three
  consecutive times; the provision log line shows the setup writing the
  ISOLATED home (not the operator's); no other lane touched.
```

### A2H-6 dispatch brief

```
ROLE: A2 executor — one scoped harness fix, two acceptable shapes.
ALLOWED_INPUTS: scripts/tui-capture/verify_resume_picker.py;
  scripts/tui-capture/pty_common.py (ONLY if adding the gate helper);
  scripts/tui-capture/verify_resume_hint.py (ONLY a call-site addition if
  the helper lands).
FORBIDDEN_INPUTS: product code; DOX; any change to the first-run gate's
  product behavior (the gate itself is correct — the harness must meet it).
OUTPUT_ARTIFACT: the edited scripts; a receipt at
  .unown/receipts/a2h6.md with the three wiped-home runs and, if the
  helper landed, the re-runs of footer-quiet and resume-hint.
HANDOFF_SCHEMA: plain text — which shape landed, the run receipts.
EFFORT_BUDGET: <=4 chunks x <=8 turns.
NON-OVERLAP: A2H-5 owns the hint lane's env filter alone.
ACCEPTANCE (preferred shape — the helper): a first_run_gate helper in
  pty_common.py answers the gate pane-aware (n + Enter, keeping the
  bundled bridge) before wait_ready; verify_resume_picker.py passes a
  WIPED VERIFY_HOME x3 first-boot; footer-quiet 9/9 and resume-hint ALL
  HELD re-run green with zero cures. ACCEPTANCE (fallback shape): the
  picker lane provisions VERIFY_HOME via an env-filtered setup call and
  passes a wiped home x3.
```

### E-1 dispatch brief

```
ROLE: A2 executor — one scoped app-skeleton ticket, the house pattern, no scope creep.
ALLOWED_INPUTS: apps/ostinato/** (read-only — the pattern source), apps/coda/**
  (read-only), apps/tempo/** (create), package.json (the tempo:* script rows),
  playwright.tempo.config.ts (create), docs/etude-prd.md (read-only context).
FORBIDDEN_INPUTS: modifying any file outside apps/tempo/ + the named rows;
  product code (src/, mini-services/, pi-repo/); DOX; the landing page;
  CHANGELOG (the operator lane); any dependency addition.
OUTPUT_ARTIFACT: the apps/tempo/ skeleton — index.html, public/
  (manifest.webmanifest, icon.svg, offline.html), sw.js, serve.mjs,
  src/storage/local-storage.ts (the atomic-write seam, stubbed),
  src/domain/model.ts (types only), src/ui/el.ts + palette.ts (stubs),
  src/app.ts (boots a hello-world render), the bun-test lane
  (src/domain/smoke.test.ts), tsconfig.json, package.json; the root
  package.json tempo:dev/tempo:test/tempo:e2e rows; playwright.tempo.config.ts
  + e2e/boot.spec.ts (boots the app, waits for the ready marker); a receipt
  at .unown/receipts/e1.md (files changed + the cmd tally).
HANDOFF_SCHEMA: plain text — what landed, the cmd tally, the receipt path.
EFFORT_BUDGET: <=4 chunks x <=8 turns.
NON-OVERLAP: E-2 owns the domain core; nothing here implements domain logic
  beyond type declarations and a smoke test.
ACCEPTANCE: `bun run tempo:test` exits 0; `bun run tempo:dev` serves the app
  (curl the port, expect the HTML); app tsc exits 0; the boot e2e passes
  (`bunx playwright test -c playwright.tempo.config.ts`); `git status --short`
  shows changes ONLY under apps/tempo/, package.json,
  playwright.tempo.config.ts (+ the receipt); the zero-dependency law holds
  (no new entries in any package.json dependencies).
```

## First keyboard and TUI audit brief

The standing pre-ticket ritual (H-3), this round's opening execution —
**DONE 2026-11-05**, the harvest that opened the round:

- Re-run the standing PTY verify lanes on the fresh lineage BEFORE any
  dispatch: `verify_footer_quiet.py`, `verify_resume_hint.py`,
  `verify_resume_picker.py` (the plan-mode and settings-hub lanes join at
  the next teardown refresh).
- Wipe every VERIFY_HOME first — the fresh-install truth law (this round's
  own addition; the prior lineage's receipts rode warm homes, V-3).
- Findings file to the bug register; every finding carries a repro
  (B-13/B-14 do), a verifier (the wiped-home ×3 lane run), and a ticket
  (A2H-5/A2H-6).

## First bug-hunt brief

The round's first product-side bug hunt dispatches AFTER A2H-5/A2H-6 land
(the harness must be trustworthy before its findings are trusted):

- Vehicle: the standing lanes under adversarial conditions — fresh homes,
  ambient-env pollution (the V-4 attack), first-boot gates, engine-down
  boots (the outbox path), bridge-down boots (the retry path), and the
  known-open #30 print-mode hang (armed watcher +
  `UNOWN_PRINT_EXIT_TRACE=1`).
- Every confirmed finding enters the Failure → Benchmark reflex: validation
  log entry → minimal repro → layer call (brief / augmentation / upstream)
  → fix at that layer → rerun → before/after receipt.

## Resume instructions

For the next lineage resuming this round:

1. Re-clone (or ff-only pull) `origin/main`; verify HEAD matches this log's
   last receipted SHA; re-read this log + [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md).
   (The V-5 lesson: a parallel lineage may land mid-session — preflight
   with `git fetch` + rebase BEFORE every push, and re-read any DOX the
   parallel commit touched.)
2. Bring-up: bun ≥1.4 (the GitHub-release binary lane if npm stalls — V-8),
   `fd` 10.2.0, the PTY venv (pyte/pexpect/pillow), `bunx playwright install
   chromium` (browsers pinned under `my-project/.playwright`),
   `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts`,
   `.env` Agnes lane, stack via `.a1/scripts/dispatch-bg.py stack bun run
   agent:start`.
3. Verify the checkpoint: doctor "ready to chat", C1 smoke `UNOWN_OK`,
   `unown engine status` UP.
4. **This round is PARKED** (V-10): do NOT dispatch E-1 — the live queue
   is the Rondo round's ([its log](rondo-round-session.md): A2H-9 → C-0 →
   C-1..C-11). This log stands as the parked round's record; the frozen
   E-1..E-6 queue and the amended PRD are the Tempo carry-over candidate's
   ready-to-resume package if a future §0.9 selects it.

## Related pages

- [The Etude PRD](etude-prd.md) — the round's DRIVE vehicle (Tempo, E-0
  approved then parked)
- [The Rondo round](rondo-round-session.md) — the live engagement whose
  §0.9 selection superseded this round
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The augmentation registry](a1-augmentation-registry.md)
- [The Etude benchmark round](../benchmarks/etude-round/README.md) — the
  baseline suite + calibration canaries
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — the recon snapshot
- [The parked Reprise round](reprise-round-session.md) — the carry-over queue
- [SESSION.md](SESSION.md) — the running index
