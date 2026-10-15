# Providers & models

How unown talks to a model: the two connection shapes, the files involved, and how to point them at anything from Dashscope to a local llama.cpp server.

- [The two shapes](#the-two-shapes)
- [unown setup](#unown-setup)
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

Both write the same three files under `~/.unown/agent/`. You can switch shapes anytime by re-running `unown setup` (add `--force` in flag mode to overwrite an existing config).

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

Presets: `bridge` (bundled), `openai`, `openrouter`, `anthropic`, `dashscope`, `deepseek`, `custom`. Every direct setup verifies the endpoint is reachable and the key is accepted before declaring success — a rejected key fails setup with the HTTP status instead of failing your first chat later.

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

`GET localhost:3031/health` reports the live state — including whether the upstream key is set and whether the upstream answers — which `unown doctor` and `scripts/start.sh` surface as actionable warnings.

**The `BRIDGE_API_KEY` coupling:** if you set a shared secret on the bridge, every client must present it — including the terminal agent. `unown setup --provider bridge` picks it up from the environment; if you set it *after* configuring, re-run setup (or hand-edit the `apiKey` in `~/.unown/agent/models.json`).

## Switching models

- **Per session**: `/model` or Ctrl+L opens the picker; Ctrl+P cycles through enabled models; Shift+Tab cycles thinking levels; `/scoped-models` controls what Ctrl+P cycles through.
- **Persistently**: pick with Ctrl+S in the picker, or re-run `unown setup`.
- **Check what's live**: `unown models` lists your configured models plus what a local bridge actually serves (with an allow-list cross-check).

Full variable reference: [configuration](configuration.md).
