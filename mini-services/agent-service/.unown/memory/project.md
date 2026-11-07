# Project Memory

## Known pitfalls
- Agent-service's index.ts is a 20-line wrapper that boots the self-learning engine on port :3030, exits 0 on single-instance lock loss for supervisor health, and exits 1 on fatal errors.
- Direct localhost engine health checks via localhost:3030 fail when attempted from the unattended probe environment.

## Environment
- In pi-repo/packages/self-learning/src/dream.ts, idempotent dream runs inflate version numbers because the no-change checks at ~line 256 and ~line 847 use raw string equality on rendered markdown that includes a volatile timestamp footer.
- The outbox dead-letter path requirement is satisfied in src/term.ts at ~line 68, where UNOWN_NOTES_DEAD_DIR resolves to $UNOWN_HOME/notes/dead, and this path is pinned by test/outbox-deadletter.test.ts.

## Facts
- Agent-service's package.json defines dev: 'bun --hot index.ts' as documented in mini-services/AGENTS.md.
- Agent-service's smoke.ts is a manual headless smoke harness that tests through the llm-bridge.
- The `agent-service` in `/home/z/my-project/Unown/mini-services/agent-service` uses a 'FUGUE_LIVE_OK' signal to indicate a successful live terminal session check.
- Self-learning engine requirements for pendingTerminalNotesByProject path-grouping with a 12-note per-project cap, consumePathlessTerminalNotes, runDream note-consumption paths, and the review-mode gate are already implemented correctly.

## Manual notes
- Your own durable rules. AutoDream preserves this section verbatim — one
  bullet per rule; everything outside it is re-rendered.

<!-- unown: rendered 8/8 memories via Mem0 (backend: lexical) at 2026-11-07T14:55:07.932Z -->
