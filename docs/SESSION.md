# Unown — Session Log (running index)

The repo keeps one session log per engineering round (`docs/*-session.md`).
This file is the **resumable checkpoint index** for in-flight work: each entry
records the mission state so any session can be resumed later without
archaeology. When a round completes, its log graduates to a round-specific
`docs/<round>-session.md` and this index keeps only the pointer.

---

## ACTIVE ROUND — the Settings Evolution round (started 2026-10-31)

**Mission**: redesign, validate, benchmark and self-improve the complete
Settings experience of Unown's TUI (see `docs/settings-evolution-session.md`
for the full mission brief and phase ledger).

Round status: **round 1 shipped inside v0.0.49** (phases 1–8 — the six phase
docs + the `/settings` hub, `4740224f` + `f02e4e26`). **Round 2 in flight**
(2026-10-31, post-v0.0.50 @ `499a9412`): phase 9 benchmarks + phase 10 learning
artifacts + the S2 ledger of open items. Resumable log:
`docs/settings-evolution-session.md`.

### Environment checkpoint (2026-10-31, round 2 — setup complete)

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
