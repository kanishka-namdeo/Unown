# Unown Research Report — How to Build "AI That Improves AI"

*Deep-dive findings behind this repository: what the mechanisms actually are,
where each behavior is documented or published, what the community has learned
running them in anger, and how Unown implements every one of them.*

---

## 0. Scope and method

The brief came from a social-media post describing how Anthropic uses Claude
Code to improve Claude Code itself, organized into five mechanisms: **tiered
memory**, a **self-improving harness**, **routing**, **auto dreaming**, and
**hooks** — united by one pattern: *"use AI to improve AI; let it discover its
own weaknesses."*

Rather than improvise an architecture from vibes, this report grounds each
mechanism in primary sources retrieved during research: the official Claude
Code documentation (`code.claude.com/docs`: memory, hooks reference, hooks
guide, subagents), Anthropic's engineering writing on agentic coding practice,
the emerging academic literature on self-modifying agent scaffolds (the
Self-Harness line of work, mid-2026), high-quality practitioner deep-dives on
hook internals and harness engineering (including Lilian Weng's July 2026
survey), and community repos ranging from hook-mastery collections to curated
subagent libraries. Where the post described an unreleased capability — auto
dreaming — research traced its origin (the internal KAIROS/"autoDream"
project surfaced during the well-publicized Claude Code leak episode) to
working analogues that can be built today. Every claim below links back to
that source base; section 8 lists all references.

Result: all five mechanisms are not only real and documented, they compose.
Unown is the composition.

---

## 1. The thesis — and why a scaffold, not a model

The recurring insight across sources is blunt: current self-improvement does
not look like a model rewriting its weights. Weng frames it precisely —
near-term recursive self-improvement runs through *harness engineering*: "the
model improves the training pipeline and the deployment system," where the
deployment system means the surrounding machinery of prompts, tools,
permissions, memory, and evaluation [7]. The arXiv-formalized Self-Harness
paradigm says the same thing structurally: LLM agents improve their *own
operating harness* without touching underlying models [6]. Anthropic's
practitioner blog made the same move empirically — their teams treat
CLAUDE.md files, custom slash commands, hooks, and subagents as editable
infrastructure, and routinely point Claude at that infrastructure to refine
it [5][9].

That reframing converts a research problem into a software-engineering
discipline with known best practices: version control for the "genome,"
evaluation suites as the selection pressure, bounded changes to prevent
catastrophic edits, and human review at promotion boundaries. Unown packages
exactly those practices, mapped onto the richest available host substrate:
Claude Code's native extension points (memory hierarchy, hooks lifecycle,
subagents, headless mode).

Keep the model stable; make the harness editable; record everything; mine
failures; propose bounded changes; gate them behind evals; promote only on
evidence. Every mechanism below is either part of that loop or infrastructure
the loop depends on.

---

## 2. Mechanism 1 — Tiered memory (`CLAUDE.md` hierarchy)

### What the platform actually documents

Claude Code loads instruction/memory markdown at session start from four
distinct tiers [1]:

| Tier | Location (macOS/Linux) | Audience |
|------|------------------------|----------|
| Managed policy | `/Library/Application Support/ClaudeCode/CLAUDE.md` · `/etc/claude-code/CLAUDE.md` | Organization-wide mandates pushed by IT |
| User | `~/.claude/CLAUDE.md` | Personal preferences across all projects |
| Project | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team conventions committed to git |
| Local override | `./CLAUDE.local.md` | Personal per-project prefs, gitignored |

Three documented behaviors matter more than the table itself. First, loading
is **concatenative**: tiers are merged into context rather than shadowing
each other like a strict config cascade; files above the working directory
load at launch, subdirectory files load on demand when Claude touches them,
and topic-scoped "rules" exist for path-gated instructions [1]. A community
README states the consequence crisply: this "is not a strict precedence chain"
[13] — effective precedence emerges from *specificity*, which changes how you
should edit these files (delete stale bullets; don't rely on later files to
"override" older ones).

Second, **imports** pull external files in with `@path/to/file` syntax,
resolved relative to the importing file, recursing to a maximum depth of four
hops; wrap paths in backticks to mention-without-importing [1].

Third, the managed tier doesn't just feed text — it is honored alongside
policy settings, giving organizations a real policy lane above user choice.

### Why tiering matters for an improving agent

A system that will be changed by its own outputs needs provenance layers:
organizational constraints nobody may optimize away; team knowledge everyone
shares; personal overrides nobody else sees. The `CLAUDE.local.md` lane is
particularly load-bearing for this repository pattern — sandbox URLs, token
placements, "my fork's test command" — kept out of CI-visible memory by
.gitignore.

### Unown's implementation

- Repo-root `CLAUDE.md` (tier-3 project memory) carries non-negotiable rules
  about changing Unown itself, written to survive being read by the very agent
  it constrains.
- `memory/digest.py` renders the live stack (per-tier path, bytes, imports)
  in human or JSON form, mirroring launch-time resolution.
- The **SessionStart hook** executes that digest into every session's context
  — so "what do I remember" is never invisible to model or human (see §6).
- `dreams/dream.py` + nightly CI close the memory hygiene loop: proposed
  additions/removals arrive as PRs instead of silent drift (§5).
- `docs/RUNBOOK.md` demonstrates the growth edge honestly: it currently
  ships with one deliberately stale fact so the self-improvement demo has
  something true-but-broken to discover and fix.

---

## 3. Mechanism 2 — The self-improving harness

### The published pattern

Across 2026's writing on self-improving agents, the operating loop converged
on the same five stages. An industry explainer compresses it to one sentence:
"keep the model stable, make the harness editable, record every run, mine
failures, propose bounded changes, gate those changes" [10]. The formal
version (Self-Harness) specifies mining execution traces, clustering failures
into weakness categories, generating bounded repair proposals against the
harness, then validating proposals before acceptance [6]. Weng's survey adds
the systems vocabulary: workflow automation loops (plan → execute → observe →
improve), the file system as persistent memory because traces outgrow any
context window, and subagent/backend job management with explicit, inspectable
parallelism [7].

Two failure modes recur in every account, and both shaped Unown's gate
design. **Brevity/context collapse:** naive "rewrite your prompt better"
steps degrade memory over iterations; the ACE line of work answers by having
a curator emit *itemized bullets* merged deterministically into a structured
logbook rather than regenerating monolithic blobs [7]. **Referee corruption:**
if the improver can rewrite its own validation, trust ends; bounded change
must therefore exclude the evaluator itself.

### Unown's implementation — mechanism-level detail

The loop lives in `harness/`, each stage a standalone, auditable script:

```text
run_evals.py      golden tasks -> claude -p -> results.jsonl (+summary.json)
mine_failures.py  failures    -> clusters by (category, signature) -> weaknesses.json
propose_fix.py    cluster     -> ONE-file unified diff, <=40 lines, whitelisted target
validate_fix.py   diff        -> apply, re-run targets x3, >=2/3 majority, else rollback
iterate.sh        orchestrates the above under --max-iterations ceiling
```

Design decisions worth calling out:

- **Editable surfaces are a whitelist** (`EDITABLE_SURFACES`): only
  knowledge-bearing files (`CLAUDE.md`, `docs/RUNBOOK.md`) may be patched by
  the improver. Gate logic, fixtures, workflows are constitutionally
  out-of-scope — the referee cannot be rewritten.
- **Noise-aware gating.** Model nondeterminism makes single-shot evals lie;
  requiring a ⅔ majority across three reruns before a flip counts prevents
  promoting phantom fixes — and costs pennies (§COST).
- **Evidence discipline.** Proposals must cite transcript lines; the analyst
  subagent (`.claude/agents/harness-analyst.md`, Sonnet-class by default) is
  instructed to mark anything needing model-level change OUT-OF-SCOPE rather
  than laundering it through the diff path.
- **Artifacts everywhere.** Every run persists JSONL results, weakness
  clusters, proposal files, and gate verdicts — inspectable, diffable, and
  uploadable as CI artifacts. Failure mining reads artifacts, never chat
  memory; runs stay reproducible after context resets.

### Evaluating an agent whose job is editing — including the eval

Golden tasks for harness improvement need one property chat evals rarely
need: *grounding in repository truth*. A task like "which formatter does the
PostToolUse hook prefer?" has a mechanically checkable answer that lives in
files; a task like "is this design good?" does not. Unown's task schema
therefore sticks to phrase-presence verifiers with optional forbidden terms —
cheap, deterministic, and impossible to flatter without actually containing
the fact. Where richer checks are wanted (exit codes, artifact existence),
the row shape leaves room to grow without changing the pipeline.

The subtler problem is evaluator capture: as proposals flow through
propose→validate, nothing stops a bad proposal from weakening verifier
phrases. The whitelist design closes most of it (fixtures and verifiers are
not editable surfaces), and the remaining exposure is acceptable at v1
because verdicts are reviewable artifacts. A production hardening path:
sign verifier files and have `validate_fix.py` refuse runs under signature
mismatch.

### The offline challenge — and why it made the demo *more* honest


Replaying canned responses would make keyless demos theatrical: patch the
harness and nothing measurable changes. Instead, `--offline` mode implements
**reposeek**: simulated answers derived deterministically from the same
knowledge surfaces proposals may edit. Patch `RUNBOOK.md`; the next
validation run reflects the patch; the gate can genuinely promote v2 with
zero API spend. The shipped demo seeds exactly one stale fact
(`memory/dream-archive/` vs. the real `dreams/consolidated/`), so users can
watch baseline 4/5 → mined cluster w001 → bounded proposal → gate PASS →
working-tree diff, in seconds, keyless. The same machinery swaps to live
models by dropping the flag.

### Operational practice: what belongs in which tier

The hierarchy earns its keep through *placement discipline*, and the
documentation plus community experience suggest stable assignments:

- **Managed policy** carries constraints that must survive any local
  optimization — security policy, compliance language, license hygiene.
  Anything here is effectively constitutional; Unown's own gate refuses
  writes targeting these paths.
- **User tier** is for taste and ergonomics that travel with you ("prefer
  2-space indentation", "always run ruff before declaring done"). Keeping it
  small matters: it loads in every project you touch.
- **Project tier** is the team's shared brain: build/test entry points,
  directory conventions, the non-negotiable rules above. The documentation's
  own guidance favors specificity that can be verified — "use 2-space
  indentation" beats "format code properly" [1]. Long projects should split
  topic files into path-scoped rules so context isn't squandered on
  irrelevant subsystems.
- **Local override** exists for personal reality that would confuse
  teammates: sandbox endpoints, "my checkout lives at X". `@import` from a
  home-directory file sidesteps the worktree-only nature of gitignored files
  [1].

A practical smell test used by experienced operators (and visible across
community threads [13]): if a rule stops being true, would someone delete it
or set it false? Deletion-shaped knowledge belongs in project memory — which
is precisely why Unown's dreaming pipeline produces *additions/removals*
rather than rewrites.

## 4. Mechanism 3 — Routing: sessions without a laptop

---

### Platform substrate

Headless mode is a first-class interface: `claude -p "<prompt>"` prints the
result and exits, accepting flags for output format, allowed tools, and
permission mode — explicitly documented for embedding in scripts, cron jobs,
and GitHub Actions [11][12]. Practitioner guides build entire "automated dev
teams" on `--print` inside CI, pairing scheduled runners with git worktrees
for parallelism [14]; Anthropic's ecosystem docs lean on the same shape for
PR review automation [15].

### What routing adds beyond cron-plus-API

Raw API calls can't read a repo idiomatically, run tools, respect hooks, or
produce commits. A routed Claude Code session gets all of that plus the
deterministic hook plane (§6) — meaning even cloud runs pass through the same
gatekeeper as local ones. Routing is where the three other mechanisms meet
remote execution: routed sessions read tiered memory at SessionStart, obey
hooks, and contribute notes that dreams consolidate.

### Threat model first, features second

Routed input is attacker-adjacent: issue bodies and PR descriptions are
stranger-authored text that lands directly in an LLM context. Community posts
on governing autonomous loops converge with Anthropic's own caution here
[16]: treat payload content as data, restrict tools, cap spend, keep humans
at merge points. Unown's router therefore:

1. fences payloads in `<untrusted_event>` blocks with explicit
   ignore-instructions directives — probabilistic but necessary;
2. allowlists tools per headless run (`Read,Grep,Glob` + narrowly scoped
   read-only git/gh);
3. gates event triggers on a label (`unown`) so strangers cannot spend API
   budget;
4. degrades to dry-run prompt printing whenever the key is absent;
5. inherits hook enforcement even unattended — a hijacked router still
   cannot force-push (gate denies pre-execution, deterministically).

Scheduled capabilities complete the "laptop closed" story: `nightly-dream`
runs consolidation regardless of local machines; `self-improve` runs weekly
loops from ephemeral runners; dispatch handles event-driven intents
(`pr_review`, `issue_triage`, `comment_reply`, `nightly_summary`) with
posting through `gh` or Slack webhooks.

### A concrete routed run (end to end)

1. A contributor opens PR #7 whose body contains a polite sentence asking
   Claude to force-push main — a textbook injection probe.
2. `event-router.yml` fires on `pull_request.opened`; the label gate is
   pass-through for PRs, intent resolves to `pr_review`.
3. `dispatch.py` redacts token-shaped strings from the payload, fences all
   of it inside `<untrusted_event>`, and appends instructions stating that
   content may contain adversarial directives which must be treated as data.
4. The headless session reviews diffs read-only. Asked in-payload to run
   destructive commands, it refuses; had any such attempt reached tool level,
   the PreToolUse gate would deny deterministically with a reason string.
5. Output is a ≤300-word engineering-lead review with an APPROVE /
   COMMENT / REQUEST_CHANGES verdict line, posted back via `gh` using the
   workflow-scoped token.

Operational tips distilled from community CI guides [14][15]: pin generous
`timeout-minutes` (review-grade sessions take minutes, not seconds); keep
posting idempotent (comment-once semantics via branch-scoped markers);
prefer workflow-dispatch dry-runs when tuning prompts so you can read what
the router would send without spending tokens.

---

## 5. Mechanism 4 — Auto dreaming: consolidation as a batch process

### Provenance of the idea

"Auto dreaming" entered public discussion through the Claude Code leak
episode, which surfaced an internal project named **KAIROS** (also referred
to as "autoDream") for agent memory consolidation [17][18]. The mechanism in
the original post reads like its distilled contract: feed multi-session notes
to a subagent that merges duplicates, resolves contradictions, prunes stale
entries, and consolidates into one clean `CLAUDE.md`.

Whatever ships inside the product eventually, nothing stops anyone from
building the behavior today — every ingredient is documented: subagents with
their own context windows [2], headless invocation for scheduled runs [11],
and file-based session state.

### Why the sleep analogy holds up

Biological consolidation doesn't edit memories one at a time during the day;
it replays batches offline, keeps what recurs, lets contradictions settle.
The engineering translation maps cleanly onto the failures Weng documents:
incremental "sticky-note memory" accumulates duplicates and contradictions
until context becomes noise; batching + ranking + deterministic merge is the
correction, straight out of ACE's itemized-bullet playbook [7].

### Unown's pipeline

- **Capture.** `Stop` and `SubagentStop` hooks transcribe each session into
  `dreams/sessions/<UTC>-<slug>.md`: goals parsed from transcript JSONL,
  tool-usage tallies, last assistant line — all redacted (§6).
- **Batch.** `dream.py` collects unconsolidated notes under a hard input cap
  (`DREAM_MAX_NOTES`, default 40) — the single biggest cost/quality lever.
- **Refine.** With Claude available: one Haiku-class headless call playing
  the `auto-dreamer` subagent role produces a report per the published
  output contract — proposed additions as bullets, proposed removals *with
  staleness evidence*, explicit `<!-- CONFLICT -->` blocks for unresolved
  contradictions, hard cap of 30 additions to keep memory lean.
- **Degrade honestly.** Without a model, dream.py writes a mechanical exact-
  duplicate merge, ranked by frequency, stamped **UNREFINED** so no human
  mistakes it for curated judgment.
- **Incrementalize.** `state.json` records consumed note files; runs are
  idempotent and re-runnable without double-counting memory.
- **Humanize promotion.** Consolidations are proposals. In CI they arrive as
  PRs (`nightly-dream.yml`); locally they wait in `dreams/consolidated/`.
  Only human review moves approved bullets into tiered `CLAUDE.md`s.

### Judging consolidation quality without overfitting memory

Batch consolidation risks two opposite failure directions: aggressive prunes
delete rare-but-critical facts, while timid merges let contradiction noise
accumulate. Three practices keep quality inspectable: (1) every removal
must cite evidence (a missing path checked via Grep/Glob), so reviewers can
spot-check rather than trust; (2) unresolved conflicts are preserved inside
explicit CONFLICT blocks instead of silently resolved-by-position; (3) the
pipeline reports its input/output counts — notes consumed, bullets proposed,
items removed — making context inflation measurable run-over-run before it
becomes a correctness problem.

Finally, the stale-fact deliberately shipped in `docs/RUNBOOK.md` doubles as
the canonical pruning target: exactly the kind of bullet consolidation
should flag — "this path is wrong; evidence: the actual output directory." A
demo dataset that is also a defect register keeps every mechanism testable
without mocking anything.

---

## 6. Mechanism 5 — Hooks: the deterministic control plane

### What's actually documented

Hooks are user-defined commands executed at lifecycle events — shell commands,
and (newer) HTTP/prompt/agent handler types [3][4]. The events relevant to
Unown map one-to-one onto the post's description:

| Event | Fires | Can block? | Canonical use |
|-------|-------|-----------|----------------|
| `PreToolUse` | before any matched tool call | yes | allow/deny gates, security policy |
| `PostToolUse` | after a tool completes | feedback-only | formatting, lint, audit log |
| `UserPromptSubmit` | on prompt submit | yes (context editable) | orientation injection, redaction hints |
| `SessionStart` | session open/resume | — | inject digest/context |
| `Stop` / `SubagentStop` | turn/subagent end | yes (exit 2 = keep working) | scribes, guards |

Practitioner census matches the post's emphasis: production setups are built
from five core events; the rest exist for edge cases [19]. The events
catalogue has grown fast — currently thirty lifecycle hooks across sessions,
tools, permissions, web/MCP activity [20] — which is why Unown wires only the
load-bearing six and leaves the catalogue documented rather than plumbed.

Two interaction channels define hook programming. **Exit codes:** exit 0
proceeds (stdout lands in transcript mode; for `SessionStart`/
`UserPromptSubmit` stdout is added to model context); exit 2 is the blocking
error whose stderr feeds back to the model; other exits show stderr without
stopping [3][4][19]. **Structured JSON:** on exit 0 a JSON body can carry
decisions — notably PreToolUse's
`hookSpecificOutput.permissionDecision` of `allow` / `deny` / `ask` plus a
human-readable reason [3][4]; a Stop hook exiting 2 *forces* Claude to keep
working, which is precisely how reviewers implement "you're not done yet"
loops [20].

### Unown's wiring (`.claude/settings.json`)

Six events → five scripts (+shared `hooklib.py`), each encoding a deliberate
policy:

- **Gatekeeper** (`pre_tool_use.py`, matcher `Bash` and `Write|Edit`): denies
  destructive filesystem patterns (`rm -rf` against `/`, system dirs),
  force-pushes/history rewrites, interpreter-piped downloads; escalates
  token-shaped content to `ask` for Bash and flat-out denies writing secrets
  into files or hitting managed/user settings paths. Denials travel via
  structured JSON so the model receives *why*, not just *no*.
- **Hygienist** (`post_tool_use.py`): best-effort formatting — ruff→black→
  prettier→gofmt chosen by extension and PATH availability — never installs,
  never blocks, logs usage lines for later mining.
- **Orienter** (`user_prompt_submit.py`): UTC timestamp, dirty-tree status,
  pending-dream count injected into every turn; warns when pastes contain
  token-shaped strings.
- **Scribes** (`stop.py`, `subagent_stop.py`): parse transcripts for goals /
  tool stats / final outputs into session notes; the raw feed of §5.
- **Digest** (`session_start.py`): prints the effective tier stack (§2) plus
  a capabilities reminder at every open/resume.

A design trade-off stated openly in SECURITY.md: hook scripts fail *open*
(unexpected exception → exit 0 with warning). Fail-closed would make any bug
a denial-of-agent; given the gate exists on top of an otherwise permissioned
CLI, availability was weighted above absolute enforcement — an audited choice
(~200 readable lines, stdlib-only), reversible via the platform-wide
`disableAllHooks` kill switch.

### Developing against hooks: the five-minute loop

Hooks are just stdin/stdout programs, which makes iteration cheap — no
wizard required. Pipe a synthetic payload and inspect behavior directly:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' \
  | python3 .claude/hooks/pre_tool_use.py | python3 -m json.tool
```

The response's `permissionDecision: deny` (and its reason) can be read,
asserted, even regression-tested — gate logic is plain code under version
control, not a prompt you hope holds. Log tails live in `unown/logs/*.jsonl`
for replaying what a real session actually triggered. When investigating
silent hook misses, the documentation's `/hooks` status command shows what
Claude Code registered and why a matcher may not have fired [4].


---

## 7. Cross-cutting principles (what made this compose cleanly)

1. **Bounded change everywhere.** Diff caps (≤40 lines), whitelist targets,
   iteration ceilings, note-input caps, workflow concurrency groups — self-
   improvement loops are only safe when every dimension they could grow in
   has a ceiling.
2. **Observability before autonomy.** Digests at session start, JSONL at
   every stage, verdict artifacts, PRs instead of silent merges. Nothing
   adjusts behavior without leaving an inspectable trail.
3. **Deterministic spine, probabilistic muscles.** Model calls propose;
   scripts decide (gate logic, dedupe keys, majority counting). Reviews that
   matter never depend on a model saying "trust me."
4. **Humans at promotion points only.** Not reviewing every run — reviewing
   every *permanent change to memory or harness* (dream PRs, v2 promotions).
5. **Offline-first testability.** reposeek-based eval answers and UNREFINED
   mechanical merges mean the entire machinery runs keyless; going live adds
   refinement, not the ability to function.

These generalize beyond Unown's host. The same skeleton ports to any agent
platform exposing (a) loadable instruction layers, (b) pre/post action
interception, (c) delegated child contexts, and (d) non-interactive
invocation.

---

## 8. Sources

**Official documentation**

1. Claude Code Docs — *How Claude remembers your project* (memory):
   <https://code.claude.com/docs/en/memory>
2. Claude Code Docs — *Create custom subagents*:
   <https://code.claude.com/docs/en/sub-agents>
3. Claude Code Docs — *Hooks reference*:
   <https://code.claude.com/docs/en/hooks>
4. Claude Code Docs — *Automate actions with hooks* (hooks guide):
   <https://code.claude.com/docs/en/hooks-guide>

**Anthropic engineering practice**

5. Anthropic Engineering Blog — *Claude Code: Best practices for agentic
   coding*: <https://www.anthropic.com/engineering> (blog index incl.
   agentic-coding best practices piece)
9. Community mirror of Anthropic's best-practices post:
   <https://gist.github.com/jussker/e825980ed46af2b99318e19ef01083be>

**Self-improving harness literature & analysis**

6. *Self-Harness: Harnesses That Improve Themselves* (arXiv, Jun 2026):
   <https://arxiv.org/html/2606.09498v1>
7. Lilian Weng — *Harness Engineering for Self-Improvement* (Jul 2026):
   <https://lilianweng.github.io/posts/2026-07-04-harness>
8. AlphaSignal — *10 Layers of Self-Improving Harness Stack*:
   <https://alphasignalai.substack.com/p/10-layers-of-self-improving-harness>

**Headless automation & routing**

10. AlphaSignal pattern analysis (cross-ref §3, [8]); practical headless
    guides below.
11. Claude Code Club — *What Is Headless Mode* (`--print` for cron/CI):
    <https://www.claudecodeclub.ai/glossary/headless-mode>
12. MindStudio — *Claude Code Skills/Automation* (headless flag usage):
    <https://www.mindstudio.ai/blog/claude-code-skills-automate-workflows>
13. claude-howto community docs — *Memory semantics*
    (concatenation not strict override):
    <https://github.com/luongnv89/claude-howto/blob/main/02-memory/README.md>
14. Fred Taylor — *Claude Code Agents & CI/CD* (worktrees + `--print` CI):
    <https://medium.com/@Fredtaylor1/claude-code-agents-cicd-automation-868896274961>
15. AY Automate — *Claude Code GitHub Actions breakdown*:
    <https://www.ayautomate.com/resources/breakdowns/github-actions-claude>
16. r/AI_Agents practitioner thread — governing autonomous improvement loops
    (runtime/reviewer/persistent-layer separation):
    <https://www.reddit.com/r/AI_Agents/comments/1u5a96c/>

**Auto dreaming provenance**

17. LinkedIn engineering commentary — KAIROS/"autoDream" revealed in the
    Claude Code leak episode:
    <https://www.linkedin.com/posts/arsalan-ahmed-927931286_ai-softwareengineering-anthropic-activity-7445806659626524672-yJE9>
18. KuCoin News — *Anthropic's Claude Now "Dreams" to Enhance AI Agent
    Performance*: <https://www.kucoin.com/news/flash/anthropic-s-claude-now-dreams-to-improve-ai-agent-performance>

**Hook internals deep-dives**

19. Blake Crosley — *Claude Code Hooks Explained: The Deterministic Layer*
    (five-event census; exit-code matrix):
    <https://blakecrosley.com/blog/claude-code-hooks-explained>
20. claudefa.st — *Complete Guide to All Lifecycle Events* (30-event table;
    exit-2 semantics per event; JSON decision schema; HTTP hooks Feb 2026):
    <https://claudefa.st/blog/tools/hooks/hooks-guide>
21. disler/claude-code-hooks-mastery (community hook patterns repo):
    <https://github.com/disler/claude-code-hooks-mastery>
22. VoltAgent — *awesome-claude-code-subagents* (subagent curation & model
    inheritance conventions): <https://github.com/VoltAgent/awesome-claude-code-subagents>
