// providers-cli.test.ts — `unown providers` golden tests (M1).
//
// Spawn-level like the other CLI suites: the REAL bin/unown, a private
// UNOWN_HOME per run, the mock bridge for live endpoint answers. Pins the
// multi-provider CLI contract:
//
//   list        empty → guidance; populated → per-provider blocks + default
//   add         non-interactive preset add with live verification; ACCUMULATES
//               (second add keeps the first); --key-env stores $VAR (no secret
//               in models.json); bridge preset uses the zai-bridge id + the
//               placeholder key; --default steals the default explicitly
//   remove      drops provider + key; default falls back; unknown → exit 1
//   default     validation + success
//   key         rotation with live verification; non-interactive needs --api-key
//   test        reachable/rejected/unknown classification
//   help/usage  -h never runs; unknown subcommand errors
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockBridge, sweepTestRoots, unown, type UnownRunOptions, type MockBridge } from "./helpers.ts";

const LONG = 30_000;
let bridge: MockBridge;
const base = (extra: Partial<UnownRunOptions> = {}): UnownRunOptions => ({ bridge, ...extra });

/** A SHARED root so several `unown()` spawns see the same UNOWN_HOME — the
 * multi-provider flows under test are inherently multi-command. */
function sharedRoot(prefix: string): string {
        return mkdtempSync(join(tmpdir(), `unown-prov-cli-${prefix}-`));
}

function agentJson(run: { unownHome: string }, name: string): Record<string, any> {
        return JSON.parse(readFileSync(join(run.unownHome, "agent", name), "utf8"));
}

beforeAll(() => {
        bridge = startMockBridge({ label: "providers-cli" });
});
afterAll(() => {
        bridge?.close();
        sweepTestRoots();
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("unown providers list", () => {
        test(
                "empty registry → guidance to add, exit 0",
                async () => {
                        const run = await unown(["providers", "list"], base());
                        expect(run.exitCode).toBe(0);
                        expect(run.stdout).toContain("No providers configured yet");
                        expect(run.stdout).toContain("unown providers add");
                },
                LONG,
        );

        test(
                "populated → per-provider blocks with endpoint, key status, models, default marker; --json mirrors it",
                async () => {
                        const root = sharedRoot("list");
                        try {
                                const opts = base({ root });
                                const add = await unown(
                                        ["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "gpt-4o"],
                                        opts,
                                );
                                expect(add.exitCode).toBe(0);

                                const run = await unown(["providers", "list"], opts);
                                expect(run.exitCode).toBe(0);
                                expect(run.stdout).toContain("openai");
                                expect(run.stdout).toContain(`${bridge.url}/v1`);
                                expect(run.stdout).toContain("key: auth.json");
                                expect(run.stdout).toContain("gpt-4o");
                                expect(run.stdout).toContain("← default");

                                const json = await unown(["providers", "list", "--json"], opts);
                                expect(json.exitCode).toBe(0);
                                const parsed = JSON.parse(json.stdout);
                                expect(parsed.providers[0]).toMatchObject({ id: "openai", keyStatus: "auth-json", isDefault: true });
                                expect(parsed.defaultModel).toBe("gpt-4o");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );
});

// ---------------------------------------------------------------------------
// add — the accumulate contract, live-verified
// ---------------------------------------------------------------------------

describe("unown providers add", () => {
        test(
                "second add KEEPS the first (accumulate, never rewrite) and does not steal the default",
                async () => {
                        const root = sharedRoot("accumulate");
                        try {
                                const opts = base({ root });
                                const first = await unown(
                                        ["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-a", "--model", "m-a"],
                                        opts,
                                );
                                expect(first.exitCode).toBe(0);
                                expect(first.stdout).toContain("default → openai/m-a");

                                const second = await unown(
                                        ["providers", "add", "--provider", "deepseek", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-b", "--model", "m-b"],
                                        opts,
                                );
                                expect(second.exitCode).toBe(0);
                                expect(second.stdout).toContain("added deepseek");
                                expect(second.stdout).toContain("registry: openai, deepseek");

                                const models = agentJson(second, "models.json");
                                expect(Object.keys(models.providers).sort()).toEqual(["deepseek", "openai"]);
                                // default still openai — add does not steal it
                                const settings = agentJson(second, "settings.json");
                                expect(settings.defaultProvider).toBe("openai");
                                // both keys coexist in auth.json
                                const auth = agentJson(second, "auth.json");
                                expect(auth.openai.key).toBe("sk-a");
                                expect(auth.deepseek.key).toBe("sk-b");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "--key-env stores a $VAR reference — models.json carries NO secret",
                async () => {
                        const root = sharedRoot("keyenv");
                        try {
                                const opts = base({ root });
                                const run = await unown(
                                        ["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--key-env", "OPENAI_API_KEY", "--model", "m"],
                                        opts,
                                );
                                expect(run.exitCode).toBe(0);
                                const models = agentJson(run, "models.json");
                                expect(models.providers.openai.apiKey).toBe("$OPENAI_API_KEY");
                                expect(JSON.stringify(models)).not.toContain("sk-");
                                // the mock bridge answers /models without auth → reachable line
                                expect(run.stdout).toContain("added openai");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "--default steals the default explicitly",
                async () => {
                        const root = sharedRoot("defaultflag");
                        try {
                                const opts = base({ root });
                                await unown(["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "m-1"], opts);
                                const run = await unown(
                                        ["providers", "add", "--provider", "deepseek", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-2", "--model", "m-2", "--default"],
                                        opts,
                                );
                                expect(run.exitCode).toBe(0);
                                expect(run.stdout).toContain("default → deepseek/m-2");
                                expect(agentJson(run, "settings.json").defaultProvider).toBe("deepseek");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "the bridge preset registers under zai-bridge with the placeholder key and the full served catalog",
                async () => {
                        const root = sharedRoot("bridgepreset");
                        try {
                                const opts = base({ root });
                                const run = await unown(["providers", "add", "--provider", "bridge", "--model", "kimi-k2.5"], opts);
                                expect(run.exitCode).toBe(0);
                                expect(run.stdout).toContain("zai-bridge");
                                const models = agentJson(run, "models.json");
                                expect(models.providers["zai-bridge"].apiKey).toBe("bridge-local");
                                const ids = models.providers["zai-bridge"].models.map((m: any) => m.id);
                                expect(ids[0]).toBe("kimi-k2.5");
                                expect(ids).toContain("qwen3.7-plus"); // the shipped default allow-list
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "non-interactive without --provider errors with the preset list",
                async () => {
                        const run = await unown(["providers", "add"], base());
                        expect(run.exitCode).toBe(1);
                        expect(run.stderr).toContain("--provider is required");
                        expect(run.stderr).toContain("openrouter");
                },
                LONG,
        );

        test(
                "bad registry id rejected; unknown provider rejected; --api-key + --key-env conflict",
                async () => {
                        const badId = await unown(
                                ["providers", "add", "--provider", "openai", "--id", "Bad_Id", "--base-url", `${bridge.url}/v1`, "--model", "m"],
                                base(),
                        );
                        expect(badId.exitCode).toBe(1);
                        expect(badId.stderr).toContain("bad registry id");

                        const unknown = await unown(["providers", "add", "--provider", "nope"], base());
                        expect(unknown.exitCode).toBe(1);
                        expect(unknown.stderr).toContain("unknown provider");

                        const conflict = await unown(
                                ["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "k", "--key-env", "V", "--model", "m"],
                                base(),
                        );
                        expect(conflict.exitCode).toBe(1);
                        expect(conflict.stderr).toContain("mutually exclusive");
                },
                LONG,
        );

        test(
                "agnes preset is a first-class choice (endpoint + model + image input stamped)",
                async () => {
                        // base-url override keeps the test hermetic (no live Agnes call);
                        // the preset's real URL lives in setup.ts PRESETS and is covered
                        // by the live smoke in this milestone's verification.
                        const root = sharedRoot("agnes");
                        try {
                                const opts = base({ root });
                                const run = await unown(
                                        ["providers", "add", "--provider", "agnes", "--base-url", `${bridge.url}/v1`, "--api-key", "cpk-test", "--model", "agnes-3.0-flash"],
                                        opts,
                                );
                                expect(run.exitCode).toBe(0);
                                expect(run.stdout).toContain("added agnes");
                                const models = agentJson(run, "models.json");
                                expect(models.providers.agnes.models[0]).toMatchObject({
                                        id: "agnes-3.0-flash",
                                        input: ["text", "image"],
                                });
                                expect(agentJson(run, "auth.json").agnes.key).toBe("cpk-test");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );
});

// ---------------------------------------------------------------------------
// remove / default / key / test
// ---------------------------------------------------------------------------

describe("unown providers remove / default / key / test", () => {
        test(
                "remove drops the provider + its key; the default falls back to the survivor",
                async () => {
                        const root = sharedRoot("remove");
                        try {
                                const opts = base({ root });
                                await unown(["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "m-1"], opts);
                                await unown(["providers", "add", "--provider", "deepseek", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-2", "--model", "m-2"], opts);
                                const run = await unown(["providers", "remove", "openai"], opts);
                                expect(run.exitCode).toBe(0);
                                expect(run.stdout).toContain("removed openai");
                                expect(run.stdout).toContain("default fell back to deepseek/m-2");
                                expect(Object.keys(agentJson(run, "models.json").providers)).toEqual(["deepseek"]);
                                expect(agentJson(run, "auth.json")).toEqual({ deepseek: { type: "api_key", key: "sk-2" } });
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "remove unknown → exit 1 naming the configured set",
                async () => {
                        const root = sharedRoot("removeunknown");
                        try {
                                const opts = base({ root });
                                await unown(["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "m-1"], opts);
                                await unown(["providers", "add", "--provider", "deepseek", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-2", "--model", "m-2"], opts);
                                const run = await unown(["providers", "remove", "ghost"], opts);
                                expect(run.exitCode).toBe(1);
                                expect(run.stderr).toContain('unknown provider "ghost"');
                                expect(run.stderr).toContain("openai, deepseek");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "default validates the model and writes settings.json",
                async () => {
                        const root = sharedRoot("defaultcmd");
                        try {
                                const opts = base({ root });
                                await unown(["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "m-1"], opts);
                                await unown(["providers", "add", "--provider", "deepseek", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-2", "--model", "m-2"], opts);
                                const bad = await unown(["providers", "default", "openai", "no-such-model"], opts);
                                expect(bad.exitCode).toBe(1);
                                expect(bad.stderr).toContain("not registered");

                                const ok = await unown(["providers", "default", "deepseek", "m-2"], opts);
                                expect(ok.exitCode).toBe(0);
                                expect(ok.stdout).toContain("default → deepseek/m-2");
                                expect(agentJson(ok, "settings.json")).toMatchObject({ defaultProvider: "deepseek", defaultModel: "m-2" });
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "key rotation updates auth.json and verifies against the live endpoint; non-TTY without --api-key errors",
                async () => {
                        const root = sharedRoot("keyrotate");
                        try {
                                const opts = base({ root });
                                await unown(["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "m-1"], opts);
                                const noKey = await unown(["providers", "key", "openai"], opts);
                                expect(noKey.exitCode).toBe(1);
                                expect(noKey.stderr).toContain("--api-key is required");

                                const run = await unown(["providers", "key", "openai", "--api-key", "sk-rotated"], opts);
                                expect(run.exitCode).toBe(0);
                                expect(run.stdout).toContain("rotated the key for openai");
                                expect(agentJson(run, "auth.json").openai.key).toBe("sk-rotated");
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );

        test(
                "test classifies reachable / unknown",
                async () => {
                        const root = sharedRoot("testcmd");
                        try {
                                const opts = base({ root });
                                await unown(["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "m-1"], opts);
                                const ok = await unown(["providers", "test", "openai"], opts);
                                expect(ok.exitCode).toBe(0);
                                expect(ok.stdout).toContain("reachable");
                                expect(ok.stdout).toContain("credential: auth-json");

                                const unknown = await unown(["providers", "test", "ghost"], opts);
                                expect(unknown.exitCode).toBe(1);
                                expect(unknown.stderr).toContain('unknown provider "ghost"');
                        } finally {
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );
});

// ---------------------------------------------------------------------------
// help surface
// ---------------------------------------------------------------------------

describe("unown providers help surface", () => {
        test(
                "-h prints usage without running; unknown subcommand errors",
                async () => {
                        const help = await unown(["providers", "-h"], base());
                        expect(help.exitCode).toBe(0);
                        expect(help.stdout).toContain("usage:");
                        expect(help.stdout).toContain("unown providers add");

                        const bad = await unown(["providers", "frobnicate"], base());
                        expect(bad.exitCode).toBe(1);
                        expect(bad.stderr).toContain('unknown subcommand "frobnicate"');
                },
                LONG,
        );

        test(
                "`unown help providers` routes to the same page; the top-level usage lists the command",
                async () => {
                        const help = await unown(["help", "providers"], base());
                        expect(help.exitCode).toBe(0);
                        expect(help.stdout).toContain("unown providers — manage the model provider registry");

                        const top = await unown(["--help"], base());
                        expect(top.exitCode).toBe(0);
                        expect(top.stdout).toContain("unown providers <sub>");
                },
                LONG,
        );
});
