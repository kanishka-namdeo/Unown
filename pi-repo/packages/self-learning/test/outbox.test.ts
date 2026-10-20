// Outbox tests: idempotency regression (audit MEDIUM-5) + the M6 outbox
// hardening (content cap, UNOWN_OUTBOX_MAX oldest-first drop, the
// note-delivery budget + engine-known-down fast path, and the drain-side
// content cap parity in notes.ts ingestTerminalNote).
//
// The MEDIUM-5 archive failure is forced NATURALLY: notes/done is occupied by
// a plain file, so both mkdirSync and renameSync inside archiveOutboxNote
// fail (the exact class of swallowed real-world failures: read-only dir,
// Windows EBUSY from a held handle).
//
// OUTBOX_MAX and NOTE_DELIVERY_BUDGET_MS are MODULE-LOAD consts — the env
// knobs are exercised in fresh bun subprocesses (the detachment.test.ts
// pattern), each with its own redirected UNOWN_HOME so the shared suite
// outbox is never touched.
import "./_env.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { deliverTerminalNote, OUTBOX_MAX, outboxStats, UNOWN_NOTES_DIR, UNOWN_NOTES_DONE_DIR, UNOWN_OUTBOX_DIR, writeOutboxNote } from "../src/term.ts";
import { syncNoteOutbox } from "../src/outbox.ts";
import { ingestTerminalNote } from "../src/notes.ts";
import { store } from "../src/store.ts";

const PKG_ROOT = join(import.meta.dir, "..");

const MARKER = `outbox-dedup-${Date.now().toString(36)}`;
const PROJECT = join("/tmp", MARKER);

const terminalNotes = () =>
        store.query<{ id: string; content: string }>(
                `SELECT id, content FROM notes WHERE kind = 'terminal' AND project_path = ? ORDER BY created_at`,
                [PROJECT],
        );

afterAll(() => {
        // restore a sane archive dir for later suites
        rmSync(UNOWN_NOTES_DONE_DIR, { recursive: true, force: true });
        try {
                mkdirSync(UNOWN_NOTES_DONE_DIR, { recursive: true });
        } catch {
                /* best effort */
        }
        // remove this suite's notes so counts never leak across runs
        for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);
        // ...and this suite's outbox FILES (the M6 delivery tests queue some)
        try {
                for (const f of readdirSync(UNOWN_OUTBOX_DIR)) if (f.includes(MARKER)) rmSync(join(UNOWN_OUTBOX_DIR, f), { force: true });
        } catch {
                /* no outbox dir */
        }
});

describe("syncNoteOutbox idempotency (MEDIUM-5)", () => {
        test("a file whose archive rename keeps failing is ingested exactly ONCE, and archives on a later healthy pass", () => {
                // clean slate for this project's notes
                for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);

                // 1. an offline note lands in the outbox
                const file = writeOutboxNote({ content: `terminal session note for ${MARKER}`, projectPath: PROJECT, ts: Date.now() });
                expect(existsSync(file)).toBe(true);

                // 2. force the archive failure: notes/done occupied by a FILE
                rmSync(UNOWN_NOTES_DONE_DIR, { recursive: true, force: true });
                writeFileSync(UNOWN_NOTES_DONE_DIR, "not a directory");

                // 3. first sync: ingests the note, archive silently fails
                const first = syncNoteOutbox();
                expect(first).toBeGreaterThanOrEqual(1);
                expect(terminalNotes()).toHaveLength(1);

                // 4. second sync (the bug): same file, still unarchived — must NOT duplicate
                const second = syncNoteOutbox();
                expect(second).toBe(0);
                expect(terminalNotes()).toHaveLength(1);
                expect(existsSync(file)).toBe(true); // still pending archive

                // 5. heal the archive dir: the pending file archives without re-ingesting
                rmSync(UNOWN_NOTES_DONE_DIR, { recursive: true, force: true });
                mkdirSync(UNOWN_NOTES_DONE_DIR, { recursive: true });
                const third = syncNoteOutbox();
                expect(third).toBe(0); // deduped, but the archive retry happens
                expect(terminalNotes()).toHaveLength(1);
                expect(existsSync(file)).toBe(false); // archived now
                expect(existsSync(join(UNOWN_NOTES_DONE_DIR, basename(file)))).toBe(true); // basename: POSIX split("/") breaks on Windows paths
        });

        test("distinct sessions with different content are both ingested (dedup does not over-block)", () => {
                for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);
                rmSync(UNOWN_NOTES_DONE_DIR, { recursive: true, force: true });
                mkdirSync(UNOWN_NOTES_DONE_DIR, { recursive: true });

                writeOutboxNote({ content: `session A for ${MARKER}: edited two files, tests green`, projectPath: PROJECT, ts: Date.now() });
                writeOutboxNote({ content: `session B for ${MARKER}: different outcome entirely`, projectPath: PROJECT, ts: Date.now() + 5 });
                const ingested = syncNoteOutbox();
                expect(ingested).toBe(2);
                expect(terminalNotes()).toHaveLength(2);
        });
});

// ---------------------------------------------------------------------------
// M6: outbox content cap — oversized notes are TRUNCATED, not rejected (the
// engine's HTTP lane rejects >20k; a queued note must not become the bypass).
// ---------------------------------------------------------------------------

describe("outbox content cap (M6)", () => {
        function parseNoteBody(path: string): { project: string; ts: string; content: string } {
                const m = readFileSync(path, "utf8").match(/^---\nproject: (.+)\nts: (\d+)\n---\n([\s\S]*)\n$/);
                expect(m).not.toBeNull();
                return { project: m![1], ts: m![2], content: m![3] };
        }

        test("content over 20k is capped at 20k and marked (truncated)", () => {
                const file = writeOutboxNote({ content: "x".repeat(20_001), projectPath: PROJECT, ts: 7 });
                try {
                        const parsed = parseNoteBody(file);
                        expect(parsed.project).toBe(PROJECT);
                        expect(parsed.ts).toBe("7");
                        expect(parsed.content).toBe(`${"x".repeat(20_000)}\n(truncated)`);
                } finally {
                        rmSync(file, { force: true });
                }
        });

        test("exactly 20k passes through untouched (the cap is a strict >)", () => {
                const file = writeOutboxNote({ content: "y".repeat(20_000), projectPath: PROJECT, ts: 8 });
                try {
                        expect(parseNoteBody(file).content).toBe("y".repeat(20_000));
                        expect(readFileSync(file, "utf8")).not.toContain("(truncated)");
                } finally {
                        rmSync(file, { force: true });
                }
        });

        test("short notes are stored verbatim", () => {
                const file = writeOutboxNote({ content: "tiny", projectPath: PROJECT, ts: 9 });
                try {
                        expect(parseNoteBody(file).content).toBe("tiny");
                } finally {
                        rmSync(file, { force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// M6: UNOWN_OUTBOX_MAX — oldest-first drop when the queue grows past the cap
// (module-load const → fresh bun subprocess per knob value).
// ---------------------------------------------------------------------------

function runOutboxCapProbe(outboxMax: string, notes: number): { code: number; out: any; stderr: string } {
        const root = mkdtempSync(join(tmpdir(), "unown-outbox-cap-"));
        const script = `
const { OUTBOX_MAX, writeOutboxNote, outboxStats, UNOWN_OUTBOX_DIR } = await import(${JSON.stringify(join(PKG_ROOT, "src/term.ts"))});
const fs = await import("node:fs");
const path = await import("node:path");
for (let i = 0; i < ${notes}; i++) {
        writeOutboxNote({ content: "cap-note-" + i, projectPath: "/tmp/outbox-cap-probe", ts: i });
        await Bun.sleep(3); // distinct Date.now() prefixes keep filename order = write order
}
const stats = outboxStats();
const remaining = fs.readdirSync(UNOWN_OUTBOX_DIR).filter((f) => f.endsWith(".md")).sort()
        .map((f) => fs.readFileSync(path.join(UNOWN_OUTBOX_DIR, f), "utf8"));
console.log("CAP_RESULT=" + JSON.stringify({ outboxMax: OUTBOX_MAX, stats, remaining }));
`;
        const probePath = join(root, "probe.ts");
        writeFileSync(probePath, script);
        const env: NodeJS.ProcessEnv = {
                ...process.env,
                UNOWN_HOME: join(root, "unown-home"), // isolated outbox + drop counter
                UNOWN_OUTBOX_MAX: outboxMax,
                UNOWN_ENGINE_URL: "http://127.0.0.1:9",
                NO_UPDATE_NOTIFIER: "1",
        };
        const res = spawnSync(process.execPath, [probePath], { env, encoding: "utf8", timeout: 60_000 });
        rmSync(root, { recursive: true, force: true });
        const m = (res.stdout ?? "").match(/CAP_RESULT=(\{.*\})/s);
        return { code: res.status ?? -1, out: m ? JSON.parse(m[1]) : null, stderr: res.stderr ?? "" };
}

describe("outbox queue cap (M6, UNOWN_OUTBOX_MAX)", () => {
        test("default cap is 200 (the suite leaves UNOWN_OUTBOX_MAX unset)", () => {
                expect(OUTBOX_MAX).toBe(200);
        });

        test("UNOWN_OUTBOX_MAX=3: the 4th write drops the OLDEST note and counts the drop", () => {
                const r = runOutboxCapProbe("3", 4);
                expect(r.code).toBe(0);
                expect(r.out.outboxMax).toBe(3);
                expect(r.out.stats.queued).toBe(3);
                expect(r.out.stats.dropped).toBe(1);
                const flat = (r.out.remaining as string[]).join("\n");
                expect(flat).not.toContain("cap-note-0"); // oldest dropped first
                expect(flat).toContain("cap-note-3"); // newest kept
                expect(r.out.remaining).toHaveLength(3);
        }, 15_000);

        test("UNOWN_OUTBOX_MAX=0: unlimited — nothing is ever dropped", () => {
                const r = runOutboxCapProbe("0", 6);
                expect(r.code).toBe(0);
                expect(r.out.outboxMax).toBe(0);
                expect(r.out.stats.queued).toBe(6);
                expect(r.out.stats.dropped).toBe(0);
                expect((r.out.remaining as string[]).join("\n")).toContain("cap-note-0");
        }, 15_000);
});

// ---------------------------------------------------------------------------
// M6: note delivery — the engine-known-down fast path (assumeDown) and the
// delivery budget (a hanging engine URL can't hold the quit hostage).
// ---------------------------------------------------------------------------

/** rm every outbox file that appeared since `before` (delivery tests clean up after themselves). */
function cleanupNewOutboxFiles(before: string[]): string[] {
        const beforeSet = new Set(before);
        let names: string[] = [];
        try {
                names = readdirSync(UNOWN_OUTBOX_DIR).filter((f) => f.endsWith(".md") && !beforeSet.has(f));
        } catch {
                /* no dir */
        }
        for (const n of names) rmSync(join(UNOWN_OUTBOX_DIR, n), { force: true });
        return names;
}

describe("note delivery: assumeDown fast path + budget (M6)", () => {
        test("assumeDown: skips BOTH the probe and the POST, lands in the outbox instantly", async () => {
                const realFetch = globalThis.fetch;
                let fetchCalls = 0;
                globalThis.fetch = (async () => {
                        fetchCalls++;
                        throw new Error("the assumeDown path must not touch the network");
                }) as any;
                const before = outboxStats().queued;
                const beforeFiles = readdirSync(UNOWN_OUTBOX_DIR);
                const t0 = Date.now();
                try {
                        const result = await deliverTerminalNote(
                                { content: `assume-down probe ${MARKER}`, projectPath: PROJECT, ts: Date.now() },
                                { assumeDown: true },
                        );
                        expect(result).toEqual({ delivered: false, via: "outbox", detail: "engine known down — queued" });
                        expect(Date.now() - t0).toBeLessThan(500); // instant — no probe/POST round trip
                        expect(fetchCalls).toBe(0);
                        expect(outboxStats().queued).toBe(before + 1); // the note actually LANDED — not dropped
                } finally {
                        globalThis.fetch = realFetch;
                        cleanupNewOutboxFiles(beforeFiles);
                }
        });

        test("dead engine (instant refusal): falls back to the outbox with the failure detail", async () => {
                // UNOWN_ENGINE_URL is the suite's dead port (127.0.0.1:9) — connection
                // refused is immediate, so this exercises the normal fallback path.
                const before = outboxStats().queued;
                const beforeFiles = readdirSync(UNOWN_OUTBOX_DIR);
                const result = await deliverTerminalNote({ content: `dead-engine probe ${MARKER}`, projectPath: PROJECT, ts: Date.now() });
                try {
                        expect(result.delivered).toBe(false);
                        expect(result.via).toBe("outbox");
                        expect(typeof result.detail).toBe("string");
                        expect(outboxStats().queued).toBe(before + 1);
                } finally {
                        cleanupNewOutboxFiles(beforeFiles);
                }
        });

        test("a hanging engine URL is cut off by the delivery budget (UNOWN_NOTE_BUDGET_MS, fresh process)", () => {
                // NOTE_DELIVERY_BUDGET_MS is a module-load const: a fresh process with
                // the knob at its 500ms floor. fetch is mocked to a promise that NEVER
                // settles and ignores its abort signal — the exact wedge the budget exists for.
                const root = mkdtempSync(join(tmpdir(), "unown-note-budget-"));
                const script = `
const { deliverTerminalNote, outboxStats } = await import(${JSON.stringify(join(PKG_ROOT, "src/term.ts"))});
globalThis.fetch = (async () => new Promise(() => {})) as any; // hangs forever, ignores the abort signal
const t0 = Date.now();
const result = await deliverTerminalNote({ content: "budget probe", projectPath: "/tmp/budget-proj", ts: 1 });
console.log("BUDGET_RESULT=" + JSON.stringify({ result, elapsed: Date.now() - t0, stats: outboxStats() }));
process.exit(0);
`;
                const probePath = join(root, "probe.ts");
                writeFileSync(probePath, script);
                const env: NodeJS.ProcessEnv = {
                        ...process.env,
                        UNOWN_HOME: join(root, "unown-home"),
                        UNOWN_NOTE_BUDGET_MS: "500",
                        UNOWN_ENGINE_URL: "http://127.0.0.1:9",
                        NO_UPDATE_NOTIFIER: "1",
                };
                const res = spawnSync(process.execPath, [probePath], { env, encoding: "utf8", timeout: 60_000 });
                rmSync(root, { recursive: true, force: true });
                expect(res.status).toBe(0);
                const m = (res.stdout ?? "").match(/BUDGET_RESULT=(\{.*\})/s);
                expect(m).not.toBeNull();
                const out = JSON.parse(m![1]);
                expect(out.result).toEqual({ delivered: false, via: "outbox", detail: "delivery budget exceeded — queued" });
                expect(out.elapsed).toBeGreaterThanOrEqual(400); // the budget actually waited
                expect(out.elapsed).toBeLessThan(2_000); // ...but not the default 2.5s
                expect(out.stats.queued).toBe(1); // the post-race write: the note is never swallowed
        }, 15_000);
});

// ---------------------------------------------------------------------------
// M6: drain-side cap parity — legacy oversized outbox files must not bypass
// the HTTP lane's 20k limit at ingest time.
// ---------------------------------------------------------------------------

describe("ingestTerminalNote content cap (M6 parity)", () => {
        test("content is capped at 20k on the drain side too", () => {
                const id = ingestTerminalNote("z".repeat(25_000), "/srv/cap-probe");
                try {
                        const row = store.get<{ content: string; kind: string; len: number }>(
                                `SELECT content, kind, LENGTH(content) AS len FROM notes WHERE id = ?`,
                                [id],
                        );
                        expect(row!.len).toBe(20_000);
                        expect(row!.kind).toBe("terminal");
                        expect(row!.content).toBe("z".repeat(20_000));
                } finally {
                        store.run(`DELETE FROM notes WHERE id = ?`, [id]);
                }
        });

        test("short content passes through whole", () => {
                const id = ingestTerminalNote("small", "/srv/cap-probe");
                try {
                        const row = store.get<{ len: number }>(`SELECT LENGTH(content) AS len FROM notes WHERE id = ?`, [id]);
                        expect(row!.len).toBe(5);
                } finally {
                        store.run(`DELETE FROM notes WHERE id = ?`, [id]);
                }
        });
});

// keep tree tidy (outbox files of this run are archived; nothing else ours)
test("suite hygiene: no leftover outbox files from this suite", () => {
        const leftovers = readdirSync(UNOWN_OUTBOX_DIR).filter((f) => f.includes(MARKER));
        expect(leftovers).toEqual([]);
        expect(statSync(UNOWN_NOTES_DONE_DIR).isDirectory()).toBe(true);
});
