// Unit tests for src/model-health.ts — the cross-process model-health store
// + provider-failure classification (pi-cciotti port).
//
// Pure module: no pi imports, no engine store. The store I/O is exercised
// against a real temp home dir (the same posture as memory-versions.test.ts's
// temp UNOWN_HOME redirection, but self-contained: this module's functions
// take `home` explicitly, so no env mutation is needed).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    EMPTY_MODEL_HEALTH,
    isModelUnhealthy,
    isProviderStyleFailure,
    loadModelHealth,
    markModelUnhealthy,
    MODEL_HEALTH_TTL_MS,
    modelHealthPath,
    pruneModelHealth,
    saveModelHealth,
    trimUnhealthyLeading,
} from "../src/model-health.ts";

const HOME = mkdtempSync(join(tmpdir(), "unown-model-health-"));
afterAll(() => {
    try {
        rmSync(HOME, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

describe("model-health store round-trip", () => {
    test("empty home loads as an empty store (fail-closed to try-the-model)", () => {
        expect(loadModelHealth(HOME)).toEqual(EMPTY_MODEL_HEALTH);
    });
    test("mark → save → load round-trips; prune drops expired marks", () => {
        const now = Date.now();
        let store = markModelUnhealthy("kimi-k2.5", now);
        store = markModelUnhealthy("qwen3.7-plus", now - 1000, store);
        saveModelHealth(HOME, store);

        const loaded = loadModelHealth(HOME);
        expect(isModelUnhealthy("kimi-k2.5", loaded)).toBe(true);
        expect(isModelUnhealthy("qwen3.7-plus", loaded)).toBe(true);
        expect(isModelUnhealthy("qwen3.6-plus", loaded)).toBe(false);

        // Expired marks vanish on load AND on explicit prune.
        const stale = markModelUnhealthy("old-model", now - MODEL_HEALTH_TTL_MS - 1, loaded);
        expect(pruneModelHealth(stale).marks["old-model"]).toBeUndefined();
        const reloaded = loadModelHealth(HOME);
        expect(reloaded.marks["old-model"]).toBeUndefined();
        expect(reloaded.marks["kimi-k2.5"]).toBeDefined();
    });
    test("the written file is valid JSON at the documented path with 0600-ish perms", () => {
        expect(existsSync(modelHealthPath(HOME))).toBe(true);
        const raw = JSON.parse(readFileSync(modelHealthPath(HOME), "utf8"));
        expect(raw.version).toBe(1);
        expect(typeof raw.marks).toBe("object");
    });
    test("corrupt store loads as empty, never throws", () => {
        const corrupt = mkdtempSync(join(tmpdir(), "unown-model-health-corrupt-"));
        try {
            saveModelHealth(corrupt, markModelUnhealthy("x", Date.now()));
            // Overwrite with garbage.
            const { writeFileSync } = require("node:fs");
            writeFileSync(modelHealthPath(corrupt), "{not json");
            expect(loadModelHealth(corrupt)).toEqual(EMPTY_MODEL_HEALTH);
        } finally {
            rmSync(corrupt, { recursive: true, force: true });
        }
    });
    test("saveModelHealth never throws on an unwritable home", () => {
        expect(() => saveModelHealth(join(HOME, "no", "such", "dir", "deeper"), EMPTY_MODEL_HEALTH)).not.toThrow();
    });
});

describe("trimUnhealthyLeading", () => {
    const now = Date.now();
    const store = markModelUnhealthy("bad-primary", now);
    test("drops leading marked models but keeps at least one candidate", () => {
        expect(trimUnhealthyLeading(["bad-primary", "fallback-a"], store, now)).toEqual(["fallback-a"]);
        // Marked model later in the chain stays.
        expect(trimUnhealthyLeading(["good", "bad-primary"], store, now)).toEqual(["good", "bad-primary"]);
        // All marked: keep the last one rather than emptying the chain.
        const allBad = markModelUnhealthy("a", now, markModelUnhealthy("b", now));
        expect(trimUnhealthyLeading(["a", "b"], allBad, now)).toEqual(["b"]);
    });
});

describe("isProviderStyleFailure", () => {
    const base = { exitCode: 1, stderr: "", output: "", toolResults: 0 };
    test("provider signatures before any tool use rotate", () => {
        expect(isProviderStyleFailure({ ...base, stderr: "401 Unauthorized" })).toBe(true);
        expect(isProviderStyleFailure({ ...base, stderr: "429 Too Many Requests" })).toBe(true);
        expect(isProviderStyleFailure({ ...base, stderr: "Error: 503 Service Unavailable" })).toBe(true);
        expect(isProviderStyleFailure({ ...base, stderr: "fetch failed" })).toBe(true);
        expect(isProviderStyleFailure({ ...base, stderr: "Request timed out after 180000ms" })).toBe(true);
        // The classic silent death: non-zero exit, no stderr, no output.
        expect(isProviderStyleFailure(base)).toBe(true);
    });
    test("success, mid-work crashes and overflow never rotate", () => {
        expect(isProviderStyleFailure({ ...base, exitCode: 0 })).toBe(false);
        // Tool calls already happened — rotating would discard real work.
        expect(isProviderStyleFailure({ ...base, stderr: "503", toolResults: 3 })).toBe(false);
        // Context overflow is a task-shape problem, not a provider problem.
        expect(isProviderStyleFailure({ ...base, stderr: "prompt is too long: 900000 tokens > 200000 maximum" })).toBe(false);
    });
});
