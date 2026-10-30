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

### Environment checkpoint (2026-10-31, setup complete)

- Cloned `kanishka-namdeo/Unown` @ `68055455` (v0.0.48).
- bun `1.4.4` installed at `~/.bun/bin/bun` (floor is 1.4 — lockfileVersion 3).
- `bun install` at root + `pi-repo/` — green.
- `bun scripts/install.ts` ran with `UNOWN_NO_ENGINE_SERVICE=1 CI=1` (sandbox:
  no systemd user unit) — linked `unown` → `~/.local/bin/unown`.
- `.env` created from `.env.example`; `BRIDGE_UPSTREAM_KEY` set (Agnes AI);
  upstream `https://apihub.agnes-ai.com/v1`, model `agnes-3.0-flash`.
- `bun run agent:start` — bridge :3031 (upstream ok, 9 models), engine :3030
  (phase ready, token auth).
- `unown doctor` — green (2 expected infos: unverified model spec, no LSP).
- Headless smoke: `unown -p "Reply with exactly: SMOKE_OK" --max-turns 2` →
  `SMOKE_OK` (full loop TUI→bridge→Agnes verified).

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
- Unown's settings surface today: pi `/settings` (theme/interface, upstream),
  `/addons` configurator (self-learning), `/permissions`, `/project-settings`,
  plus ~66 Unown slash commands in self-learning (`/memory`, `/mcp`, `/hooks`,
  `/engine`, `/goal`, `/routines`, `/providers`, `/output-style`, `/split-*`,
  `/lsp`, `/checkpoints`, `/undo`, ...), env vars (`.env.example`), CLI flags
  (`cli.ts` HELP), config files (`settings.json`, `addons.json`, `models.json`,
  `auth.json`, `mcp.json`, hooks config, permissions config, `.unown/settings.json`).
- Round conventions (from `/abort` + PLM rounds): competitor research doc,
  session log, code (self-learning ± vendored pi), unit tests BOTH suites,
  PTY verification script under `scripts/tui-capture/`, CHANGELOG entry,
  landing/blog/DOX updates, push per milestone.

### Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| 0 setup + run | ✅ done | this file |
| 1 inventory | in flight | `docs/settings_inventory.md` |
| 2 competitor research | in flight | `docs/settings_competitor_review.md` |
| 3 user journeys | pending | `docs/settings_user_journeys.md` |
| 4 IA redesign | pending | IA section of `docs/settings_ia_redesign.md` |
| 5 edge-case catalogue | pending | `docs/settings_edge_case_catalogue.md` |
| 6 trust engineering | pending | `docs/settings_trust_recovery_framework.md` |
| 7 missing settings | pending | implemented in `src/settings/` |
| 8 TUI redesign | pending | `src/settings/` + vendored patches |
| 9 benchmarks | pending | `benchmarks/settings-ux/` |
| 10 self-improvement | pending | learning artifacts |
