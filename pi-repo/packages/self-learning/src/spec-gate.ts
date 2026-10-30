/**
 * spec-gate.ts — the model-specs gate (the model-specs round).
 *
 * The contract behind "if we cannot find the specs, we must ask the user to
 * input those before they can start using the model":
 *
 *   resolveSpecGate()  ONE shared verdict for every caller (setup wizard,
 *                      providers add, session preflight): the sidecar record
 *                      wins; hand-edited models.json values count as the
 *                      user's own answer; otherwise the detection cascade
 *                      runs (self-healing models.json + recording provenance);
 *                      otherwise the model is UNVERIFIED — the caller must
 *                      ask (interactive) or refuse with the remediation
 *                      (non-interactive).
 *   askSpecNumbers()   the interactive ask: validation, clamp feedback, a
 *                      bounded retry loop, close-match context from the
 *                      detection attempts. Never accepts garbage; blank
 *                      context is refused (the gate is real).
 *   allowUnverifiedSpecs()  the documented escape hatch
 *                      (UNOWN_ALLOW_UNVERIFIED_SPECS=1) — CI and air-gapped
 *                      installs can proceed unverified, ON PURPOSE, loudly.
 *
 * Why the models.json values alone cannot be the verdict: every seeding site
 * historically stamped `modelSpec(id)` — the catalog entry OR the 131072/8192
 * guess — into models.json, so a file that says 131072 is indistinguishable
 * from a verified number. The sidecar (`~/.unown/agent/model-specs.json`) is
 * the provenance source of truth; models.json is the numbers pi loads.
 *
 * Detachment: imports only model-spec-detect (pure), providers (registry
 * mutation), probe (model resolution) and setup-dialog (the dialog TYPE —
 * type-only, so the engine lane can import this module without the terminal
 * half). Network is always injected or bounded.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SetupDialog } from "./setup-dialog.ts";
import {
        type DetectAttempt,
        type DetectResult,
        detectModelSpec,
        type ModelSpecDetection,
        type ModelSpecRecord,
        getRecordedSpec,
        isCompleteSpec,
        recordSpec,
        sanitizeSpecNumbers,
        userSpec,
        SPEC_CONTEXT_MIN,
        SPEC_CONTEXT_MAX,
} from "./model-spec-detect.ts";
import { modelSpec } from "./model-specs.ts";
import { applyModelSpecs } from "./providers.ts";

// ---------------------------------------------------------------------------
// The escape hatch
// ---------------------------------------------------------------------------

/** True when UNOWN_ALLOW_UNVERIFIED_SPECS=1|true|yes — the documented way to
 *  use a model whose specs no source could verify (CI, air-gapped installs,
 *  a provider that has not published limits yet). The gate is skipped
 *  LOUDLY: callers print that the model runs unverified. */
export function allowUnverifiedSpecs(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^(1|true|yes)$/i.test(env.UNOWN_ALLOW_UNVERIFIED_SPECS ?? "");
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

export interface SpecGateInput {
        providerId: string;
        modelId: string;
        /** Endpoint base URL — enables the endpoint lane. */
        baseUrl?: string;
        apiKey?: string;
        api?: string;
        /** The model's CURRENT models.json record values, when the caller has
         *  them (preflight). Values that differ from the catalog guess are the
         *  user's own hand edit — they count as a verified answer. */
        current?: { contextWindow?: number; maxTokens?: number };
}

export interface SpecGateContext {
        agentDir: string;
        env?: NodeJS.ProcessEnv;
        fetchImpl?: typeof fetch;
        now?: number;
        /** Per-source timeout for the cascade (preflight passes a tight one). */
        timeoutMs?: number;
        /** Session-preflight mode: stop the cascade once both numbers are filled. */
        stopWhenComplete?: boolean;
        /** A GET {base}/models body the caller already fetched. */
        endpointCatalog?: { data?: unknown[] } & Record<string, unknown>;
        /** Injectable detection (tests). */
        detect?: (modelId: string, opts: Parameters<typeof detectModelSpec>[1]) => Promise<DetectResult>;
}

export type SpecGateResult =
        | {
                        status: "verified";
                        /** The verified spec (detection result, sidecar record, or user values). */
                        spec: ModelSpecDetection;
                        /** True when this call wrote the sidecar record. */
                        recorded: boolean;
                        /** True when this call healed models.json numbers. */
                        healed: boolean;
                        /** Where the verdict came from, one line for logs. */
                        note: string;
          }
        | {
                        status: "unverified";
                        /** Every source that was tried and how it ended — the ask's context. */
                        attempts: DetectAttempt[];
                        /** The exact remediation sentence for this model. */
                        remediation: string;
          };

/** The remediation sentence — one text, every surface (print-mode abort,
 *  setup's non-interactive failure, doctor's warning) so the instruction is
 *  always the same. */
export function specRemediation(input: { providerId?: string; modelId: string }): string {
        const pin = input.providerId ? ` --provider ${input.providerId}` : "";
        return `verify the model specs: unown setup${pin} --model ${input.modelId} --context-window <N> --max-tokens <K> — or export UNOWN_ALLOW_UNVERIFIED_SPECS=1 to proceed unverified`;
}

/**
 * The shared verdict. Never throws; a broken sidecar or a read-only agent
 * dir degrades to detection, and detection itself never throws.
 */
export async function resolveSpecGate(input: SpecGateInput, ctx: SpecGateContext): Promise<SpecGateResult> {
        const { providerId, modelId } = input;
        // 1. The sidecar record — the provenance source of truth. A complete
        //    record (detected OR user-entered OR learned) settles it with zero
        //    network.
        const recorded = getRecordedSpec(ctx.agentDir, providerId, modelId) as ModelSpecRecord | undefined;
        if (isCompleteSpec(recorded)) {
                return { status: "verified", spec: recorded, recorded: false, healed: false, note: `specs on record (${recorded.source})` };
        }
        // 2. The model's own models.json values: numbers that differ from the
        //    catalog guess are a deliberate hand edit — the user already answered.
        //    Values EQUAL to the guess are indistinguishable from a seed stamp and
        //    prove nothing (the whole reason the sidecar exists).
        const guess = modelSpec(modelId);
        const cur = input.current;
        if (
                cur &&
                typeof cur.contextWindow === "number" &&
                typeof cur.maxTokens === "number" &&
                cur.contextWindow > 0 &&
                cur.maxTokens > 0 &&
                (cur.contextWindow !== guess.contextWindow || cur.maxTokens !== guess.maxTokens)
        ) {
                const sane = sanitizeSpecNumbers(cur.contextWindow, cur.maxTokens);
                if (sane.contextWindow !== undefined && sane.maxTokens !== undefined) {
                        const spec = userSpec(sane.contextWindow, sane.maxTokens);
                        recordSpec(ctx.agentDir, providerId, modelId, spec, ctx.now);
                        return { status: "verified", spec, recorded: true, healed: false, note: "specs from your models.json edit" };
                }
        }
        // 3. The detection cascade (bounded network; the caller's own /models
        //    fetch is reused when provided).
        const detect = ctx.detect ?? detectModelSpec;
        let result: DetectResult;
        try {
                result = await detect(modelId, {
                        providerId,
                        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
                        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
                        ...(input.api ? { api: input.api } : {}),
                        agentDir: ctx.agentDir,
                        ...(ctx.env ? { env: ctx.env } : {}),
                        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
                        ...(ctx.now !== undefined ? { now: ctx.now } : {}),
                        ...(ctx.timeoutMs !== undefined ? { timeoutMs: ctx.timeoutMs } : {}),
                        ...(ctx.stopWhenComplete ? { stopWhenComplete: true } : {}),
                        ...(ctx.endpointCatalog ? { endpointCatalog: ctx.endpointCatalog } : {}),
                });
        } catch {
                result = { attempts: [{ source: "curated", outcome: "unreachable", note: "detection failed unexpectedly" }] };
        }
        if (isCompleteSpec(result.spec)) {
                const spec = result.spec;
                recordSpec(ctx.agentDir, providerId, modelId, spec, ctx.now);
                // Self-heal: overwrite the guess stamp (or missing fields) in
                // models.json so pi loads the verified numbers. A hand-edited record
                // never reaches here (step 2 settled it), so this only ever replaces
                // seed stamps — the accumulate-never-rewrite law is about user data,
                // and a guess is not user data.
                let healed = false;
                try {
                        healed = applyModelSpecs(ctx.agentDir, providerId, { [modelId]: { contextWindow: spec.contextWindow!, maxTokens: spec.maxTokens! } }).length > 0;
                } catch {
                        /* read-only agent dir — the sidecar still carries the truth */
                }
                return { status: "verified", spec, recorded: true, healed, note: `specs detected via ${spec.source}` };
        }
        return { status: "unverified", attempts: result.attempts, remediation: specRemediation({ providerId, modelId }) };
}

// ---------------------------------------------------------------------------
// The interactive ask
// ---------------------------------------------------------------------------

export interface SpecNumbers {
        contextWindow: number;
        maxTokens: number;
}

/**
 * Ask for the two numbers with validation and a bounded retry loop.
 * Returns null when the user cannot produce valid numbers after the retries
 * (the caller treats that as a declined gate — the model stays unusable).
 *
 * The dialog contract (setup-dialog.ts): `ask` falls back on blank input and
 * has no built-in validation, so the loop is ours — the key-step retry
 * pattern. Suggestions come from `current` (the models.json values, when
 * they exist) so a re-run pre-fills what was there before.
 */
export async function askSpecNumbers(
        dialog: SetupDialog,
        modelId: string,
        current?: { contextWindow?: number; maxTokens?: number },
): Promise<SpecNumbers | null> {
        const askNumber = async (question: string, fallback: string, isCtx: boolean, other?: number): Promise<number | null> => {
                for (let attempt = 0; attempt < 3; attempt++) {
                        const raw = (await dialog.ask(question, fallback)).trim().replace(/[,_ ]/g, "");
                        if (!raw) {
                                dialog.note("  ⚠ a number is required — the model's limits drive compaction and the output cap (guessing is what this gate exists to stop).");
                                continue;
                        }
                        const n = Number(raw);
                        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
                                dialog.note(`  ⚠ "${raw}" is not a positive whole number of tokens.`);
                                continue;
                        }
                        const sane = sanitizeSpecNumbers(isCtx ? n : other, isCtx ? other : n);
                        const mine = isCtx ? sane.contextWindow : sane.maxTokens;
                        if (mine === undefined) {
                                dialog.note(`  ⚠ ${n.toLocaleString("en-US")} is outside the plausible range (${SPEC_CONTEXT_MIN.toLocaleString("en-US")} – ${SPEC_CONTEXT_MAX.toLocaleString("en-US")}).`);
                                continue;
                        }
                        if (sane.clamped.length > 0 && !isCtx) {
                                dialog.note(`  · clamped to ${sane.maxTokens!.toLocaleString("en-US")} — the output budget cannot exceed the context window.`);
                                return sane.maxTokens!;
                        }
                        return mine;
                }
                return null;
        };
        const ctxFallback = current?.contextWindow ? String(current.contextWindow) : "";
        const contextWindow = await askNumber(`Context window for ${modelId} (tokens — total input+output the model accepts)`, ctxFallback, true);
        if (contextWindow === null) return null;
        const outFallback = current?.maxTokens ? String(current.maxTokens) : "";
        const maxTokens = await askNumber(`Max output tokens for ${modelId} (the per-reply cap)`, outFallback, false, contextWindow);
        if (maxTokens === null) return null;
        return { contextWindow, maxTokens };
}

/** Record a user answer (the ask's or the flags') with full provenance. */
export function recordUserSpec(agentDir: string, providerId: string, modelId: string, numbers: SpecNumbers, now = Date.now()): ModelSpecDetection {
        const sane = sanitizeSpecNumbers(numbers.contextWindow, numbers.maxTokens);
        // The ask already validated; the flags path validates before calling. A
        // clamped maxTokens is recorded clamped (the sidecar must never carry a
        // number models.json will not).
        const spec = userSpec(sane.contextWindow ?? numbers.contextWindow, sane.maxTokens ?? numbers.maxTokens);
        recordSpec(agentDir, providerId, modelId, spec, now);
        return spec;
}

// ---------------------------------------------------------------------------
// Model resolution (preflight's "which model does this session start on?")
// ---------------------------------------------------------------------------

/** The model's current numbers from models.json (preflight passes them in as
 *  `current` — hand-edited values count as the user's answer). Absent fields
 *  and missing files read as undefined; never throws. */
export function readModelSpecsFromRegistry(
        agentDir: string,
        providerId: string,
        modelId: string,
): { contextWindow?: number; maxTokens?: number } | undefined {
        try {
                const raw = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")) as {
                        providers?: Record<string, { models?: Array<{ id?: string; contextWindow?: number; maxTokens?: number }> }>;
                };
                const models = raw?.providers?.[providerId]?.models;
                if (!Array.isArray(models)) return undefined;
                const m = models.find((x) => x?.id === modelId);
                if (!m) return undefined;
                return {
                        ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
                        ...(typeof m.maxTokens === "number" ? { maxTokens: m.maxTokens } : {}),
                };
        } catch {
                return undefined;
        }
}

/**
 * The model id a fresh session would use, mirroring bootRuntime's own
 * resolution: the `--model provider/model` pin's model part, else the
 * `--model <id>` pin verbatim, else settings.json's defaultModel when it
 * belongs to the active provider, else the provider's first registered id.
 */
export function resolveActiveModelId(
        agentDir: string,
        provider: { id: string; modelIds: string[] },
        pinnedModel: string | undefined,
        defaultModel: string | undefined,
): string | undefined {
        if (pinnedModel) {
                // "provider/model" → the model part, but only when the prefix names
                // this provider (an OpenRouter-style id with a slash is a bare id
                // otherwise — resolveActiveProvider's grammar).
                const segments = pinnedModel.split("/");
                for (let i = 0; i < segments.length - 1; i++) {
                        const candidate = segments.slice(0, i + 1).join("/");
                        if (candidate.toLowerCase() === provider.id.toLowerCase()) {
                                const model = segments.slice(i + 1).join("/");
                                if (model) return model;
                        }
                }
                // A pin with no recognisable provider prefix (bare id, or a slash id
                // belonging to another provider's grammar) — exactly what pi's own
                // resolver receives.
                return pinnedModel;
        }
        if (defaultModel && provider.modelIds.includes(defaultModel)) return defaultModel;
        return provider.modelIds[0];
}
