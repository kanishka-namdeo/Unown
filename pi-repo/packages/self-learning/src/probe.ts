/**
 * probe.ts — reachability probes for the model endpoint.
 *
 * Shared by `unown doctor` (diagnostics), `unown setup` (verification) and
 * the session pre-flight in `cli.ts`. Probes any OpenAI-compatible endpoint
 * with `GET {baseUrl}/models` and classifies the failure so callers can
 * print actionable messages instead of raw "Connection error." strings.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface EndpointProbe {
        ok: boolean;
        /** HTTP status when the server answered. */
        status?: number;
        /** Model ids when the endpoint answered with a list. */
        models?: string[];
        /** Failure class: "unreachable" (nothing answered) | "auth" (credentials rejected). */
        problem?: "unreachable" | "auth";
}

/** Probe an OpenAI-compatible endpoint via GET {baseUrl}/models. */
export async function probeOpenAiEndpoint(baseUrl: string, apiKey?: string, timeoutMs = 4000): Promise<EndpointProbe> {
        const url = `${baseUrl.replace(/\/+$/, "")}/models`;
        const headers: Record<string, string> = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        try {
                const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
                if (res.ok) {
                        const models: string[] = [];
                        try {
                                const body = (await res.json()) as { data?: Array<{ id?: string }> };
                                if (Array.isArray(body?.data)) {
                                        for (const m of body.data) if (typeof m?.id === "string") models.push(m.id);
                                }
                        } catch {
                                /* non-JSON body — still reachable */
                        }
                        return { ok: true, status: res.status, models };
                }
                if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, problem: "auth" };
                // Other statuses (404/405/…) mean the server IS reachable — some endpoints
                // do not implement /models. Treat as reachable without a model list.
                return { ok: true, status: res.status };
        } catch {
                return { ok: false, problem: "unreachable" };
        }
}

/** One provider entry from ~/.unown/agent/models.json, normalized. */
export interface AgentProviderConfig {
        id: string;
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
                                { baseUrl?: string; api?: string; apiKey?: string; models?: Array<{ id?: string }> }
                        >;
                };
                const providers: AgentProviderConfig[] = [];
                for (const [id, p] of Object.entries(raw.providers ?? {})) {
                        providers.push({
                                id,
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
