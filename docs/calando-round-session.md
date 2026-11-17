# The Calando round — session log (mid-session overwhelm, end to end)

Opened: 2026-11-17. Status: CLOSED at CP6 (v0.0.71).

Operator mission (verbatim):

> reverse engineer competitor products like an expert ui/ux researcher and
> make the TUI experience less overwhelming for the end user. follow actual
> study backed research. understand how it applies to all our features and
> capabilities and implement the learninings end to end. test, iterate and
> improve Unown's experience.

Standing operator requirements for this round: document the session at each
checkpoint (resume safety); use subagents aggressively; extensive online
research even for minor choices; push to the repo on EACH milestone;
production-grade implementation with edge cases; full cross-platform support
including keyboard experience; test like a real user via the PTY lane; update
landing page (with captures where relevant), README, blog, stale docs; leave
no stone unturned; update the DOX tree; never delete media assets; version
bump + release with each OS build compiling; address Dependabot and code
scanning issues.

Related pages:
- [docs/tui-overwhelm-research.md](tui-overwhelm-research.md) — the Semplice
  research record (first-boot scope)
- [docs/unown-ux-principles.md](unown-ux-principles.md) — the binding UX card
- [docs/SESSION.md](SESSION.md) — the running index

## Why this round exists

The Semplice round (v0.0.70) quieted the FIRST minute: boot preamble,
first-run gate, the command catalog, the hint row, `--help`. Its own closing
inventory left the mid-session experience explicitly open (items 9–17:
keybinding sprawl, settings sprawl, the dashboard advertised in the first
60 s, ~8 token-info homes, env-only quiet knobs, 11 split-view commands,
5 plan entry lanes). This round takes the same study-backed method to the
rest of the session: the transcript's tool-output bulk, the toast and chip
narration, the wait experience, and the discoverability of the depth that
Semplice deliberately kept.

Naming: "Calando" — musical instruction, "growing calmer, dying away";
the sequel to Semplice ("play simply"). Findings are Q-numbers (Quiet).

## Research record

Four lanes, all completed before the first edit (reports preserved in the
round's working notes and folded into the interventions below):

1. **Prior-round archaeology** — Semplice/Toccata/Da capo/footer-quiet/
   hints-ranking session logs + UX principles re-read; the open-item list
   above is its output; the standing non-adoptions (never remove commands,
   no tutorial wall, memory recall stays visible, ctx meter stays visible,
   no ghost text, no prompt suggestions) carry forward unchanged.
2. **Study-backed brief (mid-session scope)** — 5 areas, all citations
   verified online; full text at
   `/research/mid-session-overwhelm-brief.md` in the working tree root.
   Top findings ranked: (1) toasts are for blockers only — interruption
   cost ~23 min return + attention residue (Mark et al. 2008; Leroy 2009;
   Anufrieva et al. 2026; Fallon et al. 2023); (2) one authoritative surface
   per fact — the redundancy effect taxes working memory (Sweller &
   Chandler 1994); (3) close the split-attention loop between footer and
   transcript (Chandler & Sweller 1992); (4) persist what streams away —
   the transient-information effect (Wong et al. 2012); (5) adapt verbosity
   to expertise — expertise reversal (Kalyuga et al. 2003); (6) make waits
   feel occupied and moving (Maister 1985; Harrison et al. 2007/2010;
   Kuroki & Ishihara 2015); (7) the footer is a calm periphery — fixed
   slots, stable when healthy, animate on change only (Weiser & Brown
   1996; Matthews 2006); (8) pre-attentive scanning — fixed left-edge
   glyph/color column + one-line high-scent summaries (Treisman & Gelade
   1980; Pirolli & Card 1995; Nielsen 2006).
3. **Competitor teardown (2025–26 state)** — Claude Code 2.1.326, Codex CLI
   0.171, Gemini CLI, OpenCode, aider, Crush, Amp, Cursor CLI, Copilot CLI,
   lazygit/k9s/fzf/gitui/Helix. Convergent patterns already held by unown:
   collapsed tool output + ctrl+o viewer, repeat-call summarization, 2-row
   footer, plan badge + Shift+Tab, compact, numbered permission prompts,
   `?` help, queueing, undo. Divergent candidates this round evaluates:
   the fleet panic button (Claude Ctrl+X Ctrl+K — stops all background
   subagents with a 3 s confirm), the `/raw` copy-friendly toggle (Codex),
   `?`-key tabbed help (Copilot), prefix-matched commands (Gemini `/cha`).
   Loudest cross-tool complaints to design against: tool-output verbosity
   (Claude #65961, Codex #26279, Gemini #14387/#14569), progress ambiguity
   ("not clear if it's stuck", Gemini #2456), hidden background processes
   (Codex daemon, #48195).
4. **TUI surface map** — every user-visible surface inventoried with its
   file seam and density constants (the audit's baseline table; the
   intervention list below names its seams).

## CP1 — the gap analysis (Q-list, 2026-11-17)

Method: the two PTY baselines (density 128/72 + multitool 128) read line by
line against the research brief's top-8 findings, the UX card's footer-quiet
amendment, and the competitor pattern table. Every finding names its seam.

**What the baselines got RIGHT (kept, no action):** tool output is collapsed
with previews capped; `read` renders header-only when collapsed; repeat
tool-calls aggregate; the footer is two rows with attention-only chips
(the `memory: up · old build` row in the receipts is the OLD-BUILD verdict,
not a healthy-state leak — `engineFooterAttention` is correctly
attention-only); the 📂 below-editor strip is the persistent session-state
block the transient-information research asks for (files touched survive
the scroll); tips are one-shot latched; the flights card yields to typing.

- **Q1 — the mission panel narrates nothing, every turn.**
  `mission.ts` `renderMissionPanel`: Semplice W4's null state requires
  `telemetry.turns === 0`, so after the FIRST completed turn an idle session
  with no mission/plan/todo/risks renders
  `○ no tracked steps · on track ✓ · 0m in session` forever — three facts
  about nothing (W4's own words) that survive their own fix by one
  condition. Violates the footer-quiet amendment ("healthy ambient state
  earns no row") and the redundancy rule (the turn chip already carries
  per-turn time/cost; /usage owns the totals). FIX: the panel renders only
  when something is happening — mission, tracked progress, busy turn,
  risks, or fresh learning; telemetry alone is not a row.
- **Q2 — "Took 0.0s" on every instant command.**
  `coding-agent/src/core/tools/bash.ts:341-346`: the duration line renders
  whenever `startedAt` is set, including sub-second runs — pure noise on the
  most common case (a fast command), rationed-line principle. FIX: the
  completed `Took <d>` renders only when d ≥ 1 s; the live `Elapsed <d>`
  line keeps rendering always (occupied-wait research — a running command
  must never look frozen).
- **Q3 — the managed-tool download failure repeats its full notice every
  boot.** `tools-manager.ts:367-373` + `interactive-mode.ts:4110`: a user
  behind a proxy (or rate-limited GitHub, as in this sandbox: 403) sees the
  two-line actionable notice at EVERY session start — recurring identical
  failures train scan-past (the crying-wolf failure mode of error
  guidelines). FIX: a failure counter persisted in the bin dir
  (`.download-failures.json`, tools-manager-owned); the first failure keeps
  the full actionable notice, repeat failures render one dim line naming
  the tool, the count, and the manual way out; success clears the counter.
- **Q4 — quiet knobs are env-only (Semplice inventory item 14, the class
  must close).** `UNOWN_FOOTER_CLASSIC`, `UNOWN_TURN_METER`,
  `UNOWN_MISSION_PANEL` are documented in `.env.example` and shown as
  READONLY rows in the settings hub (`registry.ts` obs.turn-meter /
  obs.mission-panel) — a user cannot flip them without leaving the TUI and
  editing shell config. The hub already owns `settings-hub.json`
  (`settings/prefs.ts`) with the exact persistence pattern needed. FIX:
  graduate the three knobs to hub-owned toggles; env stays the first-class
  override (explicit env wins over the pref — kill switches stay king);
  the boot seam seeds unset env vars from the prefs so BOTH layers
  (self-learning + the vendored footer) keep reading one runtime source
  with zero circular imports.

**Deferred with reasons (not lost):** token-info consolidation (~8 homes —
needs an owning-surface decision per fact; audit recorded, architecture
round), the fleet panic button (needs the chord layer Da capo deferred as
"its own round's architecture"), the consolidated trust surface (5+ notices;
same), split-view command sprawl and plan-mode entry-lane compression
(menus, not narration — next density round), i18n/IME edge cases. Each lands
in the round's closing notes as the explicit open list.

## CP2 — the implementation (2026-11-17)

All four Q-fixes landed source-to-test; `build:unbundled` re-run so the TUI
boots the vendored changes.

- **Q1** `self-learning/src/mission.ts` — the null state drops
  `telemetry` from its condition entirely: no mission/plan/todo/risks +
  nothing tracked + no busy turn renders NOTHING, however many turns ran.
  Session facts (`Xm in session`) join the status row only when the row
  already earns its place (a mission is on). Tests:
  `test/mission.test.ts` — the W4-era pin rewritten to the honest contract
  (telemetry-alone renders `[]`), plus mission-keeps-status-row and
  degraded-confidence-keeps-row pins.
- **Q2** `coding-agent/src/core/tools/bash.ts` — new exported
  `bashDurationLineVisible(isPartial, durationMs)`: completed runs render
  the `Took <d>` line only at ≥ 1000 ms; partial (running) runs ALWAYS
  render the live `Elapsed <d>` line — occupied-wait stays non-negotiable.
  Test: `test/bash-duration-line.test.ts` (threshold both sides + the
  partial lane).
- **Q3** `coding-agent/src/utils/tools-manager.ts` — the recurring-failure
  latch: `.download-failures.json` in the bin dir (advisory, corrupt =
  empty, failed write non-fatal). First failure keeps the full two-line
  actionable notice; repeats render one dim line naming tool + attempt
  count + the manual way out (`UNOWN_MANAGED_TOOLS_VERBOSE=1` restores the
  full error); a found binary or successful download clears the counter.
  Test: `test/tools-manager-failure-latch.test.ts` (first/repeat/clear).
- **Q4** the quiet knobs graduate to hub-owned toggles. New
  `self-learning/src/settings/quiet-knobs.ts` (env > hub pref > default;
  explicit env locks the knob — kill switches stay king; live toggle writes
  update pref + `process.env` so both reader layers see one runtime source
  with zero circular imports). `types.ts` gains the three `HubPrefs`
  fields, `prefs.ts` parses them, `term.ts`'s
  `ensureUnownAgentDirInfo` seeds unset env vars right after
  `seedHubPrefs()` (every entry lane: TUI, print, dashboard),
  `registry.ts` flips obs.footer-classic/obs.turn-meter/obs.mission-panel
  from readonly to toggles backed by `applyQuietKnobPref`, and
  `.env.example` documents the new precedence. Test:
  `test/quiet-knobs.test.ts` (boot seeding, env lock, live write,
  effective readers).

**The full-suite interference war (two findings worth their own ink):**

1. *My own Q4 test leaked the suite's `UNOWN_HOME` redirect.* The first
   CP2-gate run failed `setup-catalog.test.ts` x2 (setup "succeeded",
   models.json vanished) — because `quiet-knobs.test.ts`'s afterEach did
   `delete process.env.UNOWN_HOME` and bun runs the suite's files in ONE
   process, every later file's per-call resolvers fell back to the real
   `~/.unown` (the 2026-10-22 incident class, verbatim) and the suite
   overwrote a live config with test endpoints. Fix: the file now leads
   with `import "./_env.ts"` and restores a load-time snapshot of every
   env var it touches (comment cites the incident). The live config was
   re-registered through `unown setup` against the real endpoint.
2. *The GitSpawn kill-timer flake is environmental, not code.* Proven with
   a minimal probe outside the repo: Bun 1.3.14's `spawnSync` timeout
   kills git but then waits on the grandchild (`sh -c 'sleep 5'`) holding
   the pipes — wall time 5004 ms vs the 5000 ms test timeout, a coin flip
   per run. Fails on pristine HEAD in this container (already canonized in
   the plan-mode-keyboard round's notes); passes on CI runners. Not this
   round's to fix; documented, not masked.

Also verified NOT pre-existing-vs-mine: the one-shot `--print` wedge when
run as this sandbox's foreground child (answers in ~1 s, then the process
survives SIGTERM) reproduces identically on pristine HEAD — environment,
not the round. With output to any file/fifo/pipe-to-tail the CLI exits in
3–5 s on both trees.

**CP2 gate:** full self-learning suite 5873 pass / 105 skip / 1 fail — the
fail is exactly the canonicalized kill-timer flake above. Focused lanes:
mission, quiet-knobs, settings-hub, settings-defaults-drift,
semplice-round, bash-duration-line, tools-manager-failure-latch,
bash-execution-width, agent-session-dynamic-tools — all green.
`pi-repo/bun.lock` clean (the v1-downgrade trap did not fire — no installs
this phase).

## CP3 — the verification receipts (2026-11-17)

Engine restarted onto the CP2 build before every lane (the stale-verdict
law). `build:unbundled` re-run. Receipts live under
`unown-density-captures/calando-cp3/` (density + multitool panes/PNGs).

**The density lanes (Q1 + Q2, before/after on the same scenario):**

| noise row | CP0 baseline | Calando CP3 |
|---|---|---|
| `Took 0.0s` (density 128) | line 22 | **gone** |
| `○ no tracked steps · on track ✓ · 0m in session` (density 128) | line 29 | **gone** |
| `Took 0.0s` x2 + null row (multitool 128) | lines 12/24/29 | **gone** |

Both lanes PASS their anchors (DENSITYOK at 128+72, MULTIOK at 128); the
72-col pane keeps the compact footer contract (📂 strip, ctx %, turn <1s).
The healthy pane is unchanged where it should be: collapsed tool blocks
with previews, two-row footer, attention-only chips, the 📂 session-state
strip — quiet removed exactly the three noise shapes, nothing else.

**The Q4 live receipt (and the bug it caught):** drove the real hub in a
PTY — `/settings` → control centre → Interface → the new
`Classic footer (legacy 4-row)` row → the item editor (risk badge, summary,
Now/Default/Lives-in, 1-4 quick select) → `1` (Turn ON). First run
exposed a REAL bug: the editor printed `Saved … = true` while `Now`
stayed off and the pref never landed. Root cause: `seedQuietKnobEnv` was
not idempotent — the boot seam is an ENSURE that fires again (dashboard
boot, reload), and the second pass mistook the first pass's own seeded
env vars for explicit env, silently locking every knob; the registry's
`set` also swallowed the refusal (a silent `false` still printed Saved).
Fix (committed with CP3): a one-shot guard on the seam
(`resetQuietKnobSeamForTests` for the per-case test lane, the
`resetGitAvailableCache` convention) + the three registry sets now THROW
on env-lock so the editor shows the honest `Write failed: … env var wins
— unset it in your shell` notice. New pin: "idempotent seeding: a second
ensure pass never locks". Second live run: `Saved ✓ · Now: on ✓ · option
flips to Turn OFF ✓ · settings-hub.json footerClassic: true on disk ✓`.

**The verify_settings_hub lane quirk (pre-existing, not the round's):**
its A1 (`/settings` → the hub menu) now times out because the hub opens
straight into the Search dialog — the submitted Enter leaks into the
select and picks the first option. Verified IDENTICAL on baf3e9f3
(pre-CP2, detached checkout): the lane's timing assumption drifted, not
the hub. The Q4 receipt above drives around it (Esc back, arrow keys);
rebinding that lane is filed for its owning round.

**Q3's live coverage:** unit pins (first/repeat/clear) + the boot receipt
— with tools present the pane shows no failure notice at all (correct);
the failure lane cannot be honestly triggered in a PTY without breaking
the network on purpose, so the repeat-line shape stays unit-pinned.

**CP3 gate:** full suite 5874 pass / 105 skip / 1 fail (the canonicalized
kill-timer container flake — again the only fail, 5021 ms against the
5000 ms test timeout). Focused lanes re-run green after the idempotency
fix: quiet-knobs (5), settings-hub, settings-defaults-drift, mission.

## CP4 — the docs/landing/blog sync (2026-11-17)

- **UX principles card** (`docs/unown-ux-principles.md`): the binding
  amendments — the information-hierarchy clause gains the mid-session
  law (telemetry alone is not a row; completed duration renders only at
  ≥ 1 s, the live Elapsed line always renders), the spam rule gains the
  recurring-failure latch (first failure full, repeats one dim line with
  the count, success clears — the crying-wolf failure mode), the
  kill-switch rule gains the hub-owned graduation ("a knob the user can
  only flip by editing shell config is not shipped either"), and the
  surface map's three quiet rows now carry "the hub toggle".
- **configuration.md**: the three knob rows document the hub toggle, the
  settings-hub.json field names, the env > pref > default precedence and
  the honest lock report; the mission row carries the Q1 null-state
  note.
- **Blog**: `content/blog/2026-11-17-the-calando-round.md` (type
  feature, tags tui/ux/research) with six stills — the baseline pane
  (noise visible), the after pane, the multitool pane, and the three Q4
  hub captures (menu / section list with the Classic footer row / the
  toggle landing). Assets + `.pane.txt` receipts in
  `public/blog/2026-11-17-the-calando-round/`; `landing_blog.mjs`
  regenerated (58 posts, feed + blog-data).
- **unown-overview.md**: the stamp's verification parenthetical gains
  the Calando sentence (the four surfaces counted against their
  sources; surfaces-not-counts again).
- **SESSION.md**: the round's IN FLIGHT entry carries the CP0–CP3
  progress + the CP4/CP5/CP6 shape.
- README deliberately untouched (the Semplice release's own convention —
  the docs index table row lands with a round that adds a doc page;
  Calando's record lives in the session doc the index already points
  at).

Gates at CP4: `check_docs` 0, `landing_blog.test.mjs` 9/9, `tsc
--noEmit` 0 errors.

## CP5 — the Dependabot + code-scanning sweep (2026-11-17)

Zero-open verified across the board: **0 open Dependabot alerts, 0 open
code-scanning alerts, 0 open PRs** (GitHub API, all manifests — the
Semplice round's five Dependabot streams incl. the benchmarks/edit-bench
bun-lock stream keep watching); `bun audit --all` at the repo root: **0
vulnerabilities** (458 packages, dev included). pi-repo's v3 lockfile
cannot be read by this sandbox's bun 1.3.14 (`UnknownLockfileVersion` —
the documented trap; the CI advisory-audit jobs under bun ≥ 1.4 own that
lane, and GitHub's 0-alert state covers its manifests). CI on the
round's commits: ad3e59f6 CI/CodeQL/Scorecard/deploy-verify ALL GREEN;
689b85e3 green as tagged. Nothing to remediate — the sweep's receipt is
the zero state itself.

## CP6 — the v0.0.71 cut (2026-11-17)

The CHANGELOG fold: the round's three CP entries (CP2/CP3/CP4) under
`[0.0.71]`; package.json **0.0.71**; `bun bin/unown --version` → 0.0.71;
the landing rail regenerated at **65 stops / 615 entries / 65 dated**
(`landing_changelog.mjs --check` ok). Tag `v0.0.71` cut on the release
commit per the version contract (tag = package.json), triggering the
six-per-OS release matrix.

**The release receipt (run 44104750062):** CI-green-on-tag, the three
3-OS release assertions, production build + SBOM all green on attempt
1; the macos-latest (darwin-arm64) leg was cancelled TWICE by the
hosted-runner queue (~15 min parked, zero steps — platform-side pool
starvation, not a workflow timeout; both cancellations receipted in the
run history) and landed on the third re-run of the failed jobs. Final
state: **run SUCCESS on attempt 3** — every per-OS artifact executed
(linux-x64, linux-arm64, windows-x64, darwin-x64, darwin-arm64), the
GitHub release created with **13 assets** (the six per-OS binaries +
installers + release.json + SBOM + sha256sums + checklist + version),
not draft, Latest slot, the published feed verified, and the 3-OS
install matrix green. Zero open Dependabot/code-scanning alerts at
close; CodeQL + Scorecard green on the tagged commit.




## Phase ledger

| CP | Name | Status | Artifact |
|----|------|--------|----------|
| CP0 | Research + baseline | DONE | this file + PTY density baseline |
| CP1 | Gap analysis → intervention set | DONE | the Q-list above |
| CP2 | Implementation (end to end) | DONE | the Q1–Q4 section above |
| CP3 | Verification (unit + PTY + suites) | DONE | the CP3 section above |
| CP4 | Docs/DOX/landing/blog sync | DONE | the CP4 section above |
| CP5 | Dependabot + code scanning sweep | DONE | the CP5 section above |
| CP6 | Version bump + release + OS builds | DONE | the CP6 section above |

## Environment notes (for resume)

- Sandbox recycles kill processes but keep `/home/z/my-project/`;
  `scripts/rebuild_unown.sh` (working-tree copy, outside the repo) restores
  clone → installs → model-data hydrate → `build:offline` → `.env` →
  services → verify in one idempotent run (~6 min).
- **pi-repo/bun.lock trap**: bun 1.3.14 rewrites the v3 lockfile to v1 on
  every `bun install` in pi-repo. Restore with
  `git checkout -- pi-repo/bun.lock` after ANY install there; never commit
  the downgrade.
- PTY lane: `python3 scripts/tui-capture/pty_density.py` needs
  `pip install pyte pexpect pillow numpy`; services must be up
  (`bun run agent:start`); a stale engine is a stale verdict — restart
  onto the current tree before lane runs (Divertimento law).
- First PTY spawn after a recycle is a cold boot (~90 s bun compile); the
  120 s default ready-timeout can race — the lane's own ready anchors are
  correct, patience is the fix.
- The self-learning suite runs from `pi-repo/packages/self-learning`
  (`bun test test/`, ~260 s), never from the repo root; after vendored
  changes run `bun run build:unbundled` in coding-agent first or the TUI
  won't boot.

## The baseline (CP0)

`scripts/tui-capture/pty_density.py` — one real tool turn (write hi.py,
run it, reply DENSITYOK) captured at 128 and 96 cols against v0.0.70
(10fcdb22). Receipts: `unown-density-captures/run/` (pane dumps + PNGs +
geometry). Findings Q-list opens at CP1 against those panes.
