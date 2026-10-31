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

### M3 — the Interface repair + the dead-scaffolding sweep (DONE 2026-10-31)

**S2-1 fixed by measurement-gated design:** the new **Interface section**
(`interface.*`, 31 items — the hub's 11th section, after Agent) gives every
pi-selector row a hub home with a REAL setter through the owning
SettingsManager. The theme lane is the showcase: `getChoices` resolves the
installed themes from the live UI surface (`ctx.ui.getAllThemes`), `set`
persists through the manager, and `afterSet` switches the TUI live
(`ctx.ui.setTheme`) — the setup wizard's "switch any time in-session:
/settings" claim is TRUE again. The audit's machine gate: **35/35 pi rows
hub-mirrored with setters, 0 unreachable** (was 32); registry 120 items,
41 settable (was 89/10). The long tail (paddings, scrollbar, transport,
http-timeout…) rides the now-REAL advanced gate (14 rows `advanced: true` —
S2-20's inert gate is inert no more).

**The M3 verification receipts** (`receipts/run-after-m3/`): BM-2 **5/5
reachable + 6/6 probes reachable+changed** (each probe: search → editor →
change → settings.json verified + ledger entry — the theme probe exercised
the live-switch path end to end); BM-3 **10/12** (theme and dark mode hit
at rank 1; the 2 misses are M4's S2-11/S2-4, as pinned); BM-7 audit ok +
gate full cycle + piUnreachable 0; BM-1 ✓ / BM-5 5/5 / BM-6 6/6 — no
regressions. BM-4: 10/10 reached, mean 10.5 Downs (was 9.6 — the +1 cost
of the Interface menu row, the honest price of the repair). The real-user
PTY lane (`verify_settings_hub.py`): EXIT=0. Full self-learning suite:
**5,275 pass / 0 fail**.

**S2-20 paid:** the advanced gate is real; the dead `group` kind + the
never-used `SettingsGroup` interface removed; `/settings status
--verbose` implemented (the documented-but-ignored flag now appends the
capability map — tested). **S2-21 paid:** health checks resolve the agent
dir at CALL time (the repointed-UNOWN_HOME test pins it); the 13-vs-14
check-count nit stays recorded in the drift register where it belongs.

**The suite caught its author again (the third catch):** the copy-on-select
toggle item shipped with a missing closing paren (`},` instead of `}),`)
— both parsers pointed at the array's `];`; a bisect harness found the
item in seconds. Recorded because the receipts-before-claims rule is the
round's spine.

### M4 — the trust batch (PARTIAL 2026-10-31: S2-13 + S2-19 landed)

**S2-13 (goal extras) — all four:** replacing an ACTIVE goal now asks
(`ctx.ui.confirm`) and lands the old one in history as [replaced];
`~/.unown/agent/goal-history.jsonl` records every ended goal
(replaced/cleared/complete, turns, verify gate, evidence) with
`/goal history` rendering the last 10; the footer carries the age nudge
(`goal: active · 2d old` past 24h) and `/goal` shows the ≥3-day
"still the goal you want?" line; `/goal verify <command>` arms a gate the
completion handler runs (exit 0 or the goal does NOT complete — timeout
and stderr tail in the notice). Tests: 5 new in goal.test.ts (32/32).

**S2-19 (dashboard lanes) — both:** the Automations screen gains `K` —
stop now (the kill switch riding the same `POST /api/automations/<id>/stop`
as the hub's automation.stop, with the stopped/closed toast); the Dreams
screen gains the pending-dream review lane — parked dreams render inline
(slug, notes, age) with `A` approve / `X` discard (discard behind the
confirm bar), riding the engine's `/api/dreams/pending/*` endpoints.
Store: `stopAutomationRuns` / `approvePendingDream` / `discardPendingDream`.

**The honest remainder (recorded, not hidden):** S2-3 (hoist toggle) is
coupled to S2-16's safe-env-write lane — the L item the plan already
defers; both stay follow-ups together. S2-7 (elicitation matrix),
S2-8 (undo badge), S2-9 (skill health) remain the M4 capacity items for
the next session — the S2 ledger rows stay open, and BM-3's `spend` /
`memory health` misses (S2-11/S2-4) stay honest misses until they land.

### M5 — the AFTER run + the DELTA table (DONE 2026-10-31)

`receipts/run-after/` — the identical pinned workload on the post-M4
tree, all seven lanes. **The DELTA** (benchmarks/settings-ux/RESULTS.md
carries the full table): S2-1's probes **6/6 unreachable → 6/6
reachable+changed** (theme live-switched through the hub); search
**8/12 → 10/12**; settable coverage **10/89 (11.2%) → 41/120 (34.2%)**;
pi rows unreachable **32 → 0**; BM-1/2/5/6/7 hold green (BM-1's wizard
claim went true-but-false → true-and-true; BM-4 +0.9 Downs — the
Interface row's honest price). The two remaining BM-3 misses are the
deferred S2-11/S2-4 — honest misses, pinned queries waiting.

### M6 — the Phase-10 minting: BM-8, the dream, the promoted skill, the learning report (DONE 2026-10-31)

**The minting produced a fourth find.** Building the three author-catches
as pinned guards (BM-8, `receipts/run-m6-minting/`, 4/4) surfaced a real
product defect the whole round had missed: **phantom drift** — the
registry's declared `default` fields for 8 interface items were written
from the pi selector's row states, not the vendored settings-manager
getters, so `/settings diff` showed 8 phantom "drifted" rows on EVERY
fresh install (tui-mode regular-vs-fullscreen — onboarding deliberately
writes `fullscreen` — mermaid, image-width, editor-padding, clear-on-shrink,
terminal-progress, copy-on-select, fullscreen-exit-output). Caught by
reading the run-after `bm5-diff` pane while designing the no-op guard.
Fixed (all 8, vendored provenance comments); pinned TWO ways:
`test/settings-defaults-drift.test.ts` (the unit pin — every defaulted
item's `get()` equals its declared default on an out-of-the-box home;
runs in a SUBPROCESS because some getters resolve through term.ts's
module-scope `UNOWN_HOME` snapshot — the in-process pin read an earlier
suite file's leftovers: `agent.addon-todo-lines: get()=33`, the failure
that found the snapshot class) and BM-8's phantom-drift guard (the
pane-truth pin: a pristine home's diff must say "No settings differ").

**BM-8 — author-catch guards** (`tasks/bm8-author-guards.json`, the lane
row in the suite's README, RESULTS.md's M6 section): phantom-drift ✓,
toggle-marker ✓ (the `→` marker asserted as pane-truth BEFORE matching;
changed + disk + ledger), noop-drift ✓ (todo widget lines 12 → 14, target
= current+offset never equal by construction; the diff names the drifted
key), registry-parse ✓ (audit import + `bisect-registry.mjs --selftest`:
120 spans == 120 items, the synthetic missing-paren drill named
`agent.capabilities` in 8 probes). Plus the no-op LOAD-TIME validation:
5 task diskChecks checked, 1 warning — BM-2's own hook-depth task is
diff-inert (expect 3 == declared default 3), honestly kept as a warning.
`bisect-registry.mjs` itself: the missing-paren diagnosis tool minted —
paren-INSENSITIVE span scanning (the catch class is exactly what breaks
paren-aware scanning), binary search over candidate temp files (the real
file never touched), the selftest drilling a synthetic catch every run.

**The dream.** The round's four learning notes (the find, the minting,
the receipts discipline, the environment lesson) posted via the engine's
ingestion lane; the manual trigger ran the engine dream (4 benchmark
notes → engine-scope memory v27) and `runProjectDream()` — which first
GATED us on a parked dream from an earlier session (the review-mode gate
is unconditional on pending existence; resolved through the product's
own inbox) — then consolidated the 4 notes into the dogfood project:
`project-e02884a0`, 4 in, 2 added, 1 pruned, project memory **v3 → v4**
(render "110/112 · 2 oldest pruned (cap 110; hard-won rules immune)").
The dream also MINTED a skill — `pin-settings-defaults` — into
`.unown/skills-staged/`.

**The human gate, driven like a real user — and it caught two more
product bugs.** The promotion drive (the hub → Learning → Staged skills
inbox) was silently ignored at first: **nine action items carried
death-lane labels** — the item editor dispatches on
`choice.startsWith("Run")` but pushed actionLabels verbatim, so
"opens the staged-skills list" matched NO branch. Fixed by
`actionOptionLabel()` (every action label normalised into the `Run: …`
shape); pinned in `settings-hub.test.ts` (the action dispatch contract,
all action items). Then the inbox dialog itself was UNUSABLE: the
2,500-char preview (and the pending-dreams inbox's 3,000-char diff)
pushed the option rows off-screen. Fixed by clamping both previews to
600 chars with a pointer to the full text. The completed drive then
promoted `pin-settings-defaults` through the product's own UI — disk
(`.unown/skills/pin-settings-defaults/`), ledger
(`"via": "/settings staged-skills inbox"`), the stale `staged: true`
frontmatter dropped — and Skipped the earlier round's
`add-new-subproject-skeleton` (its promotion is that round's call).

**The learning report** — `docs/settings-learning-report.md`: the five
mechanisms validated on this round's receipts (the harness's honest
quiet: 15/15 cycles already-passing, 0 improvements; the engine mint's
honest skip; the digit-quick-select observation — the inbox dialog
rendered options UNNUMBERED where the plan gate renders them numbered,
unexplained, recorded as an open question, not a claim).

**Verification at M6:** settings suites 42/42 (hub 30 + drift 2 + trust
10); full engine unit suite 5,298 pass / 0 fail / 101 skip; typecheck
clean; BM-8 4/4 with receipts; the promotion receipted on disk + ledger.

### M7 — the paper trail (DONE 2026-10-31, e8f096b5)

configuration.md gains **The settings hub** chapter (the hub-as-lens
contract — the owning surfaces, the hub prefs, the change ledger) and the
declared-defaults-are-contracts rule the M6 find established; usage.md's
Goals section gains the M4 extras (goal-history.jsonl + `/goal history`,
`/goal verify <command>`, the replace confirm, the age nudge) with the
command table row carrying them; README's configuration row names the
control centre. The CHANGELOG's **0.0.52** entry records the round in
full — including the honest note that M3–M5 rode the v0.0.51 tag's code
tree (the keyboard round's release carried it; this is its first
changelog record). The rail regenerated to 50 stops / 495 entries in the
SAME commit; the blog post
(`content/blog/2026-10-31-the-settings-round.md`) tells the
phantom-drift story + the nine dead lanes + the inbox overflow; blog
regenerated to 34 posts / 78 tags.

**The eleventh budget amendment** (3,880 → 3,920, both twins together
per the 0.0.48 no-divergence lesson): the tenth left 17 words of
headroom and the 0.0.51 stop consumed it EXACTLY (3,880/3,880 at this
round's opening audit); the 0.0.52 stop measured +20 (3,900). Compressed
FIRST per the contract: the round's own listed rail title ("The
Interface section — the S2-1 repair" → "The Interface section", −4w; no
generated number or gated literal touched). Post-compression 3,896 —
still 16 over, all undeletable stop chrome, so the ceiling carries it
plus one more stop's headroom per the 0.0.44 rule (3,900 would have
left 4). The amendment ledger in the landing AGENTS.md records it; the
spec's tenth-amendment comment was demoted, not deleted. Gates at the
commit: check:docs 122 ok · check:changelog 50/495/50 · check:blog
34/78 · check:claims 62 · check:benchmarks 6 · landing unit 2,063/2,063
· typecheck clean · e2e twin 15/15 · audit:landing --budget PASS
(15.4vh / 3,896w ≤ 3,920).

### M8 — the release (DONE 2026-10-31; v0.0.52 published 15:01:14Z)

Pre-release matrix on the tree: engine unit 5,298/0/101 skip +
integration 13/13, bridge 248/0, landing unit 2,063/2,063, typecheck
clean, biome zero findings on every changed file, all landing gates
green, `unown --version` prints 0.0.52 after the bump. The release
commit `7aeaf1ec`, the tag pushed 14:41Z. Outcome: **CI on the tagged
commit green, the Release workflow's full matrix green — draft promoted
to published 2026-10-31T15:01:14Z with all 13 assets** (six per-OS
binaries, both installers, the update manifest, version.txt,
sha256sums, the SPDX SBOM, the checklist); CodeQL + Scorecard green on
the same commit. (A CI failure appeared on main at 15:18Z — the parallel
session's f1be8569 "quiet footer round" commit at 15:06Z, not this
round's; every workflow on 7aeaf1ec completed success.)

## Resume-from-here

**Round 2 is complete** — M0 through M8, all receipts committed: the
Interface repair (S2-1 closed: 0 unreachable, coverage 11.2% → 34.2%),
the trust batch (S2-13 + S2-19), the settings-ux suite (BM-1..7 + the
DELTA), the Phase-10 minting (BM-8 4/4, the dream v4, the promoted
`pin-settings-defaults` skill, the learning report), the paper trail
(M7), and the release (v0.0.52, 13 assets). Three product finds were
caught by the minting work and shipped fixed + pinned: phantom drift,
the nine dead action lanes, the inbox overflow.

Follow-ups worth a session (recorded, not owed): the S2 ledger's honest
remainder — S2-7 (elicitation matrix), S2-8 (undo badge), S2-9 (skill
health), S2-11 (spend meter, one of the two pinned search misses),
S2-4 (memory health card, the other) — plus S2-3/S2-16 (the hoist
toggle + safe env write, the L pair), S2-22 (mem0 reconcile
review/approve), and the digit-quick-select observation from the
learning report (the inbox dialog rendered options unnumbered where the
plan gate renders them numbered — unexplained, a keyboard-lane
question). The benchmark is the regression net for all of them.

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
