# The Etude round — session log

> **Status: OPEN 2026-11-05** — opened by the **seventeenth lineage** under a
> FRESH A1 directive (the standing shape: STABILISE A2 × HARDEN A2 × PROVE
> IT). The prior engagement's P1 continuation round (the Reprise round) is
> PARKED with its queue intact — see [SESSION.md](SESSION.md); its open
> tickets R-2..R-5 are carry-over candidates for this round's queue, not
> forgotten.

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

## Validation log

| ID | Event (dated) | Class | Disposition |
|---|---|---|---|
| V-1 | Sandbox recycle reclaimed `fd` and the playwright chromium-1248 build (2026-11-05, bring-up) | infra-flake (known class) | Cured from the bring-up checklist: fd 10.2.0 → npm-global bin; `bunx playwright install chromium`. NOT the root cause of the resume-lane failures (V-2/V-3 are) — recorded so the next lineage does not re-diagnose |
| V-2 | `verify_resume_hint.py` failed `wait_ready` (PaneTimeout, 120 s) on a wiped VERIFY_HOME; the provision step `unown setup --provider bridge` ran with the ambient `UNOWN_HOME` leaked into its subprocess env (`env={**os.environ, **env_extra()}`) and provisioned the OPERATOR's home instead of the isolated one; the isolated home booted cold into the pre-TUI first-run gate (2026-11-05) | genuine-gap (harness) | **A2H-5 opened**: apply the H-8 subprocess env filter (drop `UNOWN_HOME`) to the lane's setup call. Root-caused with a controlled experiment: a correctly-targeted `setup` writes `settings.json`, which flips `created:false` and suppresses the gate (live-verified on a scratch home). Receipt: [V-2 repro log](../benchmarks/etude-round/validation-log.md) |
| V-3 | `verify_resume_picker.py` failed `wait_ready` (PaneTimeout, 90 s) on a wiped VERIFY_HOME — the lane provisions nothing, and the FIRST boot of any fresh home deterministically blocks on the pre-TUI first-run gate (`cli.ts:3595-3618`; `created: models.fresh \|\| !settingsExisted` at `term.ts:276`). Cold-home FAIL ×2 → warm-home PASS ×2 (2026-11-05) | genuine-gap (harness + receipt correction) | **A2H-6 opened**: the lane must either provision its VERIFY_HOME via an env-filtered `setup` or — the better coverage — answer the gate pane-aware (the helper proposed as H-9), so the lane exercises the product's real first-run flow. The H-8 receipt's "fresh install 3/3 PASS" is corrected: it holds only for pre-warmed homes. Receipt: [V-3 repro matrix](../benchmarks/etude-round/validation-log.md) |
| V-4 | The full pre-ticket baseline re-run (2026-11-05): every gate green on the fresh tree — the numbers in the environment checkpoint above | receipt | Filed as the Etude round's baseline snapshot ([the round's benchmark README](../benchmarks/etude-round/README.md)); the Phase-1 holdout forms against it |
| V-5 | A PARALLEL lineage closed Reprise R-2 (`782f090b`, deck-level review settings, 9 A2 dispatches, battery → 17/17) mid-Etude-Phase-0; the push rejected, the rebase reconciled (memory render taken theirs — the newer dream; SESSION.md merged semantically: R-2 CLOSED folded into the parked section) | upstream-change (the known parallel-lineage class) | Reconciled 2026-11-05: rebase clean after 3 semantic resolutions; gates re-verified green post-rebase; the battery figure drift (14/14 → 17/17) noted wherever the `f3f0176e` baseline is quoted |

## Bug register

User/operator-visible findings of this round (the B register continues the
lineage numbering — B-1..B-12 live in the Ostinato and Reprise logs):

- **B-13 — the resume-hint lane's provision step leaks ambient
  `UNOWN_HOME`** (`scripts/tui-capture/verify_resume_hint.py`, the setup
  subprocess). Failure: every run on a wiped home provisions the wrong
  home and then PaneTimeouts at the TUI header. Root cause: the H-8 env
  filter was applied to the picker lane's subprocesses but not to this
  lane's setup call. Fix lane: A2H-5. Found 2026-11-05 (V-2).
- **B-14 — the resume-picker lane cannot pass a genuinely fresh home's
  first boot** (`scripts/tui-capture/verify_resume_picker.py`). Failure:
  the pre-TUI first-run gate blocks the header on any home without
  `settings.json`, deterministically. Root cause: the lane provisions
  nothing and the harness has no gate awareness. Fix lane: A2H-6 (+ the
  H-9 helper). Found 2026-11-05 (V-3).

## Ticket queue

| Ticket | Scope | Verifier (external, named) | State |
|---|---|---|---|
| A2H-5 | The resume-hint lane's provision env filter: drop `UNOWN_HOME` from the setup subprocess env in `verify_resume_hint.py` (the H-8 pattern already in the picker lane), so the isolated home is provisioned and the lane passes a WIPED home on the first boot | The lane on a wiped VERIFY_HOME ×3 consecutive (exit 0 each); the warm-home runs stay green; `rg -l "my-project/Unown" scripts/tui-capture/` still empty | **OPEN** — dispatch brief below |
| A2H-6 | The picker lane's fresh-boot truth: provision VERIFY_HOME via an env-filtered `setup --provider bridge` (A2H-5's pattern) OR add the pane-aware first-run-gate helper to `pty_common.py` (send `n` + Enter when the gate text is on the pane — the H-9 candidate; preferred: it exercises the product's real first-run flow) | The lane on a wiped VERIFY_HOME ×3 consecutive; if the helper lands, footer-quiet and resume-hint re-run green with zero cures; unit/test lanes untouched | **OPEN** — dispatch brief below |
| E-0 | The PRD approval gate: the Tempo proposal (or the operator's substitute) approved — the app queue E-1..E-n forms at approval | The PRD's approval section signed in this log | **AWAITING APPROVAL** |
| (carry) | Reprise R-2..R-5, the #30 live-hang capture, the standing SESSION.md items | per their own logs | PARKED (candidates) |

**EFFORT_BUDGET**: A2H-5 ≤2 chunks · A2H-6 ≤4 chunks — each chunk ≤8 turns
(`--max-turns 8`), fresh session per ticket, byte-exact continuation briefs
on every resume (the standing economics).

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
2. Bring-up: bun ≥1.4 (npm-global), `fd` 10.2.0, `bunx playwright install
   chromium`, `pip install pyte pexpect pillow` (the venv — not `--user`),
   `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts`,
   `.env` Agnes lane, stack via `.a1/scripts/dispatch-bg.py stack bun run
   agent:start`.
3. Verify the checkpoint: doctor "ready to chat", C1 smoke `UNOWN_OK`,
   `unown engine status` UP.
4. Next ticket: A2H-5 (its dispatch brief above), then A2H-6, then the E-0
   approval gate.

## Related pages

- [The Etude PRD](etude-prd.md) — the proposed DRIVE vehicle (Tempo)
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The augmentation registry](a1-augmentation-registry.md)
- [The Etude benchmark round](../benchmarks/etude-round/README.md) — the
  baseline suite + calibration canaries
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — the recon snapshot
- [The parked Reprise round](reprise-round-session.md) — the carry-over queue
- [SESSION.md](SESSION.md) — the running index
