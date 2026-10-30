/**
 * probe.ts — reachability probes for the model endpoint.
 *
 * Shared by `unown doctor` (diagnostics), `unown setup` (verification) and
 * the session pre-flight in `cli.ts`. Probes a provider's model-listing
 * endpoint with the WIRE the provider actually speaks —
 *
 *   openai-completions : GET {baseUrl}/models with `Authorization: Bearer`
 *   anthropic-messages: GET {baseUrl}/models with `x-api-key` +
 *                        `anthropic-version` (Anthropic's own wire — a
 *                        Bearer probe here 401s against a perfectly good key)
 *
 * and classifies the failure so callers can print actionable messages
 * instead of raw "Connection error." strings:
 *
 *   "unreachable"  nothing answered (down, wrong URL, TLS)
 *   "auth"        the credential was rejected (401/403)
 *   "rate-limit"  the endpoint answered 429 — it is UP and throttling (the
 *                 key passed auth; 429s are issued post-auth); retry soon
 *
 * Every answered probe carries `ms` — the round-trip latency — so doctor and
 * `providers test` can show a live latency chip next to the verdict.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface EndpointProbe {
        ok: boolean;
        /** HTTP status when the server answered. */
        status?: number;
        /** Model ids when the endpoint answered with a list. */
        models?: string[];
        /** Raw catalog entries from GET /models (bounded to the first 256),
         *  when the endpoint answered with a list — the spec-detection cascade
         *  parses these instead of re-fetching (the model-specs round: the
         *  probe used to throw the truth away and keep only the ids). */
        modelEntries?: unknown[];
        /** Failure class: "unreachable" | "auth" (401/403) | "rate-limit" (429). */
        problem?: "unreachable" | "auth" | "rate-limit";
        /** Round-trip latency of the probe in ms (present whenever the server answered). */
        ms?: number;
}

export interface ProbeOptions {
        timeoutMs?: number;
        /** Provider wire (`api` from models.json / presets) — defaults to the OpenAI wire. */
        api?: string;
}

/** Probe a provider's model-listing endpoint over its own wire. */
export async function probeProviderEndpoint(
        baseUrl: string,
        apiKey?: string,
        opts: ProbeOptions = {},
): Promise<EndpointProbe> {
        // `(^|[^\/])\/+$/` = linear-time trailing-slash strip (ReDoS fix): the
        // old `/\/+$/` rescanned from every start position — quadratic on long
        // '/' runs. The mandatory non-slash prefix pins each run to one start.
        const base = baseUrl.replace(/(^|[^/])\/+$/, "$1");
        const anthropic = opts.api === "anthropic-messages";
        // Wire-truthful URL: the OpenAI wire's baseUrl already carries the
        // version segment (…/v1) and appends /models; the Anthropic SDK takes
        // the API ROOT (no /v1) and appends /v1/messages itself — the models
        // listing on that wire is {root}/v1/models.
        const url = anthropic ? `${base}/v1/models` : `${base}/models`;
        const headers: Record<string, string> = {};
        if (apiKey) {
                if (anthropic) {
                        headers["x-api-key"] = apiKey;
                        headers["anthropic-version"] = "2023-06-01";
                } else {
                        headers.Authorization = `Bearer ${apiKey}`;
                }
        }
        const started = Date.now();
        try {
                const res = await fetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 4000) });
                const ms = Date.now() - started;
                if (res.ok) {
                        const models: string[] = [];
                        let modelEntries: unknown[] | undefined;
                        try {
                                const body = (await res.json()) as { data?: Array<{ id?: string }> };
                                if (Array.isArray(body?.data)) {
                                        for (const m of body.data) if (typeof m?.id === "string") models.push(m.id);
                                        // Keep the raw entries (bounded — a 10k-model gateway must
                                        // not blow the probe's memory) for spec detection: the
                                        // context/max-output fields live HERE (vLLM max_model_len,
                                        // LM Studio loaded_context_length, DeepInfra metadata…).
                                        modelEntries = body.data.slice(0, 256);
                                }
                        } catch {
                                /* non-JSON body — still reachable */
                        }
                        return { ok: true, status: res.status, models, ...(modelEntries ? { modelEntries } : {}), ms };
                }
                if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, problem: "auth", ms };
                if (res.status === 429) return { ok: false, status: 429, problem: "rate-limit", ms };
                // Other statuses (404/405/…) mean the server IS reachable — some endpoints
                // do not implement /models. Treat as reachable without a model list.
                return { ok: true, status: res.status, ms };
        } catch {
                return { ok: false, problem: "unreachable" };
        }
}

/** Probe an OpenAI-compatible endpoint via GET {baseUrl}/models (compat wrapper). */
export function probeOpenAiEndpoint(baseUrl: string, apiKey?: string, timeoutMs = 4000): Promise<EndpointProbe> {
        return probeProviderEndpoint(baseUrl, apiKey, { timeoutMs });
}

/** The latency chip every probe verdict can append: " · 240 ms" ("" when unknown). */
export function probeLatencyNote(probe: { ms?: number } | undefined): string {
        return typeof probe?.ms === "number" && Number.isFinite(probe.ms)
                ? ` · ${Math.max(1, Math.round(probe.ms))} ms`
                : "";
}

/** The shared rate-limit sentence — the endpoint is up, the key passed auth,
 * only the throttle is in the way (Claude Code's "temporarily limiting
 * requests, not your usage limit" distinction). */
export function rateLimitNote(probe: { status?: number } | undefined): string {
        return `rate-limited (HTTP ${probe?.status ?? 429}) — the endpoint is up and throttling; retry in a moment`;
}

/** One provider entry from ~/.unown/agent/models.json, normalized. */
export interface AgentProviderConfig {
        id: string;
        /** Display name (models.json `name`), when the entry carries one. */
        name?: string;
        baseUrl?: string;
        api?: string;
        apiKey?: string;
        modelIds: string[];
}

export interface AgentModelsFile {
        providers: AgentProviderConfig[];
        /** Parse error message when models.json is invalid. */
        error?: string;
}

/** Read + normalize ~/.unown/agent/models.json (missing file → empty). */
export function readAgentModelsFile(agentDir: string): AgentModelsFile {
        const path = join(agentDir, "models.json");
        if (!existsSync(path)) return { providers: [] };
        try {
                const raw = JSON.parse(readFileSync(path, "utf8")) as {
                        providers?: Record<
                                string,
                                { name?: string; baseUrl?: string; api?: string; apiKey?: string; models?: Array<{ id?: string }> }
                        >;
                };
                const providers: AgentProviderConfig[] = [];
                for (const [id, p] of Object.entries(raw.providers ?? {})) {
                        providers.push({
                                id,
                                name: typeof p?.name === "string" ? p.name : undefined,
                                baseUrl: typeof p?.baseUrl === "string" ? p.baseUrl : undefined,
                                api: typeof p?.api === "string" ? p.api : undefined,
                                apiKey: typeof p?.apiKey === "string" ? p.apiKey : undefined,
                                modelIds: Array.isArray(p?.models) ? p.models.map((m) => String(m?.id)).filter(Boolean) : [],
                        });
                }
                return { providers };
        } catch (err: unknown) {
                return { providers: [], error: err instanceof Error ? err.message : String(err) };
        }
}

/**
 * The provider a fresh session would use: settings.json's defaultProvider
 * when it exists in models.json, else the first provider. Returns undefined
 * when nothing is configured.
 *
 * `pin` (M3) overrides the default when set — accepts either a bare provider
 * id ("agnes") or a canonical "provider/model" string (the --model flag
 * grammar); the model part is ignored here (model resolution happens in pi's
 * resolveCliModel). An unknown pin falls back to the registry default so a
 * typo degrades to today's behaviour instead of crashing pre-flight.
 */
export function resolveActiveProvider(agentDir: string, pin?: string): AgentProviderConfig | undefined {
        const file = readAgentModelsFile(agentDir);
        if (file.providers.length === 0) return undefined;
        let defaultProvider: string | undefined;
        try {
                const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as {
                        defaultProvider?: string;
                };
                if (typeof settings?.defaultProvider === "string") defaultProvider = settings.defaultProvider;
        } catch {
                /* no settings.json / invalid — fall through to first provider */
        }
        let active: AgentProviderConfig | undefined;
        if (pin) {
                // "provider/model" → take the provider prefix; a bare id is the pin itself.
                // A slash INSIDE a model id ("org/model-chat") is an OpenRouter-style id —
                // only the FIRST segment can name a configured provider; try progressively.
                const segments = pin.split("/");
                const candidates: string[] = [];
                for (let i = 0; i < segments.length - 1; i++) candidates.push(segments.slice(0, i + 1).join("/"));
                if (!candidates.length) candidates.push(pin);
                for (const candidate of candidates) {
                        const hit = file.providers.find((p) => p.id.toLowerCase() === candidate.toLowerCase());
                        if (hit) {
                                active = hit;
                                break;
                        }
                }
        }
        if (!active) active = file.providers.find((p) => p.id === defaultProvider);
        return active ?? file.providers[0];
}

/** True when the provider points at a local llm-bridge (loopback host). */
export function isLoopbackProvider(provider: AgentProviderConfig): boolean {
        if (!provider.baseUrl) return false;
        try {
                const host = new URL(provider.baseUrl).hostname;
                return host === "127.0.0.1" || host === "localhost" || host === "::1";
        } catch {
                return false;
        }
}
