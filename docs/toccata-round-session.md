# The Toccata round — the Claude Code touch study, shipped (2026-11-15)

**Mission:** reverse-engineer Claude Code's TUI experience like an expert
UI/UX researcher (popular and niche sources, every claim cited), map it
against every Unown feature and capability, implement the proven
learnings end to end, then test, iterate and improve — production grade,
cross-platform, keyboard-honest.

A toccata is a "touch" piece — written to showcase virtuosity of touch.
This is the keyboard round.

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| CP0 research — the teardown + 47-point audit | ✅ done | `docs/tui-claude-code-parity-research.md` |
| CP1 the editor lane — history, search, stash, drafts | ✅ done | `test/input-history.test.ts` (16) + tui `editor-history-persistence` (10) + `history-lane-keybindings` (6); suites 5768/0 |
| CP2 the queue/image lane — send-now, image chips | ✅ done | send-now in CP1's commit; chips: tui `editor-image-chips` (10/10) |
| CP3 the transcript lane — viewer keys, aggregation, timestamps | ✅ done | tui `tui-alt-screen-transcript` (9/9) + coding-agent `tool-call-groups` (11/11); tui suite 1059/0 |
| CP4 the dialog/command lane — permission comments, aliases, rewind picker, mid-prompt completion | ✅ done | self-learning `permission-comment` (5) + `checkpoints-rewind` (6) + `theme-command` (8); coding-agent `extension-selector-comment` (8); tui `mid-prompt-slash` (10) |
| CP5 the personality lane — spinner verbs, AGENTS.md flight | ✅ done | coding-agent `spinner-verbs` (19); flights/onboarding battery 66/66 |
| CP6 verification — suites + PTY lanes as a real user | ✅ done | PTY: toccata-cp5 10/10, footer-quiet 9/9, settings-hub lane pre-existing timeout (identical at baseline); suites green over documented baselines |
| CP7 docs/landing/blog/CHANGELOG/DOX + version + release | ✅ done | v0.0.68 cut: CHANGELOG fold + rail (62 stops, 62 dated), blog post + lane stills, overview re-stamped, dependabot 0 / code-scanning 0 |

## CP0 — the research (2026-11-15)

`docs/tui-claude-code-parity-research.md` — the official interactive-mode
and commands references fetched in full (every keybinding, the queue
contract, the history contract, the transcript-viewer keys, the vim
surface, the spinner-verbs product layer), the sibling landscape
cross-checked (Amp's palette/history keys, Codex's cycle feature-request,
Gemini's /theme, opencode's fork, Aider's git-ceremony — rejected), and
the 47-point audit of Unown at `47e4eca3` with the seam for every item.

**The verdict:** five gap clusters — input-history lane, draft
lifecycle, transcript viewer, permission comments, personality — plus
six alias/picker gaps. Sixteen adoption decisions (A1-A16), six
deliberate non-adoptions on record (vim editor, voice, spell check,
emoji shortcodes, Enter-queues, ghost text).

## Environment notes (for resume)

- Stack: bun 1.4.3 (`~/.bun/bin` first in PATH); `bun run agent:install`
  done; `.env` carries the operator-provided Agnes upstream key
  (BRIDGE_UPSTREAM_KEY — never committed; .env is gitignored).
- Stack boot: `bun run agent:start` (bridge :3031 + engine :3030);
  headless smoke: `bun bin/unown -p "…" < /dev/null` (stdin MUST be
  closed or the idle-safe reader waits — recorded as expected behavior).
- The upstream PAT lives only in the git remote URL (DOX rule).
- Engine systemd service not installed (container has no user bus) —
  agent-side auto-start covers it; `unown doctor` shows the engine
  unreachable warning, memory still works.
- `.unown/memory/project.md` + `project.provenance.json` carry runtime
  AutoDream writes from this session's smoke tests — never staged into
  round commits (DOX: stage explicit paths only).

## CP1 — the editor lane (done, 2026-11-15)

Landed: A1 persistent per-cwd history (`input-history.ts` — 500-cap JSONL
per sha256(cwd), consecutive-dup suppression, corrupt-line tolerance,
`UNOWN_INPUT_HISTORY=0` kill switch, editor seeded at session_start), A2
cleared-draft recall (Ctrl+C clear + Esc-Esc with text land the draft in
session history, "Up restores it" hint), A3 the Ctrl+R search dialog
(fuzzy filter, previews, Ctrl+R next, Ctrl+S scope cycle
session→project→all; Enter submits, Tab edits), A4 Ctrl+S stash/restore of
the full editor snapshot (paste markers + bash badge included, undoable),
A5 Ctrl+D 800 ms two-press exit confirm (delete-forward-when-text
verified), A6 Esc-Esc clear-draft-first. Bonus: Ctrl+Enter/Alt+S
send-queued-now (the draft joins the queue, then the abort matrix drains
it) and the 100→500 in-memory cap rise.

Verification: self-learning suite **5768/0** (267 files), tui suite green
(incl. the new 10-case history-persistence battery), coding-agent
startup-input test updated to the recordHistory seam + the new 6-case
dispatch battery; the pre-existing coding-agent failures (model-registry,
model-resolver, syntax-highlight, theme-detection, tools/find) verified
present at the pristine baseline 47e4eca3 — environment artifacts, not
this round's regressions. CHANGELOG entry filed, landing rail regenerated
(62 stops), `.env.example` + `docs/configuration.md` + `docs/usage.md`
keybinding tables updated, self-learning AGENTS.md contract added.

## CP2 — the queue/image lane (done, 2026-11-15)

A7 (send-queued-now: Ctrl+Enter where the terminal reports extended keys,
Alt+S everywhere, draft joins the queue then the abort matrix drains it)
landed inside CP1's commit. A8 image chips: Ctrl+V inserts an atomic
`[Image #N]` (stable ids, atomic segmenting beside paste markers, undo +
stash aware, submit expands to the stored path, literal unregistered chips
stay literal). tui suite green including the 10-case chip battery.

## CP3 — the transcript lane (done, 2026-11-15)

A9 transcript mode: fullscreen Ctrl+O toggles a MODAL review view (CC's
transcript viewer is modal — bare `{`/`}`/`q`/`v` keys can never shadow
editor typing, so the mode consumes unknown keys and yields on the first
key when a docked dialog wants the keyboard). Keys: `{`/`}` prompt jumps
(reusing the OSC-133 seam), `/` search + `n`/`N` (the last query survives
search-close), less-nav (`j`/`k`/`g`/`G`/ctrl+u/d/ctrl+b/f/space/b — j down,
k up, the vim contract), `[` write-to-scrollback (stop → park hint →
keypress → start → re-enter; the press-any-key wait is injectable for the
virtual terminal), `v` open-in-$EDITOR (host-owned stop/start dance, the
conversation as markdown via `transcript-export.ts` — a viewing artifact,
not the share format), `?` help panel (config-live from the registry),
`q`/Esc/Ctrl+C exit. Tool output auto-expands on entry and restores on
exit (`onTranscriptModeChange`, the silent setToolsExpanded option);
expanded blocks carry a dim `HH:MM:SS` result timestamp (updateResult
gains `timestamp`; live callers stamp `Date.now()`, replay passes the
message's own). Regular mode keeps Ctrl+O as expand-all — the fork's
split, documented in usage.md. New `tui.altScreen.transcript*` binding
ids (16), all rebindable.

A10 aggregation: `ChatTranscriptContainer` wraps consecutive
same-name tool calls into a `ToolCallGroupComponent` at the container
level (all four creation paths — live message_update,
tool_execution_start fallback, replay, and future ones — group for
free; any other component splits the run). Collapsed: one dim chip
`⋯ called bash ×N · ctrl+o` (present tense `calling …` while streaming);
expanded: the individual blocks (the group implements the Expandable
fan-out and sums diffLineCounts). Single-call groups delegate to the
bare block byte-identically. Per-call routing (pendingTools,
updateResult) still addresses the individual components.

Research verification (the resume session's fresh sweep): the official
interactive-mode + fullscreen pages were re-fetched and quoted — the
transcript-viewer key table, the `[` scrollback semantics ("lasts until
you exit transcript mode"), `v`'s $VISUAL/$EDITOR contract, and the
aggregation example (`Called slack 3 times` for MCP runs; consecutive
runs split on a different tool — pinned by CC's own v2.1.234 changelog).
Binary string-extraction from CC v2.1.325 confirmed no literal "Called
Bash N times" — category-specific wording — so the fork's `⋯ called
<tool> ×N` chip stays the decided form.

Verification: tui suite **1059/0** (46 files), the new transcript battery
9/9; coding-agent `tool-call-groups` 11/11 with the affected neighbors
(tool-execution-component, truncation-chip, interactive-tui,
history-lane, glyph-placement, execution-lanes) 55/55; the full
coding-agent battery green over its documented environment baseline
(model-registry, model-resolver, syntax-highlight, theme-detection,
tools/find — all `fd`/model-catalog artifacts, verified present at the
pristine baseline in CP1).

## CP4 — the dialog/command lane (done, 2026-11-15)

A11 permission comments: `ExtensionSelectorComponent` gains `commentOn`
(labels that take a Tab-opened comment field — a headless `Editor`, the
questionnaire's notes pattern) + per-option kept text; the comment rides
`onSelect(option, comment)` → `showExtensionSelector` → the new
`ExtensionUIDialogOptions.commentOn`/`onComment` (non-breaking, optional).
The gate (`permissions.ts handleAsk`) offers it on ["Allow once", "Deny"]
only; allow+comment → `ctx.sendMessage` followUp (deferred to end-of-turn
during the tool's execute — CC's after-the-result delivery); deny+comment
rides the reason. Hint strip gains "Tab to amend".

A12 mid-prompt slash: `MID_PROMPT_SLASH_TOKEN` (exported from
autocomplete.ts; the token is match group 1 — the whitespace boundary is
not part of it) drives the editor trigger (`/` after whitespace, re-trigger
on letters, any line) and the provider lane (plain prefix matching —
"Only commands whose names start with those letters match"; a second `/`
disqualifies the token so `/tmp/notes.md` keeps no list open; falls through
to the file lane when nothing matches so absolute paths keep completing).
The start-of-message lane is now gated on `cursorLine === 0`; Enter accepts
mid-prompt WITHOUT submitting (the `isMessageStartCompletion` split);
applyCompletion inserts for whitespace-preceded tokens.

A13 aliases: `/cost` (Claude Code's own "Alias for /usage" — the same
handler) and `/theme` (`settings/theme-command.ts` — the live-preview
picker: in-memory `Theme` instances while navigating (the `setTheme(Theme)`
path never persists), Enter commits through the string path (the hub row's
write), Esc restores the original setting (by name, or the captured active
instance for automatic composites); `/theme <name>` direct + headless).

A14 the rewind picker: turn manifests gain `entryId` (stamped at seal — the
last user entry in the tree is always the sealed turn's prompt);
`/rewind` lists checkpoints with prompt previews (resolved through the
entries), then the CC action menu — Restore code and conversation /
Restore conversation / Restore code / Never mind — gated on tracked files
(both code restores) and the conversation point (CC's own gating; legacy
manifests are code-only). Conversation restore rides the host's
`navigateTree` (the extension handler repaints + restores the prompt into
the editor). `doubleEscapeAction` gains `rewind` (settings-manager,
selector row, hub choices, Esc-Esc dispatch through the registered command
with a tree-picker fallback).

Verification: self-learning `permission-comment` 5/5, `checkpoints-rewind`
6/6, `theme-command` 8/8; coding-agent `extension-selector-comment` 8/8
(+ the affected selector/settings/keybindings/interactive-tui/groups
neighbors 85/85); tui `mid-prompt-slash` 10/10; full tui suite **1069/0**,
full self-learning suite green over the one known plm-wiring env artifact
(verified passing in isolation, stack stopped).

## CP5 — the personality lane (done, 2026-11-16)

A15 spinner verbs: `spinner-verbs.ts` (coding-agent, pure — the 64-verb
curated pool from CC's leaked 187-verb catalog, `parseSpinnerVerbs`
comma-split/trim/dedupe, `resolveSpinnerVerbPool` env > setting >
default with `0/false/off` kill and `1/true/on` explicit-enable values,
`pickSpinnerVerbIndex` never-repeats with a bounded stuck-rng fallback).
`WorkingStatusIndicator.setVerbPool` rotates one verb per 3 s window on
the elapsed chip's EXISTING 1 s tick (`onElapsedTick`, the new protected
hook — the no-new-timers pin holds); an external `setMessage` (tool
label, extension message) clears the pool — honest labels keep priority;
interactive-mode resolves the pool per turn (`newWorkingStatusIndicator`)
so a settings change applies next turn. Config: settings.json
`spinnerVerbs` (hub row `interface.spinner-verbs`, kind text) +
`UNOWN_SPINNER_VERBS` env. Docs: usage.md "The working line" section,
configuration.md env row, `.env.example`.

A16 the AGENTS.md first-flight offer: `orderFlightsForRepo` (pure core)
promotes the offer-variant agents-md flight first when the cwd has no
instruction file (checked against the resource-loader's candidate list —
AGENTS.override.md/AGENTS.md/AGENTS.MD/CLAUDE.md/CLAUDE.MD; a directory
named like a candidate does not count); the card title follows
("Initialize an AGENTS.md"); a RETURNING non-dismissed user in an
unoffered bare repo gets the offer card once per repo (the new
`agentsMdOfferedFor` LRU latch in onboarding.json, cap 20, field-wise
normalized); the fresh boot shows the repo-ordered catalog but never
records; `/flights` stays latch-free; the setup wizard's pinned summary
bytes ride along unchanged. Research verified this session: the leaked
187-verb list (wesbos), the `spinnerVerbs` settings shape
(`{mode: replace|append, verbs: [...]}` — the fork's text-setting form
uses the simpler replace-only list, documented), verbs chosen at random
while the model thinks with contextual labels during tool runs.

Verification: coding-agent `spinner-verbs` 19/19 + `status-indicator`
15/15 untouched; interactive-mode/settings neighbors 46/46; settings hub
suites green (the one combined-run flake re-verified green twice and at
baseline); flights/onboarding battery **66/66** across the four files
(flights, flights-core, flights-tips, onboarding-state); coding-agent
dist REBUILT (build:unbundled) — the workspace resolves
`@earendil-works/pi-coding-agent` through `dist/`, so vendored source
changes need the rebuild for both runtime and self-learning's tsc (back
to its 88-error pre-existing baseline, zero new). CHANGELOG entry filed,
self-learning AGENTS.md contract extended with CP5.

## CP6 — verification (done, 2026-11-16)

Unit batteries per surface: every CP's pins re-ran green at its commit;
at CP5's close the full self-learning suite ran **5798 pass / 105 skip /
1 fail** — the fail is the router-singleton "initially idle" order flake,
verified byte-identical at the pristine baseline (passes 24/24 isolated,
pre-existing); tui suite exit-0 green; the coding-agent battery green over
its documented environment-artifact baseline (model-registry,
model-resolver, syntax-highlight, theme-detection, tools/find — the exact
files, no new failures); self-learning tsc at its 88-error pre-existing
baseline with zero new; biome zero new warnings; instruction-chars,
check:docs, check:changelog (rail regenerated, 63rd stop), check:claims,
check:benchmarks all green.

PTY lanes as a real user: `verify_toccata_cp5.py` **10/10** — a live Agnes
turn with the forced pool (UNOWN_SPINNER_VERBS=Pondering,Brewing,Vibing)
showed the verb on the working line ("Vibing...") and the honest tool
label takeover ("Reading README.md..."); the A16 offer card verified across
four boot shapes (fresh boot in a bare repo — the offer leads + no latch
write; returning user in an unoffered bare repo — the offer once, recorded
in agentsMdOfferedFor; re-boot in the offered repo — never again; a repo
WITH an AGENTS.md — never). `verify_footer_quiet.py` **9/9** after a
stack restart — the first run failed A2/A3 on the honest `memory: up ·
old build` chip because the engine was still booted from the pre-CP5 sha:
the Divertimento round's live-verification law re-proven (a stale engine
is a stale verdict; `agent:stop` + `agent:start` onto the current tree,
sha b69b3b3c, restored the lane). `verify_settings_hub.py` timed out on
its hub-menu anchor IDENTICALLY at baseline (pre-existing environment
drift in this sandbox, not this round — the hub unit suites 30/30 and the
lane's own pane dumps show the hub rendering).

Cross-platform matrix: the keybinding tables (usage.md) carry every
Toccata key with its Windows/WSL variants in parentheses (Ctrl+R search,
Ctrl+S stash, Alt+S/Ctrl+Enter send-now, Ctrl+V/Alt+V image chips, Ctrl+D
800 ms exit, the transcript-mode key table); the 3-OS build legs ride the
release tag (CP7).

## CP7 — ship (done, 2026-11-16)

CHANGELOG: the round's five CP entries + the accumulated Unreleased
entries folded into **[0.0.68] — 2026-11-16**; the landing rail
regenerated (62 stops, 599 entries, 62 dated; the empty-Unreleased fold
rule re-learned — the parser refuses a stop with no entries, so the
header drops until the next round opens). Blog: `content/blog/
2026-11-16-the-toccata-round.md` (feature post, tags tui/keyboard/
verification) with the lane's own stills — verb-thinking.png (the
working line mid-turn: `⠦ Pondering... 0:00`) and agents-md-offer.png
(the offer card leading the catalog) — produced by
verify_toccata_cp5.py's still pass, placed under public/blog/<slug>/;
check:blog green (55 posts, 142 tags). unown-overview re-stamped at
v0.0.68 with the Toccata lane noted (no counted figure moved — the
round added surfaces, not counts). Version 0.0.68 in package.json,
`bun bin/unown --version` matches; tag v0.0.68 cut per the version
contract (the release workflow's six per-OS builds + the 3-OS CI legs
ride the tag). The dependabot + code-scanning sweep: **0 open alerts
on both** (CodeQL #91 already cured in this release's entries).
Docs complete: usage.md (the working-line section + the /flights row),
configuration.md + .env.example (UNOWN_SPINNER_VERBS), the self-learning
AGENTS contract (CP5 line), the DOX tree current.
