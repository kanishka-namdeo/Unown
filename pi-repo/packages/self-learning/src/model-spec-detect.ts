/**
 * model-spec-detect.ts — verifiable model-spec detection (the model-specs round).
 *
 * The detection cascade behind "automatically detect the model specs from
 * verifiable sources once a model has been configured; if we cannot find
 * them, ask the user before the model is usable":
 *
 *   1. the curated catalog   (model-specs.ts — vendor-published, exact ids)
 *   2. models.dev            (https://models.dev/api.json — the open registry
 *                             upstream pi's own generator builds from; disk
 *                             cache with a TTL, live fetch otherwise)
 *   3. LiteLLM's database    (model_prices_and_context_window.json — the
 *                             raw GitHub file Aider downloads; per-entry
 *                             `source` URLs are provenance)
 *   4. the endpoint's own    (GET {base}/models — the ONLY authoritative
 *      /models catalog        source for local servers: vLLM max_model_len,
 *                             llama.cpp meta.n_ctx, LM Studio
 *                             loaded_context_length, DeepInfra metadata…;
 *                             failures are cached so we never hammer)
 *   5. the user              (the gate — see setup.ts / cli.ts preflight)
 *
 * Design record: docs/model-spec-detection-research.md (the 11-product
 * survey — LiteLLM, Aider, OpenCode, Cline, Continue, Zed, Goose, Crush,
 * Codex — and the edge cases each decision answers).
 *
 * Vocabulary (the max_tokens collision, edge case 1): `contextWindow` is
 * the TOTAL context, `maxTokens` is the MAX OUTPUT — unown's existing
 * meaning, mapped explicitly per source. Everything is $ per 1M tokens
 * (pi's ModelCost vocabulary).
 *
 * Detachment rule (the presets.ts law): this module imports NOTHING beyond
 * node builtins + model-specs.ts (pure) — the CLI, the terminal half, the
 * engine runner and the tests all load it without dragging heavier graphs.
 * Network is always injected (`fetchImpl`) or bounded — never at import
 * time, never blocking startup (the opencode law).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { modelSpec, KNOWN_MODEL_SPECS } from "./model-specs.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pricing in pi's ModelCost vocabulary: USD per 1M tokens. */
export interface SpecCost {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
}

/** Where a spec (or a field of it) came from. */
export type SpecSource = "curated" | "models-dev" | "litellm" | "endpoint" | "user" | "learned";

/**
 * How the source's id was matched:
 *   exact      the id is verbatim in the source — strongest
 *   normalized the id matched after the normalization ladder (case-folded,
 *              dated/versioned suffix stripped, finetune prefix collapsed,
 *              last path segment)
 *   family     a family-prefix match (e.g. "gpt-4o-2026-05-16" → "gpt-4o")
 *              — the label that keeps a family match from masquerading as
 *              a verified exact spec
 */
export type SpecMatchQuality = "exact" | "normalized" | "family";

/** A detected (partial) spec — fields are filled by whichever source has them. */
export interface ModelSpecDetection {
        contextWindow?: number;
        maxTokens?: number;
        cost?: SpecCost;
        /** Input modalities — only ever UPGRADED to include "image"; never stripped. */
        input?: ("text" | "image")[];
        /** Reasoning capability, when a source positively reports it. */
        reasoning?: boolean;
        /** The source that provided `contextWindow` (the load-bearing number). */
        source: SpecSource;
        /** Verifiable URL for the source record (registry entry, docs page). */
        sourceUrl?: string;
        match: SpecMatchQuality;
        /** The id inside the source that matched (differs for family/normalized). */
        matchedId?: string;
        /** Every source that contributed a field, with the fields it provided. */
        contributors: Array<{ source: SpecSource; fields: string[]; match: SpecMatchQuality }>;
}

/** A recorded detection (the provenance sidecar's record shape). */
export interface ModelSpecRecord extends ModelSpecDetection {
        verifiedAt: number;
}

/** True when both load-bearing numbers are present. */
export function isCompleteSpec(spec: ModelSpecDetection | undefined | null): spec is ModelSpecDetection {
        return (
                typeof spec?.contextWindow === "number" &&
                typeof spec?.maxTokens === "number" &&
                spec.contextWindow > 0 &&
                spec.maxTokens > 0
        );
}

/** One tried source and how it ended — the "we tried X, Y, Z" receipt. */
export interface DetectAttempt {
        source: SpecSource;
        outcome: "hit" | "miss" | "partial" | "unreachable" | "skipped";
        note?: string;
}

export interface DetectResult {
        spec?: ModelSpecDetection;
        attempts: DetectAttempt[];
}

export interface DetectSpecOptions {
        providerId: string;
        /** Endpoint base URL — enables the endpoint lane when present. */
        baseUrl?: string;
        apiKey?: string;
        /** Provider wire ("openai-completions" | "anthropic-messages"). */
        api?: string;
        /** Per-source timeout, default 4000 ms. */
        timeoutMs?: number;
        /** Skip all network: cache + curated only (offline / air-gapped). */
        offline?: boolean;
        /** Test clock (epoch ms). */
        now?: number;
        /** Env override source (defaults to process.env). */
        env?: NodeJS.ProcessEnv;
        /** Injected fetch (tests). Defaults to global fetch. */
        fetchImpl?: typeof fetch;
        /** Where the sidecar + cache live (defaults resolved by the caller). */
        agentDir?: string;
        /** A GET {base}/models body the CALLER already fetched (probe.ts's
         *  EndpointProbe.modelEntries round-trips here). When present the
         *  endpoint lane parses it instead of re-fetching — one request per
         *  configuration, not two. */
        endpointCatalog?: { data?: unknown[] } & Record<string, unknown>;
        /** Stop the cascade as soon as both load-bearing numbers are filled
         *  (session-preflight mode: enrichment from the other registries can
         *  wait — a snappy startup beats a fuller record on the hot path). */
        stopWhenComplete?: boolean;
}

// ---------------------------------------------------------------------------
// Sanity bounds (shared by every source)
// ---------------------------------------------------------------------------

export const SPEC_CONTEXT_MIN = 1024;
export const SPEC_CONTEXT_MAX = 100_000_000;
/** Pricing sanity ceiling ($/1M) — a guard against unit mistakes, not a claim. */
export const SPEC_PRICE_MAX = 10_000;

export interface SanitizedNumbers {
        contextWindow?: number;
        maxTokens?: number;
        /** Fields that were adjusted (recorded, never silent). */
        clamped: string[];
        /** Fields rejected as garbage (treated as absent). */
        rejected: string[];
}

/**
 * Validate/normalize the two limit numbers. Out-of-range values are
 * rejected (a source claiming a 10-token context is garbage); maxTokens
 * above the context window is CLAMPED (LM Studio catalogs can advertise a
 * bigger output budget than the loaded context — the goose/edge-3 class).
 */
export function sanitizeSpecNumbers(contextWindow?: number, maxTokens?: number): SanitizedNumbers {
        const out: SanitizedNumbers = { clamped: [], rejected: [] };
        const isInt = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && Number.isInteger(n);
        if (contextWindow !== undefined) {
                if (isInt(contextWindow) && contextWindow >= SPEC_CONTEXT_MIN && contextWindow <= SPEC_CONTEXT_MAX)
                        out.contextWindow = contextWindow;
                else out.rejected.push("contextWindow");
        }
        if (maxTokens !== undefined) {
                if (isInt(maxTokens)) {
                        if (out.contextWindow !== undefined && maxTokens > out.contextWindow) {
                                out.maxTokens = out.contextWindow;
                                out.clamped.push("maxTokens>contextWindow");
                        } else if (maxTokens >= 1 && maxTokens <= SPEC_CONTEXT_MAX) out.maxTokens = maxTokens;
                        else out.rejected.push("maxTokens");
                } else out.rejected.push("maxTokens");
        }
        return out;
}

function sanitizeCost(cost: SpecCost | undefined): SpecCost | undefined {
        if (!cost) return undefined;
        const ok = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < SPEC_PRICE_MAX;
        if (!ok(cost.input) || !ok(cost.output)) return undefined;
        const out: SpecCost = { input: cost.input, output: cost.output };
        if (ok(cost.cacheRead)) out.cacheRead = cost.cacheRead;
        if (ok(cost.cacheWrite)) out.cacheWrite = cost.cacheWrite;
        return out;
}

// ---------------------------------------------------------------------------
// The id normalization ladder (edge cases 2 & 5)
// ---------------------------------------------------------------------------

/**
 * Ordered candidate forms for registry matching, strongest first:
 * the id verbatim → lowercased → dated suffix stripped (`-YYYY-MM-DD`) →
 * versioned suffix stripped (`-v2`) → finetune prefix collapsed
 * (`ft:base:org:x:id` → `ft:base`) → last `/` or `:` segment. Duplicates
 * removed; the ORIGINAL id is always first so exact wins.
 */
export function specIdCandidates(id: string): string[] {
        const out: string[] = [id];
        const push = (s: string) => {
                if (s && s.length >= 2 && !out.includes(s)) out.push(s);
        };
        const lower = id.toLowerCase();
        push(lower);
        // dated snapshots: gpt-4o-2026-05-16 → gpt-4o
        const undated = lower.replace(/-\d{4}-\d{2}-\d{2}$/, "");
        push(undated);
        // versioned: gemini-2.5-pro-v2 → gemini-2.5-pro (bounded to one strip)
        push(undated.replace(/-v\d+$/, ""));
        // OpenAI finetunes: ft:gpt-4o:org:suffix:id → ft:gpt-4o (and bare base)
        const ftMatch = undated.match(/^ft:([^:]+)(?::|$)/);
        if (ftMatch) {
                push(`ft:${ftMatch[1]}`);
                push(ftMatch[1]);
        }
        // last path segment: openai/gpt-4o → gpt-4o ; provider:model → model
        if (/[/:]/.test(undated)) {
                const seg = undated.split(/[/:]/).filter(Boolean).pop();
                if (seg) push(seg);
        }
        return out;
}

/**
 * Family-prefix match over a list of registry ids: the LONGEST id that is a
 * prefix of the query (at a token boundary — "gpt-4o" matches "gpt-4o-mini"
 * but "gpt-4" does not match "gpt-4o") wins. Returns the matched id.
 */
export function familyMatch(query: string, ids: Iterable<string>): string | undefined {
        const q = query.toLowerCase();
        let best: string | undefined;
        let bestLen = 0;
        for (const id of ids) {
                const lid = id.toLowerCase();
                if (lid.length < 2 || lid.length >= q.length) continue;
                if (q.startsWith(lid) && (q[lid.length] === "-" || q[lid.length] === "/" || q[lid.length] === ":")) {
                        if (lid.length > bestLen) {
                                best = id;
                                bestLen = lid.length;
                        }
                }
        }
        return best;
}

// ---------------------------------------------------------------------------
// Source parsers (pure — every one unit-tested against real fixture shapes)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function num(v: unknown): number | undefined {
        return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
        return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** models.dev model entry (https://models.dev/api.json → providers.{p}.models.{m}). */
export interface ModelsDevEntry {
        limit?: { context?: number; input?: number; output?: number };
        cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
        modalities?: { input?: string[]; output?: string[] };
        reasoning?: boolean;
        status?: string;
}

/** Parse a models.dev entry into spec fields ($/M pricing, image modality). */
export function parseModelsDevEntry(entry: ModelsDevEntry | undefined): Partial<ModelSpecDetection> {
        if (!entry) return {};
        const context = num(entry.limit?.context) ?? num(entry.limit?.input);
        const output = num(entry.limit?.output);
        const costIn = num(entry.cost?.input);
        const costOut = num(entry.cost?.output);
        const modalities = entry.modalities?.input;
        const image = Array.isArray(modalities) && modalities.includes("image");
        return {
                ...(context !== undefined ? { contextWindow: context } : {}),
                ...(output !== undefined ? { maxTokens: output } : {}),
                ...(costIn !== undefined && costOut !== undefined
                        ? { cost: sanitizeCost({ input: costIn, output: costOut, cacheRead: num(entry.cost?.cache_read), cacheWrite: num(entry.cost?.cache_write) }) }
                        : {}),
                ...(image ? { input: ["text", "image"] as ("text" | "image")[] } : {}),
                ...(entry.reasoning === true ? { reasoning: true } : {}),
        };
}

/** LiteLLM DB entry (model_prices_and_context_window.json values). */
export interface LiteLLMEntry {
        max_input_tokens?: number;
        max_output_tokens?: number;
        input_cost_per_token?: number;
        output_cost_per_token?: number;
        cache_read_input_token_cost?: number;
        cache_creation_input_token_cost?: number;
        supports_vision?: boolean;
        supports_reasoning?: boolean;
        source?: string;
        mode?: string;
        litellm_provider?: string;
}

/**
 * Parse a LiteLLM entry. `max_input_tokens` is the context window (LiteLLM's
 * own semantics — gpt-4o: max_input 128000, context 128000); the legacy
 * `max_tokens` field was the FULL context window and is gone from the DB.
 * Pricing arrives per-token → converted to $/1M. The entry's own `source`
 * URL is carried as provenance.
 */
export function parseLiteLLMEntry(entry: LiteLLMEntry | undefined): Partial<ModelSpecDetection> {
        if (!entry) return {};
        const context = num(entry.max_input_tokens);
        const output = num(entry.max_output_tokens);
        const costIn = num(entry.input_cost_per_token);
        const costOut = num(entry.output_cost_per_token);
        return {
                ...(context !== undefined ? { contextWindow: context } : {}),
                ...(output !== undefined ? { maxTokens: output } : {}),
                ...(costIn !== undefined && costOut !== undefined && costIn > 0
                        ? {
                                        cost: sanitizeCost({
                                                input: costIn * 1e6,
                                                output: costOut * 1e6,
                                                cacheRead: entry.cache_read_input_token_cost !== undefined ? entry.cache_read_input_token_cost * 1e6 : undefined,
                                                cacheWrite: entry.cache_creation_input_token_cost !== undefined ? entry.cache_creation_input_token_cost * 1e6 : undefined,
                                        }),
                                }
                        : {}),
                ...(entry.supports_vision === true ? { input: ["text", "image"] as ("text" | "image")[] } : {}),
                ...(entry.supports_reasoning === true ? { reasoning: true } : {}),
        };
}

/**
 * Parse spec fields from an OpenAI-compatible `GET /v1/models` entry (edge
 * case 3 & 4): the field zoo local servers and enriched gateways actually
 * ship, with RUNTIME fields preferred over catalog fields —
 *
 *   context:   loaded_context_length (LM Studio runtime) · max_model_len
 *              (vLLM — exact for the served config) · meta.n_ctx (llama.cpp)
 *              · max_context_length (LM Studio catalog) ·
 *              metadata.context_length (DeepInfra) · context_length ·
 *              context_window · max_input_tokens
 *   output:    top_provider.max_completion_tokens (OpenRouter) ·
 *              metadata.max_tokens (DeepInfra) · max_completion_tokens ·
 *              max_output_tokens · max_tokens (output semantics in /models
 *              entries — LM Studio & DeepInfra both mean output)
 *   vision:    capabilities includes "vision" (LM Studio) ·
 *              architecture.input_modalities includes "image" (OpenRouter)
 *
 * A top-level `max_model_len` (vLLM ships it on the envelope) is the
 * fallback when the entry itself carries nothing.
 */
export function parseEndpointCatalogEntry(entry: Json | undefined, envelope?: Json): Partial<ModelSpecDetection> {
        if (!entry || typeof entry !== "object") return {};
        const meta = (entry.meta ?? undefined) as Json | undefined;
        const metadata = (entry.metadata ?? undefined) as Json | undefined;
        const topProvider = (entry.top_provider ?? undefined) as Json | undefined;
        const contextCandidates = [
                num(metadata?.loaded_context_length),
                num(entry.loaded_context_length),
                num(entry.max_model_len),
                num(meta?.n_ctx),
                num(metadata?.max_model_len),
                num(entry.max_context_length),
                num(metadata?.context_length),
                num(entry.context_length),
                num(entry.context_window),
                num(metadata?.max_input_tokens),
                num(entry.max_input_tokens),
                num(envelope?.max_model_len),
        ];
        const outputCandidates = [
                num(topProvider?.max_completion_tokens),
                num(metadata?.max_tokens),
                num(entry.max_completion_tokens),
                num(entry.max_output_tokens),
                num(metadata?.max_output_tokens),
                num(entry.max_tokens),
        ];
        const contextWindow = contextCandidates.find((n) => n !== undefined);
        const maxTokens = outputCandidates.find((n) => n !== undefined);
        const caps = entry.capabilities;
        const arch = (entry.architecture ?? undefined) as Json | undefined;
        const inputModalities = (arch?.input_modalities ?? undefined) as string[] | undefined;
        const vision =
                (Array.isArray(caps) && caps.includes("vision")) ||
                (Array.isArray(inputModalities) && inputModalities.includes("image"));
        return {
                ...(contextWindow !== undefined ? { contextWindow } : {}),
                ...(maxTokens !== undefined ? { maxTokens } : {}),
                ...(vision ? { input: ["text", "image"] as ("text" | "image")[] } : {}),
        };
}

// ---------------------------------------------------------------------------
// Registry index (the trimmed disk cache)
// ---------------------------------------------------------------------------

/** One trimmed registry entry — everything the matchers need, nothing else. */
export interface RegistryEntry {
        /** The provider segment for models.dev ("openai"), or litellm_provider. */
        provider?: string;
        spec: Partial<ModelSpecDetection>;
        /** models.dev status ("deprecated"…) — skip deprecated models. */
        status?: string;
        /** The vendor's own doc URL when the registry carries one (LiteLLM `source`). */
        sourceUrl?: string;
}

export interface RegistryCacheEntry {
        fetchedAt: number;
        entries: Record<string, RegistryEntry>;
}

export interface RegistryCacheFile {
        version: 1;
        "models-dev"?: RegistryCacheEntry;
        litellm?: RegistryCacheEntry;
        /** Endpoint-probe failures (goose's rule: cache the miss, don't hammer). */
        probeFailures?: Record<string, { at: number; problem: string }>;
}

export const REGISTRY_CACHE_TTL_MS_DEFAULT = 24 * 60 * 60 * 1000; // aider's 24h

export function registryCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
        const raw = Number(env.UNOWN_SPEC_CACHE_TTL_MIN);
        if (Number.isFinite(raw) && raw >= 0) return raw * 60 * 1000;
        return REGISTRY_CACHE_TTL_MS_DEFAULT;
}

const CACHE_FILENAME = "model-spec-cache.json";
const SIDECAR_FILENAME = "model-specs.json";

export function readRegistryCache(agentDir: string): RegistryCacheFile {
        try {
                const raw = JSON.parse(readFileSync(join(agentDir, CACHE_FILENAME), "utf8")) as RegistryCacheFile;
                if (raw && typeof raw === "object" && raw.version === 1) return raw;
        } catch {
                /* missing/corrupt — start fresh */
        }
        return { version: 1 };
}

export function writeRegistryCache(agentDir: string, cache: RegistryCacheFile): void {
        try {
                mkdirSync(agentDir, { recursive: true });
                writeFileSync(join(agentDir, CACHE_FILENAME), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
        } catch {
                /* a read-only or contested agent dir degrades to no cache — never fatal */
        }
}

/**
 * Index the models.dev api.json payload into the trimmed cache form.
 * Keys are the provider-scoped ids (`<providerId>/<modelId>`) AND the bare
 * model ids (cross-provider reach — unown's provider ids are user-chosen).
 */
export function indexModelsDev(api: unknown): Record<string, RegistryEntry> {
        const out: Record<string, RegistryEntry> = {};
        if (!api || typeof api !== "object") return out;
        for (const [providerId, p] of Object.entries(api as Record<string, Json>)) {
                const models = (p?.models ?? undefined) as Record<string, ModelsDevEntry> | undefined;
                if (!models || typeof models !== "object") continue;
                for (const [modelId, entry] of Object.entries(models)) {
                        const spec = parseModelsDevEntry(entry);
                        if (spec.contextWindow === undefined && spec.maxTokens === undefined && spec.cost === undefined) continue;
                        const reg: RegistryEntry = {
                                provider: providerId,
                                spec,
                                ...(typeof entry?.status === "string" ? { status: entry.status } : {}),
                        };
                        out[`${providerId}/${modelId}`] = reg;
                        // Bare id: first provider wins (models.dev lists each model
                        // under every provider serving it; identical specs mostly).
                        if (!(modelId in out)) out[modelId] = reg;
                }
        }
        return out;
}

/**
 * Index the LiteLLM DB payload. Keys are the DB keys verbatim; entries with
 * `mode` not in the chat family are skipped (embedding/tts/rerank rows).
 */
export function indexLiteLLM(db: unknown): Record<string, RegistryEntry> {
        const out: Record<string, RegistryEntry> = {};
        if (!db || typeof db !== "object") return out;
        for (const [key, entry] of Object.entries(db as Record<string, LiteLLMEntry & Json>)) {
                if (key.startsWith("message")) continue; // the two meta rows in the file
                const mode = str(entry?.mode);
                if (mode && !/chat|completion/.test(mode)) continue;
                const spec = parseLiteLLMEntry(entry);
                if (spec.contextWindow === undefined && spec.maxTokens === undefined && spec.cost === undefined) continue;
                out[key] = {
                        ...(str(entry?.litellm_provider) ? { provider: entry.litellm_provider as string } : {}),
                        spec,
                        ...(str(entry?.source) ? { sourceUrl: entry.source as string } : {}),
                };
        }
        return out;
}

// ---------------------------------------------------------------------------
// Registry matching (exact → normalized → family, per provider-scope first)
// ---------------------------------------------------------------------------

export interface RegistryMatch {
        entry: RegistryEntry;
        matchedId: string;
        match: SpecMatchQuality;
}

/**
 * Match a model id against a registry index: provider-scoped exact → bare
 * exact → normalized ladder → family prefix. Deprecated entries
 * (`status: "deprecated"`) are skipped.
 */
export function matchRegistry(id: string, index: Record<string, RegistryEntry>, providerId?: string): RegistryMatch | undefined {
        const candidates = specIdCandidates(id);
        const alive = (e: RegistryEntry | undefined) => (e && e.status !== "deprecated" ? e : undefined);
        // 1. exact — provider-scoped first, then bare (a duplicate provider
        //    name in the id, edge case 5, still resolves via the scoped form).
        if (providerId) {
                for (const c of candidates) {
                        const e = alive(index[`${providerId}/${c}`]);
                        if (e) return { entry: e, matchedId: `${providerId}/${c}`, match: "exact" };
                }
        }
        for (const c of candidates) {
                const e = alive(index[c]);
                if (e) return { entry: e, matchedId: c, match: c === id ? "exact" : "normalized" };
        }
        // 2. family prefix (longest wins) — labeled, never masquerading as exact.
        const familyId = familyMatch(candidates[candidates.length - 1] ?? id, Object.keys(index));
        if (familyId) {
                const e = alive(index[familyId]);
                if (e) return { entry: e, matchedId: familyId, match: "family" };
        }
        return undefined;
}

// ---------------------------------------------------------------------------
// Field-wise merge (first verifiable hit per field, priority = cascade order)
// ---------------------------------------------------------------------------

const SPEC_FIELDS = ["contextWindow", "maxTokens", "cost", "input", "reasoning"] as const;

export function mergeSpecParts(parts: Array<{ source: SpecSource; part: Partial<ModelSpecDetection>; match: SpecMatchQuality; sourceUrl?: string }>): ModelSpecDetection | undefined {
        const merged: ModelSpecDetection = { source: "curated", match: "exact", contributors: [] };
        let have = false;
        for (const { source, part, match, sourceUrl } of parts) {
                const fields: string[] = [];
                for (const f of SPEC_FIELDS) {
                        if (part[f] !== undefined && merged[f] === undefined) {
                                (merged as unknown as Json)[f] = part[f];
                                fields.push(f);
                        }
                }
                if (fields.length > 0) {
                        have = true;
                        merged.contributors.push({ source, fields: [...fields], match });
                        // The contextWindow's source is the record's source.
                        if (fields.includes("contextWindow")) {
                                merged.source = source;
                                merged.match = match;
                                if (sourceUrl) merged.sourceUrl = sourceUrl;
                        }
                }
        }
        if (!have) return undefined;
        // Sanity pass on the merged numbers (clamp maxTokens, reject garbage).
        const sane = sanitizeSpecNumbers(merged.contextWindow, merged.maxTokens);
        if (sane.contextWindow !== undefined) merged.contextWindow = sane.contextWindow;
        else delete merged.contextWindow;
        if (sane.maxTokens !== undefined) merged.maxTokens = sane.maxTokens;
        else delete merged.maxTokens;
        merged.cost = sanitizeCost(merged.cost);
        if (!merged.cost) delete merged.cost;
        return merged;
}

// ---------------------------------------------------------------------------
// The orchestrator — the cascade
// ---------------------------------------------------------------------------

export const MODELS_DEV_URL_DEFAULT = "https://models.dev/api.json";
export const LITELLM_URL_DEFAULT =
        "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export function modelsDevUrl(env: NodeJS.ProcessEnv = process.env): string {
        return env.UNOWN_SPEC_MODELSDEV_URL || MODELS_DEV_URL_DEFAULT;
}
export function litellmUrl(env: NodeJS.ProcessEnv = process.env): string {
        return env.UNOWN_SPEC_LITELLM_URL || LITELLM_URL_DEFAULT;
}

async function fetchJson(url: string, opts: { timeoutMs: number; fetchImpl: typeof fetch }): Promise<Json | undefined> {
        try {
                const res = await opts.fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs) });
                if (!res.ok) return undefined;
                return (await res.json()) as Json;
        } catch {
                return undefined;
        }
}

async function registryPart(
        kind: "models-dev" | "litellm",
        modelId: string,
        opts: Required<Pick<DetectSpecOptions, "providerId">> & DetectSpecOptions,
        cache: RegistryCacheFile,
): Promise<{ part?: Partial<ModelSpecDetection>; match?: SpecMatchQuality; matchedId?: string; sourceUrl?: string; outcome: DetectAttempt["outcome"]; note?: string }> {
        const now = opts.now ?? Date.now();
        const ttl = registryCacheTtlMs(opts.env ?? process.env);
        let entry = cache[kind];
        let note: string | undefined;
        const fresh = entry && now - entry.fetchedAt < ttl && Object.keys(entry.entries ?? {}).length > 0;
        if (!fresh && !opts.offline) {
                const url = kind === "models-dev" ? modelsDevUrl(opts.env ?? process.env) : litellmUrl(opts.env ?? process.env);
                const payload = await fetchJson(url, { timeoutMs: opts.timeoutMs ?? 4000, fetchImpl: opts.fetchImpl ?? fetch });
                if (payload) {
                        entry = { fetchedAt: now, entries: kind === "models-dev" ? indexModelsDev(payload) : indexLiteLLM(payload) };
                        cache[kind] = entry;
                } else if (entry) {
                        // stale-while-error: a fetch failure falls back to the stale
                        // cache rather than a hard miss (the webcache pattern).
                        note = `${kind} unreachable — matched from the stale cache`;
                } else {
                        return { outcome: "unreachable", note: `${kind} unreachable` };
                }
        } else if (!entry && opts.offline) {
                return { outcome: "skipped", note: "offline — no cache" };
        }
        const m = entry ? matchRegistry(modelId, entry.entries, opts.providerId) : undefined;
        if (!m) return { outcome: "miss", note };
        const sourceUrl = kind === "models-dev" ? "https://models.dev" : m.entry.sourceUrl;
        return {
                part: m.entry.spec,
                match: m.match,
                matchedId: m.matchedId,
                ...(sourceUrl ? { sourceUrl } : {}),
                outcome: "hit",
                note,
        };
}

/**
 * The endpoint lane: `GET {base}/models` on the provider's own wire, parsed
 * for spec fields (probe.ts's EndpointProbe already fetches this — detection
 * reuses the same shape). Failure caching: a provider that 404s/401s the
 * catalog is remembered for the TTL window so bulk refreshes never hammer.
 */
async function endpointPart(
        modelId: string,
        opts: Required<Pick<DetectSpecOptions, "providerId">> & DetectSpecOptions,
        cache: RegistryCacheFile,
): Promise<{ part?: Partial<ModelSpecDetection>; outcome: DetectAttempt["outcome"]; note?: string }> {
        // The caller's own catalog (probe.ts already fetched it): parse, never
        // re-fetch, never failure-cache — the data is in hand and fresh.
        if (opts.endpointCatalog) {
                const data = Array.isArray(opts.endpointCatalog.data) ? (opts.endpointCatalog.data as Json[]) : [];
                const candidates = specIdCandidates(modelId);
                let entry: Json | undefined;
                for (const c of candidates) entry ??= data.find((m) => typeof m?.id === "string" && m.id === c);
                if (!entry && data.length === 1) entry = data[0];
                const part = parseEndpointCatalogEntry(entry, opts.endpointCatalog as Json);
                if (part.contextWindow === undefined && part.maxTokens === undefined)
                        return { outcome: "miss", note: "catalog carries no specs" };
                return { part, outcome: "hit", note: "the caller's own /models fetch" };
        }
        if (!opts.baseUrl) return { outcome: "skipped", note: "no endpoint" };
        const now = opts.now ?? Date.now();
        const ttl = registryCacheTtlMs(opts.env ?? process.env);
        const failure = cache.probeFailures?.[opts.providerId];
        if (failure && now - failure.at < ttl) {
                return { outcome: "skipped", note: `endpoint catalog failed recently (${failure.problem})` };
        }
        const base = opts.baseUrl.replace(/(^|[^/])\/+$/, "$1");
        const anthropic = opts.api === "anthropic-messages";
        const url = anthropic ? `${base}/v1/models` : `${base}/models`;
        const headers: Record<string, string> = {};
        if (opts.apiKey) {
                if (anthropic) {
                        headers["x-api-key"] = opts.apiKey;
                        headers["anthropic-version"] = "2023-06-01";
                } else headers.Authorization = `Bearer ${opts.apiKey}`;
        }
        try {
                const res = await (opts.fetchImpl ?? fetch)(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 4000) });
                if (res.status === 404 || res.status === 405) {
                        cache.probeFailures = { ...(cache.probeFailures ?? {}), [opts.providerId]: { at: now, problem: `HTTP ${res.status}` } };
                        return { outcome: "skipped", note: "endpoint has no /models" };
                }
                if (res.status === 401 || res.status === 403) {
                        cache.probeFailures = { ...(cache.probeFailures ?? {}), [opts.providerId]: { at: now, problem: `auth HTTP ${res.status}` } };
                        return { outcome: "skipped", note: "endpoint catalog refused the key" };
                }
                if (!res.ok) return { outcome: "unreachable", note: `HTTP ${res.status}` };
                const body = (await res.json()) as Json;
                const envelope = body;
                const data = Array.isArray(body?.data) ? (body.data as Json[]) : [];
                // Exact/normalized entry match, then the single-entry server
                // (llama.cpp serving one model with no id match).
                const candidates = specIdCandidates(modelId);
                let entry: Json | undefined;
                for (const c of candidates) entry ??= data.find((m) => typeof m?.id === "string" && m.id === c);
                if (!entry && data.length === 1) entry = data[0];
                const part = parseEndpointCatalogEntry(entry, envelope);
                if (part.contextWindow === undefined && part.maxTokens === undefined) return { outcome: "miss", note: "catalog carries no specs" };
                return { part, outcome: "hit" };
        } catch {
                return { outcome: "unreachable", note: "endpoint unreachable" };
        }
}

/**
 * Run the full cascade for one model id. Network is bounded per source and
 * failures degrade to misses — detection NEVER throws.
 */
export async function detectModelSpec(modelId: string, opts: DetectSpecOptions): Promise<DetectResult> {
        const attempts: DetectAttempt[] = [];
        // Parts are merged in this order — first source per field wins:
        //   endpoint (deployment-specific truth: this server's max_model_len /
        //   n_ctx / loaded_context_length is what THIS deployment serves) →
        //   curated (vendor-published) → models.dev → LiteLLM.
        const parts: Array<{ source: SpecSource; part: Partial<ModelSpecDetection>; match: SpecMatchQuality; sourceUrl?: string }> = [];
        const agentDir = opts.agentDir;
        const cache = agentDir ? readRegistryCache(agentDir) : { version: 1 as const };
        const cacheBefore = JSON.stringify(cache);
        // 1. the endpoint's own catalog (the only authoritative source for
        //    local/self-hosted servers; skips without a baseUrl).
        const stopWhenComplete = opts.stopWhenComplete === true;
        const complete = () => {
                for (const p of parts) if (p.part.contextWindow !== undefined && p.part.maxTokens !== undefined) return true;
                return false;
        };
        const endpoint = await endpointPart(modelId, opts, cache);
        attempts.push({ source: "endpoint", outcome: endpoint.outcome, ...(endpoint.note ? { note: endpoint.note } : {}) });
        if (endpoint.part) parts.push({ source: "endpoint", part: endpoint.part, match: "exact" });
        // 2. the curated catalog — vendor-published, exact ids only.
        if (KNOWN_MODEL_SPECS[modelId]) {
                const spec = modelSpec(modelId);
                parts.push({ source: "curated", part: spec, match: "exact" });
                attempts.push({ source: "curated", outcome: "hit" });
        } else attempts.push({ source: "curated", outcome: "miss" });
        // 3 & 4. the registries (they can still enrich cost/modalities when a
        // higher-priority source already filled the limits). In
        // stopWhenComplete mode (the session-preflight hot path) they are
        // skipped once the load-bearing pair is filled — a cold-cache registry
        // fetch must never add seconds to every session start.
        if (stopWhenComplete && complete()) {
                attempts.push({ source: "models-dev", outcome: "skipped", note: "limits already verified" });
                attempts.push({ source: "litellm", outcome: "skipped", note: "limits already verified" });
        } else {
                const dev = await registryPart("models-dev", modelId, opts, cache);
                attempts.push({ source: "models-dev", outcome: dev.outcome, ...(dev.note ? { note: dev.note } : {}) });
                if (dev.part)
                        parts.push({
                                source: "models-dev",
                                part: dev.part,
                                match: dev.match ?? "exact",
                                ...(dev.sourceUrl ? { sourceUrl: dev.sourceUrl } : {}),
                        });
                const litellm = await registryPart("litellm", modelId, opts, cache);
                attempts.push({ source: "litellm", outcome: litellm.outcome, ...(litellm.note ? { note: litellm.note } : {}) });
                if (litellm.part)
                        parts.push({
                                source: "litellm",
                                part: litellm.part,
                                match: litellm.match ?? "exact",
                                ...(litellm.sourceUrl ? { sourceUrl: litellm.sourceUrl } : {}),
                        });
        }

        if (agentDir && JSON.stringify(cache) !== cacheBefore) writeRegistryCache(agentDir, cache);

        const spec = mergeSpecParts(parts);
        return { spec, attempts };
}

// ---------------------------------------------------------------------------
// The provenance sidecar (~/.unown/agent/model-specs.json)
// ---------------------------------------------------------------------------

export interface SpecSidecar {
        version: 1;
        specs: Record<string, ModelSpecRecord>;
}

export function readSpecSidecar(agentDir: string): SpecSidecar {
        try {
                const raw = JSON.parse(readFileSync(join(agentDir, SIDECAR_FILENAME), "utf8")) as SpecSidecar;
                if (raw && typeof raw === "object" && raw.version === 1 && raw.specs && typeof raw.specs === "object")
                        return raw;
        } catch {
                /* missing/corrupt — empty */
        }
        return { version: 1, specs: {} };
}

export function specSidecarKey(providerId: string, modelId: string): string {
        return `${providerId}/${modelId}`;
}

/** Record a detection (or a user-entered/learned spec) in the sidecar. */
export function recordSpec(agentDir: string, providerId: string, modelId: string, spec: ModelSpecDetection, now = Date.now()): void {
        try {
                mkdirSync(agentDir, { recursive: true });
                const sidecar = readSpecSidecar(agentDir);
                const record: ModelSpecRecord = { ...spec, contributors: spec.contributors ?? [], verifiedAt: now };
                sidecar.specs[specSidecarKey(providerId, modelId)] = record;
                writeFileSync(join(agentDir, SIDECAR_FILENAME), `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
        } catch {
                /* a read-only agent dir degrades to no provenance — never fatal */
        }
}

export function getRecordedSpec(agentDir: string, providerId: string, modelId: string): ModelSpecRecord | undefined {
        return readSpecSidecar(agentDir).specs[specSidecarKey(providerId, modelId)];
}

/**
 * A user-entered spec (the gate's answer) — recorded with full provenance
 * so `unown models` and doctor can always say where a number came from.
 */
export function userSpec(contextWindow: number, maxTokens: number): ModelSpecDetection {
        return { contextWindow, maxTokens, source: "user", match: "exact", contributors: [{ source: "user", fields: ["contextWindow", "maxTokens"], match: "exact" }] };
}

// ---------------------------------------------------------------------------
// Display helpers (shared by setup summary, `unown models`, doctor)
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<SpecSource, string> = {
        curated: "curated catalog (vendor-published)",
        "models-dev": "models.dev",
        litellm: "LiteLLM model database",
        endpoint: "the endpoint's own /models",
        user: "you entered it",
        learned: "learned from an upstream error",
};

export function specSourceLabel(source: SpecSource): string {
        return SOURCE_LABELS[source];
}

/** "524,288 ctx / 65,536 out · text+image · $0.11 in / $0.60 out per 1M · models.dev (exact)" */
export function formatSpecLine(spec: ModelSpecDetection | ModelSpecRecord): string {
        const ctx = spec.contextWindow !== undefined ? spec.contextWindow.toLocaleString("en-US") : "?";
        const out = spec.maxTokens !== undefined ? spec.maxTokens.toLocaleString("en-US") : "?";
        const bits = [`${ctx} ctx / ${out} out`];
        if (spec.input?.includes("image")) bits.push("text+image");
        if (spec.cost) {
                const c = spec.cost;
                bits.push(`$${trimNum(c.input)} in / $${trimNum(c.output)} out per 1M`);
        }
        bits.push(`${specSourceLabel(spec.source)}${spec.match === "exact" ? "" : ` (${spec.match} match)`}`);
        return bits.join(" · ");
}

/** "524,288 ctx / 65,536 out (curated catalog)" — the compact chip for
 *  `unown models` and doctor's per-model lines (one line, no pricing). */
export function formatSpecShort(spec: ModelSpecDetection | ModelSpecRecord): string {
        const ctx = spec.contextWindow !== undefined ? spec.contextWindow.toLocaleString("en-US") : "?";
        const out = spec.maxTokens !== undefined ? spec.maxTokens.toLocaleString("en-US") : "?";
        const label = specSourceLabel(spec.source).split(" (")[0];
        return `${ctx} ctx / ${out} out (${label}${spec.match === "exact" ? "" : `, ${spec.match}`})`;
}

function trimNum(n: number): string {
        return n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
