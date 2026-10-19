# ACP — the editor integration (`unown acp`)

> The Agent Client Protocol adapter: JSON-RPC 2.0 over stdio, so any ACP-capable
> editor (Zed, …) can drive the full unown agent — memory, hooks, permissions,
> tools — instead of a stripped-down headless mode.

- [Point an editor at it](#point-an-editor-at-it)
- [Protocol scope](#protocol-scope)
- [What rides along](#what-rides-along)
- [Mediated reads and the write jail](#mediated-reads-and-the-write-jail)
- [Permissions over ACP](#permissions-over-acp)
- [Session persistence and load](#session-persistence-and-load)
- [Related pages](#related-pages)

## Point an editor at it

```text
agent program: unown
arguments:     acp
```

In Zed: Settings → Agent → Agent Servers, or the `agent_servers` setting:

```json
{
  "agent_servers": {
    "My Unown": {
      "command": {
        "path": "unown",
        "args": ["acp"]
      }
    }
  }
}
```

`unown acp` runs the server on stdio (stdout is protocol-only — banners and
extension logging degrade to stderr; `--verbose` adds protocol tracing).
stdin EOF exits 0; SIGTERM/SIGHUP clean up tracked child processes first.
The server must run with your normal environment: it reads the same
`~/.unown/` state and the same project `.unown/` directories as the terminal
agent, and it needs the model provider configured (`unown setup`) — the
editor's cwd per `session/new` becomes the session's project directory.

## Protocol scope

ACP v1 (agentclientprotocol.com): JSON-RPC 2.0, newline-delimited (one JSON
object per LF-terminated line — no Content-Length headers), editor is the
client, `unown acp` is the agent.

| Method | Direction | Status |
|---|---|---|
| `initialize` | editor → agent | capability negotiation; reports `loadSession`, `promptCapabilities.image/embeddedContext`, agent name + version |
| `session/new` (+ pre-v1 `newSession` alias) | editor → agent | creates a session in the given cwd through the full unown boot |
| `session/prompt` | editor → agent | text / resource / resource_link / image prompt blocks; returns the ACP `StopReason` (`end_turn`, `max_tokens`, `cancelled`, `refusal`) |
| `session/cancel` | editor → agent | aborts the in-flight prompt (maps to pi's abort) |
| `session/load` | editor → agent | resumes a persisted unown session and replays the conversation as `session/update`s |
| `session/set_mode` (+ draft aliases) | editor → agent | accepted; no prompt modes are advertised |
| `session/update` | agent → editor | streamed `user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` |
| `session/request_permission` | agent → editor | the permissions layer's `ask` flow (below) |
| `fs/read_text_file` | agent → editor | mediated reads outside the project jail (below) |
| `fs/write_text_file` | agent → editor | **deliberately not advertised** |

Unknown methods answer JSON-RPC `-32601`; requests before `initialize`
answer `-32002`; non-JSON stdin lines are skipped, never fatal.

## What rides along

Every session boots through the same factory the terminal CLI uses
(`bootRuntime` in `cli.ts`): tiered memory injection, terminal guardrail
hooks, the granular permissions layer, the unown session tools, LSP, MCP.
An editor session is a full session — `/undo`, checkpoints and receipts all
work on the files the session touches. Session notes queue to the engine
exactly like terminal sessions (outbox while the engine is down).

## Mediated reads and the write jail

The agent's own `read`/`edit`/`write` tools work unchanged **inside** the
session's project directory. When a read targets an absolute path *outside*
the project (the write-path jail boundary — see [guardrails](usage.md#guardrails))
and the editor advertised `fs.read_text_file`, the read is *mediated*: the
adapter sends an `fs/read_text_file` request to the editor and uses its
response. The editor thereby authorizes out-of-project reads that the plain
terminal agent would simply refuse; a timeout or editor error denies the
read (fail-closed).

`fs/write_text_file` is intentionally not advertised: out-of-project writes
are forbidden by a hard guardrail, and an editor callback must not be able
to override the jail — the same reasoning as the permissions layer's "rules
can only add restrictions" contract.

## Permissions over ACP

The [granular permissions](permissions.md) layer's `ask` effect surfaces as
a `session/request_permission` request to the editor: options map to
`allow_once` / `allow_always` / `reject_once`. An editor that cancels, times
out or answers garbage gets **deny** — the documented fail-closed policy for
unattended surfaces. `allow_always` persists as a session-scoped allow rule,
same as answering the TUI dialog.

## Session persistence and load

`session/new` persists under `~/.unown/agent/sessions/` like every session.
`session/load` takes a unown session id, finds the newest matching session
file (suffix `<timestamp>_<id>.jsonl`), resumes it and replays the
conversation so the editor's transcript fills in — then conversation
continues from the resumed leaf.

## Related pages

- [usage.md](usage.md) — the terminal surface; `--output-format json` is the scripted-CI counterpart of this protocol
- [permissions.md](permissions.md) — the allow/deny/ask layer this adapter surfaces
- [subagents.md](subagents.md) — the other embedding surface (task tool)
- [configuration.md](configuration.md) — env vars, state layout, provider wiring
