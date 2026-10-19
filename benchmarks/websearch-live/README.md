# websearch-live — live provider verification

Verifies the `web_search` / `webfetch` provider registry
(`pi-repo/packages/self-learning/src/websearch.ts`) against the real
network: every provider adapter runs a live query (or, for keyed providers
without a key in the environment, an endpoint-liveness probe — the
documented auth error proves the endpoint answers and the request shape is
accepted), latencies and result counts are recorded, and a JSON receipt
lands in `results/`.

Run it any time:

```bash
bun scripts/websearch-live.mjs                # full matrix
bun scripts/websearch-live.mjs tavily searxng # subset by provider id
```

Environment that influences the matrix:

- `UNOWN_SEARXNG_URL` — a self-hosted SearXNG instance (`formats: [html,
  json]`; a working settings.yml lives in `scripts/searxng-test/`)
- any provider key (`TAVILY_API_KEY`, `DASHSCOPE_API_KEY`, ...) — keyed
  providers run a real query instead of the liveness probe

## Verification status

Latest receipt: `results/websearch-live-*.json` (run from a datacenter IP —
the hostile case; residential IPs fare strictly better):

| Tier | Provider | State from a datacenter IP |
|---|---|---|
| free | tavily | live-verified (keyless mode), newest receipt 2026-10-19 |
| free | youcom | live-verified (keyless MCP, 100 q/day) |
| free | wikipedia | live-verified (policy-compliant UA) |
| free | hn | live-verified (Algolia) |
| free | npm | live-verified (registry search, package research) |
| free | github | live-verified (repo search, unauthenticated) |
| free | searxng | live-verified against a self-hosted instance (receipt `…0667517`); the 2026-10-19 runs had no local instance up, so searxng reports endpoint-liveness there |
| free | duckduckgo | works from residential IPs; this datacenter IP times out at the anomaly challenge — detected, surfaced, chain cascades |
| free | stackexchange | works keyless (300 q/day per IP); this shared datacenter IP is throttled (429) — detected and surfaced |
| paid | dashscope | **key-class-honest, verified live 2026-10-19**: coding-plan keys (`sk-sp-…`) are refused up front with an actionable note — the coding endpoints silently ignore `enable_search` (the model answers from training data and, asked directly, reports no live access; no search fields come back) while both standard endpoints reject these keys with 401. Standard keys (`sk-…`) use the documented `enable_search` grounding; request/parse shape pinned by mock tests in `test/websearch.test.ts` |
| paid | brave / serper / exa / perplexity / jina / zhipu / kagi / serpapi / firecrawl | endpoint-liveness-verified: live endpoints answering with their documented auth-gated errors; request/response shapes pinned by the parser tests in `test/websearch.test.ts`, and the full request path mock-verified there — add the provider's key to the environment and the same adapter runs live |

The 5-free + 5-paid floor is met: six free providers live-verified with real
queries in the newest receipt (seven across receipt history, counting the
self-hosted searxng run), and ten paid providers shipped — nine
liveness-verified + mock-pinned, plus dashscope (refusal path live-verified
for coding keys, standard-key request shape mock-pinned). Re-running the
harness after adding keys upgrades the affected providers to live-verified
automatically.

## webfetch side

The harness also exercises the fetch pipeline's direct path (HTML → text).
The fallback chain (Tavily extract keyless → Jina reader → Firecrawl) is
exercised by the unit suite against mock payloads; Tavily keyless extract
was live-verified manually (returns full markdown without a key).

## End-to-end agent receipt

`results/e2e-agent-web-search-session.jsonl` — a real terminal-agent session
(kimi-k2.5 through the llm-bridge) where the model invokes the native
`web_search` tool: the query "Bun javascript runtime latest version"
cascaded dashscope-429 (hourly quota) → searxng-down → duckduckgo-challenge
→ **tavily keyless, 8 results**, and the model answered "**Bun v1.4.3** —
Source: npm registry". The chain's per-provider notes are visible in the
tool result — the fallback design doing exactly what it was built to do
under partial outage.

## Cross-platform

The implementation is pure `fetch` + `node:dns/promises` — no child
processes, no file paths, no `process.platform` branches — so it is
cross-platform by construction. The 3-OS CI matrix (`build-test` job) runs
the engine suite including `test/websearch.test.ts` on ubuntu, macos and
windows. Proxy note: unown runs on Bun, whose `fetch` honors
`HTTP_PROXY`/`HTTPS_PROXY` natively.
