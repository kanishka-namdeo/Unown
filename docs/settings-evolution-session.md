# The Settings Evolution round — session log (docs/settings-evolution-session.md)

> **Mission:** transform Settings from a collection of configuration screens into
> the operational control centre for Unown — organised by user intent, answering
> six questions (What can it do? What is it allowed to do? What does it
> remember? What has it learned? What could it change automatically? How do I
> recover?), with every autonomous action **explainable, reviewable, approvable,
> undoable and audited**. This page is the round's resumable checkpoint log:
> every milestone records state + receipts so any session can resume without
> archaeology.

- [The mission phases](#the-mission-phases)
- [Round 1 shipped in v0.0.49](#round-1-shipped-in-v0049)
- [Round 2 in flight](#round-2-in-flight)
- [Resume-from-here](#resume-from-here)
- [Environment notes for a resuming session](#environment-notes-for-a-resuming-session)
- [Related pages](#related-pages)

## The mission phases

Charter ledger: 1 inventory · 2 competitor research · 3 user journeys ·
4 IA redesign · 5 edge-case catalogue · 6 trust & recovery framework ·
7 missing-settings discovery · 8 TUI experience redesign · 9 benchmarks ·
10 self-improvement. Phase docs: `settings_inventory.md`,
`settings_competitor_review.md`, `settings_user_journeys.md`,
`settings_ia_redesign.md`, `settings_edge_case_catalogue.md`,
`settings_trust_recovery_framework.md`. Success criteria (charter): a new user
configures safely in under five minutes; every autonomous capability visible,
explainable and reversible; every learning mechanism observable with rollback;
costs visible and controllable; settings organised by intent; benchmark scores
improve against baseline; failures become benchmark tasks; improvements survive
future validation runs.

## Round 1 shipped in v0.0.49

Phases 1–8 landed: the six phase docs (`d26db1a8`, `6db2f457`) and the
implementation (`4740224f` + the `f02e4e26` test-isolation fix): the `/settings`
control centre — `src/settings/` (registry 89 items / 10 intent sections; ui,
command, search, health, diff, history, prefs, transfer, render), the vendored
extension-override rule (the built-in `/settings` is intercepted only when no
extension registered it; autocomplete replaces it; pinned by
`extension-command-override.test.ts`), and the trust features (dream review
mode + the pending-dreams inbox, the staged-skills inbox, the automations
stop-now kill switch, the goal turn budget with auto-pause, the hook loop
breaker). Tests: `settings-hub.test.ts` (23) + `settings-trust.test.ts` (10);
PTY lane: `scripts/tui-capture/verify_settings_hub.py`. Round 1 did NOT ship:
phase 9 (benchmarks — `benchmarks/settings-ux/` never existed), phase 10
(learning artifacts), and a set of debts now carried below as the S2 ledger.

## Round 2 in flight

### M0 — setup + run (DONE 2026-10-31)

- Clone @ `499a9412` (v0.0.50, main). bun floor enforced: 1.3.14 → **1.4.4**
  (npm lane; `pi-repo/bun.lock` is lockfileVersion 3).
- `.env` from `.env.example` — the Agnes lane: `BRIDGE_UPSTREAM_KEY` set,
  upstream `https://apihub.agnes-ai.com/v1`, `PI_MODEL_ID=agnes-3.0-flash`,
  `BRIDGE_KNOWN_MODELS=agnes-3.0-flash,agnes-2.5-flash`;
  `UNOWN_HOME=/home/z/my-project/unown-home` (the documented override — sandbox
  containment). `bun run agent:install` 7/7 green (engine OS service skipped in
  the container: no systemd user bus; the agent-side auto-start fallback
  carries it, per docs/routines.md).
- Stack up: bridge `:3031` upstream ok 200 (6 agnes models served); engine
  `:3030` phase `ready` v0.0.50. `unown doctor` green (2 expected warnings:
  unverified model spec — the honest model-specs gate state; no LSP).
- Real-user smoke: `unown -p "Reply with exactly: UNOWN_OK"` → `UNOWN_OK`
  (the full TUI→bridge→Agnes loop).
- Real-user hub verification: `verify_settings_hub.py` **EXIT=0** — chunk A
  (the hub opens, not the theme selector), chunk B (Goal budget → 25 through
  the item editor; save notice + `settings-hub.json` + the change ledger on
  disk), chunk C (`/settings search|diff|recent` in-TUI).

### M1 — the round-2 audit + closure debts (DONE 2026-10-31)

**The audit** — research pass 2 (51 live-fetched sources:
`settings-round2-research.md`) + a code-verified current-state map. Findings:

- **The S2 ledger** — 22 concrete open items (below).
- **The drift register** — 7 docs-vs-code drifts (below).
- **Research pass 2** — 12 TUI settings-UX patterns (the `?` cheatsheet, the
  two-keystroke leader, the fuzzy palette with token grammar, the typed `:`
  prompt, schema-validated config, generated defaults, layered resolution,
  live reload, confirmation asymmetry, the persistent status bar, the in-app
  tutor, settings-as-mode), the agent-cohort deltas window (Codex `/config`
  search + `/keymap` + `doctor --network-only`; Claude Code
  `blockWritesOutsideWorkingDirectories` + layered managed policy + "Recently
  blocked"; Gemini placeholder-preserving migration; Cline local-models page;
  OpenHands profile-owns-settings; Roo and Aider negative), and the settings-UX
  measurement practice (NN/g metrics with optimal-path % and backtracks; WCAG
  3.2.6 / 3.3.7; Apple HIG settings; Microsoft app-settings guidelines).

**The S2 ledger** (round 2's work list; sizes S/M/L):

| # | Item (missing) | Blocks mission question | Size |
|---|---|---|---|
| S2-1 | Agent → Interface group — the 32 pi selector rows (theme, TUI mode, steering, follow-up, images ×4, Mermaid, hide-thinking, cache-miss, scrollbar, copy-on-select, paddings, autocomplete height, clear-on-shrink, terminal progress, double-escape, tree filter) are unreachable from the TUI since the override; three product surfaces give dead `/settings` guidance | #1 what can it do (users cannot switch theme/TUI mode in-session) | M |
| S2-2 | `benchmarks/settings-ux/` suite (BM-1..7, pinned runner, receipts) — never started; every round claim unmeasured | all six | M–L |
| S2-3 | Hoist toggle writable row (`PI_USER_TIER_HOIST` still env-only) | #5 | S |
| S2-4 | Memory health card (last-reconcile, duplicate/conflict counters, persistent warning) | #4 | M |
| S2-5 | Per-project dream canary | #4 | L |
| S2-6 | Terminal hook audit feed + per-hook last-error + failClosed toggle | #2 (audit) | M |
| S2-7 | Elicitation policy matrix + autoAccept counter | #2 | M |
| S2-8 | Undo-coverage badge per turn (+ optional pre-bash snapshot) | #6 | M/L |
| S2-9 | Skill health (last-used, suggest-retire, overlap) | #4 | M |
| S2-10 | Subagent/fleet defaults with setters | #5 (cost) | M |
| S2-11 | Automation spend meter + ceilings under governance | cost | M–L |
| S2-12 | Session/global budget card in Models & Cost | cost | M |
| S2-13 | Goal extras (replace confirm, history, age nudge, verify command) | #5 | S each |
| S2-14 | Non-git identity adopt/merge-scope tool | #3 | M |
| S2-15 | Unknown-key validation + the 21 file-only keys as Advanced rows | #1 | S–M |
| S2-16 | Safe env write path (`settings-overrides.json`) for defence/budget knobs | #5 | L |
| S2-17 | Denial explanations naming layer + rule + Settings link | #2 | M |
| S2-18 | Round-closure artifacts — paid in this milestone | honesty | S–M |
| S2-19 | Dashboard stop lane (Automations) + Dreams screen approve/discard | #6 | S |
| S2-20 | Dead scaffolding (advanced gate inert, unused kinds/imports, `--verbose`) | honesty | S |
| S2-21 | Health-view consistency (14 checks; boot-time vs call-time home) | honesty | S |
| S2-22 | mem0 reconcile review/approve + the review-mode-default decision (measurement-gated) | #4 | L |

**The drift register:**

1. `command.ts`/`tools.ts` claim an Agent → Interface group exists — no such
   registry rows (this masked S2-1).
2. Framework §5 lists "undo coverage badge" as implemented — help text only;
   `checkpoints.ts` untouched by the round.
3. `settings_user_journeys.md` cites
   `benchmarks/settings-ux/receipts/baseline.md` ("~11 minutes") — the receipt
   never existed in git history (the claim is unbacked).
4. `render.ts:99` documents `/settings status --verbose` — not implemented.
5. Stale `/settings`-points-at-selector guidance: `docs/usage.md:504,529`,
   `docs/configuration.md:371`, `setup.ts:478`, `splitview.ts:1902`
   (historical CHANGELOG mentions stay as history).
6. `docs/SESSION.md` phase ledger was stale — fixed in this milestone.
7. Commit-message nits in `4740224f`: "13 checks" (code emits ≤14), "~2,600
   lines" (settings/ is 3,336 + dream-review 133).

**Closure debts paid in M1** (S2-18, S2-21 partial): this session log (the
file SESSION.md pointed at but never existed), the SESSION.md ledger truth,
the `docs/AGENTS.md` ownership clause for the settings records, `.env.example`
gains `UNOWN_HOOK_DEPTH` (the every-env-var rule), the CHANGELOG post-release
entry for the hub (the 0.0.10 standing pattern), and the `pty-README.md`
registration of `verify_settings_hub.py`.

**F39 — the gates caught round 2's opener (CORRECTED in place).** Three
defects in the M1 commit, all mine: (1) the session log's mini-TOC anchors were
hand-computed instead of checker-derived — two rounds of unresolved-anchor
failures before the headings matched GitHub's slug rule; (2) the CHANGELOG
post-release entry was committed BEFORE the landing rail was regenerated, so
`check:changelog` ran red on main (a stale `changelog-data.ts` against the new
CHANGELOG) until the fix commit; (3) `audit:landing` was invoked without its
environmental needs (Playwright chromium + the dev server on :3000) —
environmental, not a content defect. Post-fix measurement, all green:
`check:docs` ok; the rail 48 stops / 478 entries; **3,863 / 3,880 words**,
**15.4 / 15.5 viewports**, max band 2.5vh (the word budget absorbs the settings
entry without compression). Lessons: derive anchors from the checker;
regenerate the rail in the SAME commit as any CHANGELOG edit; provision the
audit environment before claiming a number.

### M2 — the settings-ux benchmark suite + the BEFORE baseline (DONE 2026-10-31)

`benchmarks/settings-ux/` now exists: `README.md` (the methodology contract —
scripted-driver honesty clause, lane table, anti-tamper rules),
`run-settings-ux-bench.py` (the pinned PTY runner, BM-1..BM-7, task-level
resume receipts), `audit-registry.mjs` (the registry audit through the real
vendored module + the pi-selector cross-check), `tasks/` (the pinned
workload: 11 find-and-change tasks, 12 search queries, the depth sample +
the six-question map), `RESULTS.md` (the BEFORE table + AFTER targets) and
`receipts/run-2026-10-31T10-16-44/` (the baseline: 7 lane receipts + 23
task/query receipts + pane exhibits + summary.json). Registered in
`benchmarks/RESULTS.md` + `benchmarks/AGENTS.md`.

**The BEFORE baseline (all receipts committed):** BM-1 five-minute test
**PASS** (5.7s, 5 steps; the wizard still claims `/settings` switches themes
— S2-1's most user-visible symptom, exhibit `bm1-wizard-theme.pane.txt`);
BM-2 **5/5 reachable** (disk+ledger verified, mean 5.9s) + **6/6 probes
unreachable** (S2-1 measured); BM-3 **8/12** search hit-rate (8/8 catalogued
targets hit; the misses are S2-1 ×2, S2-11 spend, S2-4 memory-health);
BM-4 **10/10** browse-reachable, mean 9.6 Downs, settable coverage **10/89
(11.2%)**, **32 pi rows unreachable** (machine count — the audit corroborates
the S2 ledger's hand count exactly); BM-5 **5/5** recovery paths; BM-6 **6/6**
six questions; BM-7 audit ok (89 items, 24 high, 0 field gaps) + the
typed-confirmation gate full cycle (wrong phrase cancels, nothing written;
"yes" writes + ledger).

**The suite caught its own author twice (the receipts keep the evidence):**
(1) the toggle-marker bug — the editor's selected row renders `→ Turn ON`,
so `startswith("Turn ON")` never matched (40 Downs, honest failures, fix
by substring match); (2) the no-op drift — BM-5's diff probe first set
hook-depth to 3, which IS the default (`DEFAULT_HUB_PREFS.hookMaxDepth`),
so the diff correctly said "no settings differ" (the task now sets 5).

**Environment lesson (recorded for this sandbox):** background processes
are killed at tool-call end even under `setsid nohup` — long lanes must run
inside one foreground call; the runner's per-task resume receipts make that
safe (a killed lane loses only its in-flight task).

### The plan (M3 → M8)

- **M3** — S2-1 (the Interface group, or the escape hatch — decided by
  measurement) + S2-20 + S2-21.
- **M4** — the trust batch: S2-3, S2-7, S2-8, S2-9, S2-13, S2-19 (as capacity
  allows; the L items S2-5 / S2-16 / S2-22 recorded as follow-ups unless
  measurement forces them).
- **M5** — AFTER receipts + the BEFORE/AFTER/DELTA table.
- **M6** — phase 10 learning artifacts: mint tasks from the round's failures,
  dream, staged skills, the learning report.
- **M7** — docs/DOX/README/landing sync + the round's CHANGELOG entry.
- **M8** — version bump + tag + release builds (the release workflow).

## Resume-from-here

Round 2, M2 done (the baseline exists — every improvement claim can now
cite a receipt). Next: **M3 — S2-1: the Interface group for the 32
unreachable pi rows (or the escape hatch — decided by measurement), plus
S2-20 (dead scaffolding) and S2-21 (health-view consistency).** The M3
acceptance gates are already pinned: BM-2's six probes flip to reachable,
BM-3's theme/dark-mode queries hit, the wizard's theme-step claim becomes
true, and BM-2/5/6/7 stay green (no regression). AFTER targets live in
`benchmarks/settings-ux/RESULTS.md`.

## Environment notes for a resuming session

- Checkout `/home/z/my-project/Unown` (main). Stack boot:
  `bun run agent:start` (bridge :3031, engine :3030); stop with
  `bun run agent:stop`. `.env` is gitignored — the Agnes lane
  (`BRIDGE_UPSTREAM_KEY`; upstream `https://apihub.agnes-ai.com/v1`;
  `PI_MODEL_ID=agnes-3.0-flash`).
- `UNOWN_HOME=/home/z/my-project/unown-home` (in `.env`); engine runtime state
  `data/self-learning/` is gitignored.
- PTY lane deps: `pip install pyte pexpect pillow` (the sandbox python is a
  venv — no `--user`); run
  `OUT=<outdir> python3 scripts/tui-capture/verify_settings_hub.py`.
- Test suites: `cd pi-repo/packages/self-learning && bun test test/`
  (integration via `PI_TEST_SCOPE=integration`); landing gates via
  `bun run check:docs` / `check:changelog` / `check:claims`.
- Pushes: explicit paths only (`git add <files>` — never `-A`), lowercase
  surface prefixes (`docs(settings): …`), secret-scan guard before every push.
  GitHub auth in this sandbox: a credential helper reading `GITHUB_PAT` from
  the session env (`/home/z/my-project/scripts/git-cred.sh`, wired as the
  repo-local `credential.helper`) — the remote URL stays clean and no secret
  is ever at rest in the checkout (the repo rule "the PAT lives only in the
  git remote URL" is satisfied equivalently: nothing at rest anywhere).
- Secrets rotation: the PAT and the Agnes key were delivered via chat; rotate
  both when the round closes.

## Related pages

[settings_inventory.md](settings_inventory.md) ·
[settings_competitor_review.md](settings_competitor_review.md) ·
[settings_user_journeys.md](settings_user_journeys.md) ·
[settings_ia_redesign.md](settings_ia_redesign.md) ·
[settings_edge_case_catalogue.md](settings_edge_case_catalogue.md) ·
[settings_trust_recovery_framework.md](settings_trust_recovery_framework.md) ·
[settings-round2-research.md](settings-round2-research.md) ·
[SESSION.md](SESSION.md)
