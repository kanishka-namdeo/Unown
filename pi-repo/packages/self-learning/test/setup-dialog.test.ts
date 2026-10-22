/**
 * setup-dialog.test.ts — unit coverage for the onboarding wizard's new
 * building blocks (M1: the Hermes-patterned onboarding).
 *
 * Covers:
 *   - maskKey (the `key[:8]…` display — recognize, never usable)
 *   - clearProviderKey (auth.json entry + models.json apiKey in every form,
 *     idempotent, unknown provider)
 *   - mergeSettings (exported single mutation path — never clobbers siblings)
 *   - buildSetupSummaryText (the closer's pure text builder)
 *
 * The interactive wizard itself is PTY-verified (real-terminal runs are in
 * the CHANGELOG's 0.0.3 entry) — its dialog is injectable by design
 * (setup-dialog.ts), so these tests target the pure pieces the golden
 * subprocess suite cannot reach.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearProviderKey, mergeSettings, upsertProvider } from "../src/providers.ts";
import { buildSetupSummaryText, type SetupOutcome } from "../src/setup.ts";
import { maskKey } from "../src/setup-dialog.ts";

function tempAgentDir(): string {
        const root = mkdtempSync(join(tmpdir(), "setup-dialog-test-"));
        const dir = join(root, "agent");
        mkdirSync(dir, { recursive: true });
        return dir;
}

describe("maskKey", () => {
        test("first 8 chars + ellipsis; short keys pass through; empty is empty", () => {
                // synthetic fixture — the SHAPE of a provider key, never a real
                // credential. Built from a repeating pattern so no secret-shaped
                // literal lands in the file (gitleaks scans this diff).
                const longKey = "cpk-fixture-".repeat(4) + "0123456789";
                expect(maskKey(longKey)).toBe("cpk-fixt…");
                expect(maskKey("sk-short")).toBe("sk-short…");
                expect(maskKey("8chars!")).toBe("8chars!…");
                expect(maskKey("")).toBe("");
                expect(maskKey("   ")).toBe("");
        });
        test("never exposes more than 8 characters", () => {
                // 32 chars from an 8-char pattern: long enough to prove the
                // truncation, low-entropy by construction (no gitleaks trip).
                const key = "abcdefgh".repeat(4);
                const masked = maskKey(key);
                expect(masked.length).toBeLessThanOrEqual(9); // 8 + ellipsis
                expect(masked).toBe("abcdefgh…");
                expect(masked.length).toBeLessThan(key.length);
        });
});

describe("clearProviderKey", () => {
        test("removes an auth.json entry and a models.json literal, idempotently", () => {
                const dir = tempAgentDir();
                try {
                        upsertProvider(dir, {
                                id: "agnes",
                                name: "Agnes",
                                baseUrl: "https://apihub.agnes-ai.com/v1",
                                api: "openai-completions",
                                modelId: "agnes-3.0-flash",
                                input: ["text", "image"],
                                apiKeyInAuthJson: "sk-live-1",
                        });
                        // auth.json carries the key; models.json must NOT
                        const auth = JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"));
                        expect(auth.agnes.key).toBe("sk-live-1");
                        const models = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
                        expect(models.providers.agnes.apiKey).toBeUndefined();

                        const res = clearProviderKey(dir, "agnes");
                        expect(res).toMatchObject({ found: true, removedAuthEntry: true, removedModelsKey: false });
                        expect(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8")).agnes).toBeUndefined();

                        // second clear is a no-op success
                        const res2 = clearProviderKey(dir, "agnes");
                        expect(res2).toMatchObject({ found: true, removedAuthEntry: false, removedModelsKey: false });
                } finally {
                        rmSync(join(dir, ".."), { recursive: true, force: true });
                }
        });

        test("removes a models.json literal (provider-level key)", () => {
                const dir = tempAgentDir();
                try {
                        upsertProvider(dir, {
                                id: "bridge",
                                name: "bridge",
                                baseUrl: "http://127.0.0.1:3031/v1",
                                api: "openai-completions",
                                modelId: "m",
                                input: ["text"],
                                apiKeyInModelsJson: "bridge-local",
                        });
                        const res = clearProviderKey(dir, "bridge");
                        expect(res).toMatchObject({ found: true, removedModelsKey: true, removedAuthEntry: false });
                        const models = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
                        expect(models.providers.bridge.apiKey).toBeUndefined();
                } finally {
                        rmSync(join(dir, ".."), { recursive: true, force: true });
                }
        });

        test("removes a $ENV reference from models.json (the env var itself is not ours)", () => {
                const dir = tempAgentDir();
                try {
                        upsertProvider(dir, {
                                id: "openai",
                                name: "OpenAI",
                                baseUrl: "https://api.openai.com/v1",
                                api: "openai-completions",
                                modelId: "gpt-4o",
                                input: ["text", "image"],
                                apiKeyEnvRef: "OPENAI_API_KEY",
                        });
                        const res = clearProviderKey(dir, "openai");
                        expect(res).toMatchObject({ found: true, removedModelsKey: true });
                        const models = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
                        expect(models.providers.openai.apiKey).toBeUndefined();
                } finally {
                        rmSync(join(dir, ".."), { recursive: true, force: true });
                }
        });

        test("unknown provider: found=false, no writes, no throw", () => {
                const dir = tempAgentDir();
                try {
                        const res = clearProviderKey(dir, "nope");
                        expect(res.found).toBe(false);
                        expect(existsSync(join(dir, "auth.json"))).toBe(false);
                } finally {
                        rmSync(join(dir, ".."), { recursive: true, force: true });
                }
        });
});

describe("mergeSettings", () => {
        test("merges the patch and keeps sibling keys (never clobbers)", () => {
                const dir = tempAgentDir();
                try {
                        const p = join(dir, "settings.json");
                        writeFileSync(p, `${JSON.stringify({ theme: "unown", defaultProvider: "x", userKey: "keep-me" })}\n`);
                        mergeSettings(dir, { theme: "dark" });
                        const after = JSON.parse(readFileSync(p, "utf8"));
                        expect(after).toMatchObject({ theme: "dark", defaultProvider: "x", userKey: "keep-me" });
                } finally {
                        rmSync(join(dir, ".."), { recursive: true, force: true });
                }
        });
});

describe("buildSetupSummaryText", () => {
        const base: SetupOutcome = {
                providerId: "agnes",
                providerName: "Agnes AI",
                baseUrl: "https://apihub.agnes-ai.com/v1",
                modelId: "agnes-3.0-flash",
                keyDisposition: "auth-json",
                keyNote: "entered masked",
                verified: "ok",
                served: ["agnes-3.0-flash", "agnes-2.5-flash"],
        };

        test("renders the agnes happy path with kept + extra models", () => {
                const text = buildSetupSummaryText({
                        ...base,
                        extraModels: ["agnes-2.5-flash", "agnes-2.5-pro-alpha"],
                        kept: ["zai-bridge"],
                        theme: "dark",
                });
                expect(text).toContain("✓ setup complete");
                expect(text).toContain("provider  agnes → https://apihub.agnes-ai.com/v1");
                expect(text).toContain("model     agnes-3.0-flash  (+2 more:");
                expect(text).toContain("key       auth.json (mode 0600) — entered masked");
                expect(text).toContain("theme     switched: dark");
                expect(text).toContain("verify    endpoint reachable — serves");
                expect(text).toContain("kept      existing providers: zai-bridge");
                expect(text).toContain("files     ~/.unown/agent/{models,auth,settings}.json");
                expect(text).toContain("unown                start a session in this project");
                expect(text).toContain("First flights (paste into a session):");
                expect(text.split("· ").length - 1).toBe(4); // four first-flight suggestions
        });

        test("key dispositions: env-ref / bridge placeholder / keyless-with-note", () => {
                expect(
                        buildSetupSummaryText({ ...base, keyDisposition: "env-ref", keyNote: "kept existing ($ENV ref)" }),
                ).toContain("key       models.json $ENV reference — kept existing ($ENV ref)");
                expect(buildSetupSummaryText({ ...base, keyDisposition: "bridge" })).toContain(
                        "bridge placeholder in models.json (the real secret lives in the repo .env)",
                );
                expect(
                        buildSetupSummaryText({ ...base, keyDisposition: "keyless", keyNote: "cleared the stored key" }),
                ).toContain("none — cleared the stored key");
        });

        test("verify states: auth-rejected / unreachable / skipped", () => {
                expect(buildSetupSummaryText({ ...base, verified: "auth-rejected" })).toContain(
                        "endpoint reachable but REJECTED the key",
                );
                expect(buildSetupSummaryText({ ...base, verified: "unreachable" })).toContain(
                        "endpoint not reachable (config written — verify later)",
                );
                expect(buildSetupSummaryText({ ...base, verified: "skipped" })).toContain("verify    not verified");
        });
});
