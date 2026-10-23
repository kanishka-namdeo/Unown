// models-catalog.test.ts — the bridge model catalog contract (Milestone 2.1
// follow-up found live in the v2.2.0 release audit).
//
// The audit's live E2E showed `--model qwen3.7-plus` sessions still chatting
// on kimi-k2.5: unown's models.json seeded exactly ONE model (PI_MODEL_ID),
// so pi had nothing else to select — /model showed a single entry,
// resolveCliModel had no catalog to resolve against, and the routing flags
// were inert even after the parseArgs fix. The fix registers the FULL bridge
// allow-list (BRIDGE_KNOWN_MODELS) wherever models.json is seeded. These
// tests pin:
//   - bridgeKnownModels: default first, dedupe, env-driven, fallback list
//   - writeModelsJson: fresh seed = full catalog; existing file = never clobbered
//   - writeAgentConfig: extraModelIds registers the extras in order (the
//     bridge setup path); without extras the single-model shape is unchanged
//     (the openai/custom presets)
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TEST_TMP } from "./_env.ts";
import { bridgeKnownModels, writeModelsJson } from "../src/term.ts";
import { writeAgentConfig } from "../src/setup.ts";

// Isolated agent dir for writeModelsJson (it takes the dir explicitly).
const DIR = join(TEST_TMP, "models-catalog");
beforeEach(() => {
        rmSync(DIR, { recursive: true, force: true });
        mkdirSync(DIR, { recursive: true });
});

// writeAgentConfig targets the module-level UNOWN_AGENT_DIR (the _env.ts
// UNOWN_HOME redirect keeps it inside the test tree). Preserve whatever was
// there and restore byte-identically so this file never leaks state.
// TRIPWIRE: the redirect once silently failed (checkout .env ships
// UNOWN_HOME= empty; `??=` kept it and term.ts fell back to the REAL
// ~/.unown) and a test run rewrote a live install — so the resolved path is
// asserted to be inside the test tree BEFORE any write happens (2026-10-22).
const AGENT_DIR_MODELS = join(process.env.UNOWN_HOME!, "agent", "models.json");
if (!AGENT_DIR_MODELS.startsWith(TEST_TMP)) {
        throw new Error(
                `test isolation failed: UNOWN_HOME resolved outside the test tree (${AGENT_DIR_MODELS}) — refusing to touch it`,
        );
}
const SAVED_MODELS: string | null = existsSync(AGENT_DIR_MODELS) ? readFileSync(AGENT_DIR_MODELS, "utf8") : null;
afterAll(() => {
        if (SAVED_MODELS === null) {
                rmSync(AGENT_DIR_MODELS, { force: true });
        } else {
                mkdirSync(dirname(AGENT_DIR_MODELS), { recursive: true });
                writeFileSync(AGENT_DIR_MODELS, SAVED_MODELS, "utf8");
        }
});

/** Set BRIDGE_KNOWN_MODELS for the duration of one test; restore after. */
function withKnownModels(value: string | undefined, fn: () => void): void {
        const prev = process.env.BRIDGE_KNOWN_MODELS;
        if (value === undefined) delete process.env.BRIDGE_KNOWN_MODELS;
        else process.env.BRIDGE_KNOWN_MODELS = value;
        try {
                fn();
        } finally {
                if (prev === undefined) delete process.env.BRIDGE_KNOWN_MODELS;
                else process.env.BRIDGE_KNOWN_MODELS = prev;
        }
}

describe("bridgeKnownModels — the served-catalog helper", () => {
        test("default model first, then the env list minus the default, order kept", () => {
                withKnownModels("kimi-k2.5,qwen3.7-plus,qwen3.6-plus", () => {
                        expect(bridgeKnownModels("qwen3.7-plus")).toEqual(["qwen3.7-plus", "kimi-k2.5", "qwen3.6-plus"]);
                        expect(bridgeKnownModels("kimi-k2.5")).toEqual(["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"]);
                });
        });

        test("falls back to the shipped default trio when the env is unset", () => {
                withKnownModels(undefined, () => {
                        expect(bridgeKnownModels("kimi-k2.5")).toEqual(["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"]);
                });
        });

        test("whitespace and empty entries are tolerated (trailing commas)", () => {
                withKnownModels(" a-model , b-model , , ", () => {
                        expect(bridgeKnownModels("a-model")).toEqual(["a-model", "b-model"]);
                });
        });
});

describe("writeModelsJson — the full catalog ships on a fresh seed", () => {
        test("fresh write registers every served model (default first)", () => {
                withKnownModels("kimi-k2.5,qwen3.7-plus,qwen3.6-plus", () => {
                        const out = writeModelsJson(DIR);
                        expect(out.fresh).toBe(true);
                        expect(out.modelId).toBe("kimi-k2.5");
                        const written = JSON.parse(readFileSync(join(DIR, "models.json"), "utf8"));
                        const ids = written.providers["zai-bridge"].models.map((m: any) => m.id);
                        expect(ids).toEqual(["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"]);
                });
        });

        test("known ids stamp their published spec; unknown ids keep the conservative defaults", () => {
                withKnownModels("agnes-3.0-flash,mystery-7b", () => {
                        const out = writeModelsJson(DIR);
                        expect(out.fresh).toBe(true);
                        const written = JSON.parse(readFileSync(join(DIR, "models.json"), "utf8"));
                        const models = written.providers["zai-bridge"].models as Array<Record<string, unknown>>;
                        const agnes = models.find((m) => m.id === "agnes-3.0-flash")!;
                        expect(agnes).toMatchObject({ contextWindow: 524288, maxTokens: 65536, input: ["text", "image"] });
                        const mystery = models.find((m) => m.id === "mystery-7b")!;
                        expect(mystery).toMatchObject({ contextWindow: 131072, maxTokens: 8192 });
                });
        });

        test("an existing models.json is never clobbered (setup owns rewrites)", () => {
                withKnownModels("kimi-k2.5,qwen3.7-plus,qwen3.6-plus", () => {
                        writeModelsJson(DIR); // fresh write
                        const marker = join(DIR, "models.json");
                        const edited = JSON.stringify({ ...JSON.parse(readFileSync(marker, "utf8")), hand_edited: true }, null, 2);
                        writeFileSync(marker, edited);
                        const second = writeModelsJson(DIR);
                        expect(second.fresh).toBe(false);
                        expect(readFileSync(marker, "utf8")).toBe(edited); // byte-identical
                });
        });
});

describe("writeAgentConfig — extraModelIds (the bridge setup path)", () => {
        test("extras register after the default, in order", () => {
                writeAgentConfig({
                        providerId: "zai-bridge",
                        providerName: "unown llm-bridge",
                        baseUrl: "http://127.0.0.1:9/v1",
                        api: "openai-completions",
                        modelId: "kimi-k2.5",
                        input: ["text", "image"],
                        apiKeyInModelsJson: "bridge-local",
                        extraModelIds: ["qwen3.7-plus", "qwen3.6-plus"],
                });
                const written = JSON.parse(readFileSync(AGENT_DIR_MODELS, "utf8"));
                const ids = written.providers["zai-bridge"].models.map((m: any) => m.id);
                expect(ids).toEqual(["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"]);
        });

        test("without extras the single-model shape is unchanged (non-bridge presets)", () => {
                writeAgentConfig({
                        providerId: "openai",
                        providerName: "OpenAI",
                        baseUrl: "https://api.openai.com/v1",
                        api: "openai-completions",
                        modelId: "gpt-4o",
                        input: ["text", "image"],
                        apiKeyInAuthJson: "sk-test",
                });
                const written = JSON.parse(readFileSync(AGENT_DIR_MODELS, "utf8"));
                expect(written.providers["openai"].models).toHaveLength(1);
                expect(written.providers["openai"].models[0].id).toBe("gpt-4o");
        });
});
