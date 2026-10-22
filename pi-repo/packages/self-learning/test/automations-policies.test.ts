/**
 * automations-policies.test.ts — M5: the monitoring/delivery policies.
 *
 * PURE: the active-hours window grammar + membership (incl. tz + wrap).
 * ENGINE: the tick gates (active-hours / idle-only, skip-and-advance vs
 * hold — including the held-row starvation pin), slot jitter, and post-run
 * result delivery (sent / NO_REPLY suppression / failure), all against an
 * injected fake dispatcher and probe — plus one REAL HTTP receiver for the
 * delivery payload contract.
 */
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        AutomationsScheduler,
        createAutomation,
        deleteAutomation,
        getAutomation,
        listRuns,
        setForegroundProbeForTest,
        setJitterRandForTest,
        updateAutomation,
        type AutomationRow,
} from "../src/automations.ts";
import { isWithinActiveHours, parseActiveHours, minutesSinceMidnight } from "../src/active-hours.ts";
import { store, DATA_DIR } from "../src/store.ts";

const WORKSPACE = mkdtempSync(join(tmpdir(), "unown-m5-ws-"));
const LOCK = join(DATA_DIR, "engine.lock");
const created: string[] = [];

function track(r: { ok: true; automation: AutomationRow } | { ok: false; error: string }): AutomationRow {
        if (!r.ok) throw new Error(`createAutomation failed: ${r.error}`);
        created.push(r.automation.id);
        return r.automation;
}

function drop(id: string): void {
        store.run(`DELETE FROM automations WHERE id = ?`, [id]);
        store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
        const i = created.indexOf(id);
        if (i >= 0) created.splice(i, 1);
}

function make(opts: { cron?: string; every?: string; delayMinutes?: number; after?: string; activeHours?: string | null; idleOnly?: boolean; deliverUrl?: string | null; jitterSecs?: number | null; title?: string } = {}): AutomationRow {
        return track(
                createAutomation({
                        title: opts.title ?? "m5",
                        prompt: "test",
                        workspace: WORKSPACE,
                        schedule: opts.cron !== undefined ? { cron: opts.cron } : opts.every !== undefined ? { every: opts.every } : opts.delayMinutes !== undefined ? { delayMinutes: opts.delayMinutes } : { after: opts.after },
                        activeHours: opts.activeHours,
                        idleOnly: opts.idleOnly,
                        deliverUrl: opts.deliverUrl,
                        jitterSecs: opts.jitterSecs,
                }),
        );
}

/** Force a row due N ms ago (bypass misfire grace by keeping it small). */
function forceDue(id: string, at: number): void {
        store.run(`UPDATE automations SET next_run_at = ?, running = 0, dispatch_status = 'idle' WHERE id = ?`, [at, id]);
}

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

afterAll(() => {
        for (const id of created) {
                try {
                        store.run(`DELETE FROM automations WHERE id = ?`, [id]);
                        store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
                } catch {
                        /* best effort */
                }
        }
        rmSync(WORKSPACE, { recursive: true, force: true });
        try {
                rmSync(LOCK, { force: true });
        } catch {
                /* best effort */
        }
});

// ---------------------------------------------------------------------------
// PURE: the active-hours window
// ---------------------------------------------------------------------------

describe("parseActiveHours (the window grammar)", () => {
        test("the plain form parses and canonicalizes", () => {
                const p = parseActiveHours("09:00-18:00");
                expect(p.ok).toBe(true);
                if (p.ok) {
                        expect(p.window.startMin).toBe(540);
                        expect(p.window.endMin).toBe(1080);
                        expect(p.window.wrapsMidnight).toBe(false);
                        expect(p.window.canonical).toBe("09:00-18:00");
                }
        });
        test("a wrapping window is legal (overnight batch semantics)", () => {
                const p = parseActiveHours("18:00-06:00");
                expect(p.ok).toBe(true);
                if (p.ok) expect(p.window.wrapsMidnight).toBe(true);
        });
        test("garbage is rejected with a printable error", () => {
                expect(parseActiveHours("9am-5pm").ok).toBe(false);
                expect(parseActiveHours("25:00-26:00").ok).toBe(false);
                expect(parseActiveHours("09:00").ok).toBe(false);
                expect(parseActiveHours("09:00-09:00").ok).toBe(false); // empty window
        });
});

describe("isWithinActiveHours (membership)", () => {
        const win = parseActiveHours("09:00-18:00")!.ok ? parseActiveHours("09:00-18:00") : null;
        const wrap = parseActiveHours("18:00-06:00")!.ok ? parseActiveHours("18:00-06:00") : null;
        test("both ends inclusive; outside is outside", () => {
                if (win?.ok) {
                        // Build instants from local wall-clock minutes: 08:59 out, 09:00 in, 18:00 in, 18:01 out.
                        const at = (h: number, m: number) => new Date(2026, 9, 23, h, m, 0, 0).getTime();
                        expect(isWithinActiveHours(at(8, 59), win.window, null)).toBe(false);
                        expect(isWithinActiveHours(at(9, 0), win.window, null)).toBe(true);
                        expect(isWithinActiveHours(at(18, 0), win.window, null)).toBe(true);
                        expect(isWithinActiveHours(at(18, 1), win.window, null)).toBe(false);
                }
        });
        test("a wrapping window matches across midnight", () => {
                if (wrap?.ok) {
                        const at = (h: number, m: number) => new Date(2026, 9, 23, h, m, 0, 0).getTime();
                        expect(isWithinActiveHours(at(23, 30), wrap.window, null)).toBe(true);
                        expect(isWithinActiveHours(at(3, 0), wrap.window, null)).toBe(true);
                        expect(isWithinActiveHours(at(12, 0), wrap.window, null)).toBe(false);
                }
        });
        test("the window is evaluated in the ROUTINE's timezone (the same instant, two zones)", () => {
                if (win?.ok) {
                        // 2026-10-23 12:00 UTC = 08:00 America/New_York (EDT, UTC-4) — outside 09-18…
                        const instant = Date.UTC(2026, 9, 23, 12, 0, 0);
                        expect(isWithinActiveHours(instant, win.window, "UTC")).toBe(true);
                        expect(isWithinActiveHours(instant, win.window, "America/New_York")).toBe(false);
                        expect(minutesSinceMidnight(instant, "America/New_York")).toBe(8 * 60);
                }
        });
});

// ---------------------------------------------------------------------------
// CREATE/EDIT: the policy fields land (and event rows reject the time-shaped ones)
// ---------------------------------------------------------------------------

describe("create/update with M5 policies", () => {
        test("the four policies persist (canonicalized); the list badges carry them", () => {
                const a = make({ cron: "0 9 * * *", activeHours: " 9:00 - 17:30 ", idleOnly: true, deliverUrl: "http://127.0.0.1:9/hook", jitterSecs: 30 });
                expect(a.active_hours).toBe("09:00-17:30"); // canonicalized
                expect(a.idle_only).toBe(1);
                expect(a.deliver_url).toBe("http://127.0.0.1:9/hook");
                expect(a.jitter_secs).toBe(30);
                drop(a.id);
        });
        test("garbage is a create-time 400 (window, url, jitter)", () => {
                expect(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { cron: "* * * * *" }, activeHours: "nope" }).ok).toBe(false);
                expect(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { cron: "* * * * *" }, deliverUrl: "ftp://x" }).ok).toBe(false);
                expect(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { cron: "* * * * *" }, jitterSecs: 601 }).ok).toBe(false);
                expect(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { cron: "* * * * *" }, jitterSecs: 0 }).ok).toBe(false);
        });
        test("event rows reject the time-shaped policies but accept delivery", () => {
                expect(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: {}, eventKind: "x.y", activeHours: "09:00-18:00" }).ok).toBe(false);
                expect(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: {}, eventKind: "x.y", idleOnly: true }).ok).toBe(false);
                expect(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: {}, eventKind: "x.y", jitterSecs: 5 }).ok).toBe(false);
                const ev = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: {}, eventKind: "m5.ev.deliver", deliverUrl: "http://127.0.0.1:9/hook" }));
                expect(ev.deliver_url).toBe("http://127.0.0.1:9/hook");
                drop(ev.id);
        });
        test("edit sets and clears the policies", () => {
                const a = make({ cron: "0 9 * * *" });
                const set = updateAutomation(a.id, { activeHours: "08:00-20:00", idleOnly: true, deliverUrl: "http://x.example/h", jitterSecs: 10 });
                expect(set.ok && set.automation.active_hours === "08:00-20:00" && set.automation.idle_only === 1 && set.automation.deliver_url === "http://x.example/h" && set.automation.jitter_secs === 10).toBe(true);
                const cleared = updateAutomation(a.id, { activeHours: null, idleOnly: false, deliverUrl: null, jitterSecs: null });
                expect(cleared.ok && cleared.automation.active_hours === null && cleared.automation.idle_only === 0 && cleared.automation.deliver_url === null && cleared.automation.jitter_secs === null).toBe(true);
                drop(a.id);
        });
});

// ---------------------------------------------------------------------------
// The tick gates
// ---------------------------------------------------------------------------

describe("tick gates (active-hours + idle-only)", () => {
        const idle = () => Promise.resolve(false);
        const busy = () => Promise.resolve(true);

        test("a cron slot outside the window is skipped (outside_active_hours) and advanced, never spawned", async () => {
                setForegroundProbeForTest(idle);
                const seen: string[] = [];
                const s = new AutomationsScheduler(async (a) => {
                        seen.push(a.id);
                        return { exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 };
                }, 60_000);
                // A window that EXCLUDES the current local time, whatever the
                // clock says: [now+2h, now+10h] as an HH:MM-HH:MM pair (wraps
                // midnight when needed) — a due slot 1 min ago is fresh (no
                // misfire) and provably outside.
                const now = new Date();
                const startH = (now.getHours() + 2) % 24;
                const endH = (now.getHours() + 10) % 24;
                const window = `${String(startH).padStart(2, "0")}:00-${String(endH).padStart(2, "0")}:00`;
                const a = make({ cron: "0 * * * *", activeHours: window });
                forceDue(a.id, Date.now() - 60_000);
                await s.tick();
                expect(seen).toHaveLength(0); // gated — no spawn
                const runs = listRuns(a.id);
                expect(runs.some((r) => r.status === "skipped" && r.error === "outside_active_hours")).toBe(true);
                const after = getAutomation(a.id)!;
                expect(after.next_run_at).toBeGreaterThan(Date.now() - 60_000); // advanced
                drop(a.id);
                setForegroundProbeForTest(null);
        });

        test("an idle-only slot while the foreground is busy is skipped (yielded_to_foreground)", async () => {
                setForegroundProbeForTest(busy);
                const seen: string[] = [];
                const s = new AutomationsScheduler(async (a) => {
                        seen.push(a.id);
                        return { exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 };
                }, 60_000);
                const a = make({ cron: "0 * * * *", idleOnly: true });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                expect(seen).toHaveLength(0);
                expect(listRuns(a.id).some((r) => r.error === "yielded_to_foreground")).toBe(true);
                drop(a.id);
                setForegroundProbeForTest(null);
        });

        test("idle + in-window + idle foreground: the slot FIRES (the gates compose)", async () => {
                setForegroundProbeForTest(idle);
                const seen: string[] = [];
                const s = new AutomationsScheduler(async (a) => {
                        seen.push(a.id);
                        return { exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 };
                }, 60_000);
                const a = make({ cron: "0 * * * *", idleOnly: true, activeHours: "00:00-23:59" });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                await settle();
                expect(seen).toEqual([a.id]); // fired
                drop(a.id);
                setForegroundProbeForTest(null);
        });

        test("a one-shot outside the window is HELD (no run, no skip — the misfire bound catches it later), and it does not starve other due rows in the same tick", async () => {
                setForegroundProbeForTest(idle);
                const seen: string[] = [];
                const s = new AutomationsScheduler(async (a) => {
                        seen.push(a.id);
                        return { exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 };
                }, 60_000);
                // Same fresh-outside-window trick: due 1 min ago, window [now+2h, now+10h].
                const now = new Date();
                const startH = (now.getHours() + 2) % 24;
                const endH = (now.getHours() + 10) % 24;
                const window = `${String(startH).padStart(2, "0")}:00-${String(endH).padStart(2, "0")}:00`;
                const dueAt = Date.now() - 60_000;
                // The held one-shot.
                const held = make({ delayMinutes: 60, activeHours: window, title: "held-one-shot" });
                forceDue(held.id, dueAt);
                // A second, ungated routine due NOW — must still fire in the SAME tick.
                const other = make({ cron: "0 * * * *", title: "not-held" });
                forceDue(other.id, Date.now() - 1000);
                await s.tick();
                await settle();
                expect(seen).toEqual([other.id]); // the held row blocked nothing
                expect(listRuns(held.id)).toHaveLength(0); // held: no run, no skip row
                expect(getAutomation(held.id)!.next_run_at).toBe(dueAt); // unchanged
                drop(held.id);
                drop(other.id);
                setForegroundProbeForTest(null);
        });

        test("a held idle-only one-shot fires once the foreground goes idle", async () => {
                setForegroundProbeForTest(busy);
                const seen: string[] = [];
                const s = new AutomationsScheduler(async (a) => {
                        seen.push(a.id);
                        return { exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 };
                }, 60_000);
                const a = make({ delayMinutes: 60, idleOnly: true });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                expect(seen).toHaveLength(0); // held while busy
                setForegroundProbeForTest(idle);
                await s.tick();
                await settle();
                expect(seen).toEqual([a.id]); // fired when idle
                drop(a.id);
                setForegroundProbeForTest(null);
        });
});

// ---------------------------------------------------------------------------
// Jitter
// ---------------------------------------------------------------------------

describe("slot jitter (cron/every only)", () => {
        test("a jittered cron advances by rand*N seconds; 0 and N are both legal", async () => {
                setJitterRandForTest(() => 0.5);
                const s = new AutomationsScheduler(async () => ({ exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 }), 60_000);
                const a = make({ cron: "0 * * * *", jitterSecs: 120 });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                await settle();
                const after = getAutomation(a.id)!;
                expect(after.next_run_at).not.toBeNull();
                // Cron "0 * * * *" slots land at HH:00:00 local; jitter 0.5*120s
                // shifts the computed slot by exactly 60s → HH:01:00.
                const d = new Date(after.next_run_at!);
                expect(d.getMinutes()).toBe(1);
                expect(d.getSeconds()).toBe(0);
                drop(a.id);
                setJitterRandForTest(() => Math.random());
        });
        test("a non-jittered row keeps clean slots", async () => {
                const s = new AutomationsScheduler(async () => ({ exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 }), 60_000);
                const a = make({ cron: "0 * * * *" });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                await settle();
                const after = getAutomation(a.id)!;
                expect(after.next_run_at).not.toBeNull();
                const d = new Date(after.next_run_at!);
                expect(d.getMinutes()).toBe(0);
                expect(d.getSeconds()).toBe(0);
                drop(a.id);
        });
});

// ---------------------------------------------------------------------------
// Result delivery
// ---------------------------------------------------------------------------

describe("result delivery (--deliver)", () => {
        let receiver: ReturnType<typeof Bun.serve> | null = null;
        let received: any[] = [];
        let respond: (status: number) => void = () => {};

        beforeAll(() => {
                let status = 200;
                respond = (s: number) => {
                        status = s;
                };
                receiver = Bun.serve({
                        port: 0,
                        async fetch(req) {
                                if (req.method === "POST") {
                                        const text = await req.text();
                                        received.push(text);
                                        return new Response("ok", { status });
                                }
                                return new Response("no", { status: 404 });
                        },
                });
        });
        afterAll(() => {
                receiver?.stop(true);
        });
        beforeEach(() => {
                received = [];
                respond(200);
        });

        test("a finished run POSTs the documented payload; the run row records 'sent'", async () => {
                const s = new AutomationsScheduler(async () => ({ exitCode: 0, output: "the report: all good", turns: 2, tokensIn: 10, tokensOut: 5 }), 60_000);
                const a = make({ cron: "0 * * * *", deliverUrl: `http://127.0.0.1:${receiver!.port}/hook` });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                await settle(60);
                expect(received).toHaveLength(1);
                const payload = JSON.parse(String(received[0]));
                expect(payload.type).toBe("unown.routine.finished");
                expect(payload.routineId).toBe(a.id);
                expect(payload.status).toBe("succeeded");
                expect(payload.output).toBe("the report: all good");
                const runs = listRuns(a.id);
                expect(runs.some((r) => r.delivered === "sent")).toBe(true);
                drop(a.id);
        });

        test("NO_REPLY in the output suppresses delivery (the quiet-result contract)", async () => {
                const s = new AutomationsScheduler(async () => ({ exitCode: 0, output: "nothing to report NO_REPLY", turns: 1, tokensIn: 1, tokensOut: 1 }), 60_000);
                const a = make({ cron: "0 * * * *", deliverUrl: `http://127.0.0.1:${receiver!.port}/hook` });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                await settle(60);
                expect(received).toHaveLength(0); // never sent
                expect(listRuns(a.id).some((r) => r.delivered === "suppressed_no_reply")).toBe(true);
                drop(a.id);
        });

        test("the word NO_REPLYX does NOT suppress (word-bounded)", async () => {
                const s = new AutomationsScheduler(async () => ({ exitCode: 0, output: "the token NO_REPLYX appears in prose", turns: 1, tokensIn: 1, tokensOut: 1 }), 60_000);
                const a = make({ cron: "0 * * * *", deliverUrl: `http://127.0.0.1:${receiver!.port}/hook` });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                await settle(60);
                expect(received).toHaveLength(1); // delivered
                drop(a.id);
        });

        test("a failing receiver never fails the run — 'failed: HTTP 500' is data", async () => {
                respond(500);
                const s = new AutomationsScheduler(async () => ({ exitCode: 0, output: "ran fine", turns: 1, tokensIn: 1, tokensOut: 1 }), 60_000);
                const a = make({ cron: "0 * * * *", deliverUrl: `http://127.0.0.1:${receiver!.port}/hook` });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                await settle(60);
                const runs = listRuns(a.id);
                expect(runs.some((r) => r.status === "succeeded" && String(r.delivered).startsWith("failed: HTTP 500"))).toBe(true);
                drop(a.id);
        });

        test("an unreachable receiver records the failure honestly", async () => {
                const s = new AutomationsScheduler(async () => ({ exitCode: 0, output: "ran fine", turns: 1, tokensIn: 1, tokensOut: 1 }), 60_000);
                const a = make({ cron: "0 * * * *", deliverUrl: "http://127.0.0.1:1/nowhere" });
                forceDue(a.id, Date.now() - 1000);
                await s.tick();
                await settle(60);
                expect(listRuns(a.id).some((r) => String(r.delivered).startsWith("failed:"))).toBe(true);
                drop(a.id);
        });
});
