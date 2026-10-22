# @earendil-works/pi-self-learning

The self-learning layer for the [pi coding agent](https://github.com/badlogic/pi-mono):
a single package that turns pi into an agent that **finds its own weaknesses,
fixes them, and remembers what worked**.

Implementations:

1. **Tiered memory** (`memory.ts`, `memzero.ts`) — `policy → project → user → local`,
   most-specific-wins, versioned + rollback-able, injected into every pi
   session via `agentsFilesOverride`. Since the learning-core swap the project
   tier is backed by the **Mem0 memory platform** ([memzero.ts](src/memzero.ts),
   the `mem0ai` OSS TS SDK, in-process): rules ship in as atomic memories and
   the tier file is a deterministic markdown render of them; the other three
   tiers stay plain string-append files.
2. **Self-improving harness** (`harness.ts`) — baseline → mine failure →
   propose memory patch → candidate run → ship/reject → regression sweep.
   Ships record their memory version *and* their platform memory ids; a later
   baseline failure auto-unships the patch — deleting exactly those memories
   and re-rendering the tier (retention check).
3. **Routing** (`router.ts`) — interval + event jobs with a busy-mutex.
4. **AutoDreaming** (`dream.ts`) — consolidate session notes into memory.
   The consolidation engine is the Mem0 platform: notes are quarantined or
   admitted structurally (flagged notes never reach the extraction LLM),
   extracted as atomic scoped memories, reconciled (recency-first
   contradiction resolution, dedup, pruning — mem0's own update/delete
   primitives, so every change lands in its history), and rendered back into
   the same markdown files. Benchmark dreams are gated by a canary run (a
   failing or crashing canary rolls back the memory version *and* the
   platform event stream); terminal notes are dreamed into their own
   project's `.unown/memory/project.md` (pre-swap content imports verbatim at
   the first dream). Decision record: the repo's
   `docs/memory-platform-swap-assessment.md`.
5. **Hooks** (`hooks.ts`, `termhooks.ts`) — SessionStart / UserPromptSubmit /
   PreToolUse / PostToolUse / Stop / SubagentStop guardrails, fully logged.

Plus the **terminal agent** (`cli.ts`, `term.ts`) — the `unown` command boots
the real pi TUI (or `-p` headless mode) in the user's project with tiered
memory, terminal-scoped guardrails and session-note capture. Notes reach the
engine via `POST /api/notes` or the offline outbox (`~/.unown/notes/outbox/`,
synced by the `note-sync` job / `outbox.ts`).

Supporting modules: `sandbox.ts` (isolated workspaces, jailed exec, sha256
tamper-proof verification), `bwrap.ts` (the OS-level sandbox: bubblewrap on
Linux, seatbelt/sandbox-exec on macOS — see the section below),
`runner.ts` (headless pi deployment + transcripts),
`notes.ts` (session-note capture, benchmark + terminal kinds), `tasks.ts`
(seeded benchmark tasks), `store.ts` (SQLite persistence with schema
migrations), `server.ts` (REST + SSE API), `llm.ts` (bridge client),
`bus.ts` (in-process event bus), plus `mint.ts` (task authoring + validation +
graduation), `skills.ts` + `skill-seeds.ts` (AutoDream-minted Agent Skills),
`setup.ts` (provider wizard), `probe.ts` (endpoint probes), `tools.ts` (terminal
session tools), `theme.ts` (brand theme), `term.ts`, `cli.ts`, `index.ts`,
and `memzero.ts` (the Mem0 memory platform: in-process Memory singleton,
embedder resolution with lexical fallback, the governed-LLM wrapper, the
reconcile pass, the markdown render, event-stream revert, legacy import).

## Running

The engine is booted by `mini-services/agent-service` at the repository root:

```bash
bun run agent:start      # or: cd mini-services/agent-service && bun index.ts
```

The terminal agent is booted by the repository root `bin/unown`:

```bash
bin/unown                # interactive TUI in the current directory
bin/unown -p "prompt"    # one-shot headless
bin/unown doctor         # configuration diagnostics
bin/unown memory         # print the effective memory stack
bin/unown note "text"    # deliver a note to the engine
```

Both require the sibling pi packages to be built (`cd ../../.. && bun run build`)
and an OpenAI-compatible endpoint reachable at `PI_BRIDGE_URL` (default
`http://127.0.0.1:3031`, served by `mini-services/llm-bridge`).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PI_AGENT_PORT` | 3030 | REST + SSE API port |
| `PI_BRIDGE_URL` | http://127.0.0.1:3031 | LLM endpoint base |
| `PI_MODEL_ID` | kimi-k2.5 | Model id registered with pi |
| `PI_PROVIDER` | zai-bridge | Provider name registered with pi |
| `PI_SELFLEARNING_DATA` | `<repo>/data/self-learning` | Runtime data dir |
| `PI_SELFLEARNING_DB` | `<repo>/db/selflearning.db` | SQLite file |
| `PI_DREAM_GATE` | on | `0` disables the dream canary gate |
| `PI_MEM0_DIR` | `DATA_DIR/mem0` | Mem0 platform data dir (`vector_store.db` + `history.db`) |
| `PI_MEM0_EMBEDDER` | `auto` | `onnx` \| `lexical` \| `auto` (the local-ml lane, else the lexical fallback) |
| `PI_MEM0_MAX_RENDERED` | `110` | render bullet cap (hard-won rules immune) |
| `PI_MEM0_RECONCILE` | on | `0` disables the reconcile pass (mem0 additive-only) |
| `UNOWN_HOME` | `~/.unown` | Terminal-agent state dir (agent config, global memory, note outbox) |
| `UNOWN_ENGINE_URL` | http://127.0.0.1:3030 | Where the terminal agent delivers notes |
| `UNOWN_STRICT_HOOKS` | off | `1` = sandbox-grade hooks in terminal sessions |

## OS-level sandbox (Linux: bubblewrap · macOS: seatbelt)

Every engine sandbox command — verify scripts directly, and every agent
bash-tool command through the generated `unown-sandbox-shell` wrapper
(`runner.ts` injects it as the session's `shellPath`) — runs under the
host's OS sandbox, dispatched per platform by `src/bwrap.ts`:
bubblewrap on Linux (vendored binary, see `native/README.md`) and a
generated seatbelt profile under `sandbox-exec` on macOS. Hosts without
a backend (native Windows) fall back to the in-process TypeScript path
jail. `unown doctor` reports which backend is active.

Semantics parity (bwrap vs seatbelt):

| Property | Linux (bubblewrap) | macOS (seatbelt) |
|---|---|---|
| root filesystem | `--ro-bind /` (read-only) | `(allow file-read*)` over `(deny default)` |
| host `$HOME` | hidden — private tmpfs on `/home` | **readable** (writes denied) — no tmpfs on darwin |
| tmp areas | private tmpfs on `/tmp` `/var/tmp` | writes allowed to `/private/tmp` + `/var/folders` — **shared with the host**, not private copies |
| workspace | bind rw at its real path | `(allow file-write* (subpath "<realpath>"))` |
| `/dev/null` writes | fresh `/dev` has device nodes | `(allow file-write* (literal "/dev/null"))` |
| network | `--unshare-net` namespace | `(deny network*)` syscall-level deny |
| process/IPC | `--unshare-ipc`, caps dropped | `(allow mach-lookup)` (no IPC-namespace equivalent), `(allow signal (target self))` |
| session hardening | `--new-session`, `--die-with-parent` | no equivalent (residual) |

The two documented darwin asymmetries (no mount namespaces on macOS):
**reads of the host filesystem — including `$HOME` — stay allowed** (same
as bwrap's read-only bind of `/`, but bwrap's `/home` tmpfs additionally
hides the host home), while **writes outside the workspace/tmp areas are
denied exactly like bwrap's tmpfs mounts**; the tmp areas are shared with
the host instead of private copies. Reads never leave the machine and the
engine's data/repo secrets are write-protected either way.

Environment knobs (root `.env`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `UNOWN_OS_SANDBOX` | on | `0` disables the OS sandbox (TS path jail remains) |
| `UNOWN_SANDBOX_NET` | blocked | `1` keeps the network shared (`--unshare-net` dropped / `(allow network*)`) |
| `UNOWN_BWRAP` | vendored binary | explicit bwrap path on Linux |
| `UNOWN_SANDBOX_EXEC` | `/usr/bin/sandbox-exec` | explicit sandbox-exec path on macOS |

The seatbelt profile is generated per workspace (deterministic
`<os.tmpdir()>/unown-seatbelt-<sha256(workspace)[:16]>.sb`) and the shell
wrapper regenerates it at invocation time from the session cwd — one
wrapper serves every run. `sandbox-exec` is deprecated by Apple but
shipped on every macOS and is what shipping agents (Claude Code, Codex)
use today.

## API surface (port 3030)

The canonical, kept-in-sync route list lives in `docs/detached-engine-architecture.md` ("The engine API surface"; ultimately `src/server.ts`); `GET /api/events` is the SSE stream. The package is UI-free and can be embedded in any host process. The TUI dashboard (`src/dashboard/`) is the first-party client, tested against the typed mock at `test/dashboard-mock-engine.ts`.
