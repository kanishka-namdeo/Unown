# The Memory Encore round — the memory UX the field proved, shipped (2026-11-12)

**Mission:** evaluate the detached memory system architecture by
reverse-engineering similar products/tools/projects (at least five — this
round tore down ELEVEN new ones on top of the Recital round's five) to find
what is proven better by user experience or research, then augment the
workflows, fix whatever breaks, add visual indicators for user delight, and
cover the edge cases.

The Recital round proved the loop **works** (warm 5/5 against a 0/5 cold
control). This round asked the question after that: **can a user SEE it?**
Does a fresh session say "your memory was injected"? Can a rule's age be
read at a glance? Can "is my memory even loaded?" be answered without
trusting us? The teardown's answer shaped four surfaces and found one real
bug on the way.

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| CP0 research — eleven products | ✅ done | `docs/memory-encore-round-research.md` |
| CP1 fix — the `engineUndreamedNotes()` arity bug | ✅ done | `test/memory-health.test.ts` (3-case battery) |
| CP2 architecture — the freshness lane | ✅ done | `test/memzero-freshness.test.ts` (13 cases) + the guide drift pin |
| CP3 terminal delight — the recall line + `/memory show` | ✅ done | copy + wiring batteries; PTY phases `recall`/`show` |
| CP4 dashboard — the memory health card | ✅ done | `test/dashboard-render.test.ts` (anchors + mock fixture) |
| CP5 verification | ✅ done | this file (the two `dreamAndWait` catches + the re-run receipts) |
| CP6 docs/landing/blog/CHANGELOG/DOX + version + release | ✅ done | v0.0.63; the rail regenerated; CI + release green |

## CP0 — the research (2026-11-12)

`docs/memory-encore-round-research.md` — eleven products, every claim
sourced: **Claude Code** (the recall/save toasts — four changelog iterations;
`/context`; `/doctor prompt-audit`; per-memory `modified` timestamps),
**Cursor** (the Memories deprecation — invisible memory lost to file rules),
**Windsurf** (the Memories & Rules panel, workspace isolation), **Gemini
CLI** (`/memory show` exact-context, the Auto Memory review inbox,
checkpointing), **Codex/AGENTS.md** (the interchange format — 60k+ repos),
**GitHub Copilot** (citations + just-in-time verification, +3%/+4%/+7% A/B,
28-day expiry), **MemOS** (MemCube, LoCoMo 75.80 vs Mem0 64.57, the Memory
Viewer), **A-MEM** (Zettelkasten notes that evolve, +35% DialSim F1),
**HippoRAG 2** (Personalized PageRank single-step multi-hop, +7%
associative), **Supermemory** (temporal truth + auto-forgetting as
products), **OpenMemory** (detached extraction worker + prompt-gated recall).

The ranked patterns → what shipped: the session-start recall line (CP3),
freshness timestamps + visible staleness (CP2), the exact-context command
(CP3), the visible audit/health card (CP4), timestamp refresh on
re-assertion (CP2, falling out of the reconcile UPDATE lane). The honest
gaps NOT shipped, on the record: per-fact citation metadata (an
extraction-contract change deserving its own benchtested round) and graph
retrieval over memory links (HippoRAG 2 PPR / A-MEM evolution — deep
lanes).

## CP1 — the arity bug (2026-11-12)

The teardown's code-map pass found `engineUndreamedNotes()` in the health
card returning `(undreamedNotes ?? 0).length` — the imported FUNCTION's
`.length` (its arity, always 2), never the queue. The reconcile-stale
warning has been reporting a phantom "2 undreamed note(s) pending" whenever
the 7-day horizon tripped: an empty queue could never clear it, a real
backlog always read as 2. Now the same `undreamedNotes(50, "benchmark")`
shape router.ts and server.ts use; pinned by a three-case regression
battery (real count 5≠2, empty queue never stale, terminal notes stay out
of the engine lane).

## CP2 — the freshness lane (2026-11-12)

Every rendered memory bullet now carries its last-confirmed date —
`- run tests with bun test · 2026-11-09` — and past
`PI_MEM0_STALE_DAYS` (default 28) a `· stale` marker: Claude Code's
per-memory `modified` timestamps ("helping Claude reason about which
memories are fresh vs. stale") crossed with Copilot's 28-day TTL evidence,
softened from deletion to visible decay (the rule stays; its evidential
weight drops). The date is the platform's `updatedAt` — a later dream
re-asserting the rule refreshes it (the visible version of Copilot's
re-store-on-verify). Seeds and unknown-age rows render bare, never a fake
1970-stale. The memory guide teaches the semantics (re-assertion refreshes;
stale = weaker evidence — verify before asserting), pinned by the
guide-drift test. 13-case deterministic battery: the 27d/28d+1ms boundary,
updatedAt-wins, idempotence, UPDATE-refresh visibility, the env knob.

## CP3 — the terminal delight: the recall line + `/memory show` (2026-11-12)

**The session-start recall line** — `◈ memory recalled: N rules · vN ·
dreamed Xm ago — /memory show` — once per process boot, silent for fresh
projects, disk-derived (works with the engine down), never repeated across
`/new` reloads. Our footer-quiet contract keeps the healthy up-state
invisible, which is right for a footer and wrong for recall: this line is
the only affirmative "your memory was injected" signal in the default
layout — Claude Code's most-iterated memory-UX element, honest under our
own contract.

**`/memory show [full]`** — prints exactly what the model receives: every
tier's content with provenance lines, the injected guide, per-tier char
counts, and the injection-budget tail (pruned/head-truncated/OVERFLOW
named, never silent). The default view trims each tier to 60 display lines
with an honest `… (N more lines — /memory show full)` escape — the model
always receives the full stack; only the display trims. `/learning` shows
the stack's metadata; `/memory show` shows the payload — the Gemini CLI +
Claude Code `/context` answer to "is my memory even loaded?".

## CP4 — the dashboard health card (2026-11-12)

The SM-2 audit (last reconcile, duplicates, supersede conflicts, warnings)
existed only through the API and doctor — invisible where memory lives. The
Memory screen now renders it under the injection-budget meter: one quiet
fact line plus one badge row per live warning (reconcile-failing rose, the
capacity/backlog warnings amber), degraded-to-absent on a fetch failure,
never loading noise. Wired as the `memoryHealth` polled resource with
`dream:finished`/`memory:changed`/rollback invalidations; the mock fixture
and render anchors pinned.

## CP5 — the verification (2026-11-12; the re-run's own catches)

**Local suites, fresh bring-up** (bun 1.4.4, the real installer path —
`bun scripts/install.ts`, whose `build:offline` lane the first attempt
missed, reddening 250 CLI-spawning tests until the pi-repo packages were
built): typecheck 0 · lint 0 errors · landing unit **2094/0** · engine
**5553/0/105 skip** · integration 13/0 · bridge 243/0 · all five landing
gates green.

**The PTY memory matrix — ALL GREEN 25/25**, the two new surfaces included:
the recall line at boot (the ◈ glyph, the rule count, the `/memory show`
pointer) and `/memory show`'s exact-stack contract (tier headers with char
counts, the planted marker proven IN the injected stack, the budget tail).

**The memory-recital live re-run — warm 5/5 / cold 0/5 / lift +5
reproduced** (T3 knowledge-update 0.67 → 0.89; the freshness lane visible
end to end: 8/8 rendered bullets date-stamped in the S3 dream receipt).
Edge probes: E1 concurrency PASS (2 notes), E2 contamination PASS (nothing
false added), E3 outbox arc PASS (the down session answered from the
injected tier; the note landed; the outbox empty at rest — with the honest
finding that the note delivery AUTO-STARTED the down engine, the M6 lane,
so the outbox intermediate is conditional by design).

The re-run hardened the runner twice more — both starvation shapes are the
round's "fix whatever breaks" dividend:

1. **The pre-trigger consumer.** E1's `dreamAndWait` starved its 600 s
   budget: the auto dream-check (`run:finished`) consumed the sessions'
   notes BEFORE the manual trigger fired, so the "ended after this call"
   row anchor never matched — the sibling of the S3→T1 race the round's
   first hardening closed. The anchor is now re-based on the newest note of
   ours, re-read every poll: a pre-trigger consumer's row counts, and a
   note still in flight re-raises the bar until the row consuming it lands.
2. **The throttled settle.** The follow-on E2 wait starved with every note
   already dreamt while a governor-throttled engine (the QA battery +
   canary dreams had burned the rolling hour: 69 calls/60, 226k
   tokens/200k) landed no new row at all. The SETTLE exit now returns when
   every note of ours was consumed by a project dream that ENDED after our
   newest note — dream rows are written after the render they receipt, so
   the consolidation is provably on disk; two consecutive stable polls
   guard the in-flight window.

Plus the E3 observation fix: the outbox check now polls (bounded 10 s) for
the transient file instead of reading once, and its comment records the M6
auto-start reality so the next reader knows why
`outboxQueuedWhileDown` can honestly be false.

## CP6 — docs, landing, blog, version, release (2026-11-12)

`docs/memory.md` (the freshness lane + the two transparency surfaces),
`docs/BEHAVIOR.md` (the guide's freshness contract + `/memory show` + the
recall line), the README tier row, `unown-overview.md` re-stamped, the
package AGENTS.md contract, the CHANGELOG entries folded into **v0.0.63**,
the blog post (`content/blog/2026-11-12-the-memory-encore-round.md`), the
regenerated rail/blog data, and the PTY matrix's `recall`/`show` phases.
Repo hygiene at close: 0 open PRs, 0 open code-scanning alerts, 0 open
dependabot alerts, CI green on every pushed milestone (one flaky Legato e2e
failure on the CP3 commit recovered on the next push with no Legato
changes — noted, not ours to chase). The 7 open self-filed issues are
carry-overs re-verified against current main in earlier rounds.

## Round closed (2026-11-12)

v0.0.63 cut and released: the CHANGELOG fold, the version bump, the rail
regeneration, the 3-OS CI verdict on the bump commit, and the release
workflow's full 15-job render. Memory that proves itself AND shows itself —
that's the product.
