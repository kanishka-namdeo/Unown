# Model spec detection — the research and decision record

> **Verdict:** Unown detects model specs (context window, max output
> tokens, pricing, input modalities) from verifiable sources with a fixed
> cascade — the curated catalog (vendor-published, already in-repo) →
> models.dev → LiteLLM's model database → the endpoint's own `/models`
> catalog → the user. Specs that no source can verify are **asked for**
> (interactive) or **required as flags** (non-interactive) before the
> model is usable; a documented escape hatch exists for unattended lanes.
> Every spec carries provenance, everywhere it is shown. Detection
> **replaces** the old behavior (silently stamping 131072/8192 on every
> unknown id) — "never guess" stays the law; asking is the new fallback.

- [The problem](#the-problem)
- [Method](#method)
- [The spec-source landscape](#the-spec-source-landscape)
- [How other products do it](#how-other-products-do-it)
- [The edge cases that must be handled](#the-edge-cases-that-must-be-handled)
- [The design](#the-design)
- [What was rejected](#what-was-rejected)
- [Related pages](#related-pages)

## The problem

Unown stamps a `contextWindow`/`maxTokens` pair into every models.json
record it seeds — from `model-specs.ts`, a hand-curated table of exactly
five ids (`agnes-3.0-flash`, `agnes-2.5-flash`, `kimi-k2.5`,
`qwen3.7-plus`, `qwen3.6-plus`) `[V]`
(`pi-repo/packages/self-learning/src/model-specs.ts:40-46`). Every other
id gets `DEFAULT_MODEL_SPEC = {131072, 8192}` silently `[V]`
(`model-specs.ts:37`, stamped at `providers.ts:208-217`,
`providers.ts:647-654`, `runner.ts:219-226`, `term.ts:172-177`).

Those numbers are not cosmetic. They drive:

| Process | Where the spec is consumed | What a wrong value does |
|---|---|---|
| Compaction (engine sandbox) | `runner.ts:99-107` (`checkAutoCompact`, fallback constant at `runner.ts:53`) + `auto-compact.ts:154` (70/85/95% buckets) | too large → overflow errors; too small → premature compaction |
| Compaction (terminal) | `terminal-auto-compact.ts:120-123` (reserve-aware window) | same, in the user's live session |
| Compaction (pi native) | `compaction.ts:235-238` (`contextTokens > contextWindow - reserveTokens`) | same |
| Output cap | `openai-completions.ts:839-845` (`max_tokens`/`max_completion_tokens` from `model.maxTokens`) | too small → truncated answers (the "silent capability cut" `model-specs.ts:6-13` documents); too large → 400s |
| Context display | `/context` (`tools.ts:3656-3688`), the `ctx NN%` chip (`turn-meter.ts:134-137`), `get_context_remaining` (`context-tools.ts:140-161`) | wrong percentage, wrong remaining budget |
| Cost estimates | bridge `usage.ts:129-201` + its `usage-cli.ts:110-147` mirror (turn-meter `~$` chip) | unknown pricing → cost silently omitted (`costUsd: null`) |
| Vision (VLM) | the `input` array — `transform-messages.ts:36` gates image parts on `model.input.includes("image")` | optimistic `["text","image"]` on a text-only model → hard errors on every image |

There is even a **third** set of defaults hiding upstream: a hand-edited
models.json record that omits the fields gets pi's own
`contextWindow: 128000, maxTokens: 16384` fallback `[V]`
(`pi-repo/packages/coding-agent/src/core/provider-composer.ts:160-161`)
— inconsistent with unown's 131072/8192, so the same model can behave
differently depending on which path seeded it.

The mission: detect the specs from **verifiable sources** automatically
once a model is configured, ask the user when nothing verifiable exists,
and incorporate the workflows and edge cases the field has already
learned.

## Method

Three passes, each pinned to what was actually read or run:

1. **Live API fetches** — the models.dev catalog, OpenRouter's model
   list, DeepInfra's enriched `/v1/models`, and several OpenAI-compat
   `/v1/models` endpoints (to see what they do and do not return).
2. **Source reading** — the model-resolution code of LiteLLM, Aider,
   OpenCode, Cline, Continue, Zed, Goose, Crush, Codex CLI, plus the
   server-native discovery endpoints of Ollama, llama.cpp, LM Studio,
   vLLM (the local-model lane).
3. **In-repo audit** — every spec consumer in unown + vendored pi at the
   pinned HEAD, listed in the table above.

Claim tiers (the repo's decision-record convention): `[V]` verified at a
cited `file:line`, API field, or reproduced command; `[C]`
upstream-claimed, not re-derived; `[U]` unknown.

## The spec-source landscape

Ranked by (freshness, schema richness, no-auth, cross-provider reach):

| # | Source | What it gives | Auth | Verdict |
|---|---|---|---|---|
| 1 | **models.dev** `https://models.dev/api.json` | per-model `limit.{context, output}`, `cost.{input, output, cache_read, cache_write}` ($/M), `modalities.{input, output}`, `reasoning` + `reasoning_options`, `tool_call`, `family`, `canonical_model_id`, `status`; ~8.9k models across ~233 providers `[V]` (fetched 2026-10-30) | none | **Adopt.** The richest open registry; upstream pi's own model generator already builds its catalog from it `[V]` (`pi-repo/packages/ai/scripts/generate-models.ts:1453-1474`); the same generator also consumes OpenRouter's list `[V]` (`:1095`). |
| 2 | **LiteLLM** `model_prices_and_context_window.json` (raw GitHub) | `max_input_tokens`, `max_output_tokens`, `input/output_cost_per_token` (+ batch/priority/flex tiers), `cache_read/creation_input_token_cost`, `supports_vision/function_calling/reasoning/prompt_caching/response_schema`, `source` (a provenance URL per entry!), `litellm_provider` `[V]` (fetched 2026-10-30) | none (raw file) | **Adopt.** Aider's only download source; the `source` field matches unown's provenance law. |
| 3 | **OpenRouter** `GET /api/v1/models` | `context_length`, `top_provider.max_completion_tokens`, `pricing.{prompt, completion, input_cache_read}` (per-token strings), `architecture.input_modalities`, `supported_parameters` `[V]` (fetched 2026-10-30) | none for listing | **Adopt for openrouter-base providers** (and as a registry mirror behind the same matching). |
| 4 | **Endpoint-native catalogs** — `GET {base}/models` | vLLM `max_model_len`; llama.cpp `meta.n_ctx`; LM Studio `max_context_length`/`loaded_context_length` + `capabilities:["tool_use","vision"]`; DeepInfra `metadata.{context_length, max_tokens, pricing}`; most hosted providers (OpenAI, Together, Mistral, Fireworks, xAI) return **ids only** or 401/403 `[V]` (fetched 2026-10-30) | the provider's own key | **Adopt as the endpoint lane** — the ONLY authoritative source for local/self-hosted servers, and the one that already flows through unown's probe (which currently discards everything but the ids `[V]` `probe.ts:77-80`). |
| 5 | **HuggingFace config.json** | `max_position_embeddings` | none (public repos) | **Reject for v1** — training-time upper bound, wrong for quantized/served variants; LiteLLM uses it as a fallback `[C]`. |
| 6 | **Artificial Analysis API** | pricing + benchmarks, auth-gated (`x-api-key`) `[V]` (API reference) | account | **Reject** — benchmark/price focus, auth-walled, poor context-window coverage. |

## How other products do it

The workflows worth copying, with their sources:

- **LiteLLM** (`litellm/utils.py`): ordered static lookups —
  provider-prefixed → bare → Bedrock region-free → dated-suffix-stripped
  (`-\d{4}-\d{2}-\d{2}$`) → finetune-prefix-collapsed
  (`ft:gpt-4o:org:x:id` → `ft:gpt-4o`) → family-prefix generalization,
  then `mapped_model_fill_missing` fills holes from the family base
  `[V]` (source read). Unknown model → **raises** `ModelNotMappedError`
  with a "add it here" pointer — asking, not guessing. **Adopted:** the
  normalization ladder and the family fill; our ask is a prompt instead
  of an exception.
- **Goose** (Block) — the most explicit **cascade** in production
  (`goose-provider-types/src/context_limit.rs`): user override →
  configured limits → live probe → canonical registry (built from
  models.dev/OpenRouter, embedded at build time) → `DEFAULT_CONTEXT_LIMIT
  = 128_000`. The probe parses `meta.n_ctx` from `GET {base}/models`,
  treats 404 as "unsupported" (not an error), and **caches failures with
  a timestamp** so it never hammers `[V]` (source read). **Adopted:**
  the whole shape — override → registry → probe → ask, plus failure
  caching.
- **OpenCode** — models.dev as the only catalog, with the
  layered-load trick: **file override → KV cache (5-min TTL, ETag,
  SHA-256 body digest) → bundled snapshot → live fetch**, never blocking
  startup `[V]` (source read). **Adopted:** disk cache with TTL + a
  fetch that never blocks (our TTL is longer; see below).
- **Cline** — migrated from "ask the user for the context window" to a
  models.dev-backed catalog, but keeps **user overrides** per model, and
  keeps `contextWindow` separate from `maxInputTokens` ("Prompt/input
  token budget reported by the provider. Kept separate from the total
  context window") `[V]` (source read). Unknown custom ids get safe
  defaults applied **openly** (`openAiModelInfoSafeDefaults`).
  **Adopted:** per-model user override wins over every source (already
  unown's "the entry's own values win" law `[V]` `providers.ts:213-214`).
- **Codex CLI** — specs from the backend `GET /models`; custom/unknown
  models get fallback metadata **flagged**
  `used_fallback_model_metadata=true` and the TUI shows a warning;
  `effective_context_window_percent` defaults to 95% (the usable-window
  margin) `[V]` (source read). **Adopted:** the visible "unverified"
  state instead of a silent default; the 95% margin already matches
  pi's compaction reserve behavior.
- **Aider** — downloads LiteLLM's JSON (24h TTL cache), merges a user
  `--model-metadata-file` checked BEFORE the download, and on unknown
  models warns + **fuzzy-suggests** close matches `[V]` (source read).
  **Adopted:** 24h registry cache TTL; suggestions in the ask prompt.
- **Zed** — the cautionary tales: LM Studio gets native
  `max_context_length` polling, but Ollama **does not** — Zed sends
  `num_ctx` 4096 by default and silently truncates `[V]` (source read).
  **Adopted (the lesson):** never stamp a spec silently; local servers
  get the endpoint lane, and a model whose runtime window the endpoint
  cannot report is asked for.
- **Crush (Charm)** — custom providers must declare
  `context_window` + `default_max_tokens` per model, **required** in the
  schema — no silent defaults at all `[V]` (source read). That is the
  strict reading of this mission's gate, and it is the reading we
  implement for the *user-facing* lanes.

## The edge cases that must be handled

The field's catalog of traps, each mapped to a design decision:

1. **The `max_tokens` semantic collision** — OpenAI's request field is
   the *output* limit; LiteLLM's old DB field was the *context window*
   (since removed); Zed's settings `max_tokens` means context; Cline's
   `maxTokens` means output. Unown's `maxTokens` means **max output**
   (it feeds `max_tokens`/`max_completion_tokens` `[V]`
   `openai-completions.ts:839-845`). **Decision:** one vocabulary,
   everywhere: `contextWindow` = total context, `maxTokens` = max
   output; every source maps into it explicitly and the mapping is
   unit-tested.
2. **Aliased/family ids** — dated snapshots (`-2026-10-25`), versioned
   ids (`-v2`), finetunes (`ft:base:org:x:id`), OpenRouter
   `org/model` ids, case variants. **Decision:** exact match wins;
   then a normalization ladder (case-fold, strip dated/versioned
   suffixes, collapse finetune prefixes, try the last `/`-segment);
   then family-prefix (longest first) — and every non-exact match is
   **labeled** `match: "family"` in the provenance so it can never
   masquerade as a verified exact spec.
3. **Providers advertising training-time limits** — GGUF
   `context_length` is the training length; the runtime `num_ctx` can be
   2048. LM Studio reports both `max_context_length` (catalog) and
   `loaded_context_length` (runtime). **Decision:** the endpoint lane
   prefers runtime fields (`loaded_context_length`, vLLM `max_model_len`
   — exact for the served config) over catalog fields, and LM
   Studio-style pairs are stamped from the **loaded** value.
4. **OpenAI-compat servers without a usable `/models`** — 401/403/404 or
   ids-only bodies are the norm among hosted providers `[V]`. The goose
   rule: a 404 is "unsupported", and failures are **cached** so the
   next ask does not re-probe. **Decision:** same — the endpoint lane
   records a failure with a timestamp; the registry lanes carry the
   load for hosted models.
5. **Duplicate provider names in ids** (`perplexity/perplexity/glm`) and
   slash-bearing model ids. **Decision:** provider-scope matching tries
   the provider's own models.dev segment first; the last-segment
   fallback only after full-id matching fails.
6. **Capability absence ≠ capability false** — an absent
   `supports_vision` in LiteLLM or missing `modalities` in models.dev
   means *unknown*, not *no*. **Decision:** detection only ever
   **upgrades** `input` to include `"image"` when a source positively
   says so; it never strips `"image"` from an existing record (the
   curated-wins law), and `reasoning` is only set when positively
   detected.
7. **Pricing units** — models.dev and pi's `ModelCost` are $/1M tokens;
   LiteLLM is per-token; OpenRouter is per-token strings. **Decision:**
   normalize everything to pi's `$ per 1M` vocabulary at the source
   boundary, with per-source unit tests.
8. **Wrong-spec recovery (error-message learning)** — the upstream 400s
   carry the truth: `"This model's maximum context length is X tokens,
   but the request contains Y"` / `context_length_exceeded` /
   Anthropic's `"prompt is too long: X tokens > Y maximum"` `[V]`
   (patterns already recognized by pi's overflow util `[V]`
   `pi-repo/packages/ai/src/utils/overflow.ts:37-63`). **Decision:** the
   bridge (which sees every engine-lane error) parses the numbers and
   records a **learned** spec (`source: "learned-error"`), surfaced in
   `unown models verify` for the user to accept — a learned number is
   reported, never silently applied.
9. **Unattended lanes must not brick** — the engine's sandbox runs and
   scripted setups have no one to ask. **Decision:** the gate applies to
   the *user-facing* terminal lanes (interactive TUI + `-p` print mode);
   the engine's `ensureAgentDir` gets best-effort detection with no
   gate; scripts get `--context-window`/`--max-tokens` flags and the
   `UNOWN_ALLOW_UNVERIFIED_SPECS=1` escape hatch.
10. **Never block startup on a registry** (opencode's law). **Decision:**
    detection calls are bounded (`UNOWN_SPEC_PROBE_TIMEOUT_MS`, default
    4s per source) and the registry cache is read from disk when fresh;
    a fetch failure is a miss, never an error.

## The design

The cascade (fixed order, first verifiable hit wins):

```
resolveSpecs(providerId, baseUrl, apiKey, modelId):
  0. the record's own values      (models.json already carries curated
                                   specs — the entry's own values win, the
                                   accumulate-never-rewrite law)
  1. curated catalog              (model-specs.ts — vendor-published,
                                   exact ids only; now with pricing where
                                   the vendor publishes it)
  2. models.dev registry          (disk cache, TTL 24h → live fetch;
                                   exact → normalized → family match)
  3. LiteLLM database             (disk cache, TTL 24h → live fetch;
                                   same ladder; per-source `source` URLs)
  4. the endpoint's own catalog   (GET {base}/models with the provider's
                                   key: max_model_len / loaded_context_length /
                                   meta.n_ctx / metadata.context_length /
                                   context_length + top_provider.max_completion_tokens;
                                   404 = unsupported; failures cached)
  5. the user                     (interactive: prompted with validation and
                                   close-match suggestions;
                                   non-interactive: --context-window /
                                   --max-tokens required, else exit 1)
```

Where it lives and what it writes:

- **`model-spec-detect.ts`** (new, `pi-repo/packages/self-learning/src/`)
  — import-light (node builtins + fetch only, the presets.ts detachment
  rule): the pure matching/normalization/sanity core, the registry
  fetch+cache, the endpoint-catalog spec parser, the orchestrator.
- **The provenance sidecar** `~/.unown/agent/model-specs.json` —
  `{ "specs": { "<providerId>/<modelId>": { contextWindow, maxTokens,
  cost?, input?, reasoning?, source, sourceUrl?, match, verifiedAt } } }`.
  Read by `unown models`, doctor, preflight; written by detection.
  models.json keeps only pi-schema fields (the TypeBox schema is the
  contract `[V]` `model-config.ts:159-173`); provenance never leaks into
  it.
- **The provider upsert** grows optional per-model detected specs
  (`ProviderEntry.modelSpecs`) so setup/refresh can stamp each id with
  its own verified numbers; `newModelRecord` consults them before the
  catalog defaults. Curated/existing values still win.
- **The probe widens**: `EndpointProbe.models` entries keep the spec
  fields they already receive and discard today (`probe.ts:77-80`) —
  no new request, just stop throwing the truth away.
- **The bridge** passes upstream catalog specs through `/health`
  (`modelSpecs`) and `/v1/models` (extra fields per entry — the
  DeepInfra precedent), and learns context limits from upstream 400s
  into `model-specs-learned.json` (surfaced, not auto-applied).
  Pricing resolution (bridge `usage.ts` + `usage-cli.ts` mirror) gains a
  sidecar source between the env overrides and the estimate table.
- **The gate**: setup wizard (ask with validation + suggestions),
  non-interactive setup (flags or exit 1), session preflight
  (self-healing detection first; ask once interactively; print mode
  aborts with the remediation; `UNOWN_ALLOW_UNVERIFIED_SPECS=1`
  documented escape), engine lane (best-effort, never gated).

Sanity bounds (shared by every source): `contextWindow` an integer in
`[1024, 100_000_000]`; `maxTokens` an integer in `[1, contextWindow]`
(clamped, never rejected silently — a clamp is recorded); pricing
numbers ≥ 0 and `< $10_000` per 1M (a sanity ceiling, not a price
claim). A source whose numbers fail sanity is a miss, not a spec.

## What was rejected

- **Embedding a 5.5 MB models.dev snapshot in the package** — the
  in-repo `scripts/modelsdev.json` is a manual cache; embedding it in
  the compiled CLI (six per-OS archives) bloats every binary for a
  lookup that the 24h disk cache serves better after the first online
  detection. The curated five-model table remains the offline floor.
- **Tokenizer-based context estimation** (~4 chars/token, tiktoken
  classes) — estimates limits we cannot verify; the mission says
  verifiable or ask. Token counting for *display* already exists
  upstream and is out of scope.
- **Live overflow probing** (binary-searching the real context limit
  with filler requests) — spends the user's tokens/money to guess;
  error-message learning (edge case 8) recovers the same truth from
  real traffic, for free.
- **Asking per-model on bulk import** — `providers refresh`/`--all-models`
  can import dozens of ids; nagging per id would make the feature a
  wall. Bulk import detects what it can and marks the rest unverified;
  the gate fires when an unverified model is *used* (the active model
  at session start), which is the moment the specs start to matter.

## Related pages

- [providers.md](providers.md) — the user-facing config contract (specs
  section rewritten for detection)
- [usage-tracking.md](usage-tracking.md) — where pricing comes from now
- [configuration.md](configuration.md) — the new env knobs
- [usage.md](usage.md) — the new CLI flags and `unown models verify`
- [model-specs-session.md](model-specs-session.md) — the round's
  resumable session log
