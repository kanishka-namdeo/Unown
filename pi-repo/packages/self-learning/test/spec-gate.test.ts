/**
 * spec-gate.test.ts — the model-specs gate, pinned end to end.
 *
 * The gate's contract (docs/model-specs-session.md):
 *   1. the sidecar record wins (zero network)
 *   2. hand-edited models.json values count as the user's own answer
 *   3. the detection cascade verifies + self-heals models.json
 *   4. nothing verifiable → unverified: the interactive ask (validated,
 *      bounded retries) or the remediation; UNOWN_ALLOW_UNVERIFIED_SPECS=1
 *      is the documented escape
 *
 * Also pins the wiring the gate rides on:
 *   - upsertProvider's per-model modelSpecs stamping (heterogeneous catalogs
 *     get each id its own numbers)
 *   - applyModelSpecs (the self-heal write: existing entries only)
 *   - refreshProviderModels stamping DETECTED specs + provenance (never asks)
 *   - probe.ts keeping the raw /models entries (modelEntries) instead of
 *     throwing the spec fields away
 *
 * No test touches the real network: registries point at local servers or
 * dead ports via opts.env, endpoints are local Bun.serve servers.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SetupDialog } from "../src/setup-dialog.ts";
import {
        detectModelSpec,
        isCompleteSpec,
        type ModelSpecDetection,
        recordSpec,
        userSpec,
} from "../src/model-spec-detect.ts";
import { applyModelSpecs, refreshProviderModels, upsertProvider } from "../src/providers.ts";
import { probeProviderEndpoint } from "../src/probe.ts";
import {
        allowUnverifiedSpecs,
        askSpecNumbers,
        readModelSpecsFromRegistry,
        recordUserSpec,
        resolveActiveModelId,
        resolveSpecGate,
} from "../src/spec-gate.ts";

const tmp = mkdtempSync(join(tmpdir(), "spec-gate-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function agentDir(name: string): string {
        const dir = join(tmp, name, "agent");
        mkdirSync(dir, { recursive: true });
        return dir;
}

/** Local OpenAI-compatible endpoint with a spec-bearing /models catalog
 *  (the vLLM/LM Studio field zoo). */
function specEndpoint(port: number, models: Array<Record<string, unknown>>): { url: string; stop: () => void } {
        const server = Bun.serve({
                port: 0,
                fetch(req) {
                        const url = new URL(req.url);
                        if (req.method === "GET" && url.pathname === "/v1/models") {
                                return Response.json({ object: "list", data: models });
                        }
                        return new Response("not found", { status: 404 });
                },
        });
        return { url: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true) };
}

/** A scripted SetupDialog: ask() answers in order; notes are captured. */
function scriptedDialog(answers: string[]): SetupDialog & { notes: string[] } {
        const notes: string[] = [];
        let i = 0;
        return {
                ask: async (_q: string, fallback?: string) => {
                        const a = answers[i++];
                        if (a === undefined) return fallback ?? "";
                        return a;
                },
                askSecret: async () => "",
                choose: async (_q: string, _options: string[], defaultIndex?: number) => defaultIndex ?? 0,
                note: (text: string) => {
                        notes.push(text);
                },
                notes,
        };
}

// ---------------------------------------------------------------------------
// allowUnverifiedSpecs
// ---------------------------------------------------------------------------

describe("allowUnverifiedSpecs", () => {
        test("1/true/yes (case-insensitive) allow; anything else refuses", () => {
                expect(allowUnverifiedSpecs({ UNOWN_ALLOW_UNVERIFIED_SPECS: "1" } as NodeJS.ProcessEnv)).toBe(true);
                expect(allowUnverifiedSpecs({ UNOWN_ALLOW_UNVERIFIED_SPECS: "TRUE" } as NodeJS.ProcessEnv)).toBe(true);
                expect(allowUnverifiedSpecs({ UNOWN_ALLOW_UNVERIFIED_SPECS: "yes" } as NodeJS.ProcessEnv)).toBe(true);
                expect(allowUnverifiedSpecs({ UNOWN_ALLOW_UNVERIFIED_SPECS: "0" } as NodeJS.ProcessEnv)).toBe(false);
                expect(allowUnverifiedSpecs({ UNOWN_ALLOW_UNVERIFIED_SPECS: "" } as NodeJS.ProcessEnv)).toBe(false);
                expect(allowUnverifiedSpecs({} as NodeJS.ProcessEnv)).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// resolveSpecGate — the verdict ladder
// ---------------------------------------------------------------------------

describe("resolveSpecGate", () => {
        test("a complete sidecar record wins with zero network", async () => {
                const dir = agentDir("sidecar-hit");
                recordSpec(dir, "p", "m", userSpec(262144, 32768));
                // baseUrl points at a DEAD port — a network touch would fail the test
                // by timeout, proving the record short-circuits before any fetch.
                const gate = await resolveSpecGate(
                        { providerId: "p", modelId: "m", baseUrl: "http://127.0.0.1:9/v1" },
                        { agentDir: dir, timeoutMs: 500 },
                );
                expect(gate.status).toBe("verified");
                if (gate.status === "verified") {
                        expect(gate.spec.source).toBe("user");
                        expect(gate.spec.contextWindow).toBe(262144);
                        expect(gate.recorded).toBe(false);
                        expect(gate.healed).toBe(false);
                }
        });

        test("hand-edited models.json values (≠ the catalog guess) count as the user's answer", async () => {
                const dir = agentDir("hand-edit");
                const gate = await resolveSpecGate(
                        {
                                providerId: "p",
                                modelId: "mystery-7b",
                                current: { contextWindow: 200000, maxTokens: 16384 },
                        },
                        { agentDir: dir },
                );
                expect(gate.status).toBe("verified");
                if (gate.status === "verified") {
                        expect(gate.spec.source).toBe("user");
                        expect(gate.recorded).toBe(true);
                }
                // ...and the record persists
                const sidecar = JSON.parse(readFileSync(join(dir, "model-specs.json"), "utf8"));
                expect(sidecar.specs["p/mystery-7b"].contextWindow).toBe(200000);
        });

        test("values EQUAL to the seed guess prove nothing — detection runs (and misses here)", async () => {
                const dir = agentDir("guess-stamp");
                // 131072/8192 is DEFAULT_MODEL_SPEC — the historical seed stamp.
                const gate = await resolveSpecGate(
                        {
                                providerId: "p",
                                modelId: "mystery-7b",
                                current: { contextWindow: 131072, maxTokens: 8192 },
                        },
                        { agentDir: dir, env: { UNOWN_SPEC_MODELSDEV_URL: "http://127.0.0.1:9/x.json", UNOWN_SPEC_LITELLM_URL: "http://127.0.0.1:9/x.json" } as NodeJS.ProcessEnv },
                );
                expect(gate.status).toBe("unverified");
                if (gate.status === "unverified") {
                        expect(gate.remediation).toContain("--context-window");
                        expect(gate.attempts.length).toBeGreaterThan(0);
                }
        });

        test("registry detection verifies, records AND heals the models.json guess stamp", async () => {
                const dir = agentDir("curated-heal");
                // An UNKNOWN id (no curated entry) whose models.json record still
                // carries the historical guess stamp — exactly the pre-round state
                // the preflight self-heals. models.dev (a local mock serving the
                // real payload shape) is the verifiable source.
                const registry = Bun.serve({
                        port: 0,
                        fetch() {
                                // The REAL models.dev api.json shape: providers →
                                // models → entry (limit/context + limit/output).
                                return Response.json({
                                        "the-lab": {
                                                models: {
                                                        "lab-7b": { limit: { context: 262144, output: 32768 } },
                                                },
                                        },
                                });
                        },
                });
                try {
                        upsertProvider(dir, {
                                id: "lab",
                                name: "Lab",
                                baseUrl: "http://127.0.0.1:9/v1",
                                api: "openai-completions",
                                modelId: "lab-7b",
                                input: ["text"],
                        });
                        const gate = await resolveSpecGate(
                                { providerId: "lab", modelId: "lab-7b", current: { contextWindow: 131072, maxTokens: 8192 } },
                                {
                                        agentDir: dir,
                                        env: {
                                                UNOWN_SPEC_MODELSDEV_URL: `http://127.0.0.1:${registry.port}/api.json`,
                                                UNOWN_SPEC_LITELLM_URL: "http://127.0.0.1:9/x.json",
                                        } as NodeJS.ProcessEnv,
                                },
                        );
                        expect(gate.status).toBe("verified");
                        if (gate.status === "verified") {
                                expect(gate.spec.source).toBe("models-dev");
                                expect(gate.spec.contextWindow).toBe(262144);
                                expect(gate.spec.maxTokens).toBe(32768);
                                expect(gate.healed).toBe(true);
                                const healed = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
                                expect(healed.providers.lab.models[0].contextWindow).toBe(262144);
                                expect(healed.providers.lab.models[0].maxTokens).toBe(32768);
                        }
                } finally {
                        registry.stop(true);
                }
        });

        test("the endpoint catalog verifies (vLLM max_model_len) via the caller's own fetch", async () => {
                const dir = agentDir("endpoint-lane");
                const srv = specEndpoint(0, [
                        { id: "served-model", max_model_len: 32768, max_tokens: 4096 },
                ]);
                try {
                        const gate = await resolveSpecGate(
                                { providerId: "local", modelId: "served-model", baseUrl: srv.url },
                                {
                                        agentDir: dir,
                                        timeoutMs: 2000,
                                        endpointCatalog: { data: [{ id: "served-model", max_model_len: 32768, max_tokens: 4096 }] },
                                },
                        );
                        expect(gate.status).toBe("verified");
                        if (gate.status === "verified") {
                                expect(gate.spec.source).toBe("endpoint");
                                expect(gate.spec.contextWindow).toBe(32768);
                                expect(gate.spec.maxTokens).toBe(4096);
                        }
                } finally {
                        srv.stop();
                }
        });

        test("stopWhenComplete skips the registries once the endpoint filled both numbers", async () => {
                const dir = agentDir("stop-early");
                // A models.dev URL that FAILS if fetched (dead port): proving the skip.
                const result = await detectModelSpec("served-model", {
                        providerId: "local",
                        endpointCatalog: { data: [{ id: "served-model", max_model_len: 131072, max_tokens: 8192 }] },
                        agentDir: dir,
                        stopWhenComplete: true,
                        env: { UNOWN_SPEC_MODELSDEV_URL: "http://127.0.0.1:9/x.json", UNOWN_SPEC_LITELLM_URL: "http://127.0.0.1:9/x.json" } as NodeJS.ProcessEnv,
                });
                expect(isCompleteSpec(result.spec)).toBe(true);
                const dev = result.attempts.find((a) => a.source === "models-dev");
                expect(dev?.outcome).toBe("skipped");
                const litellm = result.attempts.find((a) => a.source === "litellm");
                expect(litellm?.outcome).toBe("skipped");
        });

        test("nothing verifiable → unverified with the remediation", async () => {
                const dir = agentDir("unverified");
                const gate = await resolveSpecGate(
                        { providerId: "p", modelId: "mystery-7b" },
                        { agentDir: dir, env: { UNOWN_SPEC_MODELSDEV_URL: "http://127.0.0.1:9/x.json", UNOWN_SPEC_LITELLM_URL: "http://127.0.0.1:9/x.json" } as NodeJS.ProcessEnv },
                );
                expect(gate.status).toBe("unverified");
                if (gate.status === "unverified") {
                        expect(gate.remediation).toContain("unown setup");
                        expect(gate.remediation).toContain("UNOWN_ALLOW_UNVERIFIED_SPECS=1");
                }
        });
});

// ---------------------------------------------------------------------------
// askSpecNumbers — the interactive ask
// ---------------------------------------------------------------------------

describe("askSpecNumbers", () => {
        test("valid answers pass through; commas are tolerated", async () => {
                const dialog = scriptedDialog(["262,144", "32,768"]);
                const r = await askSpecNumbers(dialog, "m", { contextWindow: 131072, maxTokens: 8192 });
                expect(r).toEqual({ contextWindow: 262144, maxTokens: 32768 });
        });

        test("garbage then blank then valid — validation loops, blank is refused", async () => {
                const dialog = scriptedDialog(["abc", "", "131072", "8192"]);
                const r = await askSpecNumbers(dialog, "m");
                expect(r).toEqual({ contextWindow: 131072, maxTokens: 8192 });
                expect(dialog.notes.some((n) => n.includes("required"))).toBe(true);
                expect(dialog.notes.some((n) => n.includes("not a positive whole number"))).toBe(true);
        });

        test("maxTokens above the context window is clamped with a note", async () => {
                const dialog = scriptedDialog(["131072", "999999"]);
                const r = await askSpecNumbers(dialog, "m");
                expect(r).toEqual({ contextWindow: 131072, maxTokens: 131072 });
                expect(dialog.notes.some((n) => n.includes("clamped"))).toBe(true);
        });

        test("three invalid context windows → null (the gate refuses)", async () => {
                const dialog = scriptedDialog(["x", "y", "z"]);
                const r = await askSpecNumbers(dialog, "m");
                expect(r).toBeNull();
        });

        test("recordUserSpec clamps and persists with user provenance", () => {
                const dir = agentDir("record-user");
                const spec = recordUserSpec(dir, "p", "m", { contextWindow: 100000, maxTokens: 200000 });
                expect(spec.maxTokens).toBe(100000); // clamped to the context window
                const sidecar = JSON.parse(readFileSync(join(dir, "model-specs.json"), "utf8"));
                expect(sidecar.specs["p/m"].source).toBe("user");
                expect(sidecar.specs["p/m"].maxTokens).toBe(100000);
        });
});

// ---------------------------------------------------------------------------
// resolveActiveModelId + readModelSpecsFromRegistry
// ---------------------------------------------------------------------------

describe("resolveActiveModelId", () => {
        const provider = { id: "agnes", modelIds: ["agnes-3.0-flash", "agnes-2.5-flash"] };
        test("no pin → settings defaultModel when it belongs to the provider, else first", () => {
                expect(resolveActiveModelId("ignored", provider, undefined, "agnes-2.5-flash")).toBe("agnes-2.5-flash");
                expect(resolveActiveModelId("ignored", provider, undefined, "other-model")).toBe("agnes-3.0-flash");
                expect(resolveActiveModelId("ignored", provider, undefined, undefined)).toBe("agnes-3.0-flash");
        });
        test("provider/model pin → the model part", () => {
                expect(resolveActiveModelId("ignored", provider, "agnes/agnes-2.5-flash", undefined)).toBe("agnes-2.5-flash");
        });
        test("bare pin passes through (pi's own resolver grammar)", () => {
                expect(resolveActiveModelId("ignored", provider, "some-model", undefined)).toBe("some-model");
        });
});

describe("readModelSpecsFromRegistry", () => {
        test("reads the model's numbers; missing model/file → undefined", () => {
                const dir = agentDir("registry-read");
                upsertProvider(dir, {
                        id: "p",
                        name: "P",
                        baseUrl: "http://x/v1",
                        api: "openai-completions",
                        modelId: "m1",
                        extraModelIds: ["m2"],
                        input: ["text"],
                });
                expect(readModelSpecsFromRegistry(dir, "p", "m1")).toEqual({ contextWindow: 131072, maxTokens: 8192 });
                expect(readModelSpecsFromRegistry(dir, "p", "nope")).toBeUndefined();
                expect(readModelSpecsFromRegistry(join(tmp, "never-created"), "p", "m1")).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// The wiring: upsert modelSpecs, applyModelSpecs, refresh, probe
// ---------------------------------------------------------------------------

describe("upsertProvider per-model modelSpecs", () => {
        test("per-model specs beat the entry-level numbers beat the catalog guess", () => {
                const dir = agentDir("upsert-specs");
                upsertProvider(dir, {
                        id: "p",
                        name: "P",
                        baseUrl: "http://x/v1",
                        api: "openai-completions",
                        modelId: "m-chosen",
                        extraModelIds: ["m-detected", "m-plain"],
                        input: ["text"],
                        contextWindow: 111111,
                        maxTokens: 22222,
                        modelSpecs: {
                                "m-chosen": { contextWindow: 524288, maxTokens: 65536 },
                                "m-detected": { contextWindow: 32768, maxTokens: 4096 },
                        },
                });
                const raw = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
                const byId = Object.fromEntries(raw.providers.p.models.map((m: any) => [m.id, m]));
                expect(byId["m-chosen"].contextWindow).toBe(524288); // per-model wins
                expect(byId["m-chosen"].maxTokens).toBe(65536);
                expect(byId["m-detected"].contextWindow).toBe(32768); // per-model for extras too
                expect(byId["m-plain"].contextWindow).toBe(111111); // entry-level fallback
                expect(byId["m-plain"].maxTokens).toBe(22222);
                // modelSpecs is a WRITE-SIDE input — never persisted as a provider field
                expect(raw.providers.p.modelSpecs).toBeUndefined();
        });
});

describe("applyModelSpecs (the self-heal write)", () => {
        test("updates existing entries only; unchanged values are not rewritten", () => {
                const dir = agentDir("heal");
                upsertProvider(dir, {
                        id: "p",
                        name: "P",
                        baseUrl: "http://x/v1",
                        api: "openai-completions",
                        modelId: "m1",
                        extraModelIds: ["m2"],
                        input: ["text"],
                });
                const applied = applyModelSpecs(dir, "p", {
                        m1: { contextWindow: 524288, maxTokens: 65536 },
                        "not-registered": { contextWindow: 1, maxTokens: 1 },
                });
                expect(applied).toEqual(["m1"]);
                const raw = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
                const m1 = raw.providers.p.models.find((m: any) => m.id === "m1");
                expect(m1.contextWindow).toBe(524288);
                // a second identical heal is a no-op
                expect(applyModelSpecs(dir, "p", { m1: { contextWindow: 524288, maxTokens: 65536 } })).toEqual([]);
        });
});

describe("refreshProviderModels stamps DETECTED specs + provenance (never asks)", () => {
        test("a spec-bearing catalog stamps each id its own numbers and records the sidecar", async () => {
                const dir = agentDir("refresh-detect");
                const srv = specEndpoint(0, [
                        { id: "local-a", max_model_len: 32768, max_tokens: 4096 },
                        { id: "local-b", max_model_len: 131072, max_tokens: 16384 },
                ]);
                try {
                        upsertProvider(dir, {
                                id: "local",
                                name: "Local",
                                baseUrl: srv.url,
                                api: "openai-completions",
                                modelId: "seed-model",
                                input: ["text"],
                        });
                        const result = await refreshProviderModels(dir, "local");
                        expect(result.added.sort()).toEqual(["local-a", "local-b"]);
                        const raw = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
                        const byId = Object.fromEntries(raw.providers.local.models.map((m: any) => [m.id, m]));
                        expect(byId["local-a"].contextWindow).toBe(32768);
                        expect(byId["local-a"].maxTokens).toBe(4096);
                        expect(byId["local-b"].contextWindow).toBe(131072);
                        expect(byId["local-b"].maxTokens).toBe(16384);
                        const sidecar = JSON.parse(readFileSync(join(dir, "model-specs.json"), "utf8"));
                        expect(sidecar.specs["local/local-a"].source).toBe("endpoint");
                        expect(sidecar.specs["local/local-b"].contextWindow).toBe(131072);
                } finally {
                        srv.stop();
                }
        });

        test("a spec-less catalog falls back to the guess stamp and records NOTHING", async () => {
                const dir = agentDir("refresh-miss");
                const srv = specEndpoint(0, [{ id: "mystery-7b" }]);
                try {
                        upsertProvider(dir, {
                                id: "local",
                                name: "Local",
                                baseUrl: srv.url,
                                api: "openai-completions",
                                modelId: "seed-model",
                                input: ["text"],
                        });
                        const result = await refreshProviderModels(dir, "local", 8000);
                        expect(result.added).toEqual(["mystery-7b"]);
                        const raw = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
                        const m = raw.providers.local.models.find((x: any) => x.id === "mystery-7b");
                        // the conservative default — the model is gated at session start
                        expect(m.contextWindow).toBe(131072);
                        expect(m.maxTokens).toBe(8192);
                        const sidecarPath = join(dir, "model-specs.json");
                        let sidecarExists = true;
                        try {
                                JSON.parse(readFileSync(sidecarPath, "utf8"));
                        } catch {
                                sidecarExists = false;
                        }
                        // recordSpec only fires on hits — but other models may have written
                        // records; assert THIS model has none.
                        if (sidecarExists) {
                                const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
                                expect(sidecar.specs["local/mystery-7b"]).toBeUndefined();
                        }
                } finally {
                        srv.stop();
                }
        });
});

describe("probe keeps the raw catalog entries", () => {
        test("modelEntries carries the spec fields the ids alone used to throw away", async () => {
                const srv = specEndpoint(0, [
                        { id: "m", max_model_len: 32768, meta: { n_ctx: 32768 }, loaded_context_length: 16384 },
                ]);
                try {
                        const probe = await probeProviderEndpoint(srv.url, undefined, { timeoutMs: 2000 });
                        expect(probe.ok).toBe(true);
                        expect(probe.models).toEqual(["m"]);
                        expect(Array.isArray(probe.modelEntries)).toBe(true);
                        expect((probe.modelEntries![0] as any).max_model_len).toBe(32768);
                        // and the detection cascade consumes exactly this shape
                        const part = await detectModelSpec("m", {
                                providerId: "local",
                                endpointCatalog: { data: probe.modelEntries! },
                        });
                        expect(part.spec?.contextWindow).toBe(16384); // loaded_context_length wins (runtime truth)
                } finally {
                        srv.stop();
                }
        });
});
