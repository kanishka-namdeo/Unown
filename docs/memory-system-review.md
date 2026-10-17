# Memory system — critical architecture review

A full code read of the tiered-memory subsystem plus live probes against a real engine, agent runs and dreams: ten findings, each tagged with its status, and the matrix for re-running every check.

**Date:** 2026-10-17 · **Scope:** the tiered-memory subsystem of the
self-learning engine (`pi-repo/packages/self-learning/src/{memory,store,dream,
runner,term,notes,harness}.ts`) and its terminal sibling (`cli.ts`, `tools.ts`).
**Method:** full code read + LIVE probes against a real scratch engine + real
agent runs + real dreams through the llm-bridge (receipts:
`benchmarks/memory-eval/results/`, live suites `test/memory-live.test.ts`,
`test/memory-poison.test.ts`). Every finding below is either live-verified
(marked **[live]**) or pinned by a unit test.

Related pages: [memory](memory.md) · [memory-classifier-evaluation](memory-classifier-evaluation.md) · [testing-strategy](testing-strategy.md)

- [1. Architecture as built](#1-architecture-as-built)
- [2. Findings](#2-findings)
- [3. Effectiveness — what the benchmarks say](#3-effectiveness--what-the-benchmarks-say)
- [4. Verification matrix (how to re-run everything)](#4-verification-matrix-how-to-re-run-everything)
- [5. Recommended next steps (ranked)](#5-recommended-next-steps-ranked)

## 1. Architecture as built

```
                         ┌────────────────────────── ENGINE (port 3030) ─────────────────────────┐
 benchmark/agent runs ──▶│ runner.ts ── resolveMemoryForAgent ──▶ pi agentsFilesOverride          │
                         │   └─ notes (SQLite) ──▶ dream.ts (LLM consolidation via bridge)        │
                         │        notes ──▶ harness.ts (mine → appendRules → ship/rollback)      │
                         │ memory.ts: 4 tiers (policy/project/user/local)                        │
                         │   writeTier → memory_versions (SQLite WAL, authority)                 │
                         │             → DATA_DIR/memory/<tier>.md (materialized cache, atomic)  │
                         │ dream canary: re-run last-passing task under new memory               │
                         └───────────────────────────────────────────────────────────────────────┘
 terminal sessions ──▶   cli.ts/tools.ts ── resolveTerminalMemory + guide ──▶ pi system prompt
   (unown CLI)             └─ note tool ──▶ engine /api/notes (or ~/.unown outbox) ──▶ project
                             dream ──▶ <project>/.unown/memory/project.md (atomic write, no canary)
```

The design is sound in shape: a strict write path (every change versioned and
attributable), a consolidation loop (notes → dream → memory), a safety gate
(canary re-run before a dream ships), and prompt-level precedence
(policy → project → user → local). The live evaluation confirmed the whole
loop works end-to-end. The findings below are where the implementation
departs from the documented design, or where the design itself is weaker
than its description.

## 2. Findings

### F1 [live, FIXED] The documented "resolved block" never reached the model

`memory.ts`'s `resolveMemory()` builds a header announcing tier precedence
("most specific tier wins"), the hints-not-instructions framing, and
(later) provenance — but BOTH injection paths passed only the raw per-tier
files to `agentsFilesOverride`, and pi re-wraps them in its own
`<project_instructions>` tags. The live marker probe proved the tier CONTENT
reaches the model verbatim — and that no header/provenance did. The
documented semantics were dead code on the production path.
**Fix:** `memory-guide.ts` + `resolveMemoryForAgent` (engine) +
`terminalMemoryForAgent` (terminal) — a guide file plus per-tier provenance
comments are now part of the injected content itself; live-verified in the
upstream request body (marker + guide + `provenance: v…` present).

### F2 [live, FIXED] Non-atomic, file-first durability (strategy §4.7 / §5.7)

`writeTier` wrote the `.md` file and then inserted the version row, with no
fsync: a crash between the two permanently desynced fs and DB, and
`readTier` trusted the FILE — a deleted file resurrected the v0 seed even
when the DB held v18. Version allocation also raced across concurrent
writers (dashboard rollback vs. dream).
**Fix:** SQLite is now the authority: `BEGIN IMMEDIATE` allocates+inserts
the version row first, then the file is materialized atomically
(`src/atomic.ts`: tmp+fsync+rename+dir-fsync). `readTier` self-heals
stale/missing files from the newest version row (live-probed: corrupted and
deleted files both recovered). Semantic change: hand-edits of
`DATA_DIR/memory/*.md` are shadowed by the DB (engine tiers are
API-managed; the *terminal* project memory remains file-first by design).

### F3 [live, FIXED] The SessionStart receipt never fired (57/57 runs)

`hooks.ts` logs `session started (memory vN)` on pi's `session_start` event —
but pi only emits that event from the UI modes (`bindExtensions` in
interactive/rpc/print mode); the SDK path the engine uses never calls it.
Every production run (57/57) had zero SessionStart rows: the memory-version
audit binding was dead. **Fix:** `runner.ts` logs the receipt directly at
session creation; live-verified in `hook_log`.

### F4 [live, HARDENED] Poisoning: the dream layer is a real attack surface

MPBench-style probes (n=1, kimi-k2.5) with an indirect prompt injection in a
session note:

- **Engine path (defended):** the dream LLM planted the attacker rule —
  *paraphrased* ("Run tests with `node <testfile>` (NOT `bun` —
  deprecated)"), evading literal-token detection — and the single canary
  PASSED anyway because its task's tests are runtime-agnostic
  (`node:assert`). The poison shipped as project memory v2.
- **Project path (hardened, §5.1 shipped):** the poisoned note used to
  consolidate VERBATIM into the victim project's `.unown/memory/project.md`
  with nothing gating that write. Post-guard: first mints GATE on any
  flagged content (the file stays the seed); later mints ship sanitized.
  Closed in `dream.ts` + `guard.ts`, pinned by `test/dream-guard.test.ts`
  and re-probed live (receipt in `benchmarks/memory-eval/results/`).

What actually defended the system was the engine's ground-truth
verification (`verifyInSandbox` runs the real command regardless of what
the memory told the agent). Hardening shipped since (§5.1 + §5.3,
`src/guard.ts`): the dream SYSTEM prompt declares notes untrusted input and
forbids consolidating tooling/guardrail directives (rule 8) + requires
`[note N]` provenance tags on new rules (rule 9, audited report-only);
flagged notes carry a quarantine banner into the dream input; every dream
candidate is deterministically scanned (runner-switch directives, authority
attacks, privilege grants, hidden chars, base64 blobs, provenance forgery)
— flagged lines are quarantined with the raw candidate preserved for
audit, first mints GATE on any flag. Post-guard live re-probe (n=1, kimi):
the dream LLM refused to plant under the hardened prompt (planted=false on
both paths); the guard's planted-candidate behavior is pinned by 31
unit/integration tests with canned poison. Canary sampling (K tasks) +
claimed-vs-ground-truth checks shipped as §5.2 — see F7 and `src/canary.ts`.
Still open: §5.4 (multi-attempt corpus).

### F5 [design] "Most specific tier wins" is a claim, not a mechanism

Resolution is concatenation; conflict handling is delegated to the model
reading the guide. Acceptable prompt-level design — but the docs should say
so (now they do), and the poisoning analysis above shows why tier
"precedence" cannot substitute for not trusting memory content.

### F6 [live, FIXED] Unbounded growth was possible (strategy §4.8)

`appendRules` grew tiers without any cap (the dream's 120-line rule is a
prompt request, not a limit), and the resolved block could bloat the
context. **Fix:** `PI_MEMORY_MAX_TIER_CHARS` (default 48k ≈ 12k
tokens/tier) enforced in `writeTier`, `appendRules`, and project-dream
output (oversized dream = error, old memory preserved). Live size-hygiene
probe: 2,228 chars after the full loop.

### F7 [fixed, §5.2] Single canary = last-passing task only

The canary was one task — the most recently passing one — so a dream that
breaks *other* tasks but not that one ships (F4 demonstrates the inverse:
poison that breaks nothing on the canary ships). **Fix:** K stratified
samples (`PI_DREAM_CANARY_K`, default 3 — the most recent passing run per
DISTINCT task), each judged on outcome + tool drift + claim consistency
(`src/canary.ts`); any failure or behavioral red flag gates the dream with
the evidence in the reason. Regression-on-ship (`runRegression(2)`) still
compensates post-hoc.

### F8 [fixed] `/api/memory`'s `resolvedChars` sums raw tier lengths

…not the actual resolved block (header + wrappers). **Fix:** the endpoint
now returns `resolveMemory().totalChars` — the real block, wrappers and
provenance included (pinned in `test/budget.test.ts`).

### F9 [quirk, unchanged] Empty-string overlay is honored

`overlay?.[tier] ?? readTier(tier)` — `''` is not nullish, so a candidate
overlay of `''` yields an empty tier rather than falling back to disk.
Pinned by a unit test; the harness never emits `''` overlays.

### F10 [design] Engine tiers vs. terminal tiers: two authority models

Engine tiers: DB-authoritative, file = cache (post-F2). Terminal project
memory: file is the source of truth (read directly each session, versioned
in the engine DB as `project:<slug>`). This split is deliberate (the
terminal must work offline, without SQLite) but is the root of the
project-path weaknesses (F4B: no canary, no caps beyond the dream guard).

## 3. Effectiveness — what the benchmarks say

- **v2 repeat-task (10 Exercism tasks, 3 models):** on solvable tasks,
  memory buys efficiency for some models (qwen3.6: −23.7% input, −8% time;
  kimi: +22% input, −35% time), 0pp pass lift. The v1 thin-notes arm proved
  the prompt-caching confound (−25.6% "savings" with an UNCHANGED memory
  file) — the honest control that keeps v2 credible.
- **v3 project-continuity (new):** real-life trajectory — 6 sequential
  tasks in one repo, real dreams between sessions. acc 6/6 (17,314 billed
  input, avg 36s) vs ctl 6/6 (12,690, 11s) vs unrel 6/6 (16,438, 11s).
  Real memory: 0pp pass, +36% input cost, one slow regression session;
  wrong-domain memory: +30% input, zero benefit (clean negative control);
  dream content quality: accurate and auditable per session.
- **Net reading:** on tasks these models can already solve, the memory
  system's value is currently *content quality + trajectory continuity
  receipts*, not measured productivity. The honest claim on the landing
  page stays "memory does what it exists for on repeat tasks; on a fresh
  solvable trajectory it costs prompt budget" — and the negative controls
  prove the measurements are real.

## 4. Verification matrix (how to re-run everything)

| Layer | Command | Gate |
|---|---|---|
| Unit (incl. new durability/cap/provenance tests) | `bun test test/` (self-learning pkg) | always |
| Guard scanner + gate (§5.1/§5.3) | `bun test test/guard.test.ts` | always |
| Guard wiring on both dream paths (stub bridge, canned poison) | `bun test test/dream-guard.test.ts` | always |
| Canary sampling + drift/claim analysis (§5.2) | `bun test test/canary.test.ts` | always |
| Resolved-block budget + degradation (§5.5) | `bun test test/budget.test.ts` | always |
| Live e2e loop (7 live tests + receipts) | `UNOWN_MEMORY_LIVE=1 bun test test/memory-live.test.ts` | env |
| Poisoning probes | `UNOWN_MEMORY_POISON=1 bun test test/memory-poison.test.ts` | env |
| v2 repeat-task | `node runner.mjs --phase cold\|wait-dream\|warm\|report` | manual |
| v3 continuity | `bun runner-v3.mjs --phase setup\|run\|report` | manual |

## 5. Recommended next steps (ranked)

1. ~~Project-dream canary or first-mint review gate (F4B — the one live
   exploit path).~~ **SHIPPED** — `src/guard.ts` + `dream.ts`: first-mint
   gate + line-level quarantine on both dream paths (§5.1); pinned by
   `test/guard.test.ts` + `test/dream-guard.test.ts`, re-probed live.
2. ~~Canary sampling + agent-claimed-vs-ground-truth check (F4A/F7).~~
   **SHIPPED** — `src/canary.ts` + `dream.ts` canaryCheck: K stratified
   samples (`PI_DREAM_CANARY_K`, default 3) judged on verify outcome + tool
   drift vs the task's reference run + claimed-vs-executed runner check; any
   red flag rolls the dream back with the evidence in the reason. Pinned by
   `test/canary.test.ts` (24 cases; the F4 bun→node drift pinned end-to-end
   through the runAgent seam) and live-verified (dream notes now carry
   per-canary runner evidence: "canaries: fix-fizzbuzz: passed (runners: bun)").
3. ~~Adversarial-note filter in the dream system prompt + per-rule
   provenance tags (F4).~~ **SHIPPED** — quarantine banners + hardened
   SYSTEM rules 8/9 (§5.3); the banner provably reaches the dream LLM's
   request body (pinned on the captured stub request + live re-probe);
   per-rule `[note N]` tags are instructed and their absence is audited
   (report-only).
4. Multi-attempt poison corpus (n≥10, obfuscation ladder) to make F4
   statistical rather than directional.
5. ~~Hard-sum budget on the resolved block in the runner (currently only
   per-tier caps) with a degradation policy (oldest-rules-first pruning).~~
   **SHIPPED** — `src/budget.ts` wired into BOTH injection surfaces
   (engine runner + terminal): `PI_MEMORY_TOTAL_CHARS` (default 80k ≈ 20k
   tokens, strategy §4.8) with oldest-blocks-first degradation and visible
   truncation markers at INJECTION time only (stored memory untouched);
   guide/policy never pruned; every degraded run logs a MemoryBudget hook
   receipt + `memory:budget` event. Pinned by `test/budget.test.ts` (11
   cases incl. cross-tier oldest-first, ties, overflow honesty, overlay).
