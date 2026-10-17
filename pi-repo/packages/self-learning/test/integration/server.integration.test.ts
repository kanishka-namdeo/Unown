// Integration tests for the self-learning engine HTTP API — Phase 2 layer of
// docs/testing-strategy.md §4.2 "Integration (real server, temp DB/data,
// mocked bridge)".
//
// Run with the dedicated script (see helpers.ts for the scoping rationale):
//   cd pi-repo/packages/self-learning && bun run test:integration
// Under plain `bun test test/` these tests skip (PI_TEST_SCOPE is unset) so
// the unit flow keeps its own env bootstrap (test/_env.ts).
//
// Coverage vs the strategy-doc checklist:
//   [x] Health + overview schema                       (GET /api/overview, GET /)
//   [x] Seed tasks present                             (GET /api/tasks, /api/tasks/:id)
//   [x] Trigger a run via API, await completion,
//       runs + runs/:id transcript/verify output       (POST /api/tasks/:id/run)
//       + mock-bridge traffic + improvements + notes
//   [x] Busy mutex: second trigger returns 409         (POST /api/agent/prompt + /api/tasks/:id/run)
//   [x] SSE /api/events: shape, ordering, disconnect   (POST /api/notes + /api/jobs/:id/trigger)
//       does not crash the server
//   [x] Memory version + rollback round trip           (GET /api/memory, /history, POST rollback)
//   [x] Router jobs list/toggle (+ manual trigger)     (GET /api/jobs, POST toggle/trigger)
//   [x] Skills lifecycle over HTTP                     (GET /api/skills, rollback, retire)
//   [x] GET /api/bridge proxies bridge log shape
//
// Notes on honesty of coverage:
//   · The mock model never edits task files, so task runs deterministically
//     end "failed" and cycles end "no-fix" — the full mine → patch → candidate
//     loop still executes for real (sandbox, pi agent session, verify script).
//   · Memory WRITES have no HTTP route (server.ts only exposes read/history/
//     rollback); the write step uses the in-process src/memory.ts writeTier
//     — the same primitive the harness/dream layers use — and asserts the
//     versioning through the HTTP surface.
//   · UNOWN_OS_SANDBOX=0 (see helpers.ts): OS-level bwrap execution is
//     validated by scripts/bwrap_smoke.sh + scripts/verify_sandbox.mjs.
//
// These tests run sequentially against ONE engine + ONE mock bridge (memory
// budget: the live benchmark stack stays untouched; nothing here binds 3030
// or 3031).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
        type EngineHandle,
        INTEGRATION_ACTIVE,
        SseClient,
        type SseEvent,
        startEngine,
        startMockBridge,
        waitFor,
} from "./helpers.ts";

let engine: EngineHandle | null = null;

if (!INTEGRATION_ACTIVE) {
        // Visible sentinel so a combined `bun test test/` run explains the skips.
        test.skip("integration suite is scoped out — run `bun run test:integration` (PI_TEST_SCOPE=integration)", () => {});
}

describe.skipIf(!INTEGRATION_ACTIVE)("engine integration (real server, temp DB/data, mocked bridge)", () => {
        const api = (path: string): string => `${engine!.baseUrl}${path}`;

        beforeAll(async () => {
                const bridge = startMockBridge();
                engine = await startEngine(bridge);
        }, 30_000);

        afterAll(async () => {
                // Best effort: let any in-flight work settle before teardown so
                // closing the server never races a running cycle.
                if (engine) {
                        try {
                                await waitFor(
                                        async () => {
                                                const overview = (await (await fetch(`${engine!.baseUrl}/api/overview`)).json()) as Record<
                                                        string,
                                                        unknown
                                                >;
                                                return overview.routerBusy ? null : overview;
                                        },
                                        { timeoutMs: 5_000, intervalMs: 250, label: "engine idle before teardown" },
                                );
                        } catch {
                                /* teardown anyway — the temp dir is disposable */
                        }
                }
                await engine?.close();
                engine = null;
        });

        // -------------------------------------------------------------------------
        // 1. Health + overview schema
        // -------------------------------------------------------------------------
        test("GET /api/overview returns the documented shape on a freshly seeded engine", async () => {
                const res = await fetch(api("/api/overview"));
                expect(res.status).toBe(200);
                expect(res.headers.get("content-type")).toContain("application/json");
                const body = (await res.json()) as Record<string, unknown>;

                expect(body.ok).toBe(true);
                const agent = body.agent as Record<string, unknown>;
                expect(agent.name).toBe("pi (badlogic/pi-mono)");
                expect(agent.layer).toBe("self-learning v0.1");
                expect(agent.provider).toBe("mock-bridge/mock-kimi");
                // bridge health is proxied from the mock with the real /health shape
                const bridge = agent.bridge as Record<string, unknown>;
                expect(bridge.ok).toBe(true);
                expect(bridge.port).toBe(engine!.bridge.port);
                expect(bridge.defaultModel).toBe("mock-kimi");
                expect(bridge.upstreamKeyIsSet).toBe(true);

                const kpis = body.kpis as Record<string, unknown>;
                for (const key of ["totalRuns", "passed", "failed", "errors", "passRate", "improvementsShipped", "dreams"]) {
                        expect(typeof kpis[key]).toBe("number");
                }
                expect(kpis.tasks).toBe(5); // first boot seeds the five benchmark tasks
                expect(kpis.notes).toEqual({ total: 0, pending: 0 });
                expect(kpis.hooks).toEqual({ total: 0, denies: 0 });
                expect(kpis.tokens).toEqual({ in: 0, out: 0 });
                const suite = kpis.suite as Record<string, unknown>;
                expect(suite.total).toBe(5);
                expect(suite.passing).toBe(0);
                expect(suite.saturated).toBe(false);

                // fresh boot: exactly the seed version (v1) on every memory tier
                expect(body.memoryVersions).toEqual({ policy: 1, project: 1, user: 1, local: 1 });
                expect(Array.isArray(body.trend)).toBe(true);
                expect(body.routerBusy).toBe(false);
        });

        test("GET / (non-API root) serves the service banner and unknown API routes 404", async () => {
                const root = await fetch(api("/"));
                expect(root.status).toBe(200);
                expect(await root.text()).toContain("pi self-learning agent service");
                const missing = await fetch(api("/api/nope"));
                expect(missing.status).toBe(404);
                const missingBody = (await missing.json()) as Record<string, unknown>;
                expect(String(missingBody.error)).toContain("not found");
        });

        // -------------------------------------------------------------------------
        // 2. Tasks: seeded suite present
        // -------------------------------------------------------------------------
        test("GET /api/tasks lists the five seeded tasks; /api/tasks/:id returns one", async () => {
                const res = await fetch(api("/api/tasks"));
                expect(res.status).toBe(200);
                const { tasks } = (await res.json()) as { tasks: Array<Record<string, unknown>> };
                expect(tasks).toHaveLength(5);
                expect(tasks.map((t) => t.id).sort()).toEqual(
                        ["fix-csv-parser", "fix-drop-right", "fix-fizzbuzz", "impl-debounce", "impl-map-limit"].sort(),
                );
                for (const t of tasks) {
                        expect(typeof t.name).toBe("string");
                        expect(typeof t.difficulty).toBe("number");
                        expect(t.active).toBeUndefined(); // list view carries counts, not full rows
                }

                const one = await fetch(api("/api/tasks/fix-fizzbuzz"));
                expect(one.status).toBe(200);
                const { task } = (await one.json()) as { task: Record<string, unknown> };
                expect(task.id).toBe("fix-fizzbuzz");
                expect(task.name).toContain("FizzBuzz");
                expect(typeof task.prompt).toBe("string");
                expect(task.prompt.length).toBeGreaterThan(0);
                expect(typeof (task.files as Record<string, string>)["fizzbuzz.js"]).toBe("string");
                expect(typeof task.verify).toBe("string");
                expect(task.verify).toContain("VERIFY_RESULT");

                expect((await fetch(api("/api/tasks/missing-task"))).status).toBe(404);
        });

        // -------------------------------------------------------------------------
        // 3. Trigger a run via the API and await completion (full self-improvement
        //    cycle: sandboxed pi agent → mock bridge → verify script → mining).
        // -------------------------------------------------------------------------
        test("POST /api/tasks/:id/run completes a full cycle and records run + transcript + verify output", async () => {
                const started = await fetch(api("/api/tasks/fix-fizzbuzz/run"), { method: "POST" });
                expect(started.status).toBe(200);
                expect(await started.json()).toEqual({ started: true, taskId: "fix-fizzbuzz" });

                // Await cycle completion (baseline + up to 3 mine→candidate iterations,
                // each a real sandboxed agent session — hence the generous timeout).
                const cycle = await waitFor(
                        async () => {
                                const { cycles } = (await (await fetch(api("/api/cycles"))).json()) as {
                                        cycles: Array<Record<string, unknown>>;
                                };
                                const c = cycles.find((x) => x.task_id === "fix-fizzbuzz");
                                return c && c.status !== "running" ? c : null;
                        },
                        { timeoutMs: 110_000, intervalMs: 1_000, label: "cycle for fix-fizzbuzz to finish" },
                );
                // The mock model cannot fix tasks, so the honest outcome is no-fix.
                expect(cycle.status).toBe("no-fix");
                expect(cycle.ended_at).not.toBeNull();
                expect(typeof cycle.summary).toBe("string");

                // Engine is idle again and the overview reflects the traffic.
                const overview = (await (await fetch(api("/api/overview"))).json()) as Record<string, unknown>;
                expect(overview.routerBusy).toBe(false);
                const kpis = overview.kpis as Record<string, unknown>;
                expect(kpis.totalRuns).toBeGreaterThan(0);
                expect(kpis.passRate).toBe(0); // every run failed — the mock never fixes code

                // Runs endpoint: baseline + candidate runs for the task.
                const { runs } = (await (await fetch(api("/api/runs?task=fix-fizzbuzz&limit=50"))).json()) as {
                        runs: Array<Record<string, unknown>>;
                };
                expect(runs.length).toBeGreaterThanOrEqual(2);
                const baseline = runs.find((r) => r.kind === "baseline");
                expect(baseline).toBeDefined();
                expect(baseline!.status).toBe("failed");
                expect(baseline!.task_id).toBe("fix-fizzbuzz");
                expect(baseline!.sandbox_id).toBeTruthy();

                // Run detail: transcript + verification ground truth.
                const detail = (await (await fetch(api(`/api/runs/${baseline!.id}`))).json()) as {
                        run: Record<string, unknown>;
                };
                const run = detail.run;
                expect(run.kind).toBe("baseline");
                const transcript = run.transcript as Array<Record<string, unknown>>;
                expect(Array.isArray(transcript)).toBe(true);
                expect(
                        transcript.some((e) => e.type === "text" && typeof e.text === "string" && (e.text as string).length > 0),
                ).toBe(true);
                const verify = run.verify_output as Record<string, unknown>;
                expect(verify.passed).toBe(false);
                expect(typeof verify.summary).toBe("string");
                // The verify command ran and its output was captured. (A
                // FAILING test file throws inside verify's dynamic import,
                // so the trailing VERIFY_RESULT marker line is only printed
                // on clean runs — the command banner + exit code are the
                // stable evidence.)
                expect(String(verify.log)).toContain("bun run __verify.mjs");
                expect(String(verify.log)).toContain("exit=1");

                // The mock bridge saw BOTH transport shapes the engine uses:
                // streaming (pi agent loop) and non-streaming JSON (llm.ts miner).
                const reqs = engine!.bridge.requests;
                expect(reqs.length).toBeGreaterThanOrEqual(2);
                expect(reqs.some((r) => r.stream && r.tools > 0)).toBe(true);
                expect(reqs.some((r) => !r.stream && r.tools === 0)).toBe(true);
                expect(reqs.every((r) => r.model === "mock-kimi")).toBe(true);

                // Mining really ran: the mock's canned MiningResult became (rejected)
                // improvements with candidate runs attached.
                const { improvements } = (await (await fetch(api("/api/improvements"))).json()) as {
                        improvements: Array<Record<string, unknown>>;
                };
                expect(
                        improvements.some(
                                (i) =>
                                        i.task_id === "fix-fizzbuzz" && i.diagnosis === "integration mock diagnosis" && i.status === "rejected",
                        ),
                ).toBe(true);
                expect(improvements.some((i) => i.candidate_run_id)).toBe(true);

                // Each finished run left a session note (AutoDream fuel).
                const { notes } = (await (await fetch(api("/api/notes"))).json()) as {
                        notes: Array<Record<string, unknown>>;
                };
                expect(notes.length).toBeGreaterThanOrEqual(2);
                expect(notes.some((n) => n.run_id === baseline!.id)).toBe(true);

                // GET /api/bridge proxies the mock's request log.
                const bridgeStats = (await (await fetch(api("/api/bridge"))).json()) as Record<string, unknown>;
                expect(Array.isArray(bridgeStats.log)).toBe(true);
                expect(bridgeStats.requests).toBeGreaterThan(0);
                expect(bridgeStats.errors).toBe(0);
        }, 120_000);

        // -------------------------------------------------------------------------
        // 4. Busy mutex — one engine job at a time
        // -------------------------------------------------------------------------
        test("concurrent triggers: the second trigger gets 409 while the first runs", async () => {
                // Guard: start from an idle engine (hermetic per test).
                await waitFor(async () => (await engineIdle()) || null, {
                        timeoutMs: 110_000,
                        intervalMs: 200,
                        label: "engine idle",
                });

                // Deterministic busy window: with an instant mock the whole
                // interactive run can finish in ~15ms — faster than a second
                // HTTP round-trip — so hold the mock's first LLM call open
                // for 2s to guarantee the mutex spans the second trigger.
                engine!.bridge.delayMs = 2_000;
                try {
                        const first = await fetch(api("/api/agent/prompt"), {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ prompt: "integration busy-mutex probe" }),
                        });
                        expect(first.status).toBe(200);
                        expect(await first.json()).toEqual({ started: true });

                        // withBusy is claimed synchronously before the first response is
                        // sent, so these immediate triggers must observe the mutex.
                        const second = await fetch(api("/api/agent/prompt"), {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ prompt: "should be rejected" }),
                        });
                        expect(second.status).toBe(409);
                        expect(((await second.json()) as Record<string, unknown>).error).toContain("busy");

                        const taskRun = await fetch(api("/api/tasks/fix-fizzbuzz/run"), { method: "POST" });
                        expect(taskRun.status).toBe(409);
                        expect(((await taskRun.json()) as Record<string, unknown>).error).toContain("busy");

                        // The rejected trigger must not have started any work either.
                        const { runs } = (await (await fetch(api("/api/runs?kind=interactive&limit=5"))).json()) as {
                                runs: Array<Record<string, unknown>>;
                        };
                        expect(runs).toHaveLength(1);

                        // Wait for the in-flight interactive run to finish (no verify script →
                        // the mock reply alone ends the run as passed).
                        const done = await waitFor(
                                async () => {
                                        const { runs: rs } = (await (await fetch(api("/api/runs?kind=interactive&limit=5"))).json()) as {
                                                runs: Array<Record<string, unknown>>;
                                        };
                                        return rs.length === 1 && rs[0].status !== "running" ? rs[0] : null;
                                },
                                { timeoutMs: 110_000, intervalMs: 500, label: "interactive run to finish" },
                        );
                        expect(done.status).toBe("passed");
                } finally {
                        engine!.bridge.delayMs = 0;
                }
                const overview = (await (await fetch(api("/api/overview"))).json()) as Record<string, unknown>;
                expect(overview.routerBusy).toBe(false);
        }, 120_000);

        /** No in-flight work: mutex released and no run rows in 'running'. */
        async function engineIdle(): Promise<boolean> {
                const overview = (await (await fetch(api("/api/overview"))).json()) as Record<string, unknown>;
                if (overview.routerBusy) return false;
                const { runs } = (await (await fetch(api("/api/runs?limit=200"))).json()) as {
                        runs: Array<Record<string, unknown>>;
                };
                return runs.every((r) => r.status !== "running");
        }

        // -------------------------------------------------------------------------
        // 5. SSE /api/events — shape, ordering, client disconnect survives
        // -------------------------------------------------------------------------
        test("SSE /api/events streams hello + live events in order; disconnect does not crash the server", async () => {
                // Guard: start from an idle engine so the job trigger below cannot
                // hit the busy mutex (409) because of leftover in-flight work.
                await waitFor(async () => (await engineIdle()) || null, {
                        timeoutMs: 110_000,
                        intervalMs: 200,
                        label: "engine idle",
                });

                const res = await fetch(api("/api/events"));
                expect(res.status).toBe(200);
                expect(res.headers.get("content-type")).toContain("text/event-stream");
                const client = new SseClient(res);

                const hello = await client.next();
                expect(hello.event).toBe("hello");
                expect(typeof hello.ts).toBe("number");

                // Fire a note ingestion (note:created) and a router job (job:started →
                // job:finished) — both must appear on the stream, in emission order.
                const noteRes = await fetch(api("/api/notes"), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ content: "integration sse note", project_path: "/tmp/selflearning-it-sse-probe" }),
                });
                expect(noteRes.status).toBe(200);
                const noteBody = (await noteRes.json()) as Record<string, unknown>;
                expect(noteBody.ok).toBe(true);

                const jobRes = await fetch(api("/api/jobs/sandbox-gc/trigger"), { method: "POST" });
                expect(jobRes.status).toBe(200);
                const jobBody = (await jobRes.json()) as Record<string, unknown>;
                expect(jobBody.ok).toBe(true);

                const wanted = ["note:created", "job:started", "job:finished"];
                const seen: SseEvent[] = [];
                for (let i = 0; i < 16 && seen.length < wanted.length; i++) {
                        const ev = await client.next();
                        if (wanted.includes(ev.event)) seen.push(ev);
                }
                expect(seen.map((e) => e.event)).toEqual(wanted);

                // Event envelope shape.
                for (const ev of seen) {
                        expect(typeof ev.event).toBe("string");
                        expect(typeof ev.ts).toBe("number");
                        expect(typeof ev.payload).toBe("object");
                }
                const noteEv = seen[0];
                expect((noteEv.payload as Record<string, unknown>).id).toBe(noteBody.id);
                const started = seen.find((e) => e.event === "job:started")!;
                const finished = seen.find((e) => e.event === "job:finished")!;
                expect(started.ts).toBeLessThanOrEqual(finished.ts);
                expect((finished.payload as Record<string, unknown>).id).toBe("sandbox-gc");

                // Client disconnect: cancel the stream, then prove the server is fine.
                client.abort();
                await Bun.sleep(200);
                const after = await fetch(api("/api/overview"));
                expect(after.status).toBe(200);
        });

        // -------------------------------------------------------------------------
        // 6. Memory: version + rollback round trip over HTTP
        //    (write step uses src/memory.ts writeTier — there is no memory-write
        //    HTTP route by design; everything else is asserted through the API.)
        // -------------------------------------------------------------------------
        test("memory write → version increment → HTTP history → rollback restores content", async () => {
                const before = (await (await fetch(api("/api/memory"))).json()) as {
                        tiers: Array<Record<string, unknown>>;
                        resolvedChars: number;
                };
                const userBefore = before.tiers.find((t) => t.tier === "user")!;
                expect(userBefore.version).toBe(1);
                const seedContent = userBefore.content as string;

                // Write a new version through the engine's own primitive.
                const memory = await import("../../src/memory.ts");
                const v2 = memory.writeTier(
                        "user",
                        "# Tier 2 — User Memory\n\n- integration test rule\n",
                        "manual",
                        "integration write",
                );
                expect(v2).toBe(2);

                const afterWrite = (await (await fetch(api("/api/memory"))).json()) as {
                        tiers: Array<Record<string, unknown>>;
                };
                const userAfter = afterWrite.tiers.find((t) => t.tier === "user")!;
                expect(userAfter.version).toBe(2);
                expect(userAfter.content as string).toContain("integration test rule");

                // Version history is attributable.
                const { history } = (await (await fetch(api("/api/memory/user/history"))).json()) as {
                        history: Array<Record<string, unknown>>;
                };
                expect(history.map((h) => h.changed_by)).toEqual(["manual", "seed"]);

                // Rollback via HTTP → new version carrying the old content.
                const rollback = await fetch(api("/api/memory/user/rollback"), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ version: 1 }),
                });
                expect(rollback.status).toBe(200);
                expect(await rollback.json()).toEqual({ ok: true });

                const afterRollback = (await (await fetch(api("/api/memory"))).json()) as {
                        tiers: Array<Record<string, unknown>>;
                };
                const userRolled = afterRollback.tiers.find((t) => t.tier === "user")!;
                expect(userRolled.version).toBe(3);
                expect(userRolled.content).toBe(seedContent);

                const { history: h2 } = (await (await fetch(api("/api/memory/user/history"))).json()) as {
                        history: Array<Record<string, unknown>>;
                };
                expect(h2.map((h) => h.changed_by)).toEqual(["rollback", "manual", "seed"]);

                // Bad requests are rejected.
                const bad = await fetch(api("/api/memory/user/rollback"), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({}),
                });
                expect(bad.status).toBe(400);
        });

        // -------------------------------------------------------------------------
        // 7. Router jobs: list + toggle (+ trigger already covered by SSE test)
        // -------------------------------------------------------------------------
        test("GET /api/jobs lists the seven seeded jobs; toggle flips and restores", async () => {
                const { jobs } = (await (await fetch(api("/api/jobs"))).json()) as {
                        jobs: Array<Record<string, unknown>>;
                };
                expect(jobs.map((j) => j.id).sort()).toEqual(
                        [
                                "auto-dream",
                                "dream-check",
                                "harness-cycle",
                                "note-sync",
                                "regression-on-ship",
                                "sandbox-gc",
                                "task-mint",
                        ].sort(),
                );
                for (const j of jobs) {
                        expect(typeof j.name).toBe("string");
                        expect(typeof j.description).toBe("string");
                        expect(["interval", "event"]).toContain(j.kind);
                        expect(j.enabled).toBe(1);
                }

                const off = await fetch(api("/api/jobs/note-sync/toggle"), { method: "POST" });
                expect(off.status).toBe(200);
                const offBody = (await off.json()) as { job: Record<string, unknown> };
                expect(offBody.job.enabled).toBe(0);

                const on = await fetch(api("/api/jobs/note-sync/toggle"), { method: "POST" });
                expect(on.status).toBe(200);
                const onBody = (await on.json()) as { job: Record<string, unknown> };
                expect(onBody.job.enabled).toBe(1);

                const missing = await fetch(api("/api/jobs/no-such-job/toggle"), { method: "POST" });
                expect(missing.status).toBe(404);
        });

        // -------------------------------------------------------------------------
        // 8. Skills lifecycle over HTTP (fixtures inserted via the engine store —
        //    skills are born from dreams, which no route creates synchronously).
        //    Routing fix (2026-10-17): the per-skill routes originally matched the
        //    LITERAL path "/api/skills/:id", so requests carrying a real skill id
        //    fell through to the catch-all 404. The routes now match
        //    /api/skills/<id>[/rollback|/retire] via regex, so real ids work
        //    end-to-end (found by this suite; fix in src/server.ts).
        // -------------------------------------------------------------------------
        test("skill versions: HTTP detail, rollback restores prior file, retire removes it", async () => {
                const store = (await import("../../src/store.ts")).store;
                const skills = await import("../../src/skills.ts");
                const projectPath = `${engine!.dataDir}/skills-proj`;
                const v1Body = skills.renderSkillMd("run-tests", "Use when running the project test suite.", "# v1 body\n");
                const v2Body = skills.renderSkillMd("run-tests", "Use when running the project test suite.", "# v2 body\n");
                const skillId = "run-tests-it-fixture"; // real id — exercises the fixed routing
                const now = Date.now();
                store.run(
                        `INSERT INTO skills (id, project_slug, project_path, name, description, body, status, version, dream_id, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, 'shipped', 2, NULL, ?, ?)`,
                        [
                                skillId,
                                "it-skills-proj",
                                projectPath,
                                "run-tests",
                                "Use when running the project test suite.",
                                v2Body,
                                now,
                                now,
                        ],
                );
                store.run(
                        `INSERT INTO skill_versions (skill_id, version, content, changed_by, note, created_at) VALUES (?, 1, ?, 'dream', 'v1', ?)`,
                        [skillId, v1Body, now],
                );
                store.run(
                        `INSERT INTO skill_versions (skill_id, version, content, changed_by, note, created_at) VALUES (?, 2, ?, 'dream', 'v2', ?)`,
                        [skillId, v2Body, now + 1],
                );

                // Current file on disk is v2.
                const { writeFileSync, mkdirSync, readFileSync, existsSync } = await import("node:fs");
                mkdirSync(`${projectPath}/.unown/skills/run-tests`, { recursive: true });
                writeFileSync(`${projectPath}/.unown/skills/run-tests/SKILL.md`, v2Body, "utf8");

                const listed = (await (await fetch(api("/api/skills?project=it-skills-proj"))).json()) as {
                        skills: Array<Record<string, unknown>>;
                };
                expect(listed.skills.map((s) => s.id)).toContain(skillId);
                // List-all route (no project filter) sees it too.
                const listedAll = (await (await fetch(api("/api/skills"))).json()) as {
                        skills: Array<Record<string, unknown>>;
                };
                expect(listedAll.skills.map((s) => s.id)).toContain(skillId);

                // Unknown real ids 404 (the fixed routes match any id shape, then the
                // store lookup misses).
                expect((await fetch(api("/api/skills/real-skill-id"))).status).toBe(404);

                const detail = (await (await fetch(api(`/api/skills/${skillId}`))).json()) as {
                        skill: Record<string, unknown>;
                        versions: Array<Record<string, unknown>>;
                };
                expect(detail.skill.version).toBe(2);
                expect(detail.versions.map((v) => v.version)).toEqual([2, 1]);

                // Invalid targets are rejected with 400 + error text.
                const badVersion = await fetch(api(`/api/skills/${skillId}/rollback`), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ version: 5 }),
                });
                expect(badVersion.status).toBe(400);
                expect(((await badVersion.json()) as Record<string, unknown>).error).toContain("no version 5");
                const notInt = await fetch(api(`/api/skills/${skillId}/rollback`), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ version: "one" }),
                });
                expect(notInt.status).toBe(400);

                // Rollback to v1: file + row both restore.
                const rollback = await fetch(api(`/api/skills/${skillId}/rollback`), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ version: 1 }),
                });
                expect(rollback.status).toBe(200);
                expect(await rollback.json()).toEqual({ ok: true });
                expect(readFileSync(`${projectPath}/.unown/skills/run-tests/SKILL.md`, "utf8")).toBe(v1Body);
                const after = (await (await fetch(api(`/api/skills/${skillId}`))).json()) as {
                        skill: Record<string, unknown>;
                };
                expect(after.skill.version).toBe(1);
                expect(after.skill.body).toBe(v1Body);

                // Retire: file removed, row marked.
                const retire = await fetch(api(`/api/skills/${skillId}/retire`), { method: "POST" });
                expect(retire.status).toBe(200);
                expect(await retire.json()).toEqual({ ok: true });
                expect(existsSync(`${projectPath}/.unown/skills/run-tests`)).toBe(false);
                const retired = (await (await fetch(api(`/api/skills/${skillId}`))).json()) as {
                        skill: Record<string, unknown>;
                };
                expect(retired.skill.status).toBe("retired");

                // Retired skills refuse rollback.
                const retiredRollback = await fetch(api(`/api/skills/${skillId}/rollback`), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ version: 1 }),
                });
                expect(retiredRollback.status).toBe(400);

                // Unknown skill id.
                expect((await fetch(api("/api/skills/unknown-skill"))).status).toBe(404);
        });

        // -------------------------------------------------------------------------
        // 9. Notes outbox sync route (terminal-note plumbing, no LLM involved)
        // -------------------------------------------------------------------------
        test("POST /api/notes/sync reports zero for the empty temp outbox", async () => {
                const res = await fetch(api("/api/notes/sync"), { method: "POST" });
                expect(res.status).toBe(200);
                const body = (await res.json()) as Record<string, unknown>;
                expect(body.ok).toBe(true);
                expect(body.synced).toBe(0);
        });
});
