# The Semplice round — less overwhelming, study-backed (2026-11-17)

**Mission** (operator directive, verbatim):

> reverse engineer competitor products like an expert ui/ux researcher and make the TUI experience less overwhelming for the end user. follow actual study backed research. understand how it applies to all our features and capabilities and implement the learnings end to end. test, iterate and improve Unown's experience.

The name: *semplice* — the musical instruction to play simply. The round is the
third of the touch-study lineage (Toccata, Da capo) and answers a different
question than they did: not "what do the best tools do that we don't" but "what
does a first-time user see that they shouldn't". Every decision cites
[the research record](tui-overwhelm-research.md) — the competitor teardown
(Claude Code, Codex CLI, Gemini CLI, OpenCode, Crush, aider, the classic TUIs),
the study-backed digests (cognitive load, Miller/Cowan, Hick, progressive
disclosure, Nielsen, onboarding/SDT, error guidelines, accessibility, trust
calibration), and the baseline pane evidence captured from a real fresh-home
boot.

Related pages: [research record](tui-overwhelm-research.md) · [UX principles](unown-ux-principles.md) · [Toccata round](toccata-round-session.md) · [Da capo round](dacapo-round-session.md) · [usage](usage.md) · [configuration](configuration.md)

- [Phase ledger](#phase-ledger)
- [Environment notes (for resume)](#environment-notes-for-resume)
- [CP0 — research + baseline](#cp0--research--baseline)
- [CP1 — the quiet first boot](#cp1--the-quiet-first-boot)

## Phase ledger

| CP | Scope | Status | Artifact |
|----|-------|--------|----------|
| CP0 | Research + baseline capture | done | [research record](tui-overwhelm-research.md); baseline stills/panes (fresh-home boot, 11 preamble lines pre-flights) |
| CP1 | Quiet first boot (W1–W4, W15) | done | this page; `test/semplice-round.test.ts` (7) + updated pins; PTY after-capture (1 preamble line) |
| CP2 | Two-beat first run (W6–W9) | planned | gate default, wizard summary, spec-gate |
| CP3 | Command discoverability (W10–W12) | planned | grouped popup/palette, /help, usage.md counts |
| CP4 | Plain-language chrome (W13–W14, W16) | planned | turn chip, hint row, token chips |
| CP5 | Onboarding consolidation (W16–W17) | planned | flights fall-through, FirstTimeSetup suppression |
| CP6 | `--help` restructure (W18) | planned | everyday-first help, topic pages |
| CP7 | Ship | planned | docs/landing/blog sync, v0.0.70, cross-platform builds, security sweep |

## Environment notes (for resume)

- Stack for PTY lanes: `bun run agent:start` (bridge :3031 + engine :3030), Agnes upstream keyed in `.env` (never printed). PTY lane needs `pip install pyte pexpect pillow`.
- Bun 1.4.4 (the repo floor is 1.4); `bun install` at root AND `pi-repo/`, then `cd pi-repo && bun run build` once — the vendored `dist/` artifacts are NOT committed and the TUI will not boot without them.
- The sandbox has no tmux/ttyd: the PTY lane (`scripts/tui-capture/pty_*.py`) is the verification+capture lane; the tmux lane's driver.js stays the media lane where its host deps exist.
- Baseline/after stills + `.pane.txt` receipts: `/home/z/my-project/download/unown-semplice/{baseline,after-cp1}/` (session-local; the round's durable receipts land in the changelog narrative).
- Gotcha: `rg -rn` is NOT "recursive grep" — `-r` is `--replace` and silently mangles output. Use `rg -n` + `-l`.
- Full-suite runs: `cd pi-repo/packages/self-learning && bun test test/` (~260 s; 3 order-dependent flakes observed once — automation-kill-switch/PLM×2 — green in isolation and on the full re-run).

## CP0 — research + baseline

**Landed:** the round's research record
([tui-overwhelm-research.md](tui-overwhelm-research.md)) — 44-source competitor
teardown, two study digests (15 + 20 sources), the codebase overwhelm inventory
(17 items with file:line evidence), the W1–W18 adoption table and seven
deliberate non-adoptions. Baseline pane evidence captured from a real
fresh-home PTY boot: 11 preamble lines before the flights card (resource
listing, `[Extension issues]` ×2, fd download failure, memory recall line,
mission null-state line), the 99-command flat `/` popup (`(1/99)`), the dense
wizard header and preset list, the jargon chips (`ttft`, `ctx …/524k (auto) ·
↓196 · ↑15k`).

**Verification:** stills + pane dumps in the session-local capture set; the
counts quoted in the research record re-measured from those panes.

## CP1 — the quiet first boot

**Landed:**

- **W1** — `getBuiltInCommandConflictDiagnostics` (vendored
  `interactive-mode.ts`) skips `<inline:…>`-sourced commands: the product's own
  extensions override built-ins by design; the collision notice is
  extension-author feedback and never reaches the end user's boot pane. File-
  and npm-sourced extensions keep the diagnostic.
- **W2** — `showManagedToolStatus` silences managed-tool progress/success;
  a failed fd/rg download renders once, actionable: `fd not installed
  (download failed: <reason>) — the find tool needs it; it retries next start,
  or install fd yourself`. `UNOWN_MANAGED_TOOLS_VERBOSE=1` (or `--verbose`)
  restores the full lane (documented in `.env.example` + `configuration.md`).
- **W3** — `ensureUnownAgentDirInfo` seeds `quietStartup: true` at agent-dir
  creation (existing settings.json never clobbered — pinned); the resource
  listing and hint header stay behind ctrl+o. The splash is decoupled from
  `quietStartup` (its switches are `UNOWN_NO_SPLASH` / `NO_COLOR`) — the
  default must not kill the brand moment, and the wordmark is the capture
  lanes' readiness anchor. Settings-hub row copy + `default: true`; the
  phantom-drift out-of-the-box fixture is byte-synced with the seed. PTY
  `READY_ANCHORS` gains the quiet-boot footer token (`? help`).
- **W4** — `renderMissionPanel` null state (no mission, no progress, no live
  turn, no risks, no fresh learning, zero completed turns) renders `[]` and the
  mount clears the widget (no blank row); the busy counter counts the turn in
  flight (`turn 1 running`, not `turn 0`).
- **W15** — the confidence chip reads `on track ✓/◐/✗`, not `conf ✓/◐/✗`.
- **Non-adoption (recorded)**: W5 (gating the first-boot `◈ memory recalled`
  line) — the line is a documented, test-pinned Claude-Code-parity contract
  ("Recalled 2 memories"; the recall-side proof that memory was injected); the
  research tension (Nielsen #1 visibility vs #8 minimalist) was already
  resolved by the project in favor of one honest line. Kept as-is.

**Verification:** `test/semplice-round.test.ts` 7/7 (the subprocess seed probe
— fresh/preserve homes, splash decoupling, kill switches, chip vocabulary);
`test/mission.test.ts` null-state + honest-absence + live-turn + `on track`
pins; `test/splash.test.ts` suppression matrix (quiet lane removed with the
seam); `test/settings-defaults-drift.test.ts` seeded fixture. Full suite:
**5860 pass / 105 skip / 0 fail** (the pre-change baseline run showed 3 pins to
update with the seams + 3 order-dependent flakes that re-ran green). Vendored
`build:unbundled` + biome clean. PTY as a real user (fresh scratch home,
128×36): preamble before the flights card drops **11 → 1 line** (the honest fd
failure; the memory-recall line follows it — the only remaining pre-editor
rows); the wizard/decline paths unchanged this CP. Gate copy itself untouched —
CP2's scope.

## Checkpoints

- **CP1** (2026-11-17): committed as `engine(tui): semplice CP1 — the quiet first boot`; suites and receipts as above.

## The round closes

(pending — CP2..CP7)
