// doctor-engine-auth.test.ts — the doctor engine check's 401 lane.
//
// Found live during the 2026-10-23 real-user pass: a binary install talking
// to a source-repo engine got `✗ self-learning engine — ? runs, ? dreams`
// plus `✓ engine version — engine predates version reporting — restart to
// update`, because /api/overview answers 401 (the CLI's token file lives in
// ITS data dir, the engine's token in the ENGINE's) and the doctor read the
// error body as if it were an engine that predates version reporting —
// actively wrong advice (a restart cannot fix auth).
//
// Spawn-level like test/doctor.test.ts: the REAL bin/unown, a private
// UNOWN_HOME per run, the mock bridge for the chat path, and a local HTTP
// server that answers /api/overview with 401/500 the way the real engine
// does (engineFetch sends no Origin — the non-browser lane).
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockBridge, sweepTestRoots, unown, type UnownRunOptions } from "./cli/helpers.ts";

let bridge: ReturnType<typeof startMockBridge>;

/** A one-route engine stand-in: every /api/overview request answers `status`
 * with a JSON error body shaped like the real engine-auth wrapper. */
function startFakeEngine(status: number): { url: string; close: () => void } {
        const server = Bun.serve({
                port: 0,
                fetch(req) {
                        const path = new URL(req.url).pathname;
                        if (path === "/api/overview") {
                                return new Response(JSON.stringify({ error: "missing or invalid engine token" }), {
                                        status,
                                        headers: { "content-type": "application/json" },
                                });
                        }
                        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
                },
        });
        return { url: `http://127.0.0.1:${server.port}`, close: () => server.stop(true) };
}

beforeAll(() => {
        bridge = startMockBridge({ label: "doctor-engine-auth" });
});
afterAll(() => {
        bridge?.close();
        sweepTestRoots();
});

function findCheck(stdout: string, id: string) {
        const parsed = JSON.parse(stdout) as { checks: Array<{ id: string; status: string; detail: string }> };
        return parsed.checks.find((c) => c.id === id);
}

describe("doctor — the engine 401/5xx lane (binary CLI vs source engine)", () => {
        test(
                "a 401 engine is an AUTH miss, never a broken-stats or pre-M8 verdict",
                async () => {
                        const fake = startFakeEngine(401);
                        try {
                                const opts: UnownRunOptions = { bridge, engineUrl: fake.url };
                                const run = await unown(["doctor", "--json"], opts);
                                // Warn-class: chat works, doctor exits 0 (the SDLC contract).
                                expect(run.exitCode).toBe(0);
                                const engine = findCheck(run.stdout, "self-learning-engine");
                                expect(engine).toBeDefined();
                                expect(engine!.status).toBe("warn");
                                // The message must name the fix, not invent broken data.
                                expect(engine!.detail).toContain("rejected this CLI's token");
                                expect(engine!.detail).toContain("UNOWN_ENGINE_TOKEN");
                                expect(engine!.detail).not.toContain("? runs");
                                // The wrong advice is gone: no version check may run off an
                                // error body (it used to print "engine predates version
                                // reporting — restart to update", which cannot fix auth).
                                expect(findCheck(run.stdout, "engine-version")).toBeUndefined();
                        } finally {
                                fake.close();
                        }
                },
                120_000,
        );

        test(
                "a 5xx engine reports the status it answered, not empty stats",
                async () => {
                        const fake = startFakeEngine(500);
                        try {
                                const opts: UnownRunOptions = { bridge, engineUrl: fake.url };
                                const run = await unown(["doctor", "--json"], opts);
                                expect(run.exitCode).toBe(0);
                                const engine = findCheck(run.stdout, "self-learning-engine");
                                expect(engine).toBeDefined();
                                expect(engine!.status).toBe("warn");
                                expect(engine!.detail).toContain("HTTP 500");
                                expect(engine!.detail).toContain("missing or invalid engine token");
                                expect(engine!.detail).not.toContain("? runs");
                                expect(findCheck(run.stdout, "engine-version")).toBeUndefined();
                        } finally {
                                fake.close();
                        }
                },
                120_000,
        );
});
