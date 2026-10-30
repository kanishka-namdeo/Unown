# Providers & models

How unown talks to models: the multi-provider registry, the two connection shapes, the files involved, and how to point them at anything from Dashscope to a local llama.cpp server.

- [The two shapes](#the-two-shapes)
- [Multiple providers](#multiple-providers)
- [unown setup](#unown-setup)
- [unown providers](#unown-providers)
- [In the TUI](#in-the-tui)
- [The config files](#the-config-files)
- [Model specs](#model-specs)
- [Direct provider recipes](#direct-provider-recipes)
- [The bundled bridge](#the-bundled-bridge)
- [Switching models](#switching-models)

Related pages: [quickstart](quickstart.md) · [configuration](configuration.md) · [troubleshooting](troubleshooting.md)

## The two shapes

| | Direct provider | Bundled llm-bridge |
|---|---|---|
| Terminal agent talks to | your provider's endpoint | `http://127.0.0.1:3031/v1` (localhost) |
| Credentials | your key, stored in `~/.unown/agent/auth.json` (mode 0600) | `BRIDGE_UPSTREAM_KEY` in the repo's `.env` — nothing secret on your machine |
| Extra services needed | none — the CLI works standalone | bridge (chat) + engine (learning features; mission control is the `unown dashboard` TUI riding the engine's API — no extra service) |
| Model routing / thinking translation / SSE passthrough | whatever your provider does natively | handled by the bridge |
| Configure with | `unown setup --provider openai --api-key … --model …` | put the upstream key in `.env`, then `unown setup --provider bridge` |

Both write the same three files under `~/.unown/agent/`. You can mix them — the registry below holds any number of providers of either shape.

## Multiple providers

Unown is multi-provider: **adding a provider never removes the ones you already configured**, and **updating one never truncates its model list** — a re-add naming a single model keeps the discovered catalog registered (the incoming id just moves to the front; `--force` is the only reset). The registry (`~/.unown/agent/models.json`) accumulates, `/model` lists every configured provider's models, and `--model provider/model` routes a session to any of them:

```bash
unown --model agnes/agnes-3.0-flash "fix the failing test"
```

Key rules (the same ones Cline / OpenCode / Codex CLI converged on):

- **Keys live in `auth.json`** (mode 0600 on macOS/Linux, owner-only ACLs on Windows) — never in the repo, never in models.json.
- **Env-var references instead of secrets**: `unown providers add --provider openai --key-env OPENAI_API_KEY …` writes `$OPENAI_API_KEY` into models.json; the key is read from the environment at session start (the headless/CI pattern).
- **Everything OpenAI-compatible is one preset shape** — `--provider custom --base-url … --model …` covers vLLM, llama.cpp, Ollama, LM Studio, gateways.
- **Canonical model ids are `provider/model`** in flags, agent frontmatter and settings.
- `unown setup --force` is the explicit **reset** back to exactly one provider (the pre-2.3 behaviour) — the only thing that ever drops siblings.

## unown setup

```bash
unown setup                              # interactive wizard (needs a TTY)
unown setup --list                       # print the presets
unown setup --provider bridge            # bundled stack
unown setup --provider openai \
  --api-key sk-... --model gpt-4o        # direct, non-interactive (scripts/CI)
unown setup --provider custom \
  --base-url http://127.0.0.1:11434/v1 --model llama3   # any OpenAI-compatible server
unown setup --provider custom --base-url ... --model my-model \
  --context-window 131072 --max-tokens 8192   # spec flags (see Model specs below)
```

Every setup passes through the **spec gate** (see [Model specs](#model-specs)): once the model is chosen, its context window and max output tokens are DETECTED from verifiable sources; the wizard asks for anything it cannot verify (validated numeric prompts, with the tried-sources receipt), scripts carry `--context-window`/`--max-tokens` or setup fails with the remediation (exit 1, nothing written) — `UNOWN_ALLOW_UNVERIFIED_SPECS=1` is the documented escape hatch for unattended lanes.

Presets: `bridge` (bundled), `openai`, `openrouter`, `anthropic`, `dashscope`, `deepseek`, `agnes`, `custom`. Every direct setup verifies the endpoint is reachable and the key is accepted before declaring success — a rejected key fails setup with the HTTP status instead of failing your first chat later. A 429 is reported as **rate-limited** (the endpoint is up, the key passed auth, only the throttle is in the way), and the probe speaks the provider's own wire — Anthropic endpoints are authenticated with `x-api-key` against `{root}/v1/models`, so a valid Anthropic key verifies correctly.

The interactive wizard (no flags, TTY) is a guided flow: current-state welcome → provider choice (the bundled bridge is marked `← recommended` when its stack is up and keyed; blank or an invalid answer takes the default — never a silent mid-parse selection) → **masked key entry** (a stored key shows as `key[:8]… ✓` with **Keep / Replace / Clear** — Keep preserves the storage form, Clear removes every local trace; pasted keys are trimmed and keys that still contain whitespace or control characters are rejected with a diagnosis that never echoes the value) → **live model discovery on both wires** (the endpoint is probed with your key and the list is what it actually serves; only an unreachable or throttled endpoint falls back to typing the id) → **spec gate** (the context window + max output tokens are detected from verifiable sources — the endpoint's own catalog first — and the wizard asks, with validation and the tried-sources receipt, only for what nothing could verify) → **theme step** (current first — blank keeps it) → **setup summary** (provider, model +N discovered, key disposition, theme, verify, kept siblings) plus next commands and first-flight suggestions. Blank at any step takes the default; Ctrl+C cancels with `nothing written`. Base URLs get paste hygiene too: surrounding whitespace and trailing slashes are stripped before anything is written.

Setup **merges**: re-running it adds or updates that provider in place and keeps the rest of the registry; it also makes the provider the default (setup is a "make this my setup" action). `--force` resets instead — see [Multiple providers](#multiple-providers).

## unown providers

The day-to-day management surface over the registry:

```bash
unown providers list [--json]            # what's configured, key status, defaults
unown providers add --provider agnes --key-env AGNES_API_KEY
unown providers add --provider custom --base-url http://127.0.0.1:11434/v1 \
  --id ollama --model llama3             # named custom endpoints
unown providers add --provider openai --api-key sk-... \
  --model gpt-4o --all-models            # + import every served chat model
unown providers refresh agnes            # import the endpoint's live catalog
unown providers remove openai             # drops the provider + its stored key
unown providers key openai                # rotate a key (masked prompt; verifies live)
unown providers default agnes agnes-3.0-flash
unown providers test agnes               # live endpoint probe with the stored key
```

`add` does not steal the default unless `--default` (or the registry was empty); `remove` re-points the default at the first survivor; `key` prompts with **masked input** (the same raw-mode reader the setup wizard uses — the typed secret never echoes) and verifies the new credential against the endpoint immediately — a rejected key fails the command instead of failing your next chat later. The interactive `add` wizard also masks its key entry. Probes report the round-trip latency (`· 240 ms`) and classify 429 as **rate-limited** rather than unreachable.

**Model discovery** (`--all-models` / `refresh`) imports the endpoint's live `GET /models` catalog into models.json: new ids register with their DETECTED specs when a verifiable source answers (the endpoint's own enriched `/models`, the curated catalog, models.dev, the LiteLLM database — see [Model specs](#model-specs)), curated per-model metadata is never touched, and ids the endpoint stopped serving are reported but kept (pruning is deliberate). Discovery NEVER asks per id — a bulk import can register dozens of models; unverified ids stay unverified until the moment they are used (the session preflight's gate fires then). Obviously-not-chat ids (embeddings, rerankers, TTS, image/video generation, moderation) are filtered out of the import — they would only be noise in `/model`.

## In the TUI

The same management surface lives **inside the chat session**: `/providers` opens the interactive manager, so you never leave the conversation to rotate a key or flip a default. It is the TUI twin of the CLI above — both call the same registry core, so a provider added in the session is exactly a provider `unown providers list` shows (and vice versa).

```
/providers                      # the interactive manager (TUI + RPC)
/providers list                 # the text summary, everywhere (print/json too)
/providers test <id>            # live endpoint probe with the stored key
/providers refresh <id>         # import the endpoint's live model catalog
```

Bare `/providers` opens a select over the registry — one row per provider (`✓ agnes — Agnes AI (default) · key: auth.json · 6 models`), plus `+ Add provider…` and `Done`. Picking a provider opens its action menu:

- **Make default…** — pick one of the provider's registered models; writes `settings.json` and reports `default set to <provider>/<model>`. **Use `/model` to switch the current session** — that stays /model's job (the registry default is what the NEXT session boots with).
- **Set API key** — paste the key; it lands in `auth.json` (mode 0600) and is **verified against the endpoint immediately** — a rejected key fails right there, not in your next chat. Blank keeps the current key; `$ENV` references are the CLI's `--key-env` lane.
- **Test connection** — the live probe with the stored credential, with the same actionable classification as the CLI: HTTP 401 → rotate the key, 429 → rate-limited (retry in a moment), unreachable → fix the URL/start the endpoint, plus the probe's `· 240 ms` latency chip and a `⚠ registered but not served` cross-check.
- **Refresh models** — the live `GET /models` import: `+N added`, `M no longer served (kept)`.
- **Remove provider…** — one confirm, then the provider AND its stored key are gone; if it was the default, the fallback is reported (`default fell back to <provider>/<model>`).

**Add provider** walks the preset table (the bundled bridge, OpenAI, OpenRouter, Anthropic, Dashscope, DeepSeek, Agnes, custom endpoints): optional key → live model discovery → a default-model pick from what the endpoint actually serves. Discovery failing (no key yet, endpoint down) is not fatal — the preset's default model registers and the failure is surfaced with the fix. The bundled bridge keeps its special rules (registry id `zai-bridge`, placeholder key, served allow-list); custom endpoints are a four-input form (id, base URL, model, optional key).

Composure notes:

- **Every registry mutation refreshes the model registry in place** — `/model`'s picker and the footer model line see a provider added mid-session without a restart.
- **No new keybindings** — the manager is arrow-key + Enter selects, Esc backs out at any level, exactly like `/addons`.
- **RPC mode degrades to sequential prompts** (the same dialogs, one at a time); in print/JSON mode bare `/providers` prints the text summary instead of opening dialogs, and the one-shots (`list`, `test`, `refresh`) work everywhere.

## The config files

All three live in `~/.unown/agent/` (override the whole dir with `UNOWN_HOME`).

**`models.json`** — the provider registry pi loads. Written by `unown setup`; hand-editing is supported (JSON with comments allowed):

```json
{
        "providers": {
                "my-provider": {
                        "baseUrl": "https://api.example.com/v1",
                        "api": "openai-completions",
                        "models": [
                                {
                                        "id": "my-model",
                                        "name": "My Model (via unown)",
                                        "contextWindow": 131072,
                                        "maxTokens": 8192,
                                        "input": ["text", "image"]
                                }
                        ]
                }
        }
}
```

- `api`: `openai-completions` for OpenAI-compatible servers; `anthropic-messages` for Anthropic's native API.
- When unown itself seeds a model record from an id alone (`unown setup`, the live `/models` refresh, the engine's sandbox dir, the first-run bridge seed), the record's `contextWindow`/`maxTokens` come from the [spec gate](#model-specs)'s detection cascade — verifiable sources only, never a guess: the curated catalog (`model-specs.ts`, vendor-published limits, e.g. `agnes-3.0-flash` — 524288 context / 65536 output), models.dev, the LiteLLM database, the endpoint's own enriched `/models`, or your own entry. Records registered before this round carry the seeded stamp until the session preflight's self-heal replaces it with a verified one.
- A literal `apiKey` inside a provider entry counts as configured auth — that's how the bundled-bridge shape works (`"bridge-local"` placeholder, or the shared secret when `BRIDGE_API_KEY` is set).
- Keys entered through `unown setup` for direct providers go into `auth.json` instead (see below) — the file stays shareable.

**`auth.json`** — credential store, mode 0600, keyed by provider id:

```json
{
        "my-provider": { "type": "api_key", "key": "sk-..." }
}
```

**`settings.json`** — pins the startup model so no picker ever blocks a session:

```json
{ "defaultProvider": "my-provider", "defaultModel": "my-model" }
```

`unown setup` merges these keys into an existing settings.json (your other settings survive). The resolution order for the first model of a session: `--provider`/`--model` CLI flags → settings.json defaults → first configured provider. Mid-session, `/model` (or Ctrl+L) opens the picker and Ctrl+S saves the choice back into settings.json.

## Model specs

The two numbers that drive compaction (when the session summarizes) and the output cap — the **context window** and the **max output tokens** — are DETECTED from verifiable sources the moment a model is configured, and a model whose specs cannot be verified is not usable until you supply them. A wrong spec is never cosmetic: too small and unown compacts early and caps answers (a silent capability cut); too big and compaction fires too late (an overflow loop). The detection cascade, first verifiable hit per field:

1. **The record's own values** — models.json entries you hand-edited win (the accumulate-never-rewrite law).
2. **The curated catalog** — vendor-published limits for well-known ids (`model-specs.ts`), exact ids only.
3. **models.dev** — the community registry (disk cache, 24 h TTL; exact → normalized → family match).
4. **The LiteLLM model database** — same ladder, per-source URLs.
5. **The endpoint's own catalog** — `GET {base}/models` with your key: vLLM's `max_model_len`, LM Studio's `loaded_context_length`, llama.cpp's `meta.n_ctx`, DeepInfra's `metadata.*`, OpenRouter's `top_provider.max_completion_tokens`. The only authoritative source for local/self-hosted servers.
6. **You** — the interactive wizard asks (validated numeric prompts, close-match hints, the tried-sources receipt); scripts carry `--context-window N --max-tokens N`; the session preflight asks once (TUI) or aborts with the remediation (print mode).

Sanity bounds guard every source: the context window is an integer in [1 024, 100 000 000], max output tokens an integer in [1, context window]; a source whose numbers fail sanity is a miss, not a spec. Pricing and input modalities ride along when a source positively reports them (absence is unknown, never false).

**Where the answer is recorded.** Every resolution lands in the provenance sidecar `~/.unown/agent/model-specs.json` — `{ "provider/model": { contextWindow, maxTokens, cost?, input?, reasoning?, source, match, verifiedAt } }` — and `source` names where each number came from (`curated`, `models-dev`, `litellm`, `endpoint`, `user`, `learned`). Provenance is surfaced everywhere specs are shown:

```bash
unown models            # per-model: "[524,288 ctx / 65,536 out (models.dev)]"
unown models verify     # re-run detection for every registered model; heal + record;
                        # exit 1 with per-model remediation when anything stays unverified
unown doctor            # the default model's spec + its source (warns when unverified)
```

The session preflight re-checks the active model at startup (it reuses the probe's own `/models` fetch — no new request), self-heals seeded stamps that detection can now replace (never hand edits), and applies the gate: ask once interactively, or abort with the remediation in print mode. `UNOWN_ALLOW_UNVERIFIED_SPECS=1` skips the gate everywhere (unattended lanes, CI, power users) — the conservative floor is stamped and labeled unverified.

**Learned specs.** An upstream 400 that names the real limit ("This model's maximum context length is 131072 tokens…") is free evidence: the bundled bridge parses those errors into `model-specs-learned.json` and surfaces them on `/health` (`learnedSpecs`) — never auto-applied. `unown models verify` records them with `learned` provenance; the ask (or your own entry) stays the decider.

## Direct provider recipes

Swap the values into `unown setup --provider custom --base-url … --model …` (or hand-edit models.json):

| Provider | Base URL | Notes |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | vision works (`input: ["text","image"]`) |
| OpenRouter | `https://openrouter.ai/api/v1` | one key, every model; model ids like `anthropic/claude-sonnet-4` |
| Anthropic | `https://api.anthropic.com` | uses the native `anthropic-messages` API |
| Dashscope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Qwen + Kimi families |
| DeepSeek | `https://api.deepseek.com/v1` | text-only models |
| Agnes AI | `https://apihub.agnes-ai.com/v1` | first-class preset (`agnes`); flash models take image input |
| vLLM | `http://localhost:8000/v1` | keyless local |
| Ollama | `http://127.0.0.1:11434/v1` | keyless local |
| llama.cpp server | `http://127.0.0.1:8080/v1` | keyless local |

For keyless local servers, omit `--api-key` — setup continues keyless on purpose.

## The bundled bridge

The bridge turns one upstream into a clean local endpoint for the whole stack:

- **Auth injection** — your key lives only in the repo's `.env` (`BRIDGE_UPSTREAM_KEY`); nothing secret on client machines.
- **Model routing** — requests naming an id outside `BRIDGE_KNOWN_MODELS` are routed to `BRIDGE_ROUTE_DEFAULT` (so a stale model id never hard-fails).
- **Thinking translation** — qwen-family thinking is disabled by default for snappy agent turns (`BRIDGE_QWEN_THINKING=1` keeps it).
- **SSE passthrough** — true streaming, tool calls and image content pass through verbatim.
- **Spec passthrough** — the upstream catalog's spec fields (`max_model_len`, `max_completion_tokens`, input modalities…) ride each `/v1/models` entry (the DeepInfra precedent) and `/health`'s `modelSpecs`, so the agent's spec detection sees the upstream's published limits instead of bare ids.
- **Limit learning** — an upstream 400 that names the real context/output limit (OpenAI/OpenRouter/Mistral/DashScope/Kimi/xAI/Bedrock shapes) is parsed into `model-specs-learned.json` and surfaced on `/health` (`learnedSpecs`) — once per change, pass-through requests only, never auto-applied.
- **Guardrails** — request serialization + spacing (`BRIDGE_MIN_SPACING_MS`), time-to-headers timeout (`BRIDGE_UPSTREAM_TIMEOUT_MS`), 429/5xx backoff retries, optional shared secret (`BRIDGE_API_KEY`).

`GET localhost:3031/health` reports the live state — including whether the upstream key is set and whether the upstream answers, the upstream's published specs per model (`modelSpecs`) and the limits its 400s revealed (`learnedSpecs`) — which `unown doctor`, `unown models verify` and `scripts/start.ts` surface as actionable warnings.

**The local lane (optional second upstream):** point `BRIDGE_LOCAL_URL` at any
local OpenAI-compatible server — llama.cpp `llama-server`, Ollama, LM Studio —
and model ids matching `BRIDGE_LOCAL_MODELS` (or any `local-*` id when that
list is empty) are forwarded there instead of the remote upstream: keyless by
default, no spacing throttle, llama.cpp's `chat_template_kwargs` thinking
dialect handled automatically. The learning layer can then run selected
background jobs locally (`PI_MINER_MODEL_ID` / `PI_DREAM_MODEL_ID` /
`PI_SKILLS_MODEL_ID` / `PI_MINT_MODEL_ID`, e.g. `local-qwen3-0.6b`) while
agent sessions stay on the remote model — see
[benchmarks/local-llm/](../benchmarks/local-llm/) for the hypothesis-driven
evaluation behind this split (a 0.6B local model matched the remote baseline
on note triage, failure mining and dream consolidation; pure-local task
minting was refuted — the opt-in mint cascade below is its verified salvage —
and the main agent stays remote). Start a lane in one line:

```bash
node benchmarks/local-llm/runner.mjs serve --model qwen3-0.6b   # downloads llama.cpp + GGUF on first use
```

`GET /health` reports the lane as `local {ok, status, url, models}` alongside
the upstream probe.

**Mint cascade (opt-in, `PI_MINT_CASCADE=1`):** task minting can draft on the
local model and pay for the remote one only when needed. The cascade authors
each draft on `PI_MINT_DRAFT_MODEL_ID` (default `local-qwen3-0.6b`,
json_schema-grammar-constrained), gates it with the existing validator, and
escalates only invalid drafts to ONE remote repair call on the regular mint
model; everything downstream (self-check, sandboxed validation run) is
unchanged. Verified E8/H10 on the 2-vCPU host: 6/6 accepted vs 5/6
pure-remote, 10.6× cheaper per accepted task, blind judge 2W/3T/0L — a valid
local draft never touches the remote API. Unset = remote authoring as before.

**The `BRIDGE_API_KEY` coupling:** if you set a shared secret on the bridge, every client must present it — including the terminal agent. `unown setup --provider bridge` picks it up from the environment; if you set it *after* configuring, re-run setup (or hand-edit the `apiKey` in `~/.unown/agent/models.json`).

## Switching models

- **Per session**: `/model` or Ctrl+L opens the picker (every configured provider's models); Ctrl+P cycles through enabled models; Shift+Tab cycles thinking levels; `/scoped-models` controls what Ctrl+P cycles through.
- **One-shot**: `unown --model provider/model "task"` routes that session without touching defaults.
- **Persistently**: `unown providers default <provider> [model]`, `/providers` → the provider → *Make default…* mid-session, pick with Ctrl+S in the picker, or re-run `unown setup`.
- **Check what's live**: `unown models` lists your configured models with each one's spec provenance (`[524,288 ctx / 65,536 out (models.dev)]`, or `specs unverified — checked at first use`) plus what a local bridge actually serves (with an allow-list cross-check, the probe's latency, and a `⚠ recently failed` annotation on models the health store marked — the same marks `unown doctor` surfaces); `unown models verify` re-runs detection for every registered model, records provenance, heals models.json, and exits 1 with per-model remediation when anything stays unverified; `unown providers test <id>` probes one provider with its stored key. `unown doctor` shows the probe latency on the model-endpoint row, the default model's verified spec + source, rates 429 as a warning (up, throttling), and surfaces the model-health marks (`model health marks — <model> failed N min ago (subagents skip it for up to 30 min)`) so a subagent's silent model skip is never mysterious.

## Web-search providers (the `web_search` tool)

Separate from the LLM providers above: unown's `web_search` / `webfetch` tools ship their own provider registry — 19 adapters, keyless-first. Nothing here needs setup; the tools work on a fresh clone with zero keys:

- **Keyless chain (free)**: SearXNG (self-hosted, `UNOWN_SEARXNG_URL`) → DuckDuckGo → Tavily keyless → You.com (free profile) → StackExchange (300 req/day per IP) → Wikipedia → HN → npm registry → GitHub repo search (`GITHUB_TOKEN` optional).
- **API-key providers (paid tiers / free tiers with signup)**: Tavily, Brave, Serper, Exa, Perplexity, Jina, Zhipu, DashScope (`enable_search` grounding — standard `sk-…` keys only; coding-plan `sk-sp-…` keys are refused up front with an actionable note), Kagi, SerpApi — plus Firecrawl on the fetch side. Any key set in `.env` **prepends** that provider to the chain; `UNOWN_WEB_SEARCH_PROVIDER` pins an explicit provider or comma-separated chain.

Full auto-selection order, per-provider quirks, and every env key: [usage](usage.md#session-tools) · [configuration](configuration.md). Live-verification receipts: [benchmarks/websearch-live/](../benchmarks/websearch-live/).

Full variable reference: [configuration](configuration.md).
