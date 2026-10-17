/**
 * memory-live.test.ts — LIVE end-to-end suite for the tiered memory system
 * (strategy §4.2 memory roundtrip + §4.6 poisoning-research + §4.7 crash
 * consistency + §4.8 size hygiene, exercised against a REAL engine process).
 *
 * Gate: UNOWN_MEMORY_LIVE=1 (skipped in default `bun test` and CI — it needs
 * the llm-bridge on :3031 and spends real tokens; ~2-4 minutes).
 *
 * What "live" means here, in order:
 *   1. A scratch engine (own DATA_DIR + SQLite, port 3035) booted IN-PROCESS
 *      through the real startServer() — real Bun.serve, real WAL store, real
 *      task seeding, real router.
 *   2. All LLM traffic goes through a RECORDING PROXY (port 3036 → the real
 *      llm-bridge :3031): every upstream chat-completions body is captured, so
 *      the suite can prove the resolved 4-tier memory block (with a unique
 *      marker written via writeTier) is present VERBATIM in the actual request
 *      the model receives — the end-to-end injection proof, not a unit mock.
 *   3. A REAL agent run (POST /api/tasks/fix-fizzbuzz/run) drives the full
 *      loop: memory injection → sandbox run → verification → session note.
 *   4. A REAL dream (POST /api/dreams/run): the bridge model consolidates the
 *      notes into project memory, the canary gate re-runs the last-passing
 *      task under the new memory, and SSE carries the live events.
 *   5. Crash-consistency + concurrency probes on the live state.
 *
 * Receipts (assertions + captured evidence, no secrets) are written to
 * benchmarks/memory-eval/results/memory-live-receipt-<ts>.json.
 *
 * Env:
 *   UNOWN_MEMORY_LIVE=1                 — enable the suite
 *   UNOWN_MEMORY_LIVE_BRIDGE (3031)     — real bridge behind the proxy
 *   UNOWN_MEMORY_LIVE_MODEL (kimi-k2.5) — model the engine uses
 *   UNOWN_MEMORY_LIVE_PORT (3035)       — scratch engine port (proxy = +1)
 *   UNOWN_MEMORY_LIVE_RECEIPTS          — receipts dir override
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const GATE = process.env.UNOWN_MEMORY_LIVE === "1";
const SCRATCH = join(tmpdir(), "scratch-mem", "live");
const ENGINE_PORT = Number(process.env.UNOWN_MEMORY_LIVE_PORT ?? 3035);
const PROXY_PORT = ENGINE_PORT + 1;
const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
const REAL_BRIDGE = (process.env.UNOWN_MEMORY_LIVE_BRIDGE ?? "http://127.0.0.1:3031").replace(/\/+$/, "");
const MODEL = process.env.UNOWN_MEMORY_LIVE_MODEL ?? "kimi-k2.5";
const RECEIPTS_DIR =
        process.env.UNOWN_MEMORY_LIVE_RECEIPTS ??
        join(import.meta.dir, "..", "..", "..", "..", "benchmarks", "memory-eval", "results");

// ---------------------------------------------------------------------------
// Scratch environment MUST be in place before ANY src import (store.ts opens
// SQLite and reads DATA_DIR at module load). This file therefore has NO static
// imports of ../src/* — everything is imported dynamically in beforeAll.
// ---------------------------------------------------------------------------
process.env.PI_SELFLEARNING_DATA = join(SCRATCH, "data");
process.env.PI_SELFLEARNING_DB = join(SCRATCH, "db", "selflearning.db");
process.env.PI_AGENT_PORT = String(ENGINE_PORT);
process.env.PI_BRIDGE_URL = `http://127.0.0.1:${PROXY_PORT}`;
process.env.PI_MODEL_ID = MODEL;
process.env.PI_PROVIDER = "zai-bridge";

let serverMod: typeof import("../src/server.ts");
let memoryMod: typeof import("../src/memory.ts");
let notesMod: typeof import("../src/notes.ts");
let routerMod: typeof import("../src/router.ts");
let storeMod: typeof import("../src/store.ts");
let engine: ReturnType<typeof serverMod.startServer> | null = null;
let proxy: ReturnType<typeof Bun.serve> | null = null;
let stopSSE: (() => void) | null = null;

interface Captured {
        ts: number;
        path: string;
        body: string;
}
const captured: Captured[] = [];
const sseEvents: Array<{ event: string; payload: any; ts: number }> = [];
const receipt: any = {
        suite: "memory-live",
        startedAt: new Date().toISOString(),
        env: { enginePort: ENGINE_PORT, proxyPort: PROXY_PORT, bridge: REAL_BRIDGE, model: MODEL },
        tests: [] as any[],
};

function recordTest(name: string, evidence: Record<string, unknown>, ok: boolean) {
        receipt.tests.push({ name, ok, evidence, ts: new Date().toISOString() });
}

/** Buffered SSE reader over the engine's /api/events stream. */
async function startSSE(): Promise<() => void> {
        const ctrl = new AbortController();
        const res = await fetch(`${ENGINE}/api/events`, { signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        (async () => {
                try {
                        for (;;) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                buf += dec.decode(value, { stream: true });
                                for (;;) {
                                        const idx = buf.indexOf("\n\n");
                                        if (idx < 0) break;
                                        const frame = buf.slice(0, idx);
                                        buf = buf.slice(idx + 2);
                                        const line = frame.trim();
                                        if (line.startsWith("data: ")) {
                                                try {
                                                        sseEvents.push(JSON.parse(line.slice(6)));
                                                } catch {
                                                        /* partial frame */
                                                }
                                        }
                                }
                        }
                } catch {
                        /* aborted */
                }
        })();
        return () => ctrl.abort();
}

async function api(method: string, path: string, body?: unknown) {
        const res = await fetch(`${ENGINE}${path}`, {
                method,
                headers: body !== undefined ? { "content-type": "application/json" } : undefined,
                body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const json: any = await res.json().catch(() => ({}));
        return { status: res.status, json };
}

async function pollUntil(desc: string, ms: number, fn: () => Promise<boolean>) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
                if (await fn()) return true;
                await Bun.sleep(1500);
        }
        throw new Error(`timeout waiting for ${desc}`);
}

// ---------------------------------------------------------------------------

describe.skipIf(!GATE)("memory live loop (scratch engine + real bridge)", () => {
        beforeAll(async () => {
                rmSync(SCRATCH, { recursive: true, force: true });
                mkdirSync(SCRATCH, { recursive: true });
                // Recording proxy: engine -> :3036 -> real bridge :3031
                proxy = Bun.serve({
                        port: PROXY_PORT,
                        async fetch(req) {
                                const url = new URL(req.url);
                                const bodyText = await req.text().catch(() => "");
                                if (req.method === "POST" && url.pathname.includes("chat/completions")) {
                                        captured.push({ ts: Date.now(), path: url.pathname, body: bodyText });
                                }
                                const headers: Record<string, string> = {};
                                const ct = req.headers.get("content-type");
                                if (ct) headers["content-type"] = ct;
                                const res = await fetch(`${REAL_BRIDGE}${url.pathname}${url.search}`, {
                                        method: req.method,
                                        headers,
                                        body: req.method === "GET" || req.method === "HEAD" ? undefined : bodyText,
                                });
                                return new Response(res.body, {
                                        status: res.status,
                                        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
                                });
                        },
                });
                serverMod = await import("../src/server.ts");
                memoryMod = await import("../src/memory.ts");
                notesMod = await import("../src/notes.ts");
                routerMod = await import("../src/router.ts");
                storeMod = await import("../src/store.ts");
                engine = serverMod.startServer(ENGINE_PORT);
                await pollUntil("engine boot", 15_000, async () => {
                        try {
                                const r = await fetch(`${ENGINE}/api/memory`);
                                return r.ok;
                        } catch {
                                return false;
                        }
                });
                stopSSE = await startSSE();
        }, 30_000);

        afterAll(async () => {
                try {
                        receipt.finishedAt = new Date().toISOString();
                        receipt.capturedChatRequests = captured.length;
                        receipt.sseEventNames = [...new Set(sseEvents.map((e) => e.event))];
                        mkdirSync(RECEIPTS_DIR, { recursive: true });
                        const file = join(RECEIPTS_DIR, `memory-live-receipt-${Date.now()}.json`);
                        writeFileSync(file, JSON.stringify(receipt, null, 2));
                        console.log(`[memory-live] receipt -> ${file}`);
                } catch (err: any) {
                        console.error("[memory-live] receipt write failed:", err?.message);
                }
                stopSSE?.();
                try {
                        routerMod?.router.stop();
                } catch {}
                engine?.stop(true);
                proxy?.stop(true);
        }, 20_000);

        test(
                "boots a scratch engine with the 4 tiers seeded (v1, seed content)",
                async () => {
                        const { status, json } = await api("GET", "/api/memory");
                        expect(status).toBe(200);
                        expect(json.tiers.map((t: any) => t.tier)).toEqual(["policy", "project", "user", "local"]);
                        for (const t of json.tiers) {
                                expect(t.version).toBe(1);
                                expect(t.chars).toBeGreaterThan(50);
                        }
                        expect(json.resolvedChars).toBeGreaterThan(500);
                        recordTest("boot+seed", { tiers: json.tiers.map((t: any) => [t.tier, t.version]), resolvedChars: json.resolvedChars }, true);
                },
                20_000,
        );

        test(
                "write → history → rollback roundtrip against the live engine, and the resolved block carries provenance",
                async () => {
                        const v = memoryMod.writeTier("user", "# Tier 2 — User Memory\n\n- marker: write-roundtrip", "unit-live", "live write");
                        expect(v).toBe(2);
                        const mem = await api("GET", "/api/memory");
                        const user = mem.json.tiers.find((t: any) => t.tier === "user");
                        expect(user.version).toBe(2);
                        expect(user.content).toContain("write-roundtrip");
                        const hist = await api("GET", "/api/memory/user/history");
                        expect(hist.json.history).toHaveLength(2);
                        expect(hist.json.history[0].changed_by).toBe("unit-live");

                        const rb = await api("POST", "/api/memory/user/rollback", { version: 1 });
                        expect(rb.status).toBe(200);
                        const after = await api("GET", "/api/memory");
                        const user2 = after.json.tiers.find((t: any) => t.tier === "user");
                        expect(user2.version).toBe(3); // forward-only audit row
                        expect(user2.content).toContain("# Tier 2 — User Memory"); // seed restored
                        const hist2 = await api("GET", "/api/memory/user/history");
                        expect(hist2.json.history[0].changed_by).toBe("rollback");

                        const resolved = memoryMod.resolveMemory();
                        expect(resolved.block).toContain("<!-- provenance: v");
                        recordTest("write/history/rollback", { writeVersion: v, rollbackVersion: user2.version, provenanceSample: resolved.block.match(/<!-- provenance: [^\n]+ -->/)?.[0] }, true);
                },
                20_000,
        );

        test(
                "crash-consistency: deleted/corrupted tier file self-heals from the DB on the live state",
                async () => {
                        const marker = `self-heal-${randomUUID().slice(0, 8)}`;
                        const v = memoryMod.writeTier("local", `local durable content ${marker}`, "unit-live", "heal probe");
                        expect(v).toBeGreaterThan(0);
                        // Simulate the crash window: file lost / corrupted after the DB commit.
                        rmSync(memoryMod.tierPath("local"));
                        const healed1 = memoryMod.readTier("local");
                        expect(healed1).toContain(marker);
                        expect(existsSync(memoryMod.tierPath("local"))).toBe(true);
                        writeFileSync(memoryMod.tierPath("local"), "TRUNCATED", "utf8");
                        const healed2 = memoryMod.readTier("local");
                        expect(healed2).toContain(marker);
                        expect(readFileSync(memoryMod.tierPath("local"), "utf8")).toContain(marker);
                        recordTest("self-heal", { marker, version: v }, true);
                },
                20_000,
        );

        test(
                "REAL agent run: resolved memory is injected VERBATIM into the upstream chat request (marker proof)",
                async () => {
                        const marker = `MEMORY-MARKER-${randomUUID().slice(0, 8)}`;
                        memoryMod.writeTier("user", `# Tier 2 — User Memory\n\n- Convention worth remembering: the passphrase ${marker} is part of this workspace's style guide.`, "unit-live", "injection probe");
                        const tasks = await api("GET", "/api/tasks");
                        const task = tasks.json.tasks.find((t: any) => t.id === "fix-fizzbuzz");
                        expect(task).toBeDefined();

                        const started = await api("POST", "/api/tasks/fix-fizzbuzz/run", {});
                        expect(started.status).toBe(200);
                        expect(started.json.started).toBe(true);

                        let run: any = null;
                        await pollUntil("task run to finish", 300_000, async () => {
                                const runs = await api("GET", "/api/runs?task=fix-fizzbuzz&kind=baseline");
                                run = runs.json.runs.find((r: any) => r.status !== "running");
                                return Boolean(run);
                        });
                        expect(run.status).toBe("passed");

                        // THE injection proof: some upstream request body contains the
                        // marker AND the policy tier block AND the wrapper tag.
                        const withMarker = captured.filter((c) => c.body.includes(marker));
                        expect(withMarker.length).toBeGreaterThan(0);
                        const first = withMarker[0];
                        expect(first.body).toContain("tier0-policy.md");
                        expect(first.body).toContain("<project_instructions");
                        expect(first.body).toContain("provenance: v");
                        // SessionStart hook bound the memory version into the run context.
                        const hooks = await api("GET", "/api/hooks?limit=50");
                        const sessionStart = hooks.json.hooks.find((h: any) => h.hook === "SessionStart");
                        expect(sessionStart?.reason).toMatch(/session started \(memory v\d+\)/);
                        // The finished run filed a benchmark note (dream fuel).
                        const detail = await api("GET", `/api/runs/${run.id}`);
                        recordTest("real-run-injection", {
                                runId: run.id,
                                runStatus: run.status,
                                tokensIn: detail.json.run.tokens_in,
                                tokensOut: detail.json.run.tokens_out,
                                markerPresentInRequests: withMarker.length,
                                capturedRequests: captured.length,
                                sessionStartReason: sessionStart?.reason,
                        }, true);
                },
                330_000,
        );

        test(
                "REAL dream: notes consolidate into project memory, canary re-runs the task, SSE carries the events",
                async () => {
                        const before = (await api("GET", "/api/dreams")).json.dreams.map((d: any) => d.id);
                        const projectBefore = memoryMod.readTier("project");
                        // Fuel: the run's note exists; add two synthetic benign benchmark notes.
                        notesMod.createNote(randomUUID(), "Benchmark note: fix-fizzbuzz baseline passed with a minimal edit; the test file was honored read-only.", "benchmark");
                        notesMod.createNote(randomUUID(), "Benchmark note: verify script runs `bun fizzbuzz.test.mjs` and its output is ground truth; agent iterated once before green.", "benchmark");

                        const dreamsBefore = sseEvents.filter((e) => e.event === "dream:started").length;
                        const memChangedBefore = sseEvents.filter((e) => e.event === "memory:changed").length;
                        const started = await api("POST", "/api/dreams/run", {});
                        expect(started.status).toBe(200);
                        expect(started.json.started).toBe(true);

                        let dream: any = null;
                        await pollUntil("dream to finish", 300_000, async () => {
                                const dreams = await api("GET", "/api/dreams");
                                dream = dreams.json.dreams.find((d: any) => !before.includes(d.id) && d.status !== "running");
                                return Boolean(dream);
                        });
                        expect(["done", "gated", "error"]).toContain(dream.status);
                        // The canary gate ran the regression re-check under the new memory.
                        await pollUntil("canary regression run", 300_000, async () => {
                                const runs = await api("GET", "/api/runs?task=fix-fizzbuzz&kind=regression");
                                return runs.json.runs.length > 0;
                        });
                        // Live SSE carried dream + memory events (allow small flush delay).
                        await Bun.sleep(1500);
                        expect(sseEvents.filter((e) => e.event === "dream:started").length).toBeGreaterThan(dreamsBefore);
                        expect(sseEvents.filter((e) => e.event === "dream:finished").length).toBeGreaterThan(0);
                        expect(sseEvents.filter((e) => e.event === "memory:changed").length).toBeGreaterThan(memChangedBefore);
                        // Version bookkeeping: dream ships (or gates) a NEW project version.
                        const projectVersion = memoryMod.currentVersion("project");
                        expect(projectVersion).toBeGreaterThanOrEqual(2);
                        const projectNow = memoryMod.readTier("project");
                        if (dream.status === "done") {
                                // §5.2 note format: per-sample canary verdicts with runner
                                // evidence ("canaries: fix-fizzbuzz: passed (runners: bun)").
                                expect(dream.note).toContain("canaries:");
                                expect(dream.note).toMatch(/fix-fizzbuzz: passed/);
                                expect(dream.note).toContain("runners: ");
                                expect(projectNow).not.toBe(projectBefore);
                        } else if (dream.status === "gated") {
                                expect(dream.note).toMatch(/rolled back|first-mint|quarantined/);
                        }
                        recordTest("dream+canary+SSE", {
                                dreamId: dream.id,
                                dreamStatus: dream.status,
                                dreamNote: dream.note,
                                notesIn: dream.notes_in,
                                projectVersion,
                                dreamedMemoryChars: projectNow.length,
                                sseEvents: sseEvents.filter((e) => ["dream:started", "dream:finished", "memory:changed"].includes(e.event)).map((e) => e.event),
                        }, true);
                },
                330_000,
        );

        test(
                "concurrent dream triggers are serialized by the busy mutex (409, no false start)",
                async () => {
                        notesMod.createNote(randomUUID(), "Benchmark note for the concurrency probe: benign observation about test discipline.", "benchmark");
                        const [a, b] = await Promise.all([
                                api("POST", "/api/dreams/run", {}),
                                api("POST", "/api/dreams/run", {}),
                        ]);
                        const statuses = [a.status, b.status].sort();
                        expect(statuses[0]).toBe(200);
                        expect(statuses[1]).toBe(409);
                        const started = [a, b].find((r) => r.status === 200)!;
                        expect(started.json.started ?? true).toBeTruthy();
                        const busy = [a, b].find((r) => r.status === 409)!;
                        expect(busy.json.error).toContain("busy");
                        // Let the started dream finish so afterAll state is clean.
                        await pollUntil("concurrent dream to finish", 300_000, async () => {
                                const dreams = await api("GET", "/api/dreams");
                                const running = dreams.json.dreams.find((d: any) => d.status === "running");
                                return !running;
                        });
                        recordTest("busy-mutex-409", { a: a.status, b: b.status }, true);
                },
                330_000,
        );

        test(
                "size hygiene: the 4-tier resolved block stays under the strategy §4.8 budget after real writes",
                async () => {
                        const resolved = memoryMod.resolveMemory();
                        // 20k tokens ≈ 80k chars; assert well under with real headroom.
                        expect(resolved.totalChars).toBeLessThan(80_000);
                        recordTest("size-hygiene", { totalChars: resolved.totalChars, tiers: resolved.files.map((f) => [f.tier, f.content.length]) }, true);
                },
                15_000,
        );
});
