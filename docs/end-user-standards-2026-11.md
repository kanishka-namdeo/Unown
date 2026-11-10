# End-User Experience Standards — the 2026-11 floor

The grounding research for the end-user combination round
(`docs/end-user-combo-round-session.md`), in the lineage of
`docs/plan-mode-standards-2026-11.md` and
`docs/memory-engine-standards-2026-11.md`. Sources: the leaders' current
documentation (Claude Code 2.1.x, Codex CLI 0.167, Gemini CLI / Antigravity,
opencode 2.1, Amp, Aider, Crush), clig.dev (re-hit HN front page 2026-07),
the aictrl.dev headless-harness benchmark (2026-11), and 2025–26 HN pain
threads. Live-checked 2026-11-10.

## §1 What is table stakes in late 2026

1. **Headless with clean structured output** — `-p` must stream NDJSON
   events only (`init`/`message`/`tool_use`/`tool_result`/`error`/`result`
   with per-model token usage); no banners before the first JSON event;
   stdout machine-readable, stderr for humans (Gemini headless docs; the
   aictrl benchmark scored all six harnesses on exactly this).
2. **Documented, distinct exit codes** — 0 success; separate codes for
   input error (Gemini: 42) and turn-limit (53); SIGTERM handled (Claude:
   143). Unown's contract: 0/1/2/3/4 — already stronger, IF documented
   where users look.
3. **Resume/continue** — `-c` plus resume by id, name and path; the bare
   picker; `--fork-session` (Claude CLI reference).
4. **Permission-mode cycling with a visible indicator** — Shift+Tab incl.
   plan; the 2026 trend is a classifier/auto tier as default (Claude's
   auto-mode announcement: 97% approval rate, 49.5% hand-written allow
   rules — approval fatigue is the measured enemy).
5. **MCP** — stdio/http + SSE, project `.mcp.json`, OAuth per server.
6. **`doctor` + debug paths** — read-only health, config validation,
   install checks (`claude doctor`, `opencode debug paths`). A doctor that
   can itself crash on malformed state (issue #48) is below the floor.
7. **Cost/token transparency** — live usage, per-model breakdown in the
   JSON result, `/tokens`-style surface. pi's ~6k-token startup prompt is
   the measured best (aictrl benchmark; HN 48883275 "tokenflation" thread)
   — the moat, keep it.
8. **One-line install + self-update with cleanup** — curl|sh and
   PowerShell one-liners, release channels on a published schedule,
   uninstall docs (`opencode uninstall --dry-run`).
9. **clig.dev basics** — `-h/--help` everywhere; "Did you mean…?" typo
   suggestions; never prompt when stdin is not a TTY (require flags
   instead); NO_COLOR / no color when piped; XDG paths; SIGINT/SIGTERM.
10. **Checkpoints/undo** — plan approval gates pair with a rewind/undo
    path (Claude double-Esc; Aider /undo).
11. **Custom commands/skills** — markdown + frontmatter, `$ARGUMENTS`,
    Agent Skills `SKILL.md` compatibility (opencode commands; Claude
    skills).

## §2 The strong tier (serious contenders)

12. Shell completions (bash/zsh/fish/pwsh) — Amp documents them
    sign-in-free.
13. **Daemon transparency** — status/logs/stop, opt-out of auto-start,
    old-version cleanup, documented ports. The Codex daemon backlash (610
    pts, HN 50060694: hidden self-updating background processes, 12 GB of
    old versions) is the exact anti-pattern profile of an
    always-on engine — Unown's engine already has status/logs/stop +
    opt-out + a per-boot token; the surface must SAY so where users
    first meet the daemon.
14. Effort dial (`--effort`), command palette, themes, transcript export.
15. Background tasks / attach / logs / respawn.
16. `--json-schema` validated structured output; `--max-budget-usd`;
    `--fallback-model`; `--bare` reproducible mode.
17. Image paste, voice, `$EDITOR` prompt editing, Ctrl+R history.
18. Screen-reader flag (Claude `--ax-screen-reader` flat output) +
    high-contrast themes.
19. Telemetry opt-in/out documented + a privacy statement (2026's biggest
    trust stories: steganographic marking 2445 pts, email leaks 1613 pts).
20. README/landing: GIF demo above the fold, one-liner install, badges,
    quickstart ≤ 5 min, release channels, uninstall docs, /bug-style
    in-CLI reporting.

## §3 What users complain about most (2025–26 HN evidence)

- **Token bloat** — "33k tokens before reading the prompt" (706 pts);
  pi's lean prompt is the counter-example users explicitly praise.
- **Rate limits + subscription burn** on metered upstreams (Agnes is
  metered — the bridge's guards are the right posture).
- **Hidden background daemons** (the Codex case above) — transparency is
  UX for anything that runs while the user is away.
- **Privacy/telemetry trust** — visible, auditable, off-by-default.
- **Approval fatigue** — measured 97% approval rate argues for the
  acceptEdits/plan cycle being one keystroke away and visible.
- **Setup friction** — first-run must reach a first real answer in
  minutes with copy-paste commands only.

## §4 The audit checklist (how this round grades)

Each matrix lane in the session log is graded against §1–§3: pass (meets
the floor), gap (works but below floor), fail (broken or missing). A gap
or fail becomes a finding (F-number) in the session log's ledger with the
fix that landed.
