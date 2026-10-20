# Providers & models

How unown talks to models: the multi-provider registry, the two connection shapes, the files involved, and how to point them at anything from Dashscope to a local llama.cpp server.

- [The two shapes](#the-two-shapes)
- [Multiple providers](#multiple-providers)
- [unown setup](#unown-setup)
- [unown providers](#unown-providers)
- [The config files](#the-config-files)
- [Direct provider recipes](#direct-provider-recipes)
- [The bundled bridge](#the-bundled-bridge)
- [Switching models](#switching-models)

Related pages: [quickstart](quickstart.md) · [configuration](configuration.md) · [troubleshooting](troubleshooting.md)

## The two shapes

| | Direct provider | Bundled llm-bridge |
|---|---|---|
| Terminal agent talks to | your provider's endpoint | `http://127.0.0.1:3031/v1` (localhost) |
| Credentials | your key, stored in `~/.unown/agent/auth.json` (mode 0600) | `BRIDGE_UPSTREAM_KEY` in the repo's `.env` — nothing secret on your machine |
| Extra services needed | none — the CLI works standalone | bridge (chat) + engine + dashboard (learning features) |
| Model routing / thinking translation / SSE passthrough | whatever your provider does natively | handled by the bridge |
| Configure with | `unown setup --provider openai --api-key … --model …` | put the upstream key in `.env`, then `unown setup --provider bridge` |

Both write the same three files under `~/.unown/agent/`. You can mix them — the registry below holds any number of providers of either shape.

## Multiple providers

Unown is multi-provider: **adding a provider never removes the ones you already configured**. The registry (`~/.unown/agent/models.json`) accumulates, `/model` lists every configured provider's models, and `--model provider/model` routes a session to any of them:

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
```

Presets: `bridge` (bundled), `openai`, `openrouter`, `anthropic`, `dashscope`, `deepseek`, `agnes`, `custom`. Every direct setup verifies the endpoint is reachable and the key is accepted before declaring success — a rejected key fails setup with the HTTP status instead of failing your first chat later.

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
unown providers key openai                # rotate a key (prompts; verifies live)
unown providers default agnes agnes-3.0-flash
unown providers test agnes               # live endpoint probe with the stored key
```

`add` does not steal the default unless `--default` (or the registry was empty); `remove` re-points the default at the first survivor; `key` verifies the new credential against the endpoint immediately — a rejected key fails the command instead of failing your next chat later.

**Model discovery** (`--all-models` / `refresh`) imports the endpoint's live `GET /models` catalog into models.json: new ids register with sane defaults (a vision-capable provider's new models inherit image input), curated per-model metadata is never touched, and ids the endpoint stopped serving are reported but kept (pruning is deliberate). Obviously-not-chat ids (embeddings, rerankers, TTS, image/video generation, moderation) are filtered out of the import — they would only be noise in `/model`.

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
- **Guardrails** — request serialization + spacing (`BRIDGE_MIN_SPACING_MS`), time-to-headers timeout (`BRIDGE_UPSTREAM_TIMEOUT_MS`), 429/5xx backoff retries, optional shared secret (`BRIDGE_API_KEY`).

`GET localhost:3031/health` reports the live state — including whether the upstream key is set and whether the upstream answers — which `unown doctor` and `scripts/start.ts` surface as actionable warnings.

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
- **Persistently**: `unown providers default <provider> [model]`, pick with Ctrl+S in the picker, or re-run `unown setup`.
- **Check what's live**: `unown models` lists your configured models plus what a local bridge actually serves (with an allow-list cross-check); `unown providers test <id>` probes one provider with its stored key.

## Web-search providers (the `web_search` tool)

Separate from the LLM providers above: unown's `web_search` / `webfetch` tools ship their own provider registry — 19 adapters, keyless-first. Nothing here needs setup; the tools work on a fresh clone with zero keys:

- **Keyless chain (free)**: SearXNG (self-hosted, `UNOWN_SEARXNG_URL`) → DuckDuckGo → Tavily keyless → You.com (free profile) → StackExchange (300 req/day per IP) → Wikipedia → HN → npm registry → GitHub repo search (`GITHUB_TOKEN` optional).
- **API-key providers (paid tiers / free tiers with signup)**: Tavily, Brave, Serper, Exa, Perplexity, Jina, Zhipu, DashScope (`enable_search` grounding — standard `sk-…` keys only; coding-plan `sk-sp-…` keys are refused up front with an actionable note), Kagi, SerpApi — plus Firecrawl on the fetch side. Any key set in `.env` **prepends** that provider to the chain; `UNOWN_WEB_SEARCH_PROVIDER` pins an explicit provider or comma-separated chain.

Full auto-selection order, per-provider quirks, and every env key: [usage](usage.md#session-tools) · [configuration](configuration.md). Live-verification receipts: [benchmarks/websearch-live/](../benchmarks/websearch-live/).

Full variable reference: [configuration](configuration.md).
