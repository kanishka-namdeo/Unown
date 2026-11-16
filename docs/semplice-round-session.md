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
| CP2 | Two-beat first run (W6–W9) | done | gate default flip (PTY 3/3), ≤8-row summary, spec-gate safe default |
| CP3 | Command discoverability (W10–W12) | done | grouped popup/palette (PTY 3/3), /help card, usage.md counts, +2 pre-existing bug fixes |
| CP4 | Plain-language chrome (W13–W14, W16) | done | ttft classic-only, 5-hint row, cache chips classic-only (PTY verified) |
| CP5 | Onboarding consolidation (W16–W17) | done | flights printable fall-through (PTY 2/2); W17 verified already-held (pi's dialog is official-distribution-only, never fires for unown) |
| CP6 | `--help` restructure (W18) | done | Everyday block, grouped subcommands, compressed plan + env, topic pointers |
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

## CP2 — the two-beat first run

**Landed:**

- **W6** — `firstRunGateLines(bridgeUp)` gains a `defaultYes` field: when the
  bundled bridge ANSWERS, the question leads with the truth (`First run —
  the bundled llm-bridge is answering (the default provider).` / `Connect
  your own instead?`) and **Enter keeps the bridge** — the working default,
  never a question about it. A bridge-less install (the standalone binary)
  keeps Enter = setup, because declining there leaves nothing to talk to.
  The PTY helper (`answer_first_run_gate`) detects both eras of copy.
- **W7** — `buildSetupSummaryText` compressed from ~25 rows to a ≤8-row
  contract: provider row, model + verify on one row, key, files, and rows
  that only appear when something needs saying (specs when unverified,
  theme when switched, kept when present). The four pasted flight summaries
  are gone — ONE closer line points at `/flights` (a session can RUN a
  starter; a pasted summary cannot). The wizard's `Current configuration`
  header no longer dumps the full model list (up to ten ids across three
  wrapped lines) — it names the count and the default. Preset 1's
  recommendation tag reads `← recommended (bundled stack is up)`.
- **W8** — `askSpecNumbers`: a BLANK answer accepts the conservative safe
  default (32k context / 8k output — compaction just triggers early) with a
  note naming the adjust command; the questions say so up front
  (`blank = safe default 32k`). The old blank-retry-warning loop and the
  fatal decline dead-end are gone for blanks; an explicitly WRONG number
  still warns and retries (the anti-guessing guard stays armed). Honest
  provenance: a new `user-default` spec source (sidecar + `unown models
  verify` + doctor render `the safe default you accepted …` instead of
  claiming `you entered it`).
- **W9** — verified already-held by the code (keep-current returns
  immediately with nothing written; the bridge preset asks only the model);
  recorded, no change needed.

**Verification:** `test/first-run-copy.test.ts` (the two-era gate matrix +
defaultYes pins), `test/spec-gate.test.ts` (blank-accepts-default, blank-ctx
+ typed-out mix, garbage still loops, three-invalid still refuses, the
user-default provenance sidecar), `test/setup-dialog.test.ts` (the ≤8-row
summary contract, one-row model+verify, the /flights closer, no pasted
catalog). Full suite **5864 pass / 105 skip / 0 fail**; tsc at the 88-error
pre-existing baseline, zero in the round's files. PTY as a real user
(`semplice_cp2`, 3/3): the bridge-up gate reads `Enter = keep the bundled
bridge · y = guided setup`, **Enter lands in the TUI with zero wizard
questions**, and the wizard (via `y`) opens with the compact header + short
recommended tag. Docs synced: quickstart.md (first-run + wizard steps +
summary description).

## CP3 — command discoverability

**Landed:**

- **W10 — the catalog chunks under category headers**: `SelectItem` gains
  `selectable: false` (section-header rows: navigation skips them, Enter never
  selects them, the new `SelectListTheme.sectionLabel` hook styles them) —
  and both command surfaces interleave headers between groups: the `/`
  autocomplete popup (a bare `/` opens the category-sorted catalog; a typed
  query flattens it — search neutralizes grouping) and the ctrl+k
  `CommandPalette` (grouped while the filter is empty, flat once the user
  types). The host seam is `InteractiveModeOptions.getCommandCategory` (the
  `getPermissionMode` precedent); unown's map lives in
  `src/command-categories.ts` — name-keyed (a user does not care whether
  `/model` is pi's or `/plan` is unown's), 97 commands across 10 categories
  (Session, Plan & review, Memory & learning, Models & providers, Display,
  Tools & data, Safety & permissions, Engine & ops, Add-ons, Help &
  onboarding). Product-owned inline extensions also STOP carrying the
  `[t]` scope tag in their descriptions (provenance for extension authors,
  noise for users — user/project/npm sources keep theirs).
- **W11 — `/help` exists**: the "You're flying" tip and the footer hint both
  promised `/help`, but no such command was registered — typing it sent a
  CHAT TURN to the model (the baseline capture caught the model answering
  instead). `/help` now prints the compact grouped catalog (one wrapped
  name-row per category + the discovery pointers: `ctrl+k` searches, `?`
  shows keys, `docs/usage.md`).
- **W12 — the count drift fixed**: usage.md said "forty-seven + twelve"
  against a real surface of 74 unown + 23 built-ins + dynamic; now
  "seventy-four (including the split-view eleven)" with the grouping story.
- **Two pre-existing bugs found by the round's render-pinning tests**:
  (1) the ctrl+k palette's `listChildIndex` was computed BEFORE `addChild`
  — every filter keystroke replaced the SPACER above the list and left the
  previous list mounted (stale lists stacked as you typed; interaction
  worked because `selectList` is tracked separately, so no test noticed);
  fixed and pinned. (2) `getBestAutocompleteMatchIndex`'s flat index was
  applied to the interleaved list — selection now goes by VALUE
  (`selectItemByValue`), header-row-safe.

**Verification:** tui `select-list` + `autocomplete` + `editor` node suites
**208/208** (5 new header cases: initial-selection lands on a command,
nav skips headers both directions with wrap, home/end on selectables, header
render through `sectionLabel`, `selectItemByValue`); coding-agent vitest
`command-palette` + selector suites **23/23** (3 new: headers between groups
unfiltered, typed query flattens, Enter never lands on a header — the test
that caught the stacking bug); self-learning `semplice-round.test.ts` (the
23-builtins coverage pin, representative category pins, the /help card
pins) — full suite **5867 pass / 105 skip / 0 fail**; vendored builds + biome
clean. PTY as a real user (`semplice_cp3`, 3/3): the bare-`/` popup opens
GROUPED (headers visible, commands under them), `/pl` filters flat with no
headers, and `/help` renders the grouped card in the transcript.

## CP4 — plain-language chrome

**Landed:** **W13** — the turn meter's quiet chip reads `turn 3.4s · ~$0.0084`;
`ttft` (perf-diagnosis shorthand a first-week user cannot act on) moved behind
`UNOWN_FOOTER_CLASSIC=1` with the classic layout keeping the full legacy
order. **W14** — the idle hint row carries FIVE hints, not six (Cowan 4±1;
the baseline counted six): `? help · ctrl+k palette · / commands · ! bash ·
ctrl+o transcript`; the esc-esc gesture moved to `/hotkeys`, the `?`
reference and `/tree` in the grouped catalog. **the W13 addendum** — the footer's cache
chips (`CH` hit-rate, `W` write, `R` read) are CLASSIC-ONLY single-letter
codes no first-week user can decode; the quiet stats row keeps location ·
ctx meter · ↑/↓ · model, and the cache facts live where they are explained
(`/context`'s where-it-goes breakdown, `/usage`).

**Verification:** `test/turn-meter.test.ts` + `test/providers-probe.test.ts`
(quiet = turn + cost with no ttft, classic keeps the legacy order),
coding-agent `footer-width` + `interactive-mode-status` vitest suites
(the cache-chip classic gate, the managed-tool quiet lane with the verbose
restore). The PTY lanes' ready anchors moved from `esc-esc tree` to the
stable `? help` token (verify_dacapo_cp5, verify_memory_matrix,
verify_toccata_cp5, verify_abort_resume — any-of lists). PTY as a real user
(`semplice_cp4`, live model turn through the bridge): the hint row reads
FIVE hints with no esc-esc, the stats row carries `ctx · ↓2 · ↑1.4k · model`
with no CH/W/R codes, and the turn chip renders `turn 1.1s` with no ttft.
Docs synced: usage.md's turn-meter section, configuration.md's
UNOWN_TURN_METER row, bottom-area-user-journeys.md's hint-row rows.

## CP5 — onboarding consolidation

**Landed:** **W16 — plain typing falls through the First-flights card**: `flightsHandleKey` gains a `fall-through` action — any printable text no binding claims (letters minus q/x, 0, punctuation, space, pastes) dismisses the card for this session and rides through to the editor via `setEditorText` (the same restore-then-prefill contract as a pick); control bytes and escape sequences stay inert. The documented hazard is gone: a prompt typed at the card used to be EATEN, and a stray `x` latched never-again persistently — never-again can now only be hit deliberately. The card's footer hint teaches it: `… esc close · or just type`. **W17 — verified already-held**: pi's FirstTimeSetup dialog is gated to the OFFICIAL distribution (`isOfficialDistribution` in `shouldRunFirstTimeSetup`) and never fires for a fork — no suppression needed; recorded.

**Verification:** `test/flights-core.test.ts` (the fall-through matrix: printables with data, control keys inert, clamping) + the flights component suites — 51/51 across the three flights files; tsc at the 88-error baseline. PTY as a real user (`semplice_cp5`, 2/2): the fresh boot shows the card, typing `hello` at it dismisses the card and the editor carries `hello`.

## CP6 — the everyday-first `--help`

**Landed (W18):** `unown --help` now opens with an **Everyday** block — the
seven verbs a first-week user needs (session, prompt, -p, -c, setup, doctor,
update), each one line — before the full usage grammar. The usage block drops
its duplicated everyday lines; the `--plan` sprawl compresses from eight
lines to three; the ~31 subcommands group under six category headers (Setup &
providers, Project memory & docs, Learning engine & ops, Sessions &
migration, Repo knowledge, Support & housekeeping — same order, no content
lost); the Environment block one-lines every variable and points at
`docs/configuration.md` plus the `unown help <topic>` pages. The honest
measure: the total line count held (~315 — every fact was kept), but a new
user now reads NINE lines and starts — the wall became a front porch.

**Verification:** `test/cli/help.test.ts` (the `Usage:` anchor survived the
restructure), the completions + claims gates green, full suite re-run.

## Checkpoints

- **CP1** (2026-11-17): committed as `engine(tui): semplice CP1 — the quiet first boot`; suites and receipts as above.
- **CP2** (2026-11-17): committed as `engine(tui): semplice CP2 — the two-beat first run`; receipts above.
- **CP3** (2026-11-17): committed as `engine(tui): semplice CP3 — the grouped command catalog`; receipts above.
- **CP4** (2026-11-17): committed as `engine(tui): semplice CP4 — plain-language chrome`; receipts above.
- **CP5** (2026-11-17): committed as `engine(tui): semplice CP5 — the flights fall-through`; receipts above.
- **CP6** (2026-11-17): committed as `engine(tui): semplice CP6 — the everyday-first --help`; receipts above.

## The round closes

(pending — CP2..CP7)
