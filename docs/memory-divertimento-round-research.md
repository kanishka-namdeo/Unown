# Memory Divertimento round — research grounding (2026-11-14)

> The companion research to
> [TEARDOWN_2026-11-14_new-wave-memory-platforms.md](TEARDOWN_2026-11-14_new-wave-memory-platforms.md):
> the 2025–2026 papers sweep, the consumer memory-UX patterns, and the
> ranked evidence that sets this round's checkpoints. Every claim sourced;
> `[V]` verified in fetched source, `[C]` vendor/author-claimed, `[U]`
> inference. Related: [memory.md](memory.md) ·
> [detached-memory-comparative-research.md](detached-memory-comparative-research.md) ·
> [memory-encore-round-research.md](memory-encore-round-research.md).

## Part 1 — the papers sweep (2025–2026)

Corrections to the received wisdom, verified against arXiv on 2026-11-14
(all `[V]`):

- **LightMem** ([2510.18866](https://arxiv.org/abs/2510.18866)) is
  ZJU(ZJUNLP)+NUS, **ICLR 2026** (not BAAI/NeurIPS); its stages are sensory
  memory → topic-aware STM → LTM with sleep-time update, not "S3". Results:
  LongMemEval-S **68.64%** at **28.25k total tokens vs A-MEM's 1,605.8k
  (~57×)**, 18 API calls vs 987; online-only costs ↓106×/117× tokens.
- **memU and Memobase have no arXiv papers** (the IDs circulating for them
  belong to an astronomy survey and a math paper); they are products with
  self-run benchmarks — see the teardown doc.
- **"Rethinking Memory in LLM based Agents"** is
  [2505.00675](https://arxiv.org/abs/2505.00675) — its six atomic memory
  operations (Consolidation, Updating, Indexing, Forgetting, Retrieval,
  Condensation) are the vocabulary this round uses.
- **BEAM** ([2510.27246](https://arxiv.org/abs/2510.27246)): 100 coherent
  conversations to ~10M tokens, 2,000 questions across 10 types; 1M-context
  LLMs degrade with length; the LIGHT episodic design gains +3.5–12.69%.
  Third-party BEAM-1M: True Memory 76.6%, Hindsight 73.9%.
- **LongMemEval-V2** ([2605.12493](https://arxiv.org/abs/2605.12493)):
  451 questions over web-agent trajectories; **AgentRunbook-C —
  trajectories stored as files, the coding agent gathers evidence in a
  sandbox — 72.5% vs best RAG 48.5%**; the benchmark closest to Unown's
  real job.

The findings that set this round's architecture scope (all `[V]` unless
noted):

1. **Similarity-based supersession is structurally broken.**
   **MemStrata/Temporal Validity** ([2606.26511](https://arxiv.org/abs/2606.26511)):
   cosine similarity separates contradicted from duplicated facts at
   **AUROC 0.59 — chance**; a **deterministic (subject, relation, object)
   supersession rule in a bi-temporal ledger (no LLM, no threshold)** takes
   stale-fact errors **15–40% → ~0%**. **CALM** ([2610.38573](https://arxiv.org/abs/2610.38573)):
   decoupling preservation from query-time admission, with retained
   superseded records enabling as-of reasoning, is best-in-class.
   **StateGraph** ([2611.02912](https://arxiv.org/abs/2611.02912)):
   invalidating the *dependents* of changed premises gains +26.0pp at
   cascade depth 3+. **DISCERN** ([2611.15729](https://arxiv.org/abs/2611.15729)):
   recall pillars are saturated (0.93–0.98) — **resolution is the
   frontier**; strictly additive bi-temporal provenance, never merge
   confusable entities, gated abstention (F1 0.924).
2. **Use-conditioned forgetting beats time-only decay.** **CAMeR**
   ([2607.20458](https://arxiv.org/abs/2607.20458)): keyword-gated hybrid
   activation, reinforced when used; time-driven baselines **collapse to
   ~zero**; 83.2% token savings; "the keyword gate, not learnable decay, is
   the main driver" [V]. **FadeMem** ([2601.18642](https://arxiv.org/abs/2601.18642)):
   adaptive exponential decay modulated by relevance/access-frequency —
   **45% storage reduction** at equal/better accuracy. **RSPM "Let Them
   Sleep"** ([2610.25561](https://arxiv.org/abs/2610.25561)): sleep cycles
   cluster failures → distill rules → delete episodes; rules decay unless
   reinforced; +9.1/+11.9/+7.6 pts, ~93% fewer retry loops, ~30% fewer
   entries. **MemDream** ([2609.34545](https://arxiv.org/abs/2609.34545)):
   proactive dream cycles with **soft (reversible) decay**; +4.5 F1 LoCoMo.
3. **Raw evidence preserved verbatim beats write-time distillation.**
   **Raw-RAG** ([2610.30755](https://arxiv.org/abs/2610.30755)): dense
   retrieval + rerank over **raw history ranks first in 6/7 settings**.
   **Mem++** ([2610.02002](https://arxiv.org/abs/2610.02002)): non-
   destructive, no LLM at write; +8.0–13.1 pts. **True Memory**
   ([2605.04897](https://arxiv.org/abs/2605.04897)): verbatim events, one
   SQLite file — **LoCoMo 93.0% vs Mem0 61.4%**; BEAM-1M 76.6%.
4. **Sleep-time consolidation, bounded to a frontier.** LightMem (above);
   Letta sleep-time compute; **MIRIX-2.0** AutoDream restricted to a
   newly-written frontier, lossless structural merges, +31.0/+22.0 pts.
5. **Memory is an attack surface.** **Memory Trust Gap**
   ([2609.01852](https://arxiv.org/abs/2609.01852)): models answer stale
   values **0.92–1.00 of the time at every scale**. **Long-Term Memory
   Security in LLM Agents** ([2604.16548](https://arxiv.org/abs/2604.16548),
   EMNLP 2026): Verifiable Memory Governance — provenance, versioning,
   policy-aware retention, auditable recovery. **MemoryDojo /
   MemHarmBench**: poisoning and cross-session injection are live classes.

## Part 2 — the consumer memory-UX patterns

The field's user-facing memory, as of 2026-11-14 (all `[V]` from the linked
pages unless noted):

- **ChatGPT memory** is a two-track system: **saved memories** (short,
  timestamped, single-sentence facts — visible, deletable) plus
  **reference chat history** (dense AI-generated profile paragraphs —
  invisible, not editable) — reverse-engineered by practitioners
  (<https://www.shloked.com/writing/chatgpt-memory>, fetched 2026-11-14).
  The reference-based recall wave: Apr 2025 Pro/Plus
  (<https://techcrunch.com/2025/04/10/openai-updates-chatgpt-to-reference-your-other-chats/>),
  Jun 2025 free; per-project memory Aug 2025
  (<https://simonwillison.net/2025/Aug/22/project-memory/>); group chats
  Nov 2025 with per-user-private memory
  (<https://techcrunch.com/2025/11/20/chatgpt-launches-group-chats-globally/>).
  The user verdict on the invisible layer is consistently negative:
  "context rot" (<https://every.to/also-true-for-humans/why-i-turned-off-chatgpt-s-memory>),
  the "active 2 days in the last 1 day" absurdity
  (<https://news.ycombinator.com/item?id=44052246>), cross-context
  contamination, and deletion that doesn't feel trustworthy
  (<https://news.ycombinator.com/item?id=45960293>). The quantification:
  **96% of memories are created unilaterally by the system; 28% carry
  GDPR-personal data; 52% psychological inferences** — "The Algorithmic
  Self-Portrait" (<https://arxiv.org/abs/2602.01450>).
- **Gemini** is the counter-pattern: each memory stored as
  **Statement + Rationale** — "the model knows this *because you said X on
  date Y*" — with a **Memory history page** (a timeline of every memory
  change) and natural-language edit ("Remove my old phone number")
  (<https://support.google.com/gemini/answer/18617127>; the schema
  teardown: <https://www.shloked.com/writing/gemini-memory>). Dated
  rationale is called out as fixing "an entire class of problems" —
  the stale-'considering-a-move-to-SF' class ChatGPT suffers.
- **Claude Code (Nov 2026, v2.1.325)**: auto memory lives at
  `~/.claude/projects/<project>/memory/` as a **MEMORY.md index (one line
  per memory) + one topic file per memory**; the index has explicit read
  limits (**first 200 lines or 25KB**), with an **explicit error instead
  of silent truncation** when a write leaves it over-limit, and truncation
  warnings that say **how many lines were cut and where the cut starts**
  (<https://code.claude.com/docs/en/memory>;
  <https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md>).
  Visible load indicators at session start ("AGENTS.md loaded: <path>"),
  lazy-load "Loaded" lines, oversized-file startup + `/status` warnings,
  and an `InstructionsLoaded` hook. `/memory` lists locations, toggles auto
  memory, opens the folder; background sessions show "off · can't be
  turned on here" — honest state labeling.
- **The trust research**: Memory Sandbox
  (<https://arxiv.org/abs/2308.01542>) — users "lack affordances for
  viewing and controlling what the agent remembers, resulting in a poor
  mental model and conversational breakdowns"; scrutable natural-language
  profiles (<https://arxiv.org/abs/2402.05810>; TEARS
  <https://arxiv.org/abs/2410.19302>); LTM raises disclosure and positive
  perceptions when visible (CareCall, CHI 2024:
  <https://arxiv.org/abs/2402.11353>). Grok markets transparency as the
  product: "Memories are transparent… choose what to forget"
  (<https://techcrunch.com/2025/04/16/xai-adds-a-memory-feature-to-grok/>).

## Part 3 — Unown's honest position, and what this round ships

Carried from the Encore/v2 rounds, still true: the visible layer is
frontier (freshness stamps, the recall line, `/memory show`, the health
card). The v2 round added supersede stamps, typing, and a review-queue
*module* — but an in-repo audit this round (2026-11-14) found the
half-shipped state, verified in code:

1. **The memory review queue is an orphan module.** `memory-review.ts` has
   zero callers; `hoist.ts` still auto-writes promoted rules into both
   user tiers; no `/api/memory/review` routes, no `/memory review`
   command, no dashboard drill-in. The v2 session doc marks CP3 done —
   only the module + its 16 tests shipped.
2. **The recall path leaks superseded memories.** `filterLatestOnly` runs
   only inside `renderProjectMemoryMarkdown`; `/memory search` and
   `GET /api/memories` return invalidated memories as if current — the
   exact soft-delete-leak class MIRIX's security review fixed, and a
   direct contradiction of the v2 session doc's stated contract
   ("excluded from recall by default / `latest_only=true` search
   semantics").
3. **The per-type budget never replaced the flat cap.** Types + per-type
   stale-day horizons exist; the render cap is still type-agnostic
   (110/60); `RENDER_SECTIONS` was never extended for preference/episode.
4. Dead code (`memoryReviewQueueDepth` exported, never read), env-doc
   drift (`.env.example` missing `PI_MEM0_DIR`, `PI_MEM0_EMBEDDER`,
   `PI_MEM0_MAX_RENDERED`, `PI_MEM0_RECONCILE`, the tier/total char caps,
   the per-type stale knobs), and `unown memory` still has no
   subcommands.

The ranked patterns from the teardown + this doc, mapped to checkpoints:

| Rank | Pattern (proven by) | Checkpoint |
|---|---|---|
| 1 | Recall integrity + the wired review gate (MIRIX security review; memU ADRs; GateMem's "no method achieves utility + access control + verifiable forgetting together") | **CP1** |
| 2 | Deterministic SRO supersession in the bi-temporal ledger (MemStrata AUROC 0.59→rule; CALM; DISCERN; StateGraph) | **CP2** |
| 3 | Usage-conditioned decay: render-exclusion → dormancy, recurrence reset, revival (MIRIX experience pool; CAMeR; FadeMem; RSPM; MemDream's soft/reversible decay) | **CP3** |
| 4 | Visible provenance + post-consolidation digest + honest counts (Gemini Statement+Rationale; Claude Code's explicit-truncation discipline; Memory Sandbox's scrutability; the ChatGPT anti-patterns to avoid) | **CP4** |
| 5 | The doctor that proves the loop (memU `doctor`; Claude Code `/doctor` trim proposals) | **CP5** |
| 6 | Interchange with a human gate (memU's cross-agent portability; COGX; the v2 round's deferred item) | **CP6** |

Honest non-goals this round, on the record: graph retrieval over memory
links (still the deep benchtested lane it was in v2); raw-evidence
verbatim lanes (Raw-RAG/True Memory) — Unown's tiers stay distilled with
provenance, and the finding is recorded for a future round; per-fact
citation metadata at extraction time (the v2 round's own deferral stands;
CP4 ships recall-side provenance instead).
