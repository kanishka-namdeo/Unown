# The Rondo round — Claude Code touch study, round 2 (2026-11-16)

**Mission (operator directive, verbatim scope):** "reverse engineer claude code TUI experience like an expert UI/UX research from all popular and niche online sources. understand how it applies to all our features and capabilities and implement the learnings end to end. test, iterate and improve Unown's experience."

A rondo is a form in which the principal theme returns. The Toccata round (v0.0.68) closed the first five gap clusters; this round re-sweeps against fresh evidence — the official docs at their 2026-11-16 shape, the complete CC v2.1.300→v2.1.325 changelog delta, the community catalog, and the late-2026 sibling landscape — and ships the second gap cluster.

Research artifact: `docs/tui-claude-code-parity-research-2.md` (audit R1–R18, adoption decisions, sources).

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| CP0 research — the round-2 teardown + audit R1–R18 | ✅ done | `docs/tui-claude-code-parity-research-2.md` |
| CP1 the input lane — paste-pill search (R6), invisible-char sanitization (R7), keybinding validation (R15) | pending | |
| CP2 the status lane — title states (R1), spinner amber (R5), notification channels + needs-input (R13) | pending | |
| CP3 the command lane — /color (R9), /keybindings (R10), /tui (R11), /copy [N] (R12), /redraw (R3), /terminal-setup (R14) | pending | |
| CP4 the statusline (R2) + external-editor context (R4) + settings-hub rows | pending | |
| CP5 the mouse lane — click-to-send (R8) + refocus recap (R16) | pending | |
| CP6 verification — suites + the PTY lane as a real user | pending | |
| CP7 docs/landing/blog/CHANGELOG/DOX + version 0.0.69 + release | pending | |

## Environment notes (for resume)

- Stack: bun 1.4.4 (`~/.bun/bin` first in PATH); `bun install` + `bun run agent:install` done (engine service skipped: `UNOWN_NO_ENGINE_SERVICE=1` — container has no user bus).
- `.env` carries the operator-provided Agnes upstream key (BRIDGE_UPSTREAM_KEY — never committed). Stack boot: `bun run agent:start` (bridge :3031 + engine :3030); headless smoke: `bun bin/unown -p "…" < /dev/null`.
- The upstream PAT lives only in the git remote URL (DOX rule).
- Working tree at round open: `e6672ac2` (v0.0.68). Suite baselines at round open: self-learning 5798 pass / 105 skip / 1 known order-flake; tui 1069/0; coding-agent green over its documented env-artifact baseline (model-registry, model-resolver, syntax-highlight, theme-detection, tools/find); self-learning tsc 88-error pre-existing baseline; biome clean.
- After any vendored coding-agent source change: rebuild dist (`cd pi-repo/packages/coding-agent && bun run build:unbundled`) — the workspace resolves the package through `dist/`.

## CP0 — the research (done, 2026-11-16)

Four research agents ran in parallel (official-docs delta, community/niche catalog, sibling landscape, codebase audit); every claim in the research doc carries a fetched source. The verdict: sixteen adoptable gaps (R1–R16), two assessed deferrals with design notes (R17 diff sources, R18 chords), and the round-1 non-adoptions re-affirmed against the new evidence. Key corrections to round-1's record: "Tab to collapse diffs" is UNVERIFIED in every current source (chevrons/click are the documented gesture); "microcompact" is context pruning, not a UI mode; CC's Alt+Enter is now a newline method (queue is plain Enter / Ctrl+X Enter) — the fork's Enter-steers + Alt+Enter-queue model stays a deliberate divergence, now labeled as such.
