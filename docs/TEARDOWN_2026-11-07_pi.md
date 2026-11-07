# TEARDOWN 2026-11-07 — the pi chassis moved: upstream fixed this cycle's #1 failure mode under our feet

> The Sonata round's §7 competition-cycle teardown (opened at the 5-drive-ticket
> mark per the standing cadence; run concurrently with the F-5 close). Sweep:
> 8 primary source-reads (all fetched live 2026-11-07; claims tiered
> **[V]**=verified-by-read / **[C]**=snippet-claimed-only). Pick: **pi
> (earendil-works/pi, formerly badlogic/pi-mono)** — Unown's own chassis —
> because the closest upstream shipped a harness-level fix for the exact
> failure mode this round just lived (V-12: the truncated-tool-call retry
> loop), plus the deprecation of the npm line Unown vendored.

## The sweep table (8 reads, 2026-11-07)

| # | Source | What moved | Unown-relevant? |
|---|---|---|---|
| 1 | **pi changelog (earendil-works/pi, raw fetch, 6,532 lines)** — **the PICK** | v1.0.0 (2026-10-01) → v1.5.0 (2026-11-02) + 2 breaking changes queued in [Unreleased]; #11227/#11233 (1.4.0) fixed truncated-tool-call session poisoning; #10799 (1.2.0) print-mode partial-text + stderr warning + **exit 1** on output-limit cuts; v1.4.0 removed the fixed summary output cap; #10897 (1.3.0) malformed-JSON tool args fail validation instead of silently running partial fields; $schema for settings/models (1.2.0) [V] | **Highest — this is our chassis, and our round's V-12 is their #11227** |
| 2 | pi docs: compaction.md (463 lines, raw) | Recovery pipeline: persist → turn_end → agent_end → context_edit omissions → overflow compaction → retry as fresh run; "Length responses with tool calls retain their synthetic failed tool results"; "Never cut at tool results (they must stay with their tool call)" [V] | High — the invariant our continuation flow must mirror |
| 3 | pi docs: models-configuration.md + models.schema.json | Generated from TS source (no per-entry provenance — fork merges mean diffing TS + regenerating, not diffing JSON); compat knobs for small models (`supportsMaxOutputTokens` default true, `samplingParamsByThinkingLevel`, thinking dialects incl. "zai"); user models.json is an overlay, unknown override IDs ignored [V] | High — our V-38 sidecar pin + W5 steering ride this file's semantics |
| 4 | pi docs: skills.md | Implements the **agentskills.io** spec (name/description/license/compatibility/metadata/allowed-tools); fail-open validation ("most invalid fields produce warnings rather than stopping startup"; hard-fail only for malformed SKILL.md or missing description); discovery incl. shared `~/.agents/skills/` + project `.agents/skills/` through ancestors; project-trust gate with saved-decisions precedence [V] | High — `.unown/skills` is off-standard; the ecosystem is standardizing around us |
| 5 | pi issue #11227 + PR #11233 (HTML + full .diff) | The bug: recovery omitted the truncated tool call but KEPT its results → every later request rejected ("No tool call found for function call output"); the fix: collect toolCall block IDs from the truncated message, forward-scan the projected context to the next assistant message, omit the pair together — resumed sessions included; regression test `11227-recovery-omits-tool-results.test.ts` seeds `stopReason:"length"` + a synthetic failed result "Not executed: output token limit reached." [V] | **The exact V-12 semantics — port-ready, with a conformance test** |
| 6 | pi.dev + the 1.0 and Pi Durable posts (2026-10-01) | Repo renamed + commercialized (Earendil Inc.); npm `@mariozechner/pi-coding-agent` **deprecated 2026-05-07** ("please use @earendil-works/pi-coding-agent"); "skips features like sub-agents and plan mode" by design; Pi Durable = separate MIT framework (checkpointed tasks, replay:"safe", SQLite/JSONL, Durable Objects); "Extensions can … build long-term memory" — memory marketed as an extension use case [V] | Structural — Unown's moat (subagents, plan mode, memory engine, dashboard) is additive BY THEIR DESIGN, and rides a deprecated line |
| 7 | Letta blog cluster (Mods JUN 2026, Letta Code DEC 2025, memory blocks, sleep-time compute) | Mods: versioned MemFS storing ALL context incl. prompts+skills, editable by agent AND background memory agents — "the harness itself becomes something an agent can learn"; memory blocks = discrete char-limited self-editable units (block-scoped pruning, never mid-line); OSS server stalled at v0.16.8 (2026-05-14) [V] | High — the principled cure for our issue-#46 prune class (V-8's 4+ occurrences) |
| 8 | Claude Code changelog v2.1.319 (2026-11-06) + mem0 releases + Terminal-Bench/Harbor | CC: output-limit cuts now retry (was "ending the turn silently"); eval runner marks max_tokens-cut responses "truncated, counted separately"; `/doctor` warnings are one-line-fixes with an apply key; skills `.trash` capped ~1024. mem0 ships a **Pi Agent Plugin v0.3.2** (2026-09-23). Harbor: parallel-environment eval rig for terminal agents [V] | High — CC's receipts define the diagnostics bar; mem0's pi plugin shows our memory lane is one plugin deep upstream; Harbor's parallel shape is what exposed V-9's leaks |

Scored: pi 9/10 · Claude Code 8 · Letta 8 · Gemini CLI 6 · mem0 6 · Crush 5 · Harbor/TB 5 · Codex 4 · Amp 2.
(Ties broken by S1: pi and Letta both hit live failure modes — pi hits the one we
lived THIS WEEK, and it is the same lineage, satisfying the ≥1-same-lineage rule.)

## The pick, torn down: what pi actually did to the output-cap problem

1. **The failure mode, named upstream.** An LLM response cut at the output
   token limit can carry a truncated tool call. Upstream's pre-fix behavior
   poisoned sessions exactly the way our V-12 burn did: the call was dropped
   but its results kept (or, in our vendored build, the call is refused with
   "re-issue the tool call with complete arguments" — which invites a
   small model to re-issue the SAME oversized call in a loop: 5+ refusals
   receipted in the F-5 chunk-1 continuation, 8 turns, zero tree change).
2. **The fix, at the harness layer (not prompt discipline).** (a) #10799
   (1.2.0): print mode prints the partial text, warns on stderr, exits 1 —
   a truncated answer is never reported as success. (b) #11233 (1.4.0): on
   recovery, the truncated assistant message AND all its tool results are
   omitted as a pair, discovered in the projected context, including for
   resumed sessions — with a seeded regression test. (c) v1.4.0: summaries
   use the model's output limit (no fixed cap that reasoning can eat).
   (d) #10897 (1.3.0): malformed tool-call JSON fails validation and shows
   the model its raw arguments instead of silently running parsed-prefix
   fields.
3. **The small-model steering surface matured.** models.json compat knobs
   (`supportsMaxOutputTokens`, `samplingParamsByThinkingLevel`,
   `requiresToolsWithToolHistory` [Unreleased], thinking dialect "zai") are
   exactly the W5 lane — but the file is GENERATED from TS source with no
   per-entry provenance, so a fork cannot merge it as data; merges mean
   diffing TypeScript and regenerating. Our V-38 sidecar pin is an overlay
   on top of that machinery and survives as-is, but every upstream knob is
   one we re-derive by hand.
4. **The moat, restated by their own marketing.** pi deliberately ships no
   subagents, no plan mode, no built-in long-term memory ("Extensions can
   … build long-term memory"). Unown's entire additive layer — the
   self-learning engine, tiered memory + AutoDream, subagents, plan mode,
   the dashboard, the benchmark programme — is the product their design
   leaves open. And mem0 already ships a pi plugin: the memory lane we
   built as an engine is reproducible upstream as an extension by anyone.
5. **The receipts culture.** Every changelog line links issue+PR; the
   founder publishes raw work sessions to HuggingFace for "real-world
   tasks, tool use, failures, and fixes instead of toy benchmarks." That
   is the bar our receipt programme already matches — keep matching it.

## Against A2 (the honest reckoning)

- **The vendored fork is now officially stale-lineage.** Unown vendors the
  deprecated `@mariozechner/pi-coding-agent` line inside `pi-repo/`; upstream
  moved orgs, hit 1.5.0, and queued breaking changes. Every pi-side bug we
  receipt (V-6's 1 MiB frame, V-10's cap class, V-12's truncation loop) has
  to be re-checked against a fix that may ALREADY EXIST upstream — this
  teardown found three (#11227/#11233, #10799, #10897) that predate our
  round's symptoms.
- **Our cures are prompt-layer where theirs are harness-layer.** V-40 (the
  split-write law) is brief discipline; upstream enforces the invariant in
  the session state machine. Prompt discipline failed exactly once this
  round (V-12: my own brief scoped the law "from chunk 2") and burned a
  chunk. The operator tooling can close most of the gap TODAY (see H-21
  below) without touching core; the rest is the §6b upstream question.
- **Issue #48 (fail-open diagnostics) has an upstream pattern.** pi skills
  validate fail-open (warnings, not crashes) and publish $schemas for
  settings/models so out-of-enum values are caught at EDIT time. Our doctor
  crash class is the anti-pattern; the fix we filed (#48) matches their
  direction.
- **The #46 prune class (V-8, 4+ occurrences) has a principled rival.**
  Letta's memory blocks (discrete, char-limited, self-editable) make pruning
  block-scoped and explicit; their Mods MemFS versions ALL context so a
  render that deletes a durable line is diffable and revertible. Our
  Manual-notes durable lane is the same instinct without the versioning.
  A MemFS-style render log (keep the last N dream renders as diffs) is
  buildable on OUR side of the seam and would make the 5th occurrence
  trivially detectable.

## What this teardown changes

1. **DRIVE ticket (operator research, A2-assisted, read-only): the
   vendored-pi drift audit.** Diff `pi-repo/` against the
   `@earendil-works/pi-coding-agent` 1.5.0 tag; classify every post-vendoring
   upstream fix as already-have / port-back / can't-port-without-rebase; the
   three named truncation fixes get first call. Output: a drift table in
   `benchmarks/sonata-round/` + an upstream issue on OUR side pinning the
   vendored version + the rebase-or-backport recommendation for the §6b
   decision. (This is the ONE user-voiced insight routed to Drive: "our
   chassis's newest fixes are a diff away — enumerate them before the next
   V-entry reinvents one.")
2. **AUGMENT proposal H-21 — truncation-aware continuation (operator
   tooling, buildable NOW).** `a1-continue.py` gains a signature detector:
   when the session tail shows k≥2 consecutive "Tool call was not executed:
   the response hit the output token limit" refusals, the continuation brief
   AUTO-INJECTS the V-40 split-write pin (the exact mechanism ruling that
   cured V-12, but fired by evidence instead of by operator memory). Gate:
   paired A/B on frozen replayed sessions with the signature present vs
   absent; graders = loop-burn turns (target: the 8-turn V-12 burn → ≤1),
   tree-change-per-chunk. PROPOSE row in the registry; baseline = the V-12
   envelope already on file.
3. **AUGMENT proposal H-22 — the dream-render diff log (the #46-class
   detector).** Every memory render keeps a unified diff of the previous →
   new `project.md` (last N=16, ring buffer, git-adjacent, operator-lane);
   the close gate gains a one-line check: if a diff deletes a line the
   landing quotes, flag BEFORE commit (the V-8 law automated). Buildable on
   the extension surface (a hook on the render path + an operator script);
   PROPOSE row; baseline = the 4+ occurrences on file.
4. **Upstream filings (the §6b route, no core patches):** (a) our #48 stays
   open; (b) a new issue proposing Unown's drift table as a pinned comment
   for other forks; (c) the agentskills.io compatibility question for
   `.unown/skills` — asked as an upstream discussion, decided at the next
   teardown.

## Verdict

The chassis commercialized, deprecated our npm line, and fixed our round's
#1 failure mode at the harness layer within the last 30 days — with linked
receipts and a conformance test we can adopt by reference. Unown's additive
moat (memory engine, subagents, plan mode, dashboard, benchmark programme)
remains real and is even MARKETED as open territory by pi itself, but it
rides a stale vendored line: the structural risk is no longer "can we
improve the chassis" (we can, and do) but "how far behind the chassis's own
fixes have we drifted." The drift audit is now the programme's most
leveraged next act; H-21 and H-22 convert this cycle's two live failure
classes into gated augmentations without touching core.
