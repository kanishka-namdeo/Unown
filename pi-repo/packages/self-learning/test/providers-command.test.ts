// providers-command.test.ts — the /providers slash command (R2, the TUI native).
//
// Everything runs against an ISOLATED temp agent dir passed through the
// command's deps (providers-command.ts is structural on purpose): the two
// network-reaching registry calls (testProvider, refreshProviderModels) are
// stubbed per test — no real endpoints, no real ~/.unown — while every disk
// mutation goes through the REAL registry core (providers.ts), so the tests
// pin the same contract the CLI rides.
//
// No ./_env.ts import on purpose: this file's import chain (providers-command
// → providers/presets/probe/term) never reaches store.ts, and the bunfig
// [test] preload already redirects the process env for whichever file needs
// it. The interactive flows drive a fake ctx with scripted select/input/
// confirm queues (the tools.test.ts fake-pi posture).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        defaultProvidersDeps,
        providerListLines,
        providersArgumentCompletions,
        runProvidersCommand,
        type ProvidersCommandCtx,
        type ProvidersCommandDeps,
} from "../src/providers-command.ts";
import { listProviders, upsertProvider, type ProviderEntry } from "../src/providers.ts";
import { PRESETS } from "../src/presets.ts";

let DIR = "";
beforeEach(() => {
        DIR = mkdtempSync(join(tmpdir(), "unown-providers-cmd-"));
});
afterAll(() => {
        rmSync(DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const agnes = (over: Partial<ProviderEntry> = {}): ProviderEntry => ({
        id: "agnes",
        name: "Agnes AI",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        api: "openai-completions",
        modelId: "agnes-3.0-flash",
        extraModelIds: ["agnes-2.5-flash"],
        input: ["text", "image"],
        apiKeyInAuthJson: "cpk-test-1",
        ...over,
});

function seedRegistry(dir = DIR, entries: ProviderEntry[] = [agnes()]): void {
        for (const e of entries) upsertProvider(dir, e);
}

function rawModels(dir = DIR): Record<string, any> {
        return JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
}
function rawAuth(dir = DIR): Record<string, any> {
        return JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"));
}

/** Scripted fake ctx: queues for select/input/confirm, a notify recorder, a
 *  modelRegistry.refresh counter (the seam /model's picker re-reads through). */
function makeCtx(script: { selects?: string[]; inputs?: string[]; confirms?: boolean[]; hasUI?: boolean } = {}) {
        const messages: Array<{ text: string; level: string }> = [];
        const selects: string[] = [...(script.selects ?? [])];
        const confirms: boolean[] = [...(script.confirms ?? [])];
        const seenSelects: Array<{ title: string; options: string[] }> = [];
        const seenInputTitles: string[] = [];
        let refreshes = 0;
        const ctx: ProvidersCommandCtx = {
                mode: script.hasUI === false ? "print" : "tui",
                hasUI: script.hasUI !== false,
                ui: {
                        select: async (title: string, options: string[]) => {
                                seenSelects.push({ title, options });
                                return selects.shift();
                        },
                        confirm: async () => confirms.shift() ?? false,
                        input: async (title: string, _placeholder?: string) => {
                                seenInputTitles.push(title);
                                return (script.inputs ?? []).shift();
                        },
                        notify: (text: string, level: string = "info") => messages.push({ text, level }),
                },
                modelRegistry: {
                        refresh: async () => {
                                refreshes++;
                        },
                },
        };
        // refreshes is a counter — expose it as a getter (a bare number would be
        // captured by value at construction and never move).
        return { ctx, messages, seenSelects, seenInputTitles, refreshes: () => refreshes };
}

interface Stubs {
        test?: ProvidersCommandDeps["testProvider"];
        refresh?: ProvidersCommandDeps["refreshProviderModels"];
}

function depsFor(dir: string = DIR, stubs: Stubs = {}): ProvidersCommandDeps {
        return {
                agentDir: dir,
                testProvider:
                        stubs.test ??
                        (() =>
                                Promise.resolve({
                                        found: true,
                                        probe: { ok: true, status: 200, models: ["agnes-3.0-flash", "agnes-2.5-flash"] },
                                        keySource: "auth-json",
                                })),
                refreshProviderModels:
                        stubs.refresh ??
                        (() => Promise.resolve({ found: true, added: [], missing: [], served: ["agnes-3.0-flash", "agnes-2.5-flash"] })),
        };
}

/** A refresh stub that behaves like the real import: registers ids into
 *  models.json AND reports them (so the add-flow's model picker + count work). */
function fakeDiscovery(served: string[]): ProvidersCommandDeps["refreshProviderModels"] {
        return async (agentDir: string, providerId: string) => {
                const raw = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8"));
                const entry = raw.providers[providerId];
                if (!entry || !Array.isArray(entry.models)) {
                        return { found: true, added: [], missing: [], problem: "provider entry has no models array — fix models.json" };
                }
                const known = new Set(entry.models.map((m: any) => m.id));
                const added = served.filter((m) => !known.has(m));
                for (const id of added) {
                        entry.models.push({ id, name: `${id} (via unown)`, contextWindow: 131072, maxTokens: 8192, input: ["text", "image"] });
                }
                if (added.length > 0) writeFileSync(join(agentDir, "models.json"), JSON.stringify(raw, null, 2) + "\n", "utf8");
                return { found: true, added, missing: [], served };
        };
}

const last = (messages: Array<{ text: string; level: string }>) => messages[messages.length - 1];

// ---------------------------------------------------------------------------
// argument grammar + the text summary
// ---------------------------------------------------------------------------

describe("/providers argument grammar", () => {
        test("bare command with hasUI=false renders the text summary, no dialogs", async () => {
                seedRegistry();
                const { ctx, messages, seenSelects } = makeCtx({ hasUI: false });
                await runProvidersCommand("", ctx, depsFor());
                expect(seenSelects).toHaveLength(0);
                expect(messages).toHaveLength(1);
                expect(messages[0].level).toBe("info");
                expect(messages[0].text).toContain("✓ agnes — Agnes AI (default)");
                expect(messages[0].text).toContain("unown providers --help for the CLI twin");
        });

        test("bare command with hasUI=false does NOT advertise the interactive manager", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx({ hasUI: false });
                await runProvidersCommand("", ctx, depsFor());
                expect(messages[0].text).not.toContain("/providers to manage interactively");
        });

        test("`list` (and `ls`) always renders the summary, even with dialogs available", async () => {
                seedRegistry();
                for (const sub of ["list", "ls"]) {
                        const { ctx, messages, seenSelects } = makeCtx();
                        await runProvidersCommand(sub, ctx, depsFor());
                        expect(seenSelects).toHaveLength(0);
                        expect(messages).toHaveLength(1);
                        expect(messages[0].text).toContain("✓ agnes — Agnes AI");
                }
        });

        test("unknown subcommand errors with usage", async () => {
                const { ctx, messages } = makeCtx();
                await runProvidersCommand("frobnicate", ctx, depsFor());
                expect(last(messages).level).toBe("error");
                expect(last(messages).text).toContain('Unknown /providers argument "frobnicate"');
                expect(last(messages).text).toContain("Usage: /providers [list | test <id> | refresh <id>]");
        });

        test("empty registry says so and points at the manager + setup", async () => {
                const { ctx, messages } = makeCtx();
                await runProvidersCommand("list", ctx, depsFor());
                expect(messages[0].text).toContain("No providers configured yet");
                expect(messages[0].text).toContain("/providers");
                expect(messages[0].text).toContain("unown setup");
        });

        test("invalid models.json surfaces the error + repair hints, as an error notify", async () => {
                mkdirSync(DIR, { recursive: true });
                writeFileSync(join(DIR, "models.json"), "{ not json", "utf8");
                const { ctx, messages } = makeCtx();
                await runProvidersCommand("list", ctx, depsFor());
                expect(messages[0].level).toBe("error");
                expect(messages[0].text).toContain("models.json is invalid");
                expect(messages[0].text).toContain("unown doctor");
                expect(messages[0].text).toContain("unown setup --provider <p> --force");
        });
});

describe("providerListLines — the text render", () => {
        test("two providers: default marker, base URLs, key labels, model counts, canonical default model", () => {
                seedRegistry(DIR, [
                        agnes(),
                        {
                                id: "openai",
                                name: "OpenAI",
                                baseUrl: "https://api.openai.com/v1",
                                api: "openai-completions",
                                modelId: "gpt-4o",
                                input: ["text", "image"],
                                apiKeyEnvRef: "OPENAI_API_KEY",
                        },
                ]);
                const lines = providerListLines(listProviders(DIR), { hasUI: true });
                const text = lines.join("\n");
                expect(text).toContain("✓ agnes — Agnes AI (default)");
                expect(text).toContain("✓ openai — OpenAI");
                expect(text).toContain("https://apihub.agnes-ai.com/v1");
                expect(text).toContain("key: auth.json");
                expect(text).toContain("key: $OPENAI_API_KEY");
                expect(text).toContain("2 models");
                expect(text).toContain("1 model");
                expect(text).toContain("default model: agnes/agnes-3.0-flash");
                expect(text).toContain("/providers to manage interactively · unown providers --help for the CLI twin");
                // the canonical line rides ONLY the default provider
                expect(text.match(/default model: /g)).toHaveLength(1);
        });
});

// ---------------------------------------------------------------------------
// one-shots: /providers test <id> · /providers refresh <id>
// ---------------------------------------------------------------------------

describe("/providers test <id> — live probe verdicts (stubbed network)", () => {
        test("missing id → usage warning listing the configured providers", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx();
                await runProvidersCommand("test", ctx, depsFor());
                expect(last(messages).level).toBe("warning");
                expect(last(messages).text).toContain("/providers test <id> — which provider?");
                expect(last(messages).text).toContain("agnes");
        });

        test("unknown id → error naming the configured ones", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx();
                await runProvidersCommand("test bogus", ctx, depsFor());
                expect(last(messages).level).toBe("error");
                expect(last(messages).text).toContain('unknown provider "bogus"');
                expect(last(messages).text).toContain("agnes");
        });

        test("reachable → ✓ verdict with the credential source + served models", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx();
                await runProvidersCommand("test agnes", ctx, depsFor());
                expect(last(messages).level).toBe("info");
                expect(last(messages).text).toContain("✓ agnes reachable at https://apihub.agnes-ai.com/v1");
                expect(last(messages).text).toContain("credential: auth-json");
                expect(last(messages).text).toContain("serves 2 models");
        });

        test("401 → actionable key rotation hint (the CLI's classification)", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx();
                await runProvidersCommand(
                        "test agnes",
                        ctx,
                        depsFor(DIR, { test: () => Promise.resolve({ found: true, probe: { ok: false, status: 401, problem: "auth" }, keySource: "auth-json" }) }),
                );
                expect(last(messages).level).toBe("error");
                expect(last(messages).text).toContain("✗ agnes rejected the credential (HTTP 401)");
                expect(last(messages).text).toContain("Set API key");
                expect(last(messages).text).toContain("unown providers key agnes");
        });

        test("unreachable → URL/network hint with the re-point command", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx();
                await runProvidersCommand("test agnes", ctx, depsFor(DIR, { test: () => Promise.resolve({ found: true, probe: { ok: false, problem: "unreachable" } }) }));
                expect(last(messages).level).toBe("error");
                expect(last(messages).text).toContain("✗ agnes unreachable at https://apihub.agnes-ai.com/v1");
                expect(last(messages).text).toContain("unown providers add --provider agnes --base-url <url>");
        });

        test("env-ref credential renders as $VAR", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx();
                await runProvidersCommand(
                        "test agnes",
                        ctx,
                        depsFor(DIR, { test: () => Promise.resolve({ found: true, probe: { ok: true, status: 200, models: [] }, keySource: "env-ref", keyEnv: "AGNES_API_KEY" }) }),
                );
                expect(last(messages).text).toContain("credential: $AGNES_API_KEY");
        });
});

describe("/providers refresh <id> — live discovery verdicts (stubbed network)", () => {
        test("new models → import verdict + /model composition hint, modelRegistry refreshed", async () => {
                seedRegistry();
                const { ctx, messages, refreshes } = makeCtx();
                await runProvidersCommand(
                        "refresh agnes",
                        ctx,
                        depsFor(DIR, { refresh: () => Promise.resolve({ found: true, added: ["agnes-4.0-flash"], missing: ["agnes-2.5-flash"], served: ["agnes-3.0-flash", "agnes-4.0-flash"] }) }),
                );
                expect(last(messages).level).toBe("info");
                expect(last(messages).text).toContain("✓ imported 1 new model from agnes: agnes-4.0-flash");
                expect(last(messages).text).toContain("⚠ registered but no longer served (kept");
                expect(last(messages).text).toContain("/model mid-session");
                expect(refreshes()).toBe(1);
        });

        test("`sync` alias dispatches the same path", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx();
                await runProvidersCommand("sync agnes", ctx, depsFor(DIR, { refresh: () => Promise.resolve({ found: true, added: [], missing: [], served: ["agnes-3.0-flash"] }) }));
                expect(last(messages).text).toContain("✓ agnes is in sync — 1 chat models served");
        });

        test("auth problem → reason + rotate hint as a warning", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx();
                await runProvidersCommand(
                        "refresh agnes",
                        ctx,
                        depsFor(DIR, { refresh: () => Promise.resolve({ found: true, added: [], missing: [], probe: { ok: false, status: 401, problem: "auth" }, problem: "endpoint rejected the credential (HTTP 401)" }) }),
                );
                expect(last(messages).level).toBe("warning");
                expect(last(messages).text).toContain("· agnes: endpoint rejected the credential (HTTP 401)");
                expect(last(messages).text).toContain("rotate the key");
        });

        test("unknown id → error (no registry touch)", async () => {
                seedRegistry();
                const { ctx, messages, refreshes } = makeCtx();
                await runProvidersCommand("refresh bogus", ctx, depsFor());
                expect(last(messages).level).toBe("error");
                expect(refreshes()).toBe(0);
        });
});

// ---------------------------------------------------------------------------
// the interactive manager (scripted select/input/confirm queues)
// ---------------------------------------------------------------------------

describe("interactive manager — entry list + navigation", () => {
        test("bare /providers opens the select with entry rows + Add + Done; Done exits silently", async () => {
                seedRegistry();
                const { ctx, seenSelects, messages } = makeCtx({ selects: ["Done"] });
                await runProvidersCommand("", ctx, depsFor());
                expect(seenSelects).toHaveLength(1);
                expect(seenSelects[0].title).toBe("Providers");
                expect(seenSelects[0].options).toContain("✓ agnes — Agnes AI (default) · key: auth.json · 2 models");
                expect(seenSelects[0].options).toContain("+ Add provider…");
                expect(seenSelects[0].options).toContain("Done");
                expect(messages).toHaveLength(0);
        });

        test("Esc at the top-level select (undefined) aborts without a notify", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx({ selects: [undefined as unknown as string] });
                await runProvidersCommand("", ctx, depsFor());
                expect(messages).toHaveLength(0);
        });

        test("listProviders error → error notify + doctor hint, no dialogs", async () => {
                mkdirSync(DIR, { recursive: true });
                writeFileSync(join(DIR, "models.json"), "{ nope", "utf8");
                const { ctx, messages, seenSelects } = makeCtx();
                await runProvidersCommand("", ctx, depsFor());
                expect(seenSelects).toHaveLength(0);
                expect(messages).toHaveLength(1);
                expect(messages[0].level).toBe("error");
                expect(messages[0].text).toContain("models.json is invalid");
        });
});

describe("interactive — Make default…", () => {
        test("picks a model → settings.json default (asserted via listProviders) + /model hint + registry refresh", async () => {
                seedRegistry();
                const { ctx, messages, refreshes } = makeCtx({
                        selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Make default…", "agnes-2.5-flash", "Done"],
                });
                await runProvidersCommand("", ctx, depsFor());
                expect(last(messages).level).toBe("info");
                expect(last(messages).text).toBe("✓ default set to agnes/agnes-2.5-flash — use /model to switch this session");
                const list = listProviders(DIR);
                expect(list.defaultProvider).toBe("agnes");
                expect(list.defaultModel).toBe("agnes-2.5-flash");
                expect(refreshes()).toBe(1);
        });

        test("Back at the model picker changes nothing", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx({ selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Make default…", "Back", "Done"] });
                await runProvidersCommand("", ctx, depsFor());
                expect(messages).toHaveLength(0);
                expect(listProviders(DIR).defaultModel).toBe("agnes-3.0-flash");
        });

        test("provider without models is warned, not crashed", async () => {
                seedRegistry(DIR, [agnes({ extraModelIds: undefined })]);
                // hand-strip the models array to the degenerate case: a provider entry with no models
                const raw = rawModels();
                raw.providers.agnes.models = [];
                writeFileSync(join(DIR, "models.json"), JSON.stringify(raw, null, 2) + "\n", "utf8");
                const { ctx, messages } = makeCtx({ selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 0 models", "Make default…"] });
                await runProvidersCommand("", ctx, depsFor());
                expect(last(messages).level).toBe("warning");
                expect(last(messages).text).toContain("agnes has no models registered");
        });
});

describe("interactive — Set API key", () => {
        test("entered key → auth.json (pi shape, 0600 POSIX) + immediate verify verdict", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx({
                        selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Set API key"],
                        inputs: ["cpk-rotated-2"],
                });
                await runProvidersCommand("", ctx, depsFor());
                expect(rawAuth().agnes).toEqual({ type: "api_key", key: "cpk-rotated-2" });
                if (process.platform !== "win32") {
                        expect(statSync(join(DIR, "auth.json")).mode & 0o777).toBe(0o600);
                }
                expect(last(messages).level).toBe("info");
                expect(last(messages).text).toContain("✓ key stored for agnes — endpoint accepts it");
        });

        test("blank input keeps the current key (no writes, no notify)", async () => {
                seedRegistry();
                const before = readFileSync(join(DIR, "auth.json"), "utf8");
                const { ctx, messages } = makeCtx({
                        selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Set API key"],
                        inputs: ["  "],
                });
                await runProvidersCommand("", ctx, depsFor());
                expect(messages).toHaveLength(0);
                expect(readFileSync(join(DIR, "auth.json"), "utf8")).toBe(before);
        });

        test("stored-but-rejected key → warning with the HTTP status", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx({
                        selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Set API key"],
                        inputs: ["cpk-bad"],
                });
                await runProvidersCommand(
                        "",
                        ctx,
                        depsFor(DIR, { test: () => Promise.resolve({ found: true, probe: { ok: false, status: 401, problem: "auth" }, keySource: "auth-json" }) }),
                );
                expect(rawAuth().agnes.key).toBe("cpk-bad");
                expect(last(messages).level).toBe("warning");
                expect(last(messages).text).toContain("endpoint rejected it (HTTP 401)");
        });
});

describe("interactive — Test connection / Refresh models", () => {
        test("action menu order + labels (the spec's six actions)", async () => {
                seedRegistry();
                const { ctx, seenSelects } = makeCtx({ selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Back", "Done"] });
                await runProvidersCommand("", ctx, depsFor());
                expect(seenSelects[1].title).toBe("agnes");
                expect(seenSelects[1].options).toEqual(["Make default…", "Set API key", "Test connection", "Refresh models", "Remove provider…", "Back"]);
        });

        test("Test connection → same verdict as the one-shot", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx({ selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Test connection"] });
                await runProvidersCommand("", ctx, depsFor());
                expect(last(messages).text).toContain("✓ agnes reachable at https://apihub.agnes-ai.com/v1");
        });

        test("Refresh models → import verdict + registry refresh seam", async () => {
                seedRegistry();
                const { ctx, messages, refreshes } = makeCtx({
                        selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Refresh models"],
                });
                await runProvidersCommand(
                        "",
                        ctx,
                        depsFor(DIR, { refresh: () => Promise.resolve({ found: true, added: ["agnes-4.0-flash"], missing: [], served: ["agnes-3.0-flash", "agnes-2.5-flash", "agnes-4.0-flash"] }) }),
                );
                expect(last(messages).text).toContain("✓ imported 1 new model from agnes: agnes-4.0-flash");
                expect(refreshes()).toBe(1);
        });
});

describe("interactive — Remove provider…", () => {
        function seedTwo() {
                seedRegistry(DIR, [
                        agnes(),
                        {
                                id: "openai",
                                name: "OpenAI",
                                baseUrl: "https://api.openai.com/v1",
                                api: "openai-completions",
                                modelId: "gpt-4o",
                                input: ["text", "image"],
                                apiKeyInAuthJson: "sk-test",
                        },
                ]);
        }

        test("confirm=true → provider + stored key gone, default falls back to the survivor", async () => {
                seedTwo();
                const { ctx, messages, refreshes } = makeCtx({
                        selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Remove provider…"],
                        confirms: [true],
                });
                await runProvidersCommand("", ctx, depsFor());
                expect(Object.keys(rawModels().providers)).toEqual(["openai"]);
                expect(rawAuth().agnes).toBeUndefined();
                expect(rawAuth().openai).toEqual({ type: "api_key", key: "sk-test" });
                expect(last(messages).level).toBe("info");
                expect(last(messages).text).toContain("✓ removed agnes (its stored key went with it)");
                expect(last(messages).text).toContain("default fell back to openai/gpt-4o");
                expect(listProviders(DIR).defaultProvider).toBe("openai");
                expect(refreshes()).toBe(1);
        });

        test("confirm=false → nothing is removed", async () => {
                seedTwo();
                const { ctx, messages } = makeCtx({
                        selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Remove provider…"],
                        confirms: [false],
                });
                await runProvidersCommand("", ctx, depsFor());
                expect(messages).toHaveLength(0);
                expect(Object.keys(rawModels().providers).sort()).toEqual(["agnes", "openai"]);
        });

        test("removing the LAST provider says so instead of a broken default line", async () => {
                seedRegistry();
                const { ctx, messages } = makeCtx({
                        selects: ["✓ agnes — Agnes AI (default) · key: auth.json · 2 models", "Remove provider…"],
                        confirms: [true],
                });
                await runProvidersCommand("", ctx, depsFor());
                expect(last(messages).text).toContain("no providers left — add one before your next session");
        });
});

// ---------------------------------------------------------------------------
// interactive — Add provider (preset + custom)
// ---------------------------------------------------------------------------

describe("interactive — Add provider (presets)", () => {
        test("add-preset happy path: key → discovery → default-model pick → upsert + notify summary", async () => {
                const agnesPreset = PRESETS.find((p) => p.id === "agnes")!;
                const { ctx, seenSelects, messages } = makeCtx({
                        selects: ["+ Add provider…", agnesPreset.label, "agnes-2.5-flash", "Done"],
                        inputs: ["cpk-fresh-1"],
                });
                await runProvidersCommand("", ctx, depsFor(DIR, { refresh: fakeDiscovery(["agnes-3.0-flash", "agnes-2.5-flash"]) }));
                // registry: provider written with the preset's model + the discovered one
                const ids = rawModels().providers.agnes.models.map((m: any) => m.id);
                expect(ids.sort()).toEqual(["agnes-2.5-flash", "agnes-3.0-flash"]);
                expect(rawModels().providers.agnes.baseUrl).toBe("https://apihub.agnes-ai.com/v1");
                // key → auth.json, 0600 POSIX
                expect(rawAuth().agnes).toEqual({ type: "api_key", key: "cpk-fresh-1" });
                if (process.platform !== "win32") {
                        expect(statSync(join(DIR, "auth.json")).mode & 0o777).toBe(0o600);
                }
                // first provider in an empty registry becomes the default (CLI parity)
                const list = listProviders(DIR);
                expect(list.defaultProvider).toBe("agnes");
                expect(list.defaultModel).toBe("agnes-2.5-flash");
                // the default-model picker saw the DISCOVERED chat models
                expect(seenSelects[2].title).toBe("Default model for agnes");
                expect(seenSelects[2].options).toEqual(["agnes-3.0-flash", "agnes-2.5-flash", "Back"]);
                expect(last(messages).level).toBe("info");
                expect(last(messages).text).toContain("✓ added agnes — 2 models imported, default agnes/agnes-2.5-flash");
                expect(last(messages).text).toContain("use /model to switch this session");
        });

        test("add-preset discovery failure: preset default model still registered, failure surfaced with the fix", async () => {
                const agnesPreset = PRESETS.find((p) => p.id === "agnes")!;
                const { ctx, messages } = makeCtx({
                        selects: ["+ Add provider…", agnesPreset.label, "Done"],
                        inputs: ["cpk-rejected"],
                });
                await runProvidersCommand(
                        "",
                        ctx,
                        depsFor(DIR, {
                                refresh: () =>
                                        Promise.resolve({
                                                found: true,
                                                added: [],
                                                missing: [],
                                                probe: { ok: false, status: 401, problem: "auth" },
                                                problem: "endpoint rejected the credential (HTTP 401)",
                                        }),
                        }),
                );
                expect(rawModels().providers.agnes.models.map((m: any) => m.id)).toEqual(["agnes-3.0-flash"]);
                expect(last(messages).level).toBe("warning");
                expect(last(messages).text).toContain("model discovery failed: endpoint rejected the credential (HTTP 401)");
                expect(last(messages).text).toContain("Set API key or Refresh models");
                // the key the user typed still landed in auth.json
                expect(rawAuth().agnes.key).toBe("cpk-rejected");
        });

        test("add-preset into a NON-empty registry: picking a model in the Default-model dialog makes it the default (explicit act)", async () => {
                seedRegistry(); // agnes is the default
                const openaiPreset = PRESETS.find((p) => p.id === "openai")!;
                const { ctx, messages } = makeCtx({
                        selects: ["+ Add provider…", openaiPreset.label, "gpt-4o", "Done"],
                        inputs: [""], // keyless
                });
                await runProvidersCommand("", ctx, depsFor(DIR, { refresh: fakeDiscovery(["gpt-4o", "gpt-4o-mini"]) }));
                const list = listProviders(DIR);
                expect(list.providers.map((p) => p.id).sort()).toEqual(["agnes", "openai"]);
                // the dialog is titled "Default model for openai" — picking is an explicit
                // default-setting act (the notify reports it; nothing silent)
                expect(list.defaultProvider).toBe("openai");
                expect(list.defaultModel).toBe("gpt-4o");
                expect(last(messages).text).toContain("default openai/gpt-4o");
                // the keyless add wrote no NEW secrets (agnes's seeded key remains)
                expect(rawAuth().openai).toBeUndefined();
        });

        test("add-preset into a NON-empty registry with Back at the model dialog keeps the current default", async () => {
                seedRegistry();
                const openaiPreset = PRESETS.find((p) => p.id === "openai")!;
                const { ctx, messages } = makeCtx({
                        selects: ["+ Add provider…", openaiPreset.label, "Back", "Done"],
                        inputs: [""],
                });
                await runProvidersCommand("", ctx, depsFor(DIR, { refresh: fakeDiscovery(["gpt-4o"]) }));
                expect(listProviders(DIR).defaultProvider).toBe("agnes"); // untouched
                expect(last(messages).text).toContain("make it the default: /providers → openai → Make default…");
        });

        test("the bridge preset keeps the CLI's special rules (zai-bridge id, placeholder key, allow-list)", async () => {
                const bridgePreset = PRESETS.find((p) => p.id === "bridge")!;
                const { ctx, seenSelects, seenInputTitles } = makeCtx({
                        selects: ["+ Add provider…", bridgePreset.label, "kimi-k2.5", "Done"],
                });
                await runProvidersCommand("", ctx, depsFor(DIR, { refresh: fakeDiscovery(["kimi-k2.5"]) }));
                const entry = rawModels().providers["zai-bridge"];
                expect(entry).toBeDefined();
                expect(entry.apiKey).toBe("bridge-local");
                expect(entry.baseUrl).toBe(process.env.PI_BRIDGE_URL ? `${process.env.PI_BRIDGE_URL.replace(/\/+$/, "")}/v1` : "http://127.0.0.1:3031/v1");
                // the served allow-list rides along (BRIDGE_KNOWN_MODELS), no key prompt
                expect(seenInputTitles).toHaveLength(0);
                expect(seenSelects.some((s) => s.title === "API key for bridge")).toBe(false);
        });

        test("Back at the preset picker adds nothing", async () => {
                const { ctx, messages } = makeCtx({ selects: ["+ Add provider…", "Back", "Done"] });
                await runProvidersCommand("", ctx, depsFor());
                expect(messages).toHaveLength(0);
                expect(existsSync(join(DIR, "models.json"))).toBe(false);
        });
});

describe("interactive — Add provider (custom)", () => {
        const customPreset = PRESETS.find((p) => p.id === "custom")!;

        test("the 4-input form: id → base URL → model → optional key; keyless notify", async () => {
                const { ctx, messages } = makeCtx({
                        selects: ["+ Add provider…", customPreset.label, "Done"],
                        inputs: ["ollama", "http://127.0.0.1:11434/v1", "llama3", ""],
                });
                // capture the input prompts (title + placeholder) for the form assertion
                const prompts: string[] = [];
                const origInput = ctx.ui.input.bind(ctx.ui);
                (ctx.ui as any).input = async (title: string, placeholder?: string) => {
                        prompts.push(`${title}|${placeholder ?? ""}`);
                        return origInput(title, placeholder);
                };
                await runProvidersCommand("", ctx, depsFor());
                expect(prompts).toHaveLength(4);
                expect(prompts[0]).toContain("Provider id");
                expect(prompts[1]).toContain("Endpoint base URL");
                expect(prompts[2]).toBe("Model id|");
                expect(prompts[3]).toContain("API key (optional");
                const entry = rawModels().providers.ollama;
                expect(entry.baseUrl).toBe("http://127.0.0.1:11434/v1");
                expect(entry.models.map((m: any) => m.id)).toEqual(["llama3"]);
                expect(entry.apiKey).toBeUndefined();
                expect(listProviders(DIR).defaultProvider).toBe("ollama"); // empty registry → default
                expect(last(messages).text).toContain("✓ added ollama → http://127.0.0.1:11434/v1 (model llama3, default ollama/llama3)");
                expect(last(messages).text).toContain("keyless (fine for local servers)");
        });

        test("bad registry id is rejected before any write", async () => {
                const { ctx, messages } = makeCtx({
                        selects: ["+ Add provider…", customPreset.label],
                        inputs: ["Not Valid"],
                });
                await runProvidersCommand("", ctx, depsFor());
                expect(last(messages).level).toBe("error");
                expect(last(messages).text).toContain('bad registry id "Not Valid"');
                expect(existsSync(join(DIR, "models.json"))).toBe(false);
        });

        test("missing model id aborts with a warning, nothing written", async () => {
                const { ctx, messages } = makeCtx({
                        selects: ["+ Add provider…", customPreset.label],
                        inputs: ["vllm", "http://localhost:8000/v1", ""],
                });
                await runProvidersCommand("", ctx, depsFor());
                expect(last(messages).level).toBe("warning");
                expect(last(messages).text).toContain("no model id given");
                expect(existsSync(join(DIR, "models.json"))).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// argument completions
// ---------------------------------------------------------------------------

describe("providersArgumentCompletions", () => {
        const HOME = mkdtempSync(join(tmpdir(), "unown-providers-cmd-env-"));
        const SAVED = process.env.UNOWN_HOME;
        afterAll(() => {
                if (SAVED === undefined) delete process.env.UNOWN_HOME;
                else process.env.UNOWN_HOME = SAVED;
                rmSync(HOME, { recursive: true, force: true });
        });

        test("subcommand completions filter by prefix (list | test | refresh)", () => {
                expect(providersArgumentCompletions("")).toEqual([
                        { value: "list", label: "list" },
                        { value: "test", label: "test" },
                        { value: "refresh", label: "refresh" },
                ]);
                expect(providersArgumentCompletions("l")).toEqual([{ value: "list", label: "list" }]);
                expect(providersArgumentCompletions("te")).toEqual([{ value: "test", label: "test" }]);
                expect(providersArgumentCompletions("zzz")).toBeNull();
        });

        test("provider ids complete after test/refresh (registry read live)", () => {
                process.env.UNOWN_HOME = HOME;
                const agent = join(HOME, "agent");
                mkdirSync(agent, { recursive: true });
                seedRegistry(agent);
                expect(providersArgumentCompletions("test ")).toEqual([{ value: "agnes", label: "agnes" }]);
                expect(providersArgumentCompletions("refresh ag")).toEqual([{ value: "agnes", label: "agnes" }]);
                expect(providersArgumentCompletions("test zz")).toBeNull();
                // ids only after test/refresh — not after other words
                expect(providersArgumentCompletions("list ag")).toBeNull();
        });

        test("default deps resolve the agent dir under the ACTIVE UNOWN_HOME", () => {
                process.env.UNOWN_HOME = HOME;
                expect(defaultProvidersDeps().agentDir).toBe(join(HOME, "agent"));
        });
});
