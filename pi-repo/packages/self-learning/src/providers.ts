/**
 * providers.ts — the multi-provider registry (M1 of the multi-provider plan).
 *
 * Single source of truth for every mutation of ~/.unown/agent's provider
 * configuration. `unown setup` (via writeAgentConfig), `unown providers *`
 * and the engine's provider API (M5) all go through these functions, so the
 * accumulate-never-rewrite contract is enforced in ONE place:
 *
 *   ~/.unown/agent/models.json   provider + model registry pi loads
 *   ~/.unown/agent/auth.json     API keys, mode 0600 POSIX / ACL on Windows
 *   ~/.unown/agent/settings.json defaultProvider + defaultModel
 *
 * Design notes (docs/providers.md is the user-facing twin):
 *   - ADDING a provider never discards the others (the old setup rewrote
 *     models.json with exactly one provider — the #1 multi-provider blocker).
 *     `--force` on setup is the explicit reset back to single-provider.
 *   - Keys prefer auth.json (pi's AuthStorage format: {type:"api_key", key}).
 *     models.json may carry an `$ENV_VAR` reference instead of a secret so
 *     committed/registry files never contain keys (Codex env_key / OpenCode
 *     {env:VAR} pattern); pi resolves those at load time.
 *   - Unknown provider/model fields (headers, compat, modelOverrides…) are
 *     preserved on update — this module owns the fields it models, nothing
 *     else, so hand-edited extras survive a `providers add`.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { probeOpenAiEndpoint, readAgentModelsFile, type EndpointProbe } from "./probe.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Wire API a provider speaks (pi's model-config vocabulary). */
export type ProviderApi = "openai-completions" | "anthropic-messages";

/** A provider registration to write (upsert semantics). */
export interface ProviderEntry {
        /** Registry id — also the `provider/` prefix in canonical model ids. */
        id: string;
        name: string;
        baseUrl: string;
        api: ProviderApi;
        /** Primary model id. */
        modelId: string;
        /** Extra served model ids registered after modelId. */
        extraModelIds?: string[];
        /** Input modalities stamped on newly-registered models. */
        input: string[];
        /** Context window stamped on newly-registered models. */
        contextWindow?: number;
        /** Max output tokens stamped on newly-registered models. */
        maxTokens?: number;
        /** Literal key inside models.json (bridge placeholder / shared secret). */
        apiKeyInModelsJson?: string;
        /** `$ENV_VAR` reference stored in models.json instead of a secret. */
        apiKeyEnvRef?: string;
        /** Real secret → auth.json (0600). */
        apiKeyInAuthJson?: string;
}

/** Read-side view of one configured provider. */
export interface ProviderSummary {
        id: string;
        name?: string;
        baseUrl?: string;
        api?: string;
        modelIds: string[];
        /** Where the key lives, if anywhere. */
        keyStatus: "auth-json" | "models-json" | "env-ref" | "none";
        /** The env var named by an `$VAR` reference, when keyStatus = env-ref. */
        keyEnv?: string;
        isDefault: boolean;
}

/** One-line human label for a provider's key status (doctor, list, engine). */
export function keyStatusLabel(p: ProviderSummary): string {
        switch (p.keyStatus) {
                case "auth-json":
                        return "key: auth.json";
                case "models-json":
                        return "key: in models.json";
                case "env-ref":
                        return `key: $${p.keyEnv}`;
                default:
                        return "key: none";
        }
}

export interface ProviderList {
        providers: ProviderSummary[];
        /** defaultProvider/defaultModel from settings.json, when set. */
        defaultProvider?: string;
        defaultModel?: string;
        /** models.json parse error, when the file is invalid. */
        error?: string;
}

// ---------------------------------------------------------------------------
// Raw file helpers (JSON with the same layout setup.ts has always written)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function readJson(path: string): JsonRecord {
        if (!existsSync(path)) return {};
        try {
                return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
        } catch {
                return {};
        }
}

/**
 * Restrict a credentials file to the current user. POSIX: chmod 0600 (a no-op
 * on NTFS). Windows: `icacls <file> /inheritance:r /grant:r "<user>:F"` —
 * strips inheritance and re-grants full control to the owner only. Best
 * effort: a failure degrades to the pre-2.3 plain-file behaviour with a
 * stderr note, never a thrown error (the key is still more protected than
 * the alternative of not writing it).
 */
export function secureFilePermissions(path: string): void {
        if (process.platform === "win32") {
                try {
                        const user = process.env.USERNAME ?? process.env.USERDOMAIN ?? "";
                        if (!user) return;
                        const proc = Bun.spawnSync({
                                cmd: ["icacls", path, "/inheritance:r", "/grant:r", `${user}:F`],
                                stdout: "ignore",
                                stderr: "ignore",
                        });
                        if (proc.exitCode !== 0) {
                                console.error(`· could not harden ${path} ACLs (icacls exit ${proc.exitCode}) — treat the file as plain text`);
                        }
                } catch {
                        /* best effort */
                }
        } else {
                try {
                        chmodSync(path, 0o600);
                } catch {
                        /* best effort */
                }
        }
}

function writeAuthJson(agentDir: string, mutate: (auth: JsonRecord) => void): string {
        const authPath = join(agentDir, "auth.json");
        const auth = readJson(authPath);
        mutate(auth);
        writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
        secureFilePermissions(authPath);
        return authPath;
}

// ---------------------------------------------------------------------------
// Read: the provider list
// ---------------------------------------------------------------------------

/** Full registry view: models.json + auth.json + settings.json combined. */
export function listProviders(agentDir: string): ProviderList {
        const file = readAgentModelsFile(agentDir);
        if (file.error) return { providers: [], error: file.error };
        const auth = readJson(join(agentDir, "auth.json"));
        const settings = readJson(join(agentDir, "settings.json"));
        const defaultProvider = typeof settings.defaultProvider === "string" ? settings.defaultProvider : undefined;
        const defaultModel = typeof settings.defaultModel === "string" ? settings.defaultModel : undefined;

        // models.json raw — needed for provider-level apiKey detection ($ENV refs).
        const raw = readJson(join(agentDir, "models.json"));
        const rawProviders = (raw.providers ?? {}) as Record<string, { apiKey?: string }>;

        const providers: ProviderSummary[] = file.providers.map((p) => {
                let keyStatus: ProviderSummary["keyStatus"] = "none";
                let keyEnv: string | undefined;
                const authEntry = auth[p.id];
                if (authEntry && typeof authEntry === "object" && (authEntry as { key?: unknown }).key) keyStatus = "auth-json";
                else if (typeof rawProviders[p.id]?.apiKey === "string" && rawProviders[p.id].apiKey) {
                        const key = rawProviders[p.id].apiKey as string;
                        if (/^\$(\{)?[A-Za-z_][A-Za-z0-9_]*(\})?$/.test(key)) {
                                keyStatus = "env-ref";
                                keyEnv = key.replace(/^\$\{?|\}$/g, "");
                        } else keyStatus = "models-json";
                }
                return {
                        id: p.id,
                        name: p.name,
                        baseUrl: p.baseUrl,
                        api: p.api,
                        modelIds: p.modelIds,
                        keyStatus,
                        keyEnv,
                        isDefault: p.id === defaultProvider,
                };
        });
        return { providers, defaultProvider, defaultModel };
}

// ---------------------------------------------------------------------------
// Write: upsert (the accumulate-never-rewrite core)
// ---------------------------------------------------------------------------

/** Default metadata stamped on newly-registered models. */
function newModelRecord(entry: ProviderEntry, id: string): JsonRecord {
        return {
                id,
                name: `${id} (via unown)`,
                contextWindow: entry.contextWindow ?? 131072,
                maxTokens: entry.maxTokens ?? 8192,
                input: entry.input,
        };
}

export interface UpsertOptions {
        /** RESET models.json to exactly this provider (setup --force semantics). */
        reset?: boolean;
        /** Make this the default provider/model (setup semantics; providers add defaults to no). */
        setDefault?: boolean;
}

/**
 * Add or update one provider in the registry. Never discards sibling
 * providers (unless `reset`). Preserves unknown provider-level and per-model
 * fields (headers, compat, modelOverrides…) so hand-edited config survives.
 */
export function upsertProvider(agentDir: string, entry: ProviderEntry, opts: UpsertOptions = {}): void {
        mkdirSync(agentDir, { recursive: true });
        const modelsPath = join(agentDir, "models.json");
        const raw = readJson(modelsPath);
        const providers = (opts.reset ? {} : ((raw.providers ?? {}) as JsonRecord)) as JsonRecord;

        // --- the provider record -------------------------------------------------
        const incoming: JsonRecord = { name: entry.name, baseUrl: entry.baseUrl, api: entry.api };
        if (entry.apiKeyInModelsJson) incoming.apiKey = entry.apiKeyInModelsJson;
        else if (entry.apiKeyEnvRef) incoming.apiKey = `$${entry.apiKeyEnvRef}`;
        // else: no provider-level key — auth.json (below) or keyless.

        const modelIds = [entry.modelId, ...(entry.extraModelIds ?? [])];
        const existing = (opts.reset ? undefined : providers[entry.id]) as JsonRecord | undefined;
        if (existing && typeof existing === "object") {
                // Update in place: keep unknown provider-level fields (headers, compat…).
                const merged: JsonRecord = { ...existing, ...incoming };
                // Models: keep per-model metadata the user may have curated;
                // ensure every incoming id is present; drop nothing.
                const existingModels = Array.isArray(existing.models) ? (existing.models as JsonRecord[]) : [];
                const byId = new Map<string, JsonRecord>();
                for (const m of existingModels) if (typeof m?.id === "string") byId.set(m.id, m);
                for (const id of modelIds) if (!byId.has(id)) byId.set(id, newModelRecord(entry, id));
                merged.models = modelIds.map((id) => byId.get(id)).filter(Boolean);
                // A previous provider-level apiKey survives unless the entry
                // explicitly replaces it (incoming.apiKey set above) — but a
                // REAL secret moving to auth.json should clear the old
                // models.json literal to avoid two sources of truth.
                if (!incoming.apiKey && entry.apiKeyInAuthJson && typeof merged.apiKey === "string" && !/^\$/.test(merged.apiKey)) {
                        delete merged.apiKey;
                }
                providers[entry.id] = merged;
        } else {
                incoming.models = modelIds.map((id) => newModelRecord(entry, id));
                providers[entry.id] = incoming;
        }

        raw.providers = providers;
        writeFileSync(modelsPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

        // --- the key ---------------------------------------------------------------
        if (entry.apiKeyInAuthJson) {
                writeAuthJson(agentDir, (auth) => {
                        auth[entry.id] = { type: "api_key", key: entry.apiKeyInAuthJson };
                });
        }

        // --- the default -------------------------------------------------------------
        const settingsPath = join(agentDir, "settings.json");
        const settings = readJson(settingsPath);
        const hadDefault = typeof settings.defaultProvider === "string" && settings.defaultProvider !== "";
        if (opts.setDefault || !hadDefault) {
                mergeSettings(agentDir, { defaultProvider: entry.id, defaultModel: entry.modelId });
        }
}

export function mergeSettings(agentDir: string, patch: JsonRecord): void {
        const settingsPath = join(agentDir, "settings.json");
        const settings = readJson(settingsPath);
        writeFileSync(settingsPath, `${JSON.stringify({ ...settings, ...patch }, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Write: remove / key / default
// ---------------------------------------------------------------------------

export interface RemoveResult {
        removed: boolean;
        /** The removed provider was the default — default fell back to the first remaining. */
        wasDefault: boolean;
        /** Remaining provider count after the removal. */
        remaining: number;
}

/** Drop a provider from models.json + auth.json; re-point the default if it pointed here. */
export function removeProvider(agentDir: string, providerId: string): RemoveResult {
        const modelsPath = join(agentDir, "models.json");
        const raw = readJson(modelsPath);
        const providers = (raw.providers ?? {}) as JsonRecord;
        if (!(providerId in providers)) return { removed: false, wasDefault: false, remaining: Object.keys(providers).length };

        const settings = readJson(join(agentDir, "settings.json"));
        const wasDefault = settings.defaultProvider === providerId;

        delete providers[providerId];
        raw.providers = providers;
        writeFileSync(modelsPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

        // auth.json — drop the stored key too (an orphaned secret is a leak).
        const authPath = join(agentDir, "auth.json");
        if (existsSync(authPath)) {
                const auth = readJson(authPath);
                if (providerId in auth) {
                        delete auth[providerId];
                        writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
                        secureFilePermissions(authPath);
                }
        }

        // Default re-point: fall back to the first remaining provider, or clear.
        const remainingIds = Object.keys(providers);
        if (wasDefault) {
                if (remainingIds.length > 0) {
                        const next = providers[remainingIds[0]] as { models?: Array<{ id?: string }> };
                        const nextModel = next?.models?.[0]?.id ?? "";
                        mergeSettings(agentDir, { defaultProvider: remainingIds[0], defaultModel: nextModel });
                } else {
                        mergeSettings(agentDir, { defaultProvider: "", defaultModel: "" });
                }
        }
        return { removed: true, wasDefault, remaining: remainingIds.length };
}

/** Rotate/replace a provider's stored key (auth.json). Returns false when the provider is unknown. */
export function setProviderKey(agentDir: string, providerId: string, apiKey: string): boolean {
        const file = readAgentModelsFile(agentDir);
        if (!file.providers.some((p) => p.id === providerId)) return false;
        writeAuthJson(agentDir, (auth) => {
                auth[providerId] = { type: "api_key", key: apiKey };
        });
        return true;
}

export interface ClearKeyResult {
        /** The provider existed in the registry. */
        found: boolean;
        /** An auth.json entry was removed. */
        removedAuthEntry: boolean;
        /** A provider-level apiKey (literal or $ENV ref) was removed from models.json. */
        removedModelsKey: boolean;
}

/**
 * Remove EVERY locally-stored trace of a provider's key: the auth.json entry
 * and any provider-level apiKey in models.json (literal secrets AND `$ENV`
 * references — the reference goes; the environment variable itself is the
 * user's shell, not ours). Idempotent: clearing an already-keyless provider
 * is a no-op success.
 */
export function clearProviderKey(agentDir: string, providerId: string): ClearKeyResult {
        const file = readAgentModelsFile(agentDir);
        const found = file.providers.some((p) => p.id === providerId);
        let removedAuthEntry = false;
        let removedModelsKey = false;
        // auth.json: drop the entry if present.
        const authPath = join(agentDir, "auth.json");
        if (existsSync(authPath)) {
                const auth = readJson(authPath);
                if (auth[providerId] !== undefined) {
                        delete auth[providerId];
                        writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}
`, { encoding: "utf8" });
                        secureFilePermissions(authPath);
                        removedAuthEntry = true;
                }
        }
        // models.json: drop a provider-level apiKey (literal or $ENV ref).
        const modelsPath = join(agentDir, "models.json");
        if (existsSync(modelsPath)) {
                const raw = readJson(modelsPath);
                const providers = (raw.providers ?? {}) as Record<string, { apiKey?: string }>;
                const entry = providers[providerId];
                if (entry && typeof entry.apiKey === "string" && entry.apiKey) {
                        delete entry.apiKey;
                        raw.providers = providers;
                        writeFileSync(modelsPath, `${JSON.stringify(raw, null, 2)}
`, { encoding: "utf8" });
                        removedModelsKey = true;
                }
        }
        return { found, removedAuthEntry, removedModelsKey };
}

export interface DefaultResult {
        ok: boolean;
        error?: string;
}

/** Point settings.json's default at provider/model (validated against the registry). */
export function setDefaultModel(agentDir: string, providerId: string, modelId?: string): DefaultResult {
        const file = readAgentModelsFile(agentDir);
        const provider = file.providers.find((p) => p.id === providerId);
        if (!provider) {
                return {
                        ok: false,
                        error: `unknown provider "${providerId}" — configured: ${file.providers.map((p) => p.id).join(", ") || "(none)"}`,
                };
        }
        let model = modelId;
        if (!model) model = provider.modelIds[0];
        if (!model) return { ok: false, error: `provider "${providerId}" has no models — add one first` };
        if (!provider.modelIds.includes(model)) {
                return {
                        ok: false,
                        error: `model "${model}" is not registered on "${providerId}" — models: ${provider.modelIds.join(", ")}`,
                };
        }
        mergeSettings(agentDir, { defaultProvider: providerId, defaultModel: model });
        return { ok: true };
}

// ---------------------------------------------------------------------------
// Test: live endpoint probe with the stored credential
// ---------------------------------------------------------------------------

export interface ProviderTestResult {
        found: boolean;
        probe?: EndpointProbe;
        /** The credential the probe used (models.json literal/env-ref or auth.json). */
        keySource?: "auth-json" | "models-json" | "env-ref" | "none";
        keyEnv?: string;
}

/** Resolve the effective key for a provider (auth.json > models.json literal > $ENV at call time). */
export function resolveProviderKey(agentDir: string, providerId: string): { key?: string; source: ProviderTestResult["keySource"]; envVar?: string } {
        const list = listProviders(agentDir);
        const p = list.providers.find((x) => x.id === providerId);
        if (!p) return { source: "none" };
        if (p.keyStatus === "env-ref" && p.keyEnv) {
                const fromEnv = process.env[p.keyEnv];
                return fromEnv ? { key: fromEnv, source: "env-ref", envVar: p.keyEnv } : { source: "env-ref", envVar: p.keyEnv };
        }
        if (p.keyStatus === "auth-json") {
                const auth = readJson(join(agentDir, "auth.json"));
                const entry = auth[providerId] as { key?: string } | undefined;
                return entry?.key ? { key: entry.key, source: "auth-json" } : { source: "none" };
        }
        if (p.keyStatus === "models-json") {
                const raw = readJson(join(agentDir, "models.json"));
                const entry = ((raw.providers ?? {}) as Record<string, { apiKey?: string }>)[providerId];
                return entry?.apiKey ? { key: entry.apiKey, source: "models-json" } : { source: "none" };
        }
        return { source: "none" };
}

/** Probe a configured provider's endpoint with its stored credential. */
export async function testProvider(agentDir: string, providerId: string, timeoutMs = 6000): Promise<ProviderTestResult> {
        const list = listProviders(agentDir);
        const p = list.providers.find((x) => x.id === providerId);
        if (!p) return { found: false };
        if (!p.baseUrl) return { found: true, keySource: p.keyStatus, keyEnv: p.keyEnv };
        const { key, source, envVar } = resolveProviderKey(agentDir, providerId);
        const probe = await probeOpenAiEndpoint(p.baseUrl, key, timeoutMs);
        return { found: true, probe, keySource: source, keyEnv: envVar };
}

// ---------------------------------------------------------------------------
// Discovery: live model import (M2)
// ---------------------------------------------------------------------------

export interface RefreshResult {
        found: boolean;
        /** Endpoint probe outcome (absent when the provider is unknown). */
        probe?: EndpointProbe;
        /** Model ids newly registered into models.json. */
        added: string[];
        /** Registered ids the endpoint no longer serves (kept — removal is a
         *  deliberate act; they may be typos, locals, or a temporarily empty list). */
        missing: string[];
        /** Everything the endpoint served, when it answered with a list. */
        served?: string[];
        /** Why the refresh did nothing, when it did not. */
        problem?: string;
}

/**
 * Import a provider's LIVE model catalog (`GET {baseUrl}/models`) into
 * models.json — the Cline/Roo "model discovery" flow. New ids are registered
 * with the provider's existing modality/metadata conventions (new-model
 * defaults); existing model records are untouched (curated metadata survives);
 * ids the endpoint stopped serving are REPORTED but kept — silent removal
 * would eat hand-registered ids whenever an endpoint has a bad /models day.
 *
 * Ids that are obviously not chat models are filtered (embeddings, rerankers,
 * TTS, whisper, guard/moderation, image/video/audio generation) — importing
 * those into a coding agent's picker is noise.
 */
const NON_CHAT_RE =
        /^(?!.*(embed|rerank|tts|whisper|speech|guard|moderation|bge-|text-embedding|davinci|dall-e|stable-diffusion|sdxl|flux|imagen|image|video|voice|audio|realtime|transcribe|caption)).+$/i;

export function looksLikeChatModel(id: string): boolean {
        return NON_CHAT_RE.test(id);
}

export async function refreshProviderModels(agentDir: string, providerId: string, timeoutMs = 8000): Promise<RefreshResult> {
        const list = listProviders(agentDir);
        const p = list.providers.find((x) => x.id === providerId);
        if (!p) return { found: false, added: [], missing: [] };
        if (!p.baseUrl) return { found: true, added: [], missing: [], problem: "no baseUrl configured — fix models.json" };
        const { key } = resolveProviderKey(agentDir, providerId);
        const probe = await probeOpenAiEndpoint(p.baseUrl, key, timeoutMs);
        if (!probe.ok) {
                return { found: true, probe, added: [], missing: [], problem: probe.problem === "auth" ? `endpoint rejected the credential (HTTP ${probe.status})` : `endpoint unreachable at ${p.baseUrl}` };
        }
        const served = (probe.models ?? []).filter(looksLikeChatModel);
        if (served.length === 0) {
                return { found: true, probe, added: [], missing: [], served: probe.models, problem: "endpoint serves no listable models (some APIs do not implement /models)" };
        }

        // Merge new ids into the provider's models array — preserving every
        // existing record byte-for-byte (curated contextWindow/cost survive).
        const modelsPath = join(agentDir, "models.json");
        const raw = readJson(modelsPath);
        const providers = (raw.providers ?? {}) as Record<string, any>;
        const entry = providers[providerId];
        if (!entry || !Array.isArray(entry.models)) {
                return { found: true, probe, added: [], missing: [], served, problem: "provider entry has no models array — fix models.json" };
        }
        const existingIds: string[] = entry.models.map((m: any) => m?.id).filter(Boolean);
        const existingSet = new Set(existingIds);
        const inputModalities = inferInputModalities(entry);
        const added: string[] = [];
        for (const id of served) {
                if (existingSet.has(id)) continue;
                entry.models.push({
                        id,
                        name: `${id} (via unown)`,
                        contextWindow: 131072,
                        maxTokens: 8192,
                        input: inputModalities,
                });
                added.push(id);
        }
        if (added.length > 0) {
                writeFileSync(modelsPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
        }
        const missing = existingIds.filter((id) => !served.includes(id));
        return { found: true, probe, added, missing, served };
}

/** The provider's input modalities, inherited by newly-discovered models. */
function inferInputModalities(entry: Record<string, any>): string[] {
        const models = Array.isArray(entry.models) ? entry.models : [];
        // A provider whose EXISTING models include image input passes it on;
        // otherwise new models register text-only (the conservative default).
        const anyImage = models.some((m: any) => Array.isArray(m?.input) && m.input.includes("image"));
        return anyImage ? ["text", "image"] : ["text"];
}
