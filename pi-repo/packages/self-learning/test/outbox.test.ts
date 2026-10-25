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
import { deliverTerminalNote, OUTBOX_MAX, outboxStats, sliceCodePointSafe, UNOWN_NOTES_DIR, UNOWN_NOTES_DONE_DIR, UNOWN_OUTBOX_DIR, writeOutboxNote } from "../src/term.ts";
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

/** Parse an outbox file into its front-matter fields + note body (shared by
 *  the M6 cap tests and the BUG 9/13 cap-parity tests below). */
function parseNoteBody(path: string): { project: string; ts: string; content: string } {
        const m = readFileSync(path, "utf8").match(/^---\nproject: (.+)\nts: (\d+)\n---\n([\s\S]*)\n$/);
        expect(m).not.toBeNull();
        return { project: m![1], ts: m![2], content: m![3] };
}

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

describe("ingestTerminalNote content cap (M6 parity + BUG 9)", () => {
        test("content is capped at 20k AND MARKED — byte-identical to the outbox cap shape", () => {
                // REGRESSION (BUG 9): the drain-side cap used to be a bare
                // slice(0, 20000) with NO marker, while the outbox write stored
                // slice(0, 20000) + "\n(truncated)". The same oversized note
                // stored via the two delivery paths therefore differed by the
                // marker, the drain's exact-content dedup missed, and the note
                // was ingested twice. All cap sites now produce the SAME bytes.
                const id = ingestTerminalNote("z".repeat(25_000), "/srv/cap-probe");
                try {
                        const row = store.get<{ content: string; kind: string; len: number }>(
                                `SELECT content, kind, LENGTH(content) AS len FROM notes WHERE id = ?`,
                                [id],
                        );
                        expect(row!.len).toBe(20_012); // 20k cap + the 12-unit marker
                        expect(row!.kind).toBe("terminal");
                        expect(row!.content).toBe(`${"z".repeat(20_000)}\n(truncated)`);
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

        test("the cap is idempotent: an already-capped note re-entering ingest is unchanged", () => {
                // The outbox drain re-reads the SAME capped bytes (a failed
                // archive rename, the budget race's twin write) — re-capping
                // must be a no-op or file bytes and stored row diverge again.
                const capped = `${"z".repeat(20_000)}\n(truncated)`;
                const id = ingestTerminalNote(capped, "/srv/cap-probe");
                try {
                        const row = store.get<{ content: string }>(`SELECT content FROM notes WHERE id = ?`, [id]);
                        expect(row!.content).toBe(capped);
                } finally {
                        store.run(`DELETE FROM notes WHERE id = ?`, [id]);
                }
        });
});

// ---------------------------------------------------------------------------
// BUG 9: double-delivery on >20k notes — the budget race writes the outbox
// while the POST is still in flight, and the engine's 413 fallback writes it
// AGAIN; both outbox files then drain through the exact-content dedup. With
// all cap sites producing identical bytes (capTerminalNoteContent), the twin
// dedupes. Pre-fix, the marker present in the file but stripped by the ingest
// slice made every twin look "new" — the note landed in the notes table
// twice and the dream consolidated the same session twice.
// ---------------------------------------------------------------------------

describe("terminal-note cap parity across delivery paths (BUG 9)", () => {
        test("a >20k note delivered via BOTH paths is ingested exactly once", () => {
                for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);
                const big = "x".repeat(20_500);
                // Both delivery paths' outbox writes for the same note: the
                // budget-race write and the engine-413 fallback write.
                writeOutboxNote({ content: big, projectPath: PROJECT, ts: Date.now() });
                writeOutboxNote({ content: big, projectPath: PROJECT, ts: Date.now() });
                syncNoteOutbox();
                // Exactly ONE row for this project's twin files — pre-fix the
                // marker mismatch defeated the dedup and BOTH landed (the same
                // session consolidated twice by every later dream).
                const rows = terminalNotes();
                expect(rows).toHaveLength(1);
                expect(rows[0].content).toBe(`${"x".repeat(20_000)}\n(truncated)`);
                syncNoteOutbox(); // a re-drain (failed archive retry) changes nothing
                expect(terminalNotes()).toHaveLength(1);
                // Both twin files are archived (the deduped one retries the archive).
                expect(readdirSync(UNOWN_OUTBOX_DIR).filter((f) => f.endsWith(".md") && f.includes(MARKER))).toEqual([]);
        });

        test("all three cap sites agree byte-for-byte (outbox file, direct ingest, drain ingest)", () => {
                for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);
                const big = "y".repeat(20_123);
                const capped = `${"y".repeat(20_000)}\n(truncated)`;
                // Site 1 — the outbox write: the file's note body.
                const file = writeOutboxNote({ content: big, projectPath: PROJECT, ts: 42 });
                try {
                        expect(parseNoteBody(file).content).toBe(capped);
                } finally {
                        rmSync(file, { force: true });
                }
                // Site 2 — the HTTP lane's sink with the RAW oversized content
                // (the legacy-file drain shape).
                const idDirect = ingestTerminalNote(big, PROJECT);
                // Site 3 — the drain re-ingest of the CAPPED file bytes.
                const idDrain = ingestTerminalNote(capped, PROJECT);
                try {
                        const rows = terminalNotes();
                        expect(rows).toHaveLength(2);
                        expect(rows.every((r) => r.content === capped)).toBe(true);
                } finally {
                        store.run(`DELETE FROM notes WHERE id IN (?, ?)`, [idDirect, idDrain]);
                }
        });
});

// ---------------------------------------------------------------------------
// BUG 13: every truncation boundary can split an astral char (emoji, CJK
// ext-B) — the outbox cap and the ingest cap must back off to a codepoint
// boundary so no lone surrogate is ever stored.
// ---------------------------------------------------------------------------

describe("codepoint-safe truncation at the 20k cap (BUG 13)", () => {
        test("sliceCodePointSafe: backs off a high surrogate at the cut, keeps whole pairs, passes short strings", () => {
                const emoji = "\u{1F600}"; // 2 UTF-16 units
                expect(sliceCodePointSafe(`a${emoji}b`, 2)).toBe("a"); // cut inside the pair -> back off
                expect(sliceCodePointSafe(`a${emoji}b`, 3)).toBe(`a${emoji}`); // cut just after the pair -> keep it
                expect(sliceCodePointSafe(emoji, 1)).toBe(""); // nothing well-formed fits
                expect(sliceCodePointSafe("abc", 10)).toBe("abc"); // n >= length
                expect(sliceCodePointSafe("abc", 0)).toBe("");
        });

        test("an oversized astral note caps at a codepoint boundary on BOTH sites (no lone surrogates stored)", () => {
                for (const n of terminalNotes()) store.run(`DELETE FROM notes WHERE id = ?`, [n.id]);
                // 'x' + 10_000 emoji = 20_001 UTF-16 units: the 20_000-unit cut
                // lands on the LAST emoji's high surrogate and must back off to
                // 19_999 units ('x' + 9_999 emoji) before the marker.
                const astral = `x${"\u{1F600}".repeat(10_000)}`;
                const expected = `x${"\u{1F600}".repeat(9_999)}\n(truncated)`;
                // Site 1 — the outbox write.
                const file = writeOutboxNote({ content: astral, projectPath: PROJECT, ts: 43 });
                let body = "";
                try {
                        body = parseNoteBody(file).content;
                } finally {
                        rmSync(file, { force: true });
                }
                expect(body).toBe(expected);
                // Site 2 — the ingest sink.
                const id = ingestTerminalNote(astral, PROJECT);
                try {
                        const row = store.get<{ content: string }>(`SELECT content FROM notes WHERE id = ?`, [id]);
                        expect(row!.content).toBe(expected); // byte-identical to the outbox site
                        // No lone surrogates in the STORED text.
                        for (let i = 0; i < row!.content.length; i++) {
                                const c = row!.content.charCodeAt(i);
                                if (c >= 0xd800 && c <= 0xdbff) {
                                        const next = row!.content.charCodeAt(i + 1);
                                        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
                                }
                        }
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
