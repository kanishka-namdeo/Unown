# The Website Excellence Round 2 — the session record

> The resumable checkpoint log for the second Website Excellence Program
> round (2026-10-30 →): the same mission as the first round — evolve
> Unown into a design-aware, visually intelligent, self-improving website
> creation platform — executed as a fresh programme, not a continuation:
> new research, new capability gaps, new tools/skills/agents, new
> benchmark websites, and the failure→learning pipeline retaining what
> works. Each checkpoint states what is done, what is verified, and what
> is next, so an interrupted session resumes from the last green state.
> The round's failure ledger is
> [`../benchmarks/website-excellence-round-2/validation-log.md`](../benchmarks/website-excellence-round-2/validation-log.md)
> (F-numbers continue from the first round's F1–F20).

- [Checkpoint 0 — setup, the stack verified, and the state of main](#checkpoint-0--setup-the-stack-verified-and-the-state-of-main)
- [Checkpoint 1 — main restored to green: the release gate, the DNS retry, the ledger](#checkpoint-1--main-restored-to-green-the-release-gate-the-dns-retry-the-ledger)

## The contract

The programme's success question is unchanged: *"If we restarted these
projects from scratch using the improved version of Unown, would the
resulting websites be significantly better than those produced by the
original version?"* — answerable only with measured evidence. The
operating principle is also unchanged: when a weakness is identified,
decide where the defect lives (Unown, the caller environment, or the
artifact), fix it where it lives, and create the benchmark that would
catch it next time. This round adds a gate-credibility corollary the
baseline taught: **a claimed gate result that CI never ran is a defect
of its own** — measure, never record.

## Checkpoint 0 — setup, the stack verified, and the state of main

**DONE.** Fresh clone at `e52664fe`; bun upgraded 1.3.14 → 1.4.4 (the
lockfileVersion-3 floor); `bun run agent:install` (root + pi-repo
installs, model-data hydration, build, `.env` bootstrap, PATH link);
`.env` configured with the Agnes upstream
(`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key set,
`AGNES_API_KEY` set, the metered free-tier guards untouched);
`bun run agent:start` brought up the stack.

**VERIFIED (all receipts from this machine, 2026-10-30):**

| Gate | Result |
|---|---|
| Agnes upstream | `/models` 200 (6 models served); chat completion 200 (`agnes-3.0-flash`) |
| Bridge `:3031/health` | ok, upstream 200, `agnes-3.0-flash` default, concurrency guards active |
| Engine `:3030/api/health` | `phase: ready`, v0.0.42 |
| `bun bin/unown -p` end-to-end | `UNOWN-AGENT-OK` through the bridge |
| `unown doctor` | all green (bubblewrap sandbox active, instruction-set audit clean) |
| `bun run typecheck` / `lint` | green / 0 errors (4 pre-existing warnings) |
| `bun run test:unit` | 2041/2041 |
| `bun run build` | green |
| `bun run test:e2e` | 14/15 — the scroll budget red (see F22), fixed upstream mid-diagnosis; 15/15 on `989205c7` |

**The state of main found at baseline (the round's first findings):**

- **CI was RED** on `e52664fe` and had been red since the v0.0.42
  release: the e2e scroll-budget breach (F22) plus a macOS runner DNS
  blip (F23), cascading into the deploy-verify "Live production check"
  failure. The v0.0.42 release had shipped while its own CI was red —
  the Release workflow never gates on CI's conclusion (F21).
- **A scheduled routine had already fixed the word breach** (commit
  `989205c7`, sessions `e13-fix*`): the built-improved lede compressed
  17 words, ceiling held at 3,750, CI green on the fix. This round
  verified the fix rather than re-fixing it, and ledgered the process
  failure (F21/F22) with API receipts.
- **A tooling lesson recorded for this workspace**: a "corrupted"
  `branches: ain]` finding in `ci.yml` was a display artifact — the
  tool-output pipeline renders `[main]` with its `[m` consumed as an
  ANSI reset. Verified with `od -c` + `git log -S` before any edit; the
  file was always correct. Byte-level verification before surprising
  conclusions is now a session rule (the docs workspace's own AGENTS.md
  records the same artifact class for markdown link labels).

**NEXT.** Milestone 1's remaining fixes: the release gate (F21), the
DNS retry (F23), the ledger + this doc, then push and watch CI go green
end-to-end — the first push this round makes under its own new
discipline (every gate measured locally before the push, CI observed to
conclusion, never cancelled mid-flight).

## Checkpoint 1 — main restored to green: the release gate, the DNS retry, the ledger

**DONE.**

- `release.yml` — the new `ci-green` first job (F21's durable fix):
  resolves the CI run for the tagged SHA via the GitHub API, waits
  while CI is queued/running (bounded 40 min), and fails the release
  unless CI concluded `success`. Every downstream job needs it, so a
  red or in-flight CI can no longer mint release artifacts. YAML
  validated; the bash step `bash -n` clean; the needs chain asserted.
- `ci.yml` — the `update --check` smoke step now retries once (15s
  backoff) on exit 1 (F23): a hosted-runner DNS blip is transient; two
  strikes still fail.
- `benchmarks/website-excellence-round-2/validation-log.md` — F21, F22,
  F23 ledgered with reproduction commands and API receipts.
- This session doc.

**VERIFIED.** `python3 -c "import yaml; …"` parses both workflows
(job graph: `ci-green` → `verify` → `build` → `smoke-artifacts` →
`publish-release` → `verify-feed`/`smoke-install`); both edited run
blocks pass `bash -n`; the touched markdown passes `bun run check:docs`.

**NEXT.** Phase 1 — the second research base (the first round covered
Linear, Geist/Vercel, Stripe; this round surveys the rest of the
mission's list: Apple, Airbnb, Arc, Resend, Cursor, OpenAI, Anthropic,
Perplexity, Raycast, Mercury, Attio, Notion, Framer) and the refreshed
capability gap analysis, then the round's capability builds.
