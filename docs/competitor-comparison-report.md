# The competitor comparison report — reverse-engineering the field, building the loop

> The mission-level consolidation of every competitor-research pass this
> programme ran (2026-10-24 → 2026-10-28): **24 systems** across six
> research documents, compared on learning loops, memory systems, benchmark
> design, planning, failure recovery, task decomposition, autonomous
> debugging, live-preview showcase and memory architecture — what the field
> does, what Unown adopted (with the receipt that proves it landed), and
> the gaps that remain honestly open. Each source doc carries its own
> claim-tier convention (`[V]` verified at a cited source, `[C]`
> upstream-claimed, `[U]` unknown/inference, `[V-absence]` verified
> absence); every load-bearing claim below inherits the tier of its source.

- [Method](#method)
- [The corpus — 24 systems, six passes](#the-corpus--24-systems-six-passes)
- [Findings by dimension](#findings-by-dimension)
- [Improvements adopted — the consolidated ledger](#improvements-adopted--the-consolidated-ledger)
- [Remaining gaps](#remaining-gaps)
- [The verdict](#the-verdict)

Related: [SOTA round research](sota-round-competitor-research.md) ·
[Parley round research](parley-round-competitor-research.md) ·
[Sentinel round research](sdlc-testing-competitor-research.md) ·
[Live-preview research](live-preview-competitor-research.md) ·
[Memory research](memory-competitor-research.md) ·
[Memory source deep-dive](memory-competitor-source-deep-dive.md)

## Method

Every pass followed the same discipline: read the competitors' actual
ships — their source code at pinned SHAs, their published changelogs,
their benchmarks, their issue trackers — never their marketing pages
alone; verify at the cited source where possible; mark what could not be
verified with the tier it deserves; and record verified absences as
findings (an absence of a learning loop in a 34k-star fork is data, not a
cheap shot). The passes were also *bidirectional*: research preceded each
build round, and each round's findings fed back into the next pass's
questions. The memory sweep (2026-10-24/25) asked "what does the memory
industry know that Unown's four-tier stack does not"; the sentinel pass
(2026-10-28) asked "how do comparable products drive, verify and showcase
agent-built apps"; the live-preview pass (2026-10-27) asked "how does the
field put a live agent-built app on a landing page"; the SOTA pass
(2026-10-28) asked "what is the actual state of the art on the seven
learning dimensions"; the Parley pass (2026-10-28) asked "what makes
self-improvement *trustworthy*" — adversarial verification,
isolation-controlled evaluation, durable resumable execution. Two passes
were triggered mid-round by late entrants (ZCode, OpenClaude, Codewhale)
discovered while verifying another claim — the corpus grew because the
field grew.

One honesty rule inherited from the SOTA pass applies to this report too:
**withdrawn pages are not evidence** (the Gemini CLI GA benchmark post
that 404s during verification is cited at `[C]`, never presented as
verified), and network blocks during research (developers.openai.com was
unreachable from the sandbox) are stated, not worked around with guesses.

## The corpus — 24 systems, six passes

| # | System | Pass(es) | What it is | Read on |
|---|---|---|---|---|
| 1 | OpenHands (Agent Canvas / software-agent-sdk) | SOTA, sentinel, live-preview | open-source agent platform, SWE-bench lineage | all 7 dimensions + verification gates + demo mode |
| 2 | Roo Code / Zoo Code | SOTA | VSCode agent (sunset 2026-05) + community fork | all 7 |
| 3 | Cline | SOTA, sentinel | VSCode agent, shadow-git checkpoints | all 7 + unattended-build safety |
| 4 | OpenAI Codex CLI | SOTA, memory | Rust AGENTS.md-native CLI | all 7 + memory |
| 5 | Google Gemini CLI | SOTA | the only competitor mining its own transcripts | all 7 |
| 6 | Aider | SOTA, live-preview | pair-programming CLI, the field's benchmarking bar | all 7 + showcase |
| 7 | Claude Code (public practice) | SOTA, memory | closed-source; postmortems + memory design documented publicly | all 7 + memory |
| 8 | ZCode | SOTA, Parley | Z.ai's agentic dev environment; closest shipped memory loop | all 7 (Parley, deeper) |
| 9 | OpenClaude | SOTA, Parley | provider-agnostic fork of the leaked Claude Code source | all 7 (Parley, deeper) |
| 10 | Codewhale | SOTA, Parley | Rust terminal agent, Operate mode, receipts | all 7 (Parley, deeper) |
| 11 | Goose (Block / Linux Foundation) | Parley | agent + Harbor cross-harness benchmark | all 7 |
| 12 | Crush (Charmbracelet) | Parley | Go TUI agent, LSP-native | all 7 |
| 13 | Amp (ex-Sourcegraph) | Parley | threads, orbs, The Dial | all 7 |
| 14 | bolt.diy | sentinel | open-source bolt; WebContainer showcase | live preview + sandboxing |
| 15 | gpt-pilot | sentinel | unmaintained pilot; decomposition + recovery canon | decomposition + failure recovery |
| 16 | bolt.new | live-preview | the app-is-the-landing product | preview/verification/persistence/demo-mode |
| 17 | opencode | live-preview | terminal agent; share-page tombstone | same 4 columns |
| 18 | v0 | live-preview | closed-source; live-iframe template gallery | same 4 columns |
| 19 | pi (earendil-works) | live-preview | Unown's own base — the reference point | same 4 columns |
| 20 | Mem0 | memory | the engine Unown embeds; its bugs are Unown's | storage/retrieval/consolidation/transparency/multi-project/self-editing |
| 21 | Letta (MemGPT) | memory + deep-dive | MemFS — memory as an agent-owned git repo | same 6 + process model |
| 22 | Zep / Graphiti | memory + deep-dive | temporal knowledge graph, bi-temporal edges | same 6 + durability |
| 23 | LangMem, Cursor, Cognee, A-MEM, MemOS, Supermemory | memory (+deep-dive for three) | the memory-product landscape | same 6 |

*(Claude Code appears once at #7; the memory pass re-read its memory
design but adds no new system. Mem0/Letta/Zep/Cognee/A-MEM/MemOS/
Supermemory/LangMem/Cursor count as nine distinct products in rows
20–23.)*

## Findings by dimension

### Learning loops — nobody ships the closed loop

The SOTA pass's headline, re-verified by the Parley pass a day later:
**no competitor ships a closed, self-improving loop.** The pieces exist
in public, scattered: Gemini CLI's Auto Memory mines *past idle
transcripts* into human-gated unified-diff patch inboxes and SKILL.md
drafts (`/memory inbox`; never auto-applies) — "Unown's AutoDream with a
human gate instead of canary gates." Claude Code institutionalised the
postmortem loop after its April-23 regressions (per-model eval suites →
line-by-line prompt ablations → soak periods → gradual rollouts, then
back-tested its own Code Review agent against the offending PRs).
OpenHands gates releases with matched-model benchmarks and measured a
+8.2-point SWE-bench delta attributable to its harness (arXiv:2511.03690;
Sonnet 4.5 64.6% → 72.8%). ZCode auto-curates memory after each finished
conversation round — the closest shipped thing to Unown's loop, "memory
curation only — no benchmark, no harness, no shipped-improvement
receipts." OpenClaude — 34.2k stars, the leaked Claude Code source made
provider-agnostic — inherited the full skills/subagents surface with
**no persistent learning loop** `[V-absence]`: "the widest-distributed
proof that Claude Code's *surface* is commoditized while its
*improvement loop* is not." Nobody converts a live failure into a
benchmark, fixes the agent, and reruns the workflow as one machine.
That is the gap this programme exists to close.

### Memory systems — the industry moved past three things Unown hadn't

The memory sweep's verdict: "Unown's flat-file-plus-gated-consolidation
design is directionally validated (Letta converged on the same shape from
the other direction), but the industry has moved past 'recency wins'
contradiction handling (bi-temporal supersede), past 'one memory type'
(facts vs episodes vs procedures with different decay), and past 'trust
the dream' (review queues for inferred memories). Those three are where
the gap is." Letta's MemFS makes agent memory a git repository the agent
commits to, with dreaming subagents in worktrees and a `/doctor` audit;
Zep invalidates facts with bi-temporal edges instead of deleting them;
Supermemory flags inferences `isInference: true` **until someone confirms
them**, with an approve/decline/undo review queue; Mem0's own platform
(not the OSS SDK Unown embeds) added non-destructive Supersede/Merge/
Synthesis dreams. The bugs matter as much as the features: Letta #3388
(poisoned context permanently leaking into later evaluation runs) is "the
canonical statement of the threat Unown's write-gate + zero-extraction
quarantine answers"; Graphiti #1707 (silent episode loss) is the
counter-design for Unown's outbox + markDreamed-only-on-success contract;
Codex CLI's silent 32 KB AGENTS.md truncation (#13386) — "users assume
Codex is unreliable when in reality their instructions were silently
clipped" — became an Unown benchmark pin, not a feature.

### Benchmark design — matched-model, isolation-controlled, cost-columned

Aider remains "the most rigorous public benchmarking in the field"
(133 exercises drawn from the 225-of-697 hardest, pass@1/pass@2, edit
well-formedness, cost and seconds per case, Docker-pinned, SHA-logged
requests). OpenHands scores every patch in a fresh container against
FAIL_TO_PASS/PASS_TO_PASS — never transcript self-reports. Goose's
Harbor runs terminal-bench-2 **across harnesses on the same model**
(goose code-mode 57.3% vs Claude Code harness 55.1% vs opencode 52.8% on
claude-sonnet-4-6) with rate/compute/tokens/turns/cost columns — proving
"a harness feature moved the score +6.7 points — more than the gap
between several competing agents." ZCode's `--memory-bench` makes memory
drain-before-exit a first-class benchmark mode; its external-launcher
contract pins per-sample isolation and strict adjudication (a startup
failure is never a success). Codewhale's SKILL_EVALUATION freezes
provider/model/tools/fixtures, changes one skill, and holds out a dev/
holdout split. Unown's benchmark craft (RESULTS.md's receipt-first
inventory, matched-model gating, the parley round's drain-before-snapshot
+ holdout + cost columns) is the direct descendant of these.

### Planning, decomposition, failure recovery, debugging

gpt-pilot's decomposition canon — "each task is one testable whole that
the user can test and commit" — and its re-plan-not-patch ErrorHandler
(regenerate the remaining step list; `MAX_CODING_ATTEMPTS = 3`) survived
the repo's own death (the worm-infested, unmaintained upstream is cited
read-only, exactly as the pass used it). Roo/Zoo's boomerang tasks
(isolated subtask contexts, summary-only returns, a deliberately
tool-less orchestrator) and OpenHands' StuckDetector (five repeat-cycle
patterns → one nudge → hard stop) define the recovery vocabulary. Crush's
interrupted-tool-call settling (a dead process's unanswered tool calls
settled at startup so the transcript is never poisoned) and Cline's
buffer-until-proven streams + retry-empty-response middleware close the
streaming-crash class. OpenClaude's verification agent — "a PASS report
without at least one adversarial probe is rejected", "the implementer is
an LLM too", spot-check re-runs — is the sharpest autonomous-debugging
honesty found anywhere: Codewhale's Operate mode states the same
discipline as a lifecycle ("dispatched ≠ settled ≠ verified"), and Amp's
orbs make the environment itself the verifier ("prove that your changes
work before you look at them").

### Live-preview showcase — embed where they interact, video where they watch

v0's split is the field standard: live iframes of each template's own
deployment where the visitor can interact, `<video>` where they only need
to be convinced; bolt.new is the opposite pole (the app *is* the landing,
WebContainer in the visitor's tab, address bar locked by validation).
OpenHands ships the cleanest demo mode — recorded event-stream fixtures
replayed through the real UI behind a build flag, zero server state — and
screenshots-not-live-VNC for agent browser activity. opencode's
discontinued share pages are the liability lesson ("public pages that
expose agent sessions are a long-term liability: secrets, moderation,
cost"); aider's `redact-cast.py` (a pyte terminal emulator detecting
sensitive frames in asciinema recordings) is the redaction gate any
session-replaying showcase needs. Unown's gallery — same-origin sandboxed
iframes of its own deployed routes, per-app reset handshakes, poster
fallbacks on mobile — adopted the v0 contract, bolt.new's address-bar
honesty, and aider's redaction discipline, and rejected WebContainers on
the landing outright (COOP/COEP "breaks any non-CORP third-party
resource").

## Improvements adopted — the consolidated ledger

Every adopted pattern, with where it landed. This is the "competitor
research directly influenced implementation" ledger the mission asked
for — the receipts are in the repo, not in this prose:

| # | Pattern | From | Where it landed in Unown |
|---|---|---|---|
| 1 | Matched-model benchmark gating | OpenHands | every learning claim runs the same model (agnes-3.0-flash) before/after; the harness delta is the only measured delta (sota-round metrics.mjs; RESULTS.md) |
| 2 | QA-changes verification loop | OpenHands | phase gates verify by *running* the app (server up, HTTP, browser CDP pass), never diff-reading alone (every build round's phase contract) |
| 3 | Machine-checkable phase gates | OpenHands | each phase's brief names its own verify command before the next phase starts (cadence/parley phase chains) |
| 4 | Append-only receipts | OpenHands, Codewhale | `.unown/receipts/*.jsonl` — one JSONL per session, the evidence lane every gallery count reads from |
| 5 | Stuck-detect + nudge | OpenHands | `--max-tool-repetitions` loop guard + the chunked-resume continuation pattern |
| 6 | Demo mode as a build flag + recorded fixtures through the real UI | OpenHands | the session-replay band + the tui-capture lane; fixture files shared by the replay band and e2e specs |
| 7 | Boomerang subtask contract | Roo/Zoo Code | the research-probe subtasks: isolated contexts, summary-only returns (`task` tool lanes) |
| 8 | Shadow-git discipline | Cline, Roo | per-phase commits with explicit staged paths; the checkpoints/undo system (Cline's reflog-safe restore semantics) |
| 9 | Per-run checkpoints + buffer-until-proven streams | Cline | auto-checkpoints per phase; the bridge's degenerate-completion guard (2026-10-23, verified still live in `/health` during this round) |
| 10 | Headless-first event lane | Codex CLI | all build sessions drive `unown -p` with the JSON envelope; "exit codes and receipts are the interface, never parsed TUI text" (the F0/F2 unattended-caller contract) |
| 11 | Instruction-cap discipline + override layering | Codex CLI | AGENTS.md caps; `local.md` mirrors `AGENTS.override.md`; **loud** itemized truncation (the silent-truncation anti-patterns became benchmark pins) |
| 12 | Human-gated patch-inbox vocabulary | Gemini CLI | harness fixes and minted tasks presented with before/after evidence + canary gates (the improvement-report format; skills stage → human `mv` promotion) |
| 13 | Aider's benchmark craft | Aider | the SDLC metrics table's shape; pass@1/pass@2 separation; cost/seconds columns; the "Singularity: 88%" badge's honest ancestor — this showcase |
| 14 | The postmortem loop | Claude Code | the Validation Log IS this loop written down: every failure → root cause → fix → regression pin → rerun with before/after evidence |
| 15 | Naming-collision discipline | (Cascade → Fugue) | 25+-query collision search before a product name ships; late-entrant verification passes keep the corpus current |
| 16 | Adversarial review probes | OpenClaude | the `/review` phases are briefed to *attempt* cross-tenant reads, role escalations, expired-token replays — "a PASS report without at least one adversarial probe is rejected" |
| 17 | Evidence-first cycle receipts | Codewhale | "a status without its run receipt is treated as unmeasured"; every landing figure resolves to a committed receipt or prints `null` |
| 18 | Memory-drain-before-snapshot | ZCode `--memory-bench` | the parley round's snapshots refuse to write while a cycle/dream is in flight (`drained: false` honestly marked otherwise) |
| 19 | Holdout discipline | Codewhale SKILL_EVALUATION | the final re-run covers the seed suite AND minted tasks — "an improvement that only shows on the tasks a patch was mined from is not retained learning" |
| 20 | Cost columns on every run | Goose Harbor | every snapshot carries tokensIn/tokensOut/toolCalls; every pass-rate figure reads against its token cost |
| 21 | Interrupted-tool-call settling | Crush | the fleet journal's crash sweep (heartbeat-verified orphans reaped/traced at next boot) |
| 22 | Environment-as-verifier | Amp orbs | fresh bubblewrap sandbox per harness run; the E2E phases drive the real deployed route |
| 23 | Task = one testable committable whole | gpt-pilot | every build round's phase chain (scaffold → domain → API → UI → E2E), each phase green and committed before the next |
| 24 | Re-plan-don't-patch, capped attempts | gpt-pilot | review-round fixes regenerate the approach when a fix fails twice; the F-series validation entries never stack hotfixes |
| 25 | Sandboxed-iframe showcase + curated gallery | bolt.diy, v0 | the live-demo band: same-origin sandbox, poster + switcher, per-app reset handshake, mobile poster fallback |
| 26 | Poll-with-nudge E2E | bolt.diy | the QA browser pass retries a stalled interaction once with a deterministic nudge |
| 27 | Never-sleep e2e rule | opencode | "NEVER use waitForTimeout — wait for the specific UI state/request/event" (the e2e specs' law) |
| 28 | Redaction gate for session replays | aider | any showcase that replays a real session runs the redaction pipeline (secrets redaction default-on in session export; the pyte-detect pattern cited) |
| 29 | Readiness-gated preview | bolt.new | `postMessage("sigil-ready")` / HEAD-able health endpoints gate the embed, never scroll |
| 30 | Local-first engine as the answer to telemetry controversy | ZCode (cautionary) | the engine's loopback bind + token auth + per-project data dirs are the design answer to Sept-2026-style silent uploads |

## Remaining gaps

The honest list — recorded, not closed:

1. **No cross-harness lane.** Harbor's same-model-across-harnesses table
   has no Unown equivalent; the polyglot/selfimprove tracks measure Unown
   against itself over time, not against sibling harnesses on the same
   model. The single most requested follow-up from the Parley pass.
2. **Bi-temporal supersede.** Unown's reconcile is recency-first; Zep's
   `valid_at`/`invalid_at` edges and Mem0-platform's Supersede keep
   history with provenance. The memory sweep ranked this opportunity #1;
   the schema work (per-bullet `superseded_by`, `latest_only`) is
   designed but not shipped.
3. **Typed memory with per-type decay.** Facts, episodes and procedures
   should age differently (Supermemory's typed decay; LangMem's
   taxonomy); Unown's tiers are scoped, not typed.
4. **A review queue for inferred memories.** Supermemory's
   approve/decline/undo for `isInference` entries is "the best-published
   answer to 'the dream hallucinated a pattern'"; Unown's canary gates +
   human-gated skill promotion cover skills, not memory bullets.
5. **`unown memory doctor`.** Letta's and Claude Code's `/doctor` audits
   (placement, duplication, token usage, trims) have no Unown twin.
6. **Memory interchange.** Cognee's COGX is the only shipping
   interop format; multi-machine sync (COGX-style export) is
   opportunity #10, unstarted.
7. **The Dial's bundle-pinning constraint** (no mid-thread model switches
   — they "confuse models and invalidate prompt caches", Amp) is
   documented but untested against Unown's routing.
8. **Writer-claim coordination ledger** (Codewhale's refuse-overlapping-
   second-writer) — Unown's single-writer busy-mutex achieves the safety
   differently; a multi-sandbox future would need the ledger.

The deliberate non-adoptions (recorded as rejections, not gaps):
Gemini's enterprise gating (Unown stays clone-to-install), Codex's
docs-behind-login (Unown's docs stay in-repo), Cline's product-surface
sprawl (one terminal, one engine), WebContainers on the landing (the
COOP/COEP resource-breakage class), and public session-share pages (the
opencode liability lesson).

## The verdict

Across 24 systems and six passes, the field's state of the art in late
2026: **surfaces are commoditized, loops are not.** Every competitor
ships some subset of subagents, checkpoints, skills, plans and sandboxes;
almost none ship a memory that improves later sessions (ZCode's
curation and Gemini's patch inbox are the partial exceptions, both
human-gated, neither benchmark-gated); none convert measured failures
into benchmark tasks and ship verified improvements to the agent itself
with before/after receipts. The 2026 frontier moved to making
self-improvement *trustworthy* — adversarial verification (OpenClaude),
isolation-controlled evaluation (Goose Harbor, ZCode, Codewhale), durable
resumable execution (Codewhale, ZCode, Amp) — and those are exactly the
scaffolding patterns the Parley round adopted wholesale. Unown's
differentiation, validated by contrast with every system in this corpus,
remains the closed loop: notes → dreams → memory → harness → minted
tasks → shipped improvements → regression sweeps, every step receipted,
every claim drain-gated, every number traceable to a committed JSON file.
The [learning report](unown-learning-report.md) and the
[benchmark improvement report](benchmark-improvement-report.md) carry the
evidence that the loop actually ran.
