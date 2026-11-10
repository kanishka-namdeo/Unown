# End-User Combination Round — Session Log (2026-11-10)

Session doc per the repo's checkpoint discipline. Resume from the latest
checkpoint if this session is interrupted.

Objective (user task): *"test all possible usecases and combinations of
unown's end user experience. fix whatever is not upto latest standards or
not performing upto expectations. implement new features and workflows if
needed to achieve success."* — then document at each checkpoint, push every
milestone, update the landing/README/docs surfaces, and bump the version.

The charter follows the 2026-11-09/10 combination rounds
(`docs/plan-mode-tui-combo-round-session.md`,
`docs/plan-mode-tui-combo-2-round-session.md`,
`docs/memory-engine-combo-round-session.md`), applied to the **whole
end-user surface**: every combination of entry lane (TUI / print /
resume / plan) × management command × service (bridge / engine / landing /
apps) × platform artifact (installers, completions, update) — driven live,
as a real user against the real model, and graded against the late-2026
floor (`docs/end-user-standards-2026-11.md` — the round's grounding
research).

## Method (as a real user, against the real model)

- Fresh clone at v0.0.60 (f8302387, main); bun 1.4.3 side-installed at
  `~/.bun/bin` (the sandbox's 1.3.14 cannot parse `pi-repo/bun.lock`
  lockfileVersion 3).
- `.env` carries `BRIDGE_UPSTREAM_KEY` **and** `AGNES_API_KEY` (Agnes AI
  `https://apihub.agnes-ai.com/v1`, metered free tier ~20 RPM — the
  bridge's spacing/concurrency guards stay on; model `agnes-3.0-flash`).
  Engine OS service skipped in the container (`UNOWN_ENGINE_AUTOSTART=0`,
  `UNOWN_NO_ENGINE_SERVICE=1`) — the engine is driven through
  `bun run agent:start`.
- GitHub auth: the PAT in the git remote URL (repo convention).

## Checkpoint 0 — environment (2026-11-10, OPEN)

- Fresh clone OK; **`bun run agent:start` right after `bun install` left
  the engine DOWN** (`Cannot find module '@earendil-works/pi-coding-agent'`
  — pi-repo workspaces not installed by the root install). F1 candidate:
  the quickstart says `bun install && bun run agent:start` in places; the
  full installer (`bun run agent:install`) is the path that works. Verify
  what the README quickstart actually instructs (see matrix lane A).
- `bun run agent:install` 7/7 green (engine service skipped by env);
  `~/.local/bin/unown` shim written (with the PATH warning + the exact
  profile line — good error craft).
- Stack green: bridge :3031 (`upstream ok 200`, 6 agnes models discovered
  upstream) + engine :3030 (401 to a bare curl — the M7 bearer token,
  expected).
- `unown doctor` — green with 2 expected warnings (unverified model spec
  on first run, no LSP servers). `unown --version` → `0.0.60 · f8302387`.
- Real-user smokes: `unown -p "Read greet.js and tell me..."` → correct
  one-line answer in 4.1 s (full CLI→bridge→Agnes round trip);
  `-p --mode json` → clean NDJSON envelope (session/agent_start/turn
  events, per-message usage, agent_end, agent_settled), exit 0, stderr
  clean.
- **F0 (external state, from the round's research)**: CI on `main` is RED
  (runs #1102–#1107, 2026-11-10) — Playwright browser binaries missing
  after the version bump, `encore.test.tsx` Expected 11 / Received 12,
  "multiple elements with role heading", a fetch to `localhost:3100`
  failing — while `package.json` sits at unreleased 0.0.60 vs the last
  tagged release v0.0.57. Deploy-verify runs #528–#534 fail accordingly
  (by design: they mirror main's CI). Reproduce locally in the matrix
  (lane J) and fix — a red main is the loudest "not performing up to
  expectations" state a repo can be in.
- **Open issues inherited** (self-filed, all end-user facing):
  #29 background starvation · #30 print-mode hang after answer · #43
  iframe form-fill loss · #44 JPEG bytes under .png · #45 proactive
  dialog lessons · #46 AutoDream prunes quoted landing lines · #48
  doctor crash on malformed model-specs.json. This round's matrix should
  re-verify each against current main (some may already be fixed — verify
  before duplicating work).

## The combination matrix (this round's enumeration)

| Lane | Surface | Combinations driven |
|---|---|---|
| A | First-run / install | fresh clone → install → doctor; README quickstart fidelity; installers (`install.sh`/`install.ps1` `--inspect`) |
| B | CLI surface | `--help`, `--version`, every management subcommand (setup, models, providers, mcp, doctor, doctor-instructions, info, note, memory, init, init-agents, update, changelog, completions, sessions, import, blame, recipes, wiki, worktrees, acp, usage, webcache, repomap, ralph, watch, routines, engine) |
| C | Print mode | `-p` text/JSON; exit codes 0/1/2/3/4; `--max-turns`; `--output-schema`; `--worktree`; loop guard; stderr/stdout separation; NO_COLOR |
| D | Session lifecycle | `-c`, `--resume` id/name/path/picker, `sessions list/export/import`, both session stores |
| E | Plan mode | `--plan` print + TUI matrix (the PTY lane), `/plan`, plan-model split, budget |
| F | Engine REST+SSE | overview/health/notes/dreams/routines through the bearer token; dashboard data lanes |
| G | TUI dashboard | `unown dashboard` screens via PTY |
| H | Apps | coda/ostinato/legato/bolero/chaconne/fugue unit + smoke lanes |
| I | Landing + blog | dev server routes, a11y, SEO, installers served, feed |
| J | CI gates locally | typecheck, lint, unit, docs/changelog/blog/benchmarks/claims gates, e2e — reproduce main's red lanes and fix |

## Findings ledger (updated at each checkpoint)

- **F0** — CI red on main (see above). Lane J.
- **F1** — engine DOWN on the `bun install`-only path (see Checkpoint 0).
  Verify the README quickstart; if it tells users to `bun install` +
  `agent:start` directly, that lane is broken for every fresh clone.
- (further findings appended at each checkpoint)

## Checkpoints

- [x] CP0 — environment up, smokes green (this section)
- [ ] CP1 — research records committed (M1)
- [ ] CP2 — matrix lanes A–J driven, findings ledger filled (M2)
- [ ] CP3 — fixes landed, lanes re-run green (M3)
- [ ] CP4 — round close: records, contracts, blog, version bump (M4)
- [ ] CP5 — review hardening: full gate re-run, receipts (M5)
