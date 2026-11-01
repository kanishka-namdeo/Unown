# Unown — Session Log (running index)

The repo keeps one session log per engineering round (`docs/*-session.md`).
This file is the **resumable checkpoint index** for in-flight work: each entry
records the mission state so any session can be resumed later without
archaeology. When a round completes, its log graduates to a round-specific
`docs/<round>-session.md` and this index keeps only the pointer.

---

## ACTIVE ROUND — none (the browser autonomy round graduated; plan mode V3 is in flight in its own lineage)

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
(two rebases, zero conflicts) and is still in flight in its own lineage.

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

**The next round's queue (recorded, in priority order)**: the browser
autonomy round's carries-overs first — #46 (the dream-render/landing-quote
coupling: gate-side or renderer-side fix; two occurrences in one day) —
then #45 (the tool-time browser-memory hint lane — recall works,
proactive application doesn't), #44 (the screenshot extension/format
reconciliation), the warm docs-navigation benchmark on a second
technology, the skill-promotion decision for the hostile-checkout
procedure, and the release-monitoring routine's first weekly run
(`auto-mvxw0wne-onkwcn`, 2026-11-08); then the pre-existing queue: the S2
ledger's head — S2-11 (the spend meter) and S2-4 (the memory health card),
each flipping a pinned, waiting benchmark miss — then S2-7/S2-8/S2-9, the
S2-3/S2-16 L-pair, S2-22 (see the settings log's "Resume-from-here"); the
injection-scanner ML classifier (the production TODO); the delegation
round's subagent-reuse axis; OB-7 (fleet outcomes in the brief); the
landing next-round queue (cmd-K search, blog hover-previews); the term.ts
snapshot-class follow-up (release-recovery CP2); the plan mode V3 round's
own milestones (its session log owns that queue). When the first v0.0.56
content lands, re-add `## [Unreleased]` to CHANGELOG.md and regenerate the
rail in the same commit; the version bump itself is the release commit
(package.json version + dated heading + rail + tag on the green SHA).

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
