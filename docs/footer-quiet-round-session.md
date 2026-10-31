# Footer Quiet Round — Session Log (2026-10-31)

Session doc per the repo's checkpoint discipline. Resume from the latest
checkpoint if this session is interrupted.

Objective (user task): *"The area below the user keyboard input in the TUI has
too many elements showing. Map out user journeys to understand and evaluate
what we should be showing at all times and how vs what is supposed to be shown
only at certain times and how. research and reverse engineer competing
products and learn from them. implement changes end to end"* — with the
standing instructions: document each checkpoint, use subagents aggressively,
research extensively, push on every milestone, production-grade work with
edge cases, cross-platform support, verify like a real user, update
landing/readme/blog/stale docs, update the DOX tree, never delete media
assets.

Scope: the TUI's bottom dock **below the input editor** — the vendored
`FooterComponent` (`pi-repo/packages/coding-agent/src/modes/interactive/components/footer.ts`)
and the extension-status chips Unown paints through `ctx.ui.setStatus` (the
sixteen keys in `tools.ts`/`engine-status.ts`/`mcp.ts`/`fleet.ts`/`addons/`).
The mission panel and the plan/todo widgets **above** the editor are out of
scope — the open [todo-unification
round](plan-mode-todo-unification-round-session.md) owns that lane; this
round only fixes the footer↔panel duplications (conf, goal-active) by making
the chips yield to the panel.

## Research baseline (done before any edit)

- **Codebase audit** (subagents, very thorough): the bottom dock's seven
  containers, the footer's four-line render, every chip key with its
  file:line, the responsive tiers, the existing hide/show levers, and the
  test suites covering them (vendored `footer-width`/`footer-diff-stat`/
  `footer-data-provider` vitest; self-learning `engine-status`/`turn-meter`/
  `mission`/`learning-feed` bun suites).
- **Competitor lane** (subagents, live web research with sources):
  [the research doc](bottom-area-competitor-research.md) — Claude Code
  (statusline-as-a-trade, budgeted hints), Codex (status row hidden while
  streaming, expiring hints, duplicate-indicators-are-defects), Gemini
  (declarative ordered footer items, high-priority transients, drop-whole-
  items), aider (scrollback-as-status), Crush (healthy-states-silent, 5 s
  TTL transients, no badge in the default mode), OpenCode (conditional
  everything, focus-dimmed hints) + NN/g + clig.dev grounding.
- **Baseline evidence** (PTY+pyte lane, 128×36, real session over the live
  Agnes bridge): 4 stills + pane dumps in `download/tui-bottom-redesign/before/`
  — the idle footer is 4 rows; after ONE trivial turn the extension-status
  line reads `conf ✓ memory: up · stale (v0.0.51) turn 2.7s · ttft 2.7s · ctx
  5% · in 26.8k out 2` — three chips, alphabetical, truncated mid-chip.
- **Journeys**: [the user-journeys doc](bottom-area-user-journeys.md) — four
  personas, the friction inventory, and the manifest table dispositioning
  every element persistent vs situational vs demoted.

## Findings (each confirmed against source)

| # | Finding | Where | Severity |
|---|---|---|---|
| F1 | **Four stacked footer rows at rest.** Location, stats, extension statuses, hints — 8 rows of bottom chrome with the mission panel, 22 % of a 36-row terminal before any work happens. | `footer.ts:161-389`; baseline stills | critical — the reported bug |
| F2 | **The extension-status line is an unsorted dump that truncates mid-chip.** Every `setStatus` key paints (sixteen today), joined alphabetically by key, cut at width mid-text (observed `out 2`); an actionable chip (health ✗) can be the one truncated away. | `footer.ts:354-364` (alphabetical sort + `truncateToWidth`), `footer-data-provider.ts:135-152`; baseline `after-turn.pane.txt` | critical |
| F3 | **The same facts render twice.** Context % on the meter AND the turn chip; in/out tokens on the stats chips AND the turn chip; session cost on the stats `$` chip AND the turn chip's `~$`. | `turn-meter.ts:125-149` vs `footer.ts:124-149, 246-270` | high — Codex names this class a defect |
| F4 | **conf duplicates the mission panel.** The panel's status row shows `conf ✓/◐/✗` (`renderConfidenceChip`) and the footer paints the same chip on every turn end. | `tools.ts:6100` vs `mission.ts:292`; baseline pane | high |
| F5 | **goal-active duplicates the mission panel's objective line.** `goal: active · 1d old` under the editor while the panel already shows `● mission — … (goal · 2h)`. | `tools.ts:1491-1501` (goalFooterLine) + 5 call sites vs `mission.ts:275-282` | medium |
| F6 | **Healthy-ambient states paint permanent lines.** `memory: up · auto-dream 4m · mem ▕██░░ v2 · 107 rules · dreamed 12m ago`, `mcp: 3/3 · 14 tools`, `lsp: ts,py ready` — no action attached, rewriting on the probe cadence (the ~30-50 s heartbeat churn). Competitors: healthy states are silent (Crush mode badge "an empty string in the default coding mode"; Gemini items "not shown when unavailable"). | `engine-status.ts:189-219`, `mcp.ts:1858-1871`, `tools.ts:3754-3763` | high |
| F7 | **Session cost is the most fragile metric.** The `$` stats chip is last in the ordered-drop queue (audit B2) — the one number the ops seat cares about drops first at narrow widths. | `footer.ts:261-270, 288-335` | medium |
| F8 | **No kill switch.** The footer's density has no off switch — no setting or env restores a different layout; the UX card's "kill switches stay first-class" applies to every ambient surface. | `footer.ts` (no mode), `.env.example` (no knob) | medium |
| F9 | Verified NON-issues (documented so nobody re-litigates): the hint line is already contextual (I3 busy/queued/idle swap with ordered-segment fit — kept verbatim); the narrow-tier degradation is already ordered-drop; `widgetContainerBelow` is empty except the opt-in split-view dock; the attention line's data (extension statuses) already flows through one provider; the startup header and first-flights are above-input surfaces with their own rounds. | `interactive-mode.ts:4339-4396`; baseline | none |

## Fix plan (milestones; each = commit + push)

- **M1 (vendored footer, quiet layout)**: merge location into the status line
  (left: `cwd (branch) [• session @ wide+]`, then meter + chips; right: model,
  existing degrade ladder) — idle footer = 2 rows; the extension-status line
  becomes the **attention line** (priority-ordered, whole-chip dropping with a
  dim `+N`, never mid-chip cuts); `ctx.ui.setStatus(key, text, {priority?})`
  (priority DESC then key ASC; default 0); `UNOWN_FOOTER_CLASSIC=1` restores
  the exact legacy render path (fork-change comment, the clearOnShrink env
  pattern); vendored footer tests for every tier + priority + drop + classic.
- **M2 (Unown chip policy)**: `engineFooterAttention()` — up-without-skew
  stops painting (bar/rules/dreams stay in /engine, dashboard, doctor); mcp
  failures/withheld paint (critical), healthy doesn't; lsp ready clears,
  restarting (active) / paused (critical) paint; conf + goal-active yield to
  the mission panel (paint only when the panel is killed — the panel-composes
  rule); turn meter deduplicates to `turn Xs · ttft Ys · ~$Z` and inherits
  the session cost (F7: cost's one home); priorities wired on every chip;
  self-learning tests updated/added.
- **M3 (real-user verification)**: `verify_footer_quiet.py` in the PTY lane —
  pane-truth assertions for: 2-row idle footer, no ambient chips at rest,
  attention states paint (engine stopped → `memory: down`), busy hint swap,
  turn chip dedup, classic mode restore; before/after stills captured.
- **M4 (docs/DOX/landing)**: UX-principles amendment (the placement law's
  footer clause + the manifest), BEHAVIOR.md footer references, usage.md,
  configuration.md + `.env.example` (the knob), self-learning AGENTS.md +
  the vendored-patch ledger, CHANGELOG [Unreleased] + Agent Behavior entry,
  landing regeneration + checks, blog post, media: new stills added (existing
  assets never deleted).
- **M5 (release)**: version 0.0.53, changelog rail, tag `v0.0.53`, local
  gates, xplat smoke, release workflow verification.

## Checkpoints

- **CP0 (pre-work)**: repo synced to `7aeaf1ec` (v0.0.52 — the settings
  round; ff-only pull, 4 commits, no bottom-area files touched by them); bun
  1.4.4 (the pi lockfile floor — sandbox had 1.3.14, upgraded via npm);
  `.env` from `.env.example` with the Agnes AI upstream; stack up (engine
  `{"ok":true,"phase":"ready"}` :3030, bridge healthy :3031, upstream Agnes
  200); `fd` 10.2.0 installed to `~/.local/bin` (the boot-time
  `ensureTool("fd")` GitHub download stalled the first PTY boot — `rg` was
  already present); baseline captured (4 stills + pane dumps, PASS); research
  + journeys + this session doc written. Next: M1.
- **CP1 (M1 — the vendored quiet layout)**: `footer.ts` rewritten around a
  classic/quiet split — quiet renders ONE merged status row
  (`assembleMergedStatusLine`: location · meter · chips left, model right
  with the existing degrade ladder; location ellipsizes, never drops) and an
  attention row (`renderAttentionRow`: priority-desc/key-asc, whole-chip
  admission, dim `+N` overflow counter, highest-priority-chip-ellipsized last
  resort); `setStatus(key, text, {priority?})` added across
  `types.ts`/`interactive-mode.ts`/`footer-data-provider.ts`
  (`FooterStatusEntry`); the stats `$` chip is classic-only; the session name
  is wide-tier-only in quiet. `UNOWN_FOOTER_CLASSIC=1` restores the exact
  pre-round render path. pi-repo rebuilt (`build:offline`). Vendored footer
  suites 43/43 (new quiet suite: one-row rest, tier merge, session/cost
  placement, attention order, +N dropping, last resort, chrome widths at six
  tiers, classic restore); full coding-agent suite 2162 pass / 27 fail — the
  same 27 as pristine HEAD (model-registry network + find.ts fd flakes,
  stash-verified), zero regressions. Pushed `4f8dd054`.
- **CP2 (M2 — the quiet chip policy)**: `engineFooterAttention()` gates the
  engine chip (healthy up paints nothing; down/blocked/paused/starting and
  build-skew paint critical — `engineFooterText` unchanged for classic,
  /engine and the pinned copy tests); conf and goal-active yield to the
  mission panel via `missionPanelLive()` (both return when the panel is
  killed — the signals never disappear); the turn meter deduplicated to
  `turn Xs · ttft Ys · ~$Z` (classic keeps the full legacy format via the
  env-aware pure core; a dedicated `cost` chip carries the number when
  `UNOWN_TURN_METER=0`); mcp healthy is classic-only, failures/withheld paint
  critical (refuse-first kept); lsp ready is classic-only, restarting paints
  active / exhausted paints critical; `FOOTER_PRIORITY` wired on every chip
  through the new third argument. New `src/footer-mode.ts` (the kill switch +
  the priority ladder, pure). Full self-learning suite **5426 pass / 0 fail**
  (baseline 5306/0 + the todo round's remote +10; one automations failure on
  the first full run verified as a suite-parallelism flake — passes in
  isolation on both trees). Pushed `9fd5de32`.
- **CP3 (M3 — real-user verification)**:
  `scripts/tui-capture/verify_footer_quiet.py` (PTY lane, pane-truth
  discipline) drives the real TUI against the live stack — **9/9 checks
  held**: A1 the merged status row (cwd+branch+meter+model on one line), A2
  exactly two footer rows at rest, A3 ambient chips silent (no memory:/mcp:/
  lsp: lines with a healthy engine), B1 the busy hint swap, B2 the turn chip
  dedup (`turn 2.9s · ttft 2.9s` — no ctx/in/out/cached), C1/C2 a dead
  engine URL paints `memory: down` on the attention row below the status row
  above the hints (measured live: `starting…` at ~1 s, `down` at ~8 s — the
  spawn-kick re-probe cadence), D1/D2 `UNOWN_FOOTER_CLASSIC=1` restores the
  four-row layout with the ambient `memory: up` line. Stills + pane dumps:
  quiet-idle / quiet-busy / quiet-after-turn / quiet-attention-down /
  classic-idle (OUT_DIR). The before/after evidence pairs with the baseline
  captures in `download/tui-bottom-redesign/before/`. Next: M4.
- **CP4 (M4 — docs/DOX/landing/blog)**: `.env.example` + `configuration.md`
  carry `UNOWN_FOOTER_CLASSIC` in sync (plus the turn meter's new format and
  the mission-panel interplay); `usage.md` gains the "bottom area" section
  (the persistent-vs-contextual contract as a user reads it);
  `BEHAVIOR.md`'s /engine reference names the attention-row semantics; the
  UX card's placement law amended (healthy ambient state earns no row, the
  dedup clause, the surface-map row); CHANGELOG's Changed entry with the
  full evidence chain; README's docs-table row + the convergence-round
  turn-meter format corrected; self-learning AGENTS.md carries the
  chip-policy contract paragraph; docs/AGENTS.md indexes the round's three
  records. The blog post (`content/blog/2026-10-31-the-footer-quiet-round.md`)
  ships five PTY-lane stills + pane sidecars to `public/blog/<slug>/`
  (before/after pairs + the classic kill switch — the media-reuse rules
  honored: the tmux lane needs host binaries this machine class lacks, the
  pane text ships beside every image, no existing media touched). Gates at
  the landing: check:docs / check:changelog (51 stops, 498 entries) /
  check:blog (36 posts) / check:claims (62 literals) / check:benchmarks (6
  tracks) / audit:landing against the live dev server — all green;
  typecheck clean; lint 0 errors (4 pre-existing warnings, none in the
  round's files); `bun test src` 2063/0; e2e 15/15 against the production
  build. Pushed `caa93195`. Next: M5.
- **CP5 (M5 — release): the cut went RED; the release-recovery round re-cut
  it.** The bump commit `53b8d766` (version 0.0.53, dated heading, rail,
  tag `v0.0.53`) was pushed and tagged while CI on the SHA was failing —
  the release workflow's `ci-green` gate blocked everything downstream, so
  NO release published (latest stayed v0.0.52; no assets, no feed entry,
  no installs). The red was the todo-unification round's M1 fallback pin:
  an order-dependent test (goal.test.ts registers the todo addon into
  module state that survives into the later file) hiding a real production
  defect (the todo bridges' one-way latch vs `/reload`). The repair, the
  re-verification (this round's footer PTY lane re-run on the repaired
  tree: 9/9) and the re-cut are the release-recovery round's record:
  [docs/release-recovery-session.md](release-recovery-session.md). The
  lesson this round owes forward: **the pre-release gate matrix is run
  BEFORE the tag, and the tag waits for the green SHA** — the local
  `xplat full` pass and the CI poll are both part of the cut, not
  afterthoughts.
