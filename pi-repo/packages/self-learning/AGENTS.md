# Self-learning engine (pi-repo/packages/self-learning/)

## Purpose

Unown's core transformation: the self-learning layer that turns the vendored pi coding agent into an agent that finds its own weaknesses, fixes them, and remembers what worked. Implements the five mechanisms: tiered memory (`memory.ts`), self-improving harness with retention auto-unship (`harness.ts`), routing/background jobs (`router.ts`), AutoDreaming with canary gate (`dream.ts`), and 6-layer hooks (`hooks.ts`, `termhooks.ts`). Also provides the `unown` terminal agent (`cli.ts`, `term.ts`) and the REST+SSE API the dashboard consumes (`server.ts`).

This package is Unowned (modified from upstream pi-mono); sibling packages (`ai`, `agent`, `tui`, `server`, …) are upstream code — their rules live in `pi-repo/AGENTS.md`.

## Ownership

- Owns: everything under `src/` in this package (memory, hooks, notes, harness, dream, router, sandbox, runner, term, termhooks, cli, outbox, store, server, tasks, llm, bus) plus `README.md`.
- The module map in `README.md` is authoritative for what each `src/*.ts` file does.

## Local Contracts

- Booted by `mini-services/agent-service` (port 3030) — never run standalone for the stack; `bun run agent:engine` for dev.
- Environment (defaults in parentheses): `PI_AGENT_PORT` (3030), `PI_BRIDGE_URL` (http://127.0.0.1:3031 — served by llm-bridge), `PI_MODEL_ID` (model id registered with pi; current: kimi-k2.5), `PI_PROVIDER` (zai-bridge), `PI_SELFLEARNING_DATA` (`<repo>/data/self-learning`), `PI_SELFLEARNING_DB` (`<repo>/db/selflearning.db`), `PI_DREAM_GATE` (on; `0` disables the dream canary gate), `UNOWN_HOME` (~/.unown — terminal-agent state), `UNOWN_ENGINE_URL` (http://127.0.0.1:3030), `UNOWN_STRICT_HOOKS` (off; `1` = sandbox-grade hooks in terminal sessions).
- Model registration: `llm.ts` writes `models.json` into the generated pi agent dir (`data/self-learning/pi-agent-dir/`) from `PI_MODEL_ID`/`PI_BRIDGE_URL`. Local template contract (in `runner.ts`, `term.ts`): input `["text","image"]` (VLM enabled), contextWindow 131072, maxTokens 8192. The terminal agent's copy lives at `~/.unown/agent/models.json`.
- API surface on :3030 is the dashboard contract — see `src/lib/AGENTS.md` for the endpoint list; changing an endpoint requires updating that doc in the same change.
- Learning-integrity gates are binding behavior, not tunables to remove: ship gate (candidate run must pass in a fresh sandbox), dream canary gate (consolidation must re-pass the most recently passing task, else rolled back to status `gated`), retention check (later baseline failure auto-unships the improvement and rolls memory back), full version history (every tier write is versioned + attributable).
- Sandboxes: every harness/task run deploys a fresh isolated workspace, jailed exec with timeouts/output caps, sha256-pinned verification tests.
- Runtime state (gitignored): `data/self-learning/` and `db/selflearning.db` — created/seeded on first boot (default memory tiers, five benchmark tasks: fizzbuzz, impl-debounce, map-limit, drop-right, fix-csv-parser; router jobs).
- Per-project memory: AutoDream consolidates terminal session notes into `<project>/.unown/memory/project.md`; notes queue offline in `~/.unown/notes/outbox/` and sync via the `note-sync` job / `outbox.ts`.

## Work Guidance

- Requires sibling pi packages built: `cd pi-repo && bun run build:offline` (install: `scripts/install.sh`).
- Engine internals follow the parent `pi-repo/AGENTS.md` code-quality rules (no `any`, top-level imports only, erasable TypeScript syntax).
- Verify with `unown doctor` (bridge/engine/memory config), `unown memory` (effective 4-tier stack), `unown -p "…" < /dev/null` (headless run in non-TTY shells).
- Single-tenant busy-mutex: one cycle at a time; don't add parallel harness loops.
- Upstream re-sync caveat (local patches vs pi-mono upstream): models.json templates in `runner.ts`/`term.ts` (text+image input, 131k/8k), `server.ts` overview reporting the real provider/model, and repo-wide build fixes (`generate-models.ts` kimi-code-plan rename handling, `opencode-go.ts` google-generative-ai union, root `https-proxy-agent@7.0.6` dev dep). Re-apply or re-verify these after pulling upstream pi-mono changes.

## Verification

- `curl -s localhost:3030/api/overview` → up, provider `zai-bridge/kimi-k2.5`.
- `bin/unown doctor` from the repo root → all green.
- A Learning Lab cycle passes end to end (sandboxed pi agent → bridge → model, with tool calls) and the router's autonomous runs pass; AutoDream produces a versioned memory update.
- Watch behavior live in the dashboard (:3000) — Learning Lab / Dreams / Router tabs.

## Child DOX Index

(none — flat `src/` module set; the README module map is the index)
