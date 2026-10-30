---
title: "The model-specs round: never guess a context window again"
description: "Unown 0.0.47: specs detected from verifiable sources, asked for when nothing knows, provenance everywhere, and a bridge that learns limits from upstream 400s."
date: 2026-10-30
lastmod: 2026-10-30
tags: [providers, verification]
type: release
media: [/landing/tui/cli-doctor/stills/01-doctor.png]
---

Every coding agent carries two numbers about your model that it never
shows you: the **context window** and the **max output tokens**. They
decide when the session summarizes itself and where answers get capped.
Get them wrong in one direction and the agent starts compacting early and
truncating answers — a silent capability cut you'd never attribute to a
config number. Wrong the other way and compaction fires too late: the
overflow loop, the request that fails at 90% context, the retry that
fails the same way.

The field's answer, mostly, is a hardcoded table plus a shrug. The
fallback metadata ships flagged — if you read the logs. Local servers
ship declared, or don't. Nobody asks.

This round, Unown made the two numbers a **first-class verified fact** —
detected from sources that can actually know, asked for when they
can't, and labeled with where every number came from.

## The cascade

Once a model is configured — `unown setup`, `providers add`, a live
catalog refresh, or the session preflight for models registered before
this round — the specs resolve through a cascade, first verifiable hit
per field:

1. **Your own values** — hand-edited models.json entries always win.
2. **The curated catalog** — vendor-published limits for well-known ids.
3. **models.dev** — the community registry, disk-cached for 24 hours.
4. **The LiteLLM model database** — same ladder, per-source URLs.
5. **The endpoint's own catalog** — `GET /models` with your key. This is
   the one that matters for local servers: vLLM's `max_model_len`, LM
   Studio's `loaded_context_length`, llama.cpp's `meta.n_ctx`, the
   enriched shapes DeepInfra and OpenRouter ship. The only authoritative
   source for a deployment-specific limit.
6. **You.** When nothing verifiable knows the model, the wizard asks —
   validated numeric prompts, the receipt of every source that was
   tried, close-match hints. Scripts carry
   `--context-window N --max-tokens N`. Print mode aborts with the same
   remediation. `UNOWN_ALLOW_UNVERIFIED_SPECS=1` is the documented
   escape hatch for unattended lanes — the conservative floor gets
   stamped and *labeled unverified*.

Sanity bounds guard every source — a context window must be an integer
in [1024, 100,000,000], output within it — and a source whose numbers
fail sanity is a miss, not a spec. **Never guess** stays the law;
detection replaces guessing with sources, and asks otherwise.

## Provenance on every number

Every resolution lands in a sidecar,
`~/.unown/agent/model-specs.json`, that records where each number came
from — `curated`, `models.dev`, `litellm`, `endpoint`, `user`, or
`learned` — and when it was verified. That provenance is surfaced
everywhere specs appear:

```
$ unown models
  agnes  https://apihub.agnes-ai.com/v1  [key: auth.json]  ← default
      · agnes-3.0-flash  [524,288 ctx / 65,536 out (curated catalog)]

$ unown models verify
  ✓ agnes/agnes-3.0-flash — 524,288 ctx / 65,536 out · text+image
    · $0 in / $0 out per 1M · curated catalog (vendor-published)
  All 1 model spec verified.
```

`unown models verify` re-runs detection for every registered model,
heals seeded stamps that a source can now replace (never your hand
edits), records a loopback bridge's learned specs, and exits 1 listing
whatever stays unverified — the CI lane for specs.

## The bridge learns from upstream 400s

The bundled bridge now passes the upstream catalog's spec fields through
its own `/v1/models` (the DeepInfra precedent), so detection sees the
upstream's published limits instead of bare ids. And when an upstream
400 *names* the real limit — "This model's maximum context length is
131072 tokens" — the bridge parses the number (OpenAI, OpenRouter,
Mistral, DashScope, Kimi, DS4, xAI, Bedrock shapes, plus output caps
like "max_tokens must be at most 65536") into
`model-specs-learned.json`, once per change, pass-through requests only.

Learned specs are **surfaced, never auto-applied** — an error message is
evidence, not a catalog. `/health` reports them, `unown models verify`
records them with `learned` provenance, and you stay the decider.

## Pricing, verified

Detection often verifies pricing too (models.dev and LiteLLM carry
USD-per-1M rates). The usage tables now resolve prices in three layers —
your env overrides, the **verified spec sidecar**, then the shipped
estimates — and the `~` estimate mark is reserved for the last layer.
A model priced from its verified spec prints a plain `$`, listed in
`pricing.sidecarPriced`.

## Why it matters

The wrong context window is invisible until it isn't: answers capped at
8K when the model does 512K, compaction firing at 30% because the
agent thought the window was smaller than it is. Detection from
verifiable sources — the endpoint's own catalog first, because a
deployment's `max_model_len` is the deployment's truth — plus a gate
that asks instead of guessing, plus provenance you can audit, turns a
silent config number into a checked fact. `unown models verify` is the
one-command audit.

The research record behind the design — how eleven products handle
spec detection, the five registries, the edge-case catalog (partial
catalogs, ids-only listings, provider-qualified ids, flapping
snapshots) — is in
[docs/model-spec-detection-research.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/model-spec-detection-research.md),
and the round's checkpoint log in
[docs/model-specs-session.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/model-specs-session.md).
