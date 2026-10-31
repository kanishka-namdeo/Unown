# Plan Mode Keyboard & Interactivity Round — Session Log (2026-10-31)

Session doc per the repo's checkpoint discipline. Resume from the latest checkpoint if this session is interrupted.

Objective (user task): *"keyboard and interactivity issues in overall plan mode. identify and fix. cover edge cases"* — then bump the agent version and release with builds.

Scope: the full interactive plan-mode surface — the mode shortcuts (Shift+Tab cycle, Ctrl+Alt+P), the approval gate dialog (`ctx.ui.select` → `ExtensionSelectorComponent`), the feedback input, the plan editor dialog (`ExtensionEditorComponent`), the questionnaire (plan clarification, `ask-user-question`), and the terminal input stack they ride on (StdinBuffer → keys.ts → TUI dispatch → CustomEditor → extension shortcuts).

## Research baseline (done before any edit)

- Codebase audit (pi-tui custom framework — not Ink; input chain `ProcessTerminal → StdinBuffer → TUI.handleTerminalInput → focused component`; extension shortcuts dispatch through `CustomEditor.handleInput` before app actions).
- Competitor lane: Claude Code cycles permission modes with Shift+Tab (default → acceptEdits → plan) — this is the design target the repo's own `docs/plan-mode-competitor-research.md` pinned and `docs/usage.md` documents.
- Terminal keyboard edge cases covered by research: DECCKM/SS3 arrow forms (`\x1bOD`/`\x1bOC` vs CSI `\x1b[D`/`\x1b[C`), Kitty CSI-u encodings, xterm modifyOtherKeys, bracketed paste, lone-ESC disambiguation (10 ms), UTF-16 surrogate pairs (astral chars: emoji, rare CJK), Windows Terminal quirks.

## Findings (identified, each confirmed against source)

| # | Finding | Where | Severity |
|---|---|---|---|
| F1 | **Shift+Tab plan-mode cycle is dead on arrival.** The unown extension registers `Key.shift(Key.tab)`, but `ExtensionRunner.getShortcuts` drops extension shortcuts colliding with reserved built-ins; `app.thinking.cycle` defaults to `shift+tab` and is reserved. Every fresh install: Shift+Tab cycles thinking level, never enters plan mode. Docs contradict themselves (`docs/usage.md` line 561 vs 572). Gap register P-09 admits only "manual verification". | `self-learning/src/tools.ts:3977`, `coding-agent/src/core/extensions/runner.ts:616-622`, `coding-agent/src/core/keybindings.ts:100-103` | critical |
| F2 | **Questionnaire tab-switch mis-routes SS3 arrows.** `tabSwitchAction` lists `\x1bOC` (SS3 Right) in BOTH the left and right branches (first match wins → Right arrow moves tabs backward); SS3 Left (`\x1bOD`) is missing. Breaks multi-question ask-user-question in DECCKM application-cursor terminals. Raw-byte matching also ignores Kitty/modifyOtherKeys encodings that `matchesKey` already normalizes. | `self-learning/src/addons/ask-user-question-core.ts:526-529` | high |
| F3 | **Approval selector keyboard gaps.** `ExtensionSelectorComponent` (the plan approval gate UI) ignores `tui.select.pageUp/pageDown` (bindings exist; SelectList honors them), has no home/end, no numbered quick-select (Claude Code's approval dialog uses 1/2), and hardcodes `j`/`k`/`\n`. | `coding-agent/src/modes/interactive/components/extension-selector.ts:85-101` | medium |
| F4 | **Approval dialog brittle option matching.** `runPlanApprovalDialog` routes via `choice?.startsWith("Execute — auto-accept")` etc. — a cosmetic label tweak silently breaks approval routing. The 6-round editor cap exits silently. The "Edit the plan in $EDITOR" label lies (it opens the in-TUI editor; external editing is the editor's own Ctrl+G). | `self-learning/src/tools.ts:2368-2412` | medium |
| F5 | **Escape silently discards plan edits.** `ExtensionEditorComponent` cancels on `tui.select.cancel` (escape) with no dirty check — a stray Esc after minutes of plan editing loses everything. It also intercepts escape while the inner editor's autocomplete is open (the main editor's pattern checks `isShowingAutocomplete` first). | `coding-agent/src/modes/interactive/components/extension-editor.ts:98-114` | high |
| F6 | **Directly-typed astral characters corrupt input.** `StdinBuffer.process` splits non-escape input per UTF-16 code unit (`remaining[0]`), so a typed astral char (emoji, rare CJK) becomes two lone surrogates; the base `Editor` then inserts them (`charCodeAt(0) >= 32` accepts lone surrogates). Bracketed paste and Kitty CSI-u are safe; legacy terminals are not. | `tui/src/stdin-buffer.ts:271-275`, `tui/src/components/editor.ts:1024-1027` | high |
| F7 | **Plan-mode bash gate allows curl write primitives.** `/^\s*curl\s/` is in SAFE_PATTERNS with no `-o/--output/-O` constraint — a file-write primitive inside "read-only" plan mode. | `self-learning/src/tools.ts:1411` | medium (plan-mode safety, adjacent) |
| F8 | Verified NON-issues (documented so nobody re-litigates): the approval dialog does NOT lose the editor draft (same editor instance is re-added); Enter-as-`\n` in Kitty mode still confirms in extension dialogs (explicit `\n` fallback); Ctrl+C-as-cancel matches every other pi selector (consistent modal semantics). | — | none |

## Fix plan (milestones; each = commit + push)

- M1 — F2: route `tabSwitchAction` through the injected key matcher (`tab`, `shift+tab`, `left`, `right`) — fixes SS3 + Kitty + Windows in one stroke.
- M2 — F1: move `app.thinking.cycle` default `shift+tab` → `alt+t` in the vendored coding-agent (free, terminal-safe, mnemonic; users with explicit `keybindings.json` overrides keep their choice). Docs + regression tests incl. an InteractiveMode-level test pressing `\x1b[Z`.
- M3 — F3: selector pageUp/pageDown/home/end (`tui.select.first/last` configurable bindings), numbered quick-select with visible numbering, hint strip update.
- M4 — F4+F5: exact-match option constants, honest cap notice, truthful editor label, escape-discard guard (second-Esc confirms discard when dirty; autocomplete-aware).
- M5 — F6: StdinBuffer emits whole code points; base editor rejects lone surrogates (defense in depth).
- M6 — F7: curl write-flag constraint in the plan-mode gate.
- M7 — docs/DOX/CHANGELOG; M8 — real-user PTY verification + recapture changed media (never delete existing assets); M9 — v0.0.51 release with builds.

## Checkpoints

- **CP0 (pre-work)**: repo cloned at v0.0.50 (499a9412); deps installed (bun 1.3.14, node 24); baseline `bun test test/plan.test.ts` 24/24 green; research + audit complete; fix plan fixed. Next: M1.
- **CP1 (M1 done — questionnaire tab routing)**: `tabSwitchAction` now routes through the injected key matcher (`tab`/`shift+tab`/`left`/`right`) instead of raw bytes — fixes the SS3/DECCKM bug (`\x1bOC` in both branches, `\x1bOD` missing) and inherits Kitty CSI-u + modifyOtherKeys + Windows encodings from `matchesKey`. Tests: encoding-family regression cases + a real-`matchesKey` composition pin (35/35 in `test/addons/config.test.ts`). Environment notes: pi-repo needs `npm install --ignore-scripts` + `npm run build` (dist-based workspace resolution) before `bun test` resolves `@earendil-works/*`; `pi-repo/bun.lock` drifts under bun<1.4.3 — always `git checkout -- pi-repo/bun.lock` after any bun install. Known pre-existing sandbox flake (verified failing on pristine HEAD worktree): `gittools.test.ts` "runGitSync enforces its kill timer" — process-kill timing under this container, unrelated to this round. Full suite otherwise green (5264 pass / 1 env-flake). Next: M2 (Shift+Tab).
