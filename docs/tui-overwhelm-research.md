# The TUI overwhelm study — the Semplice research (2026-11-17)

> Purpose: the research base for the Semplice round (semplice — the musical instruction: play it simply), mission: make the TUI experience less overwhelming for the end user, study-backed, end to end. Verdict up front: **Unown's overwhelm is a presentation problem, not a feature-count problem.** Search neutralizes choice count, so the ~100-command catalog stays; what must change is what a brand-new user sees in the first 60 seconds — ~25 rows of boot preamble before the first keystroke, two diagnostics about Unown's own extensions, a failed-download warning, a 99-entry flat command popup, jargon chips — and how the first run asks its questions (five to eight before the first prompt on the wizard path). The round ships 18 interventions, W1–W18 (W numbering avoids collision with Toccata's A-numbers and Da capo's R-numbers), each mapped to the finding it implements, the competitor pattern it matches, and the Unown evidence that demands it.

- [Method](#1-method)
- [The study-backed foundation](#2-the-study-backed-foundation)
- [The competitor pattern library](#3-the-competitor-pattern-library)
- [The Unown overwhelm inventory](#4-the-unown-overwhelm-inventory)
- [Adoption decisions (W1-W18)](#5-adoption-decisions-w1-w18)
- [Deliberate non-adoptions](#6-deliberate-non-adoptions)
- [Verification plan](#7-verification-plan)
- [Source status](#8-source-status)

Related: [unown-ux-principles](unown-ux-principles.md) (the binding UX card) · [toccata-round-session](toccata-round-session.md) · [dacapo-round-session](dacapo-round-session.md) · [usage](usage.md) · [configuration](configuration.md)

---

## 1. Method

Four inputs, all gathered 2026-11-16/17:

1. **Competitor teardown** (`research/competitor-teardown.md`): Claude Code, Codex CLI, Gemini CLI, OpenCode, Crush, aider, plus the classic TUI reference set (lazygit, k9s, htop, btop, fzf, Helix) — 44 sources, every URL fetched 2026-11-17, UI copy quoted verbatim.
2. **Two UX research digests** (`research/study-backed-ux-core.md`, `research/study-backed-ux-applied.md`): peer-reviewed and practitioner literature on cognitive load, chunking, choice, disclosure, recognition, grouping, modes, onboarding, error messages, aesthetics, flow, natural programming, terminal accessibility, and AI-assistant trust. Citations carry verification tiers (opened / Crossref-verified / unverified); the tiers are inherited below, and no unverified claim is load-bearing.
3. **The codebase map** (`research/unown-tui-map.md`): every user-facing surface with file:line evidence, plus the 17-item overwhelm inventory this doc adopts as its checklist.
4. **Baseline PTY captures** (`download/unown-semplice/baseline/*.pane.txt`): a fresh home's first 60 seconds in the verification lane (PTY 128×36, pane text as truth) — the gate, boot with flights, settled editor, `/` popup, a `/help` turn, and the wizard's preset and key steps.

The design shape every input converges on is the core digest's synthesis: **small visible surface, large searchable depth** — cap what is simultaneously visible (Miller/Cowan, ~4–5 items), weed what remains (cognitive load theory), and put depth behind search and one-key expansion (Hick/Landauer; the command palette), never behind deletion.

## 2. The study-backed foundation

Load-bearing findings only; each row names the design implication this round acts on.

| Finding | Source | What it says | TUI implication |
|---|---|---|---|
| Cognitive load: cut extraneous load; weed | [Sweller 1988](https://doi.org/10.1207/s15516709cog1202_4) · [Sweller et al. 2019](https://link.springer.com/article/10.1007/s10648-019-09465-5) · [Mayer & Moreno 2003](https://doi.org/10.1207/s15326985ep3801_6) | Presentation redesign sheds extraneous load (weeding, signaling, segmenting) | Every boot line must earn its row; the default screen is weeded, not truncated (W2–W5) |
| Redundancy effect | [Sweller & Chandler 1994](https://doi.org/10.1207/s1532690xci1203_1) | Duplicating the same information in multiple forms actively hurts processing | One home per fact; duplicated onboarding systems get collapsed (W17) |
| Working memory ≈ 4 chunks | [Miller 1956](https://psychclassics.yorku.ca/Miller/) · [Cowan 2001](https://doi.org/10.1017/s0140525x01003922) | Chunking, not raw item count, is the lever; the modern reading is ~4 chunks; practitioner caveat: do not cite 7±2 to cap features | Hint rows ≤4–5 keys valid right now (W14); summaries as ≤8-line chunks (W7); grouped menus (W10) |
| Hick's law — and its limits; breadth beats depth | [Hick's law](https://en.wikipedia.org/wiki/Hick%27s_law) · [Landauer & Nachbar 1985](https://doi.org/10.1145/317456.317470) | Choice time grows only logarithmically; menu cost is per decision level — broad shallow was fastest | Never delete commands to satisfy Hick; flatten, group, search instead (non-adoption 1) |
| Search neutralizes choice count | [Command palette](https://en.wikipedia.org/wiki/Command_palette) · [VS Code docs](https://code.visualstudio.com/docs/getstarted/userinterface) | A fuzzy palette converts choose-among-N into type-a-prefix plus recognize | The ~100-command catalog stays; palette and groups make it feel small (W10, W11) |
| Progressive disclosure | [Wikipedia](https://en.wikipedia.org/wiki/Progressive_disclosure) | Defer advanced or rare features to secondary screens, revealed when relevant; burial is the failure mode — backstop with search | Collapse by default, expand on one key (ctrl+o), nothing buried (W3, W5) |
| Recognition over recall (heuristic 6) | [Nielsen 1994](https://doi.org/10.1145/191666.191729) · [heuristic list](https://en.wikipedia.org/wiki/Heuristic_evaluation) | Make objects, actions, and options visible; minimize memory load | State and hints carry what the user would otherwise re-derive (W9, W15) |
| Gestalt grouping | [Principles of grouping](https://en.wikipedia.org/wiki/Principles_of_grouping) · [law of proximity](https://lawsofux.com/law-of-proximity/) | Proximity, common region, and similarity organize perception preattentively | Category headers and whitespace, not decoration; borders only for functional regions (W10, W11) |
| Visibility of system status (heuristic 1) | [heuristic list](https://en.wikipedia.org/wiki/Heuristic_evaluation) | Keep users informed about what is going on | Keep the ctx meter, working spinner, and memory-recall evidence (non-adoptions 5, 7) |
| Error messages: blame-free, actionable, quiet when recoverable | [Microsoft Win UX guidelines](https://learn.microsoft.com/en-us/windows/win32/uxguide/mess-error) · [Norman 1983](https://doi.org/10.1145/2163.358092) | Say what happened, why, and the fix; "often the best error message is no error message"; design to prevent | Silence product-internal diagnostics (W1); failure gets one actionable line (W2); no fatal dead ends (W8) |
| Aesthetic and minimalist design (heuristic 8) | [heuristic list](https://en.wikipedia.org/wiki/Heuristic_evaluation) | "Every extra unit of information in a dialogue competes with the relevant units" | The round's one-sentence law: ration every printed line (W4, W5, W7, W13) |
| Help and documentation (heuristic 10) | [heuristic list](https://en.wikipedia.org/wiki/Heuristic_evaluation) | Help should be task-shaped, searchable, easily retrievable | Grouped /help (W11); everyday-first `--help` (W18); docs that match the code (W12) |
| Modes and mode errors; plain typing must be safe | [Mode (UI)](https://en.wikipedia.org/wiki/Mode_(user_interface)) · [Sellen et al. 1992](https://doi.org/10.1207/s15327051hci0702_1) | Continuous, distinctive feedback of the active mode prevents mode errors; stray keystrokes must not trigger actions | Typing with the flights card mounted falls through to the editor (W16) |
| Onboarding: competence, autonomy, spacing | [Ryan & Deci 2000](https://doi.org/10.1037/0003-066x.55.1.68) · [Ryan et al. 2006](https://doi.org/10.1007/s11031-006-9051-8) · [Cepeda et al. 2006](https://doi.org/10.1037/0033-2909.132.3.354) · [Andersen et al. 2012](https://doi.org/10.1145/2207676.2207687) · [Apple HIG Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) | Competence and autonomy sustain motivation; spaced beats massed; tutorials helped only the most complex game; Apple: prefer "context-specific tips instead of a single onboarding flow" | First 60 seconds = a working prompt (W6); contextual tips stay the teacher (non-adoption 2) |
| Interruption cost | [Mark et al. 2008](https://doi.org/10.1145/1357054.1357072) | Interrupted users finish as fast but with more stress, frustration, and effort | Quiet boot: no ambient status noise while nothing is happening (W2, W3, W4) |
| Aesthetic-usability effect | [Kurosu & Kashimura 1995](https://doi.org/10.1145/223355.223680) · [Tractinsky 1997](https://doi.org/10.1145/258549.258626) | Attractive interfaces are rated more usable at equal actual usability | Calm spacing and alignment are perceived-usability work, not decoration |
| Natural programming | [Ko et al. 2004](https://doi.org/10.1109/vlhcc.2004.47) · [CMU NatProg](https://www.cs.cmu.edu/~NatProg/) | Users guess behavior from names; selection and information barriers dominate beginner failure; help should be goal-oriented | No unexplained jargon in chrome (W13, W15); `--help` leads with everyday verbs (W18) |
| Terminal accessibility | [Albusays et al. 2017](https://doi.org/10.1145/3132525.3132550) · [NEI](https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness) · [WCAG use of color](https://cdn.jsdelivr.net/gh/w3c/wcag@main/understanding/20/use-of-color.html) | Screen readers need linear text streams; ~1 in 12 men have a color-vision deficiency; never encode meaning in color or glyph alone | Chips pair glyphs with words (W15); quiet changes stay in the linear transcript |
| Trust calibration | [Lee & See 2004](https://doi.org/10.1518/hfes.46.1.50_30392) · [Amershi et al. 2019](https://doi.org/10.1145/3290605.3300233) | Calibrate trust to actual reliability via process feedback; support efficient dismissal; make clear why the system did what it did | Memory recall stays visible on demand (non-adoption 5); no silent auto-trust (non-adoption 4) |

## 3. The competitor pattern library

Condensed from the teardown; full patterns and per-product detail in `research/competitor-teardown.md`.

| Pattern | Who | Evidence |
|---|---|---|
| Two-question first run; defer everything else | Claude Code, Gemini CLI, Codex, Crush | [quickstart](https://docs.anthropic.com/en/docs/claude-code/quickstart) · [get started](https://www.geminicli.com/docs/get-started) |
| Zero-setup first prompt ("your first plain prompt in a fresh session already does the right thing") | Claude Code | [best practices](https://www.anthropic.com/engineering/claude-code-best-practices) |
| Post-login screen = version + model + cwd, nothing else | Claude Code | [quickstart](https://docs.anthropic.com/en/docs/claude-code/quickstart) |
| Startup warnings never print as raw text above the logo (changelog 2.1.305) | Claude Code | [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md) |
| Chat view relies on command output and status, not repeated notices | Codex | [history_cell/exec.rs](https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/history_cell/exec.rs) |
| Collapsed tool cells; capped lists ("shows up to five tasks at a time") | Claude Code | [interactive mode](https://docs.anthropic.com/en/docs/claude-code/interactive-mode) |
| Density as a dial with quiet defaults (compactToolOutput true; context percentage hidden by default; decomposable footer) | Gemini CLI | [configuration](https://www.geminicli.com/docs/reference/configuration) |
| `?` cheatsheet plus a persistent "? for shortcuts" hint; panel auto-hides while streaming | Claude Code, Gemini CLI | [interactive mode](https://docs.anthropic.com/en/docs/claude-code/interactive-mode) · [keyboard shortcuts](https://www.geminicli.com/docs/reference/keyboard-shortcuts) |
| Whole-shortcut hint rows; state-aware labels (Send to Queue, Quit to Interrupt) | Codex | [footer_hint.rs](https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/footer_hint.rs) |
| Scope-labeled allow ladders plus plain outcome lines after the answer | Claude Code, Codex | [permissions](https://docs.anthropic.com/en/docs/claude-code/permissions) · [approval_overlay.rs](https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/bottom_pane/approval_overlay.rs) |
| Namespaced or grouped command menus (built-ins, skills, plugins; user: / project:) | Claude Code, Crush | [interactive mode](https://docs.anthropic.com/en/docs/claude-code/interactive-mode) · [crush README](https://raw.githubusercontent.com/charmbracelet/crush/main/README.md) |
| Theme without a wizard: auto-switching from the terminal background | Gemini CLI | [configuration](https://www.geminicli.com/docs/reference/configuration) |
| Folder trust with visible consequences (discovery scan; untrusted = named restricted mode) | Gemini CLI, Claude Code | [trusted folders](https://www.geminicli.com/docs/cli/trusted-folders) · [security](https://docs.anthropic.com/en/docs/claude-code/security) |

Anti-patterns the teardown recorded, and this round designs against: command sprawl without a palette (aider, docs-first); hidden density toggles (Gemini's Tab+Tab lives only in the keyboard reference); dead ends in restricted modes (`FatalUntrustedWorkspaceError`, escape hatches only in prose); everything-on-screen by default; raw-log repetition; faint-text contrast as style.

## 4. The Unown overwhelm inventory

The map's 17-item inventory, condensed; full file:line evidence in `research/unown-tui-map.md` §10.

| # | Item | Evidence |
|---|---|---|
| 1 | ~100 slash commands, flat list (74 unown + 23 pi + 3 hidden + dynamic); docs undercount ("forty-seven + twelve") | `tools.ts:4600-6751` et al.; `docs/usage.md:493` |
| 2 | ~315-line `unown --help`: ~31 subcommands, 24 session flags, ~20 env vars | `cli.ts:179-494` |
| 3 | Pre-TUI raw `[Y/n]` gate; Enter defaults into a 4–7-question wizard | `cli.ts:1745-1760, 3959-3969` |
| 4 | Wizard closing summary ≈25 dense lines incl. a pasted flight list | `setup.ts:342-386` |
| 5 | Boot chrome stacking: splash + header rows + footer rows + mission panel + flights card replacing the editor | `splash.ts:451-484`; `interactive-mode.ts:1240-1307`; `mission.ts:264+`; `flights.ts:367-411` |
| 6 | Four overlapping onboarding systems on three latches (gate, splash, flights, pi FirstTimeSetup) | `first-time-setup.ts:31-145`; `onboarding-state.ts:32-49` |
| 7 | Flights card eats keystrokes; stray `x` latches never-again persistently | `flights-core.ts:147-166`; `scripts/tui-capture/pty-README.md:96-104` |
| 8 | Spec-gate asks numbers a new user cannot know; declining is fatal | `spec-gate.ts:219-246`; `cli.ts:3976-3989` |
| 9 | ~120 rebindable keybinding actions; 5 doc tables | `tui/src/keybindings.ts`; `docs/usage.md:604-686` |
| 10 | Settings sprawl: 11 sections, 127 hub rows, ~410 entries across 8 surfaces | `settings/types.ts:25-37`; `docs/settings_inventory.md` |
| 11 | Dashboard: a second 15-screen TUI advertised in the first 60 s (flight 3) | `dashboard-app.ts:55-76` |
| 12 | Token/context information has ~8 homes | footer meter, `/context`, `/usage`, `/cost`, `/session`, `/status`, `/insights`, statusline |
| 13 | Jargon chips a newcomer must decode (ttft, CH, R, conf ✓) | `footer.ts:139-173`; `turn-meter.ts:11-32`; `mission.ts:189` |
| 14 | Quiet is configured by env kill switches, not settings UX | `UNOWN_FOOTER_CLASSIC`, `UNOWN_TURN_METER`, …; `docs/configuration.md` |
| 15 | 5+ separate untrusted-config notices, each with its own `/x trust` | `cli.ts:1157-1161`; `permissions.ts:924-926` |
| 16 | Split-view: 11 `/split*` commands plus geometry flags for one display mode | `splitview.ts:1891-2078` |
| 17 | `/plan` spans 5 entry lanes + 4 approval options + a scoring rubric | `cli.ts:195-204`; `tools.ts:4600-4675` |

**The baseline pane evidence (first 60 seconds, fresh home)** — the round's before-state, quoted from the captures:

- Gate (00): `First run — no provider connected yet.` / `Connect one now? (Agnes, OpenAI, OpenRouter, Anthropic, Dashscope, DeepSeek, local…)` / `Enter = guided setup · n = keep the bundled bridge for now [Y/n]` — Enter defaults into the wizard even when the bundled bridge is healthy (`cli.ts:3962`).
- Boot preamble (04): 21 non-blank lines across the 30 pane rows above the editor — the `── Context ── / ── Skills ── / ── Extensions ── / ── Themes ──` block (14 rows), two `[Extension issues]` warnings about Unown's own `/settings` and `/copy` overrides, `fd not found. Downloading...`, `Warning: Failed to download fd: GitHub API error: 403`, `◈ memory recalled: 2 rules — /memory show`, and `○ no tracked steps · conf ✓ · 0m in session`.
- Command popup (05): a flat list beginning `model / tree / thinking / scoped-models / export` under a `(1/99)` counter.
- Settled turn (06): `turn 2.5s · ttft 1.5s` and `ctx ▕██████░░░░▏ 2.9%/524k (auto) · ↓196 · ↑15k`; the footer hint row carries six hints (`? help · ctrl+k palette · / commands · ! bash · ctrl+o transcript · esc-esc tree`).
- Wizard (07/08): a three-line `Current configuration` header wrapping a ten-model list, a nine-entry provider list, then a ten-entry model list — five to eight questions before the first prompt.

## 5. Adoption decisions (W1-W18)

All 18 are ADOPT, planned for this round; none deferred. CP labels map to the round's checkpoint plan: CP1 quiet first boot, CP2 two-beat first run, CP3 discoverability, CP4 plain language, CP5 onboarding consolidation, CP6 help.

| # | Intervention (CP) | Implements | Competitor pattern | Unown evidence | Confidence |
|---|---|---|---|---|---|
| W1 | Suppress extension-override diagnostics for product-owned inline extensions (CP1) | Error guidelines: suppress recoverable noise; heuristic 8 | Claude Code 2.1.305: startup warnings never print above the logo | Two `[Extension issues]` blocks in every baseline capture | high |
| W2 | Managed-tool (fd/rg) download status quiet by default; one actionable line only on failure (CP1) | Error guidelines (what/why/fix); Mark 2008 interruption cost | Codex: status, not repeated notices | `fd not found. Downloading...` + `GitHub API error: 403` on boot; `interactive-mode.ts:1310-1316` | high |
| W3 | Startup resource block (Context/Skills/Extensions/Themes) hidden by default on fresh homes; ctrl+o expands (CP1) | Progressive disclosure; weeding | Claude Code ctrl+o expansion; Gemini hideable context summary | 14 of the 21 preamble rows (04) | high |
| W4 | Zero-state status/mission lines earn no row (`no tracked steps · 0m in session` suppressed at rest) (CP1) | Heuristic 8; footer quiet round's "healthy ambient state earns no row" | Gemini: context percentage hidden by default | `○ no tracked steps · conf ✓ · 0m in session` (02/04/06) | high |
| W5 | First-boot memory-recall line gated (first boot only; reachable via ctrl+o and `/memory`) (CP1) | Heuristics 8 vs 1, resolved by disclosure | Gemini ui.hideContextSummary | `◈ memory recalled: 2 rules` on a fresh home (02) | medium |
| W6 | First-run gate defaults to keep-bridge when the bundled bridge is healthy (CP2) | SDT competence moment; Apple HIG "fast, fun, and optional" | Two-question first run; zero-setup first prompt | Gate capture 00; Enter drops a healthy-bridge user into the wizard (`cli.ts:3962`) | high |
| W7 | Wizard closing summary ≤8 lines; flights as a pointer, not a pasted list (CP2) | Cowan chunking; heuristic 8 | Claude Code post-login: version/model/cwd only | ≈25-line summary (`setup.ts:342-386`); flight summaries are byte-pinned — pins move in the same change | high |
| W8 | Spec-gate gains a conservative-default answer; declining is never fatal (CP2) | Error guidelines: no dead ends; heuristic 5 | Gemini anti-pattern: restricted modes must name their exit | Declined spec ask is fatal today (`cli.ts:3982-3989`) | high |
| W9 | Keep-current-config path skips questions whose answers are already settled (CP2) | Recognition over recall; heuristic 8 | Claude Code zero-setup | The wizard re-asks key/model after "Keep the current configuration" (08) | high |
| W10 | Category grouping in the `/` autocomplete popup and ctrl+k palette (CP3) | Gestalt common region; chunking | Claude Code grouped `/` menu; Crush user:/project: namespaces; the dashboard already groups LEARNING/OPERATIONS | `(1/99)` flat (05) | high |
| W11 | `/help` grouped compact redesign (CP3) | Heuristic 10; recognition over recall | Gemini `/help` plus auto-hiding `?` panel; Codex three-group overlay | 99-command flat surface | high |
| W12 | `docs/usage.md` command-count drift fix (CP3) | Heuristic 10 (accurate docs) | — (docs hygiene) | Code counts 74 + 23; docs say "forty-seven + twelve" | high |
| W13 | Turn chip drops `ttft` by default (CP4) | Natural programming: no unexplained jargon | Crush ships tool-call elapsed timers in plain units (recorded in [tui-claude-code-parity-research-2](tui-claude-code-parity-research-2.md) §1.5) | `turn 2.5s · ttft 1.5s` (06); `turn-meter.ts:11-32` | high |
| W14 | Footer hint row pruned 6 to 5 (CP4) | Cowan: ≤4–5 keys valid now | Codex whole-shortcut hint rows; Gemini's single `? for shortcuts` hint | Six-hint row in every capture | high |
| W15 | `conf ✓` chip made decodable (a word, not a bare glyph) (CP4) | Natural programming; WCAG use of color | Codex plain-language outcome lines | `conf ✓` (02/04/06); `mission.ts:189` | high |
| W16 | First-flights card printable-character fall-through: typing dismisses the card into the editor (CP5) | Mode-error prevention; plain typing must never be destructive | Codex startup: safe editor input accepted while the app is provisional | Lane hazard: both capture lanes had to add `dismiss_first_flights()` (`pty-README.md:96-104`) | high |
| W17 | Suppress pi's FirstTimeSetup dialog when the unown wizard already ran (CP5) | Redundancy effect; heuristic 8 | Gemini auto-theme (no theme ask); Claude Code first run = login only | Four onboarding systems, three latches (inventory 6) | high |
| W18 | `--help` restructured: everyday commands first, grouped table, flags/env into topic pages (CP6) | Natural programming: goal-oriented help; heuristic 10 | Topic pages (20 HELP_PAGES already exist in `cli.ts:4124-4157`) | ~315-line `--help` (`cli.ts:179-494`) | high |

Design notes on the rows that need them:

- **W4/W5 draw the heuristic-1 versus heuristic-8 line explicitly.** Visibility of system status is preserved wherever the state is real work in progress (spinner, ctx meter, attention rows). What stops printing is evidence of nothing (`no tracked steps`) and bookkeeping a first-boot user cannot yet interpret (`memory recalled: 2 rules` on a home with no history). Both stay reachable via ctrl+o and their commands — disclosure, not deletion (non-adoptions 5, 7).
- **W6 keeps the gate one question and changes only the default.** When the bundled bridge's `/health` answers, keep-bridge becomes the Enter default and the wizard stays one keystroke away (`unown setup`). On the standalone binary without a bridge the current default stands — the gate never lies about a missing endpoint.
- **W7 moves byte-pinned copy.** The flights summaries are the wizard's output bytes, pinned by tests; compressing the summary updates those pins in the same change.
- **W14 folds the least-everyday hint behind `? help`** (the esc-esc tree hint is the candidate), keeping the row to the keys valid at rest; `?` stays first.

## 6. Deliberate non-adoptions

The refusals on record, mirroring prior rounds:

1. **Not removing commands.** Hick's law does not license deletion: the relation is logarithmic and Landauer & Nachbar measured cost growing with depth, not breadth; the palette converts recall into recognition. The ~100-command catalog stays; W10/W11 make it navigable.
2. **Not a first-run tutorial wall.** Andersen et al. (CHI '12) found tutorials raised engagement only in the most complex game, no significant gain in the simpler ones; Cepeda et al. show spaced beats massed; Apple HIG says prefer "context-specific tips instead of a single onboarding flow." Unown already ships the right shape: the flights card (pick a starter task, dismissible) plus one rotating tip per returning boot.
3. **Not making the theme wizard mandatory.** SDT autonomy; Apple's "fast, fun, and optional"; Gemini removes the ask via auto-theme switching. The theme step stays skippable; `/theme` keeps live preview.
4. **Not auto-trusting project configs.** Gemini's trust dialog works because it shows what trust unlocks and drops untrusted folders into a named restricted mode; Crush warns "Don't launch Crush in a directory whose config you haven't reviewed"; Lee & See's misuse failure mode is overtrust. The fragmented trust notices (inventory 15) deserve a consolidated review surface in a later round — never silent trust.
5. **Not silencing memory recall entirely.** Heuristic 1 and trust calibration both want the recall line visible as process feedback; W5 gates only the first-boot line, every later recall keeps its `/memory show` pointer.
6. **Not adopting ghost-text completions.** Declined in the Toccata round, re-affirmed in Da capo; the reasons (mid-prompt clutter, metered cost) stand.
7. **Not hiding the ctx meter.** Heuristic 1; auto-compaction is only trustworthy while context state is visible. The meter already lives in the merged status row (the footer quiet round's contract); Gemini hides only the percentage — Unown keeps meter and percentage.

## 7. Verification plan

- **PTY lane, before/after.** Baseline: `download/unown-semplice/baseline/*.pane.txt` (fresh home, 128×36, pane text as truth). After-captures run the same scenarios (gate, boot with flights, settled editor, `/` popup, `/help`, wizard presets/key). Metrics, counted on pane text:
  - Boot preamble (non-blank rows above the editor in the settled-editor capture, footer rows excluded per the two-row contract): baseline 21 → **target ≤6**.
  - Wizard closing summary: baseline ≈25 lines → **target ≤8**.
  - `/` popup and `/help`: category headers present; the popup stays fully searchable (a `(1/N)` counter is fine).
  - Footer hint row: **≤5 hints** (baseline 6).
  - A healthy fresh boot contains no `[Extension issues]` block and no `fd not found` line (grep the pane text); failure paths print exactly one line naming the fix.
  - Flights card fall-through: typing `hello` with the card mounted lands in the editor; a stray `x` inside a typed word no longer latches never-again.
- **Unit pinning.** `test/first-run-copy.test.ts` (gate copy and default), `test/setup-dialog.test.ts` and the flights byte pins (W7 moves them in the same change), `test/footer-mode.test.ts` (W14), `test/turn-meter.test.ts` (W13), the mission/status-card pins (W15), `test/cli/golden.test.ts` HELP golden (W18). Suites: `cd pi-repo/packages/self-learning && bun test test/`; vendored coding-agent changes additionally run `bun run build:unbundled`; `bun run check:docs` gates the doc sync.
- **Kill switches and settings, documented.** Every new quiet behavior gets a settings entry in the `/settings` hub (inventory 14's finding: quiet must not be env-only) plus its env kill switch in the house pattern, synced to `docs/configuration.md` and `.env.example` in the same change. Nothing ships unswitchable.
- **Receipt.** The round session doc (`docs/semplice-round-session.md`, created by the round) records per-CP verification counts and links the pane dumps and stills; behavior-visible changes (the gate default, the memory-line gating) get CHANGELOG Agent Behavior entries.

## 8. Source status

Research citations inherit the digests' verification tiers: **opened** (Sweller et al. 2019 abstract; Miller; Hick; the heuristic list; grouping; progressive disclosure; command palette; VS Code docs; Microsoft error guidelines; Apple HIG; CMU NatProg; NEI; WCAG mirror; Anthropic best practices; lawsofux) and **Crossref/OpenAlex-verified records** (Sweller 1988; Sweller & Chandler 1994; Mayer & Moreno 2003; Cowan 2001; Landauer & Nachbar 1985; Nielsen 1994; Norman 1983; Sellen et al. 1992; Cepeda 2006; Ryan & Deci 2000; Ryan et al. 2006; Andersen 2012; Mark 2008; Kurosu & Kashimura 1995; Tractinsky 1997; Ko et al. 2004; Albusays 2017; Lee & See 2004; Amershi 2019) — findings summarized from verified records; spot-check abstracts before external publication. Unverified in the digests and not load-bearing here: the NN/g articles (WAF-blocked), the Google PAIR Guidebook, Csikszentmihalyi's book, the Appleyard & Ritter study, Skilometer. All competitor URLs were fetched 2026-11-17 (44 sources; full list in `research/competitor-teardown.md`); the Claude Code changelog claim (2.1.305) is additionally recorded in [tui-claude-code-parity-research-2](tui-claude-code-parity-research-2.md). No new URLs were added for this document.

Related pages: [unown-ux-principles](unown-ux-principles.md) · [toccata-round-session](toccata-round-session.md) · [dacapo-round-session](dacapo-round-session.md) · [usage](usage.md) · [configuration](configuration.md)
