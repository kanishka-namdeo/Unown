// memory-evidence.test.ts — the evidence lane (2026-11-15 round), pinned.
//
// The provenance chain from a distilled memory back to the session notes
// that produced it: the WikiTrace / MAPE / Zep-episodes pattern (see
// src/memory-evidence.ts's header for the receipts). Pinned here:
//   1. the pure builders — excerpt (first line, metadata skipped, capped),
//      note pointers, imported-evidence sanitizer (untrusted input);
//   2. the record — batch attribution, note-count bound, oldest-first
//      eviction at the entry cap, atomic write, corrupt = empty;
//   3. hygiene — prune-to-live-set, coverage's honest denominator;
//   4. integration — a real project dream (fake platform, no LLM) links
//      every extracted memory to the batch's note and dream identity.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    EVIDENCE_MAX_ENTRIES,
    EVIDENCE_MAX_NOTES,
    evidenceCoverageFor,
    evidenceExcerpt,
    evidenceFor,
    evidenceNote,
    evidenceRecordPath,
    pruneEvidenceToLiveSet,
    recordEvidenceFromBatch,
    readEvidenceRecord,
    sanitizeImportedEvidence,
} from "../src/memory-evidence.ts";
import { dormancyScopeKey, projectScope } from "../src/memzero.ts";
import { runProjectDream } from "../src/dream.ts";
import { initProjectMemory, projectMemoryPath } from "../src/term.ts";
import { ingestTerminalNote, slugifyProject } from "../src/notes.ts";
import { store } from "../src/store.ts";
import { makeFakePlatform } from "./_fake-platform.ts";

const SCRATCH = join(tmpdir(), "memory-evidence-test");
const DIR = join(SCRATCH, "records");

beforeEach(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
});

afterAll(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The pure builders
// ---------------------------------------------------------------------------

describe("evidenceExcerpt", () => {
    test("first non-empty line, trimmed", () => {
        expect(evidenceExcerpt("\n\n  run tests with bun test  \nsecond line")).toBe("run tests with bun test");
    });
    test("session metadata lines are skipped — they name tools, not topics", () => {
        expect(evidenceExcerpt("session metadata: duration 42s, tools bash, write\nthe parser fix landed")).toBe(
            "the parser fix landed",
        );
    });
    test("capped with an honest ellipsis, never a silent cut", () => {
        const long = "x".repeat(200);
        const out = evidenceExcerpt(long, 96);
        expect(out.length).toBe(96);
        expect(out.endsWith("…")).toBe(true);
    });
    test("empty content → empty excerpt (never a fake pointer)", () => {
        expect(evidenceExcerpt("")).toBe("");
        expect(evidenceExcerpt("session metadata: tools bash")).toBe("");
    });
});

describe("evidenceNote", () => {
    test("id stringified, ts carried, excerpt built", () => {
        const n = evidenceNote({ id: 42, content: "the flaky test was pinned", created_at: 1234 });
        expect(n.id).toBe("42");
        expect(n.at).toBe(1234);
        expect(n.excerpt).toBe("the flaky test was pinned");
    });
    test("missing created_at degrades to 0, not NaN", () => {
        expect(evidenceNote({ id: "n1", content: "x" }).at).toBe(0);
    });
});

describe("sanitizeImportedEvidence (the untrusted-input lane)", () => {
    test("well-formed notes pass with caps applied", () => {
        const out = sanitizeImportedEvidence([{ id: "a", at: 5, excerpt: "e".repeat(500) }]);
        expect(out).not.toBeNull();
        expect(out!.length).toBe(1);
        expect(out![0].excerpt.length).toBe(200);
    });
    test("garbage entries are dropped, not thrown", () => {
        const out = sanitizeImportedEvidence([null, 7, { nope: true }, { id: "", excerpt: "" }, { id: "ok", excerpt: "fine" }]);
        expect(out).toEqual([{ id: "ok", at: 0, excerpt: "fine" }]);
    });
    test("empty / non-array / all-garbage → null (no evidence carried)", () => {
        expect(sanitizeImportedEvidence([])).toBeNull();
        expect(sanitizeImportedEvidence(undefined)).toBeNull();
        expect(sanitizeImportedEvidence("nope")).toBeNull();
        expect(sanitizeImportedEvidence([{}, "x"])).toBeNull();
    });
    test("the note-count bound holds against a hostile file", () => {
        const many = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, excerpt: "e" }));
        expect(sanitizeImportedEvidence(many)!.length).toBeLessThanOrEqual(8);
    });
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe("recordEvidenceFromBatch + evidenceFor", () => {
    test("links every extracted id to the batch (the honest attribution unit)", () => {
        const n = recordEvidenceFromBatch(
            ["m1", "m2"],
            [
                { id: "n1", content: "first note", created_at: 100 },
                { id: "n2", content: "second note", created_at: 200 },
            ],
            "dream-1",
            { scopeKey: "s", dir: DIR, now: 1000 },
        );
        expect(n).toBe(2);
        const e1 = evidenceFor("s", "m1", DIR);
        expect(e1?.dreamId).toBe("dream-1");
        expect(e1?.at).toBe(1000);
        expect(e1?.notes.map((x) => x.id)).toEqual(["n1", "n2"]);
        expect(e1?.notes[0].excerpt).toBe("first note");
        // the same entry shape answers for m2 — batch-level attribution
        expect(evidenceFor("s", "m2", DIR)?.notes.length).toBe(2);
    });
    test("a later dream re-extracting the same id replaces the pointer (mem0 UPDATE keeps the id)", () => {
        recordEvidenceFromBatch(["m1"], [{ id: "n1", content: "old", created_at: 1 }], "d1", { scopeKey: "s", dir: DIR, now: 1 });
        recordEvidenceFromBatch(["m1"], [{ id: "n2", content: "newer", created_at: 2 }], "d2", { scopeKey: "s", dir: DIR, now: 2 });
        const e = evidenceFor("s", "m1", DIR);
        expect(e?.dreamId).toBe("d2");
        expect(e?.notes[0].id).toBe("n2");
    });
    test("no ids or no notes → zero links, no record written", () => {
        expect(recordEvidenceFromBatch([], [{ id: "n", content: "x" }], "d", { scopeKey: "s2", dir: DIR })).toBe(0);
        expect(recordEvidenceFromBatch(["m"], [], "d", { scopeKey: "s2", dir: DIR })).toBe(0);
        expect(existsSync(evidenceRecordPath("s2", DIR))).toBe(false); // nothing written
    });
    test("notes beyond EVIDENCE_MAX_NOTES are dropped (no transcript amplification)", () => {
        const many = Array.from({ length: EVIDENCE_MAX_NOTES + 5 }, (_, i) => ({ id: `n${i}`, content: `note ${i}` }));
        recordEvidenceFromBatch(["m"], many, "d", { scopeKey: "s3", dir: DIR });
        expect(evidenceFor("s3", "m", DIR)?.notes.length).toBe(EVIDENCE_MAX_NOTES);
    });
    test("entries past EVIDENCE_MAX_ENTRIES evict oldest-dream-first", () => {
        const ids = Array.from({ length: EVIDENCE_MAX_ENTRIES + 10 }, (_, i) => `m${i}`);
        recordEvidenceFromBatch(ids, [{ id: "n", content: "x" }], "d-old", { scopeKey: "s4", dir: DIR, now: 1 });
        const rec = readEvidenceRecord("s4", DIR);
        expect(Object.keys(rec).length).toBe(EVIDENCE_MAX_ENTRIES);
        // the OLDEST dream's entries evicted; the newest batch's ids survive
        expect(rec["m0"]).toBeUndefined();
        expect(rec[`m${EVIDENCE_MAX_ENTRIES + 9}`]).toBeDefined();
    });
    test("corrupt record reads as empty, never throws", () => {
        const path = evidenceRecordPath("s5", DIR);
        mkdirSync(DIR, { recursive: true });
        writeFileSync(path, "{not json", "utf8");
        expect(readEvidenceRecord("s5", DIR)).toEqual({});
    });
});

describe("pruneEvidenceToLiveSet + coverage", () => {
    test("dead ids drop, live ids keep", () => {
        recordEvidenceFromBatch(["m1", "m2", "m3"], [{ id: "n", content: "x" }], "d", { scopeKey: "s", dir: DIR });
        const pruned = pruneEvidenceToLiveSet("s", ["m1", "m3"], DIR);
        expect(pruned).toBe(1);
        expect(evidenceFor("s", "m2", DIR)).toBeNull();
        expect(evidenceFor("s", "m1", DIR)).not.toBeNull();
    });
    test("coverage: pre-lane and seeded memories count as unlinked — never retroactive", () => {
        recordEvidenceFromBatch(["m1"], [{ id: "n", content: "x" }], "d", { scopeKey: "s", dir: DIR });
        const cov = evidenceCoverageFor("s", ["m1", "m2", "m3"], DIR);
        expect(cov.linked).toBe(1);
        expect(cov.unlinked).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Integration: a real project dream links extracted memories to the batch
// ---------------------------------------------------------------------------

// The skill-mint leg of a project dream calls the bridge (chatJson); against
// a dead endpoint it hangs to the 180s upstream timeout — the same reason
// dream-guard spawns a stub. The stub answers with no skills (the honest
// nothing-to-mint outcome), so the memory lane under test runs to completion.
const STUB_PORT = 3947;
const STUB_SCRIPT = `
import { serve } from "bun";
const server = serve({
  port: ${STUB_PORT},
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/v1/chat/completions") {
      return Response.json({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ skills: [] }) } }],
      });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log("STUB_READY");
`;
let stubProc: ReturnType<typeof spawn> | null = null;
let savedBridgeUrl: string | undefined;

describe("the dream path records evidence end to end", () => {
    beforeAll(async () => {
        savedBridgeUrl = process.env.PI_BRIDGE_URL;
        const stubPath = join(SCRATCH, "bridge-stub.ts");
        writeFileSync(stubPath, STUB_SCRIPT);
        stubProc = spawn(process.execPath, [stubPath], { stdio: ["ignore", "ignore", "ignore"] });
        await new Promise<void>((resolve) => {
            const deadline = Date.now() + 10_000;
            const poll = () => {
                if (Date.now() > deadline) return resolve();
                fetch(`http://127.0.0.1:${STUB_PORT}/health`).then(() => resolve()).catch(() => setTimeout(poll, 100));
            };
            poll();
        });
        process.env.PI_BRIDGE_URL = `http://127.0.0.1:${STUB_PORT}`;
    });
    afterAll(() => {
        stubProc?.kill();
        if (savedBridgeUrl === undefined) delete process.env.PI_BRIDGE_URL;
        else process.env.PI_BRIDGE_URL = savedBridgeUrl;
    });
    beforeEach(() => {
        store.run(`DELETE FROM notes`);
        store.run(`DELETE FROM dreams`);
        store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
    });

    test("a clean terminal note's extracted memories carry the batch + dream identity", async () => {
        const project = join(SCRATCH, "evidence-project");
        mkdirSync(project, { recursive: true });
        initProjectMemory(project);
        const NOTE = "Terminal session outcome: pinned the flaky parser test by forcing column offsets in the CSV reader.";
        ingestTerminalNote(NOTE, project);
        const platform = makeFakePlatform();
        const noReconcile = () => Promise.resolve({ ops: [] });

        const results = await runProjectDream({ platform, reconcileLlmFn: noReconcile });
        expect(results.length).toBe(1);
        expect(results[0].status).toBe("done");

        // The scope key the dream path used (dormancyScopeKey of the composite
        // project scope) — the evidence record lives under the same key space.
        const slug = slugifyProject(project);
        const scopeKey = dormancyScopeKey(projectScope(slug));

        // Every memory the fake platform extracted for this scope is linked.
        const live = await platform.getAll(projectScope(slug));
        expect(live.length).toBeGreaterThan(0);
        for (const m of live) {
            const e = evidenceFor(scopeKey, m.id);
            expect(e).not.toBeNull();
            expect(e?.dreamId).toMatch(/^project-/);
            expect(e?.notes.length).toBe(1); // the batch was this one note
            expect(e?.notes[0].excerpt.length).toBeGreaterThan(0);
            // the pointer names the topic, not the telemetry
            expect(e?.notes[0].excerpt).not.toMatch(/^session metadata:/i);
        }
        // Coverage is complete for this fresh scope — every live memory was
        // extracted by the dream that just ran.
        const cov = evidenceCoverageFor(scopeKey, live.map((m) => m.id));
        expect(cov.linked).toBe(live.length);
        expect(cov.unlinked).toBe(0);
        // and the dream row the evidence points at exists (the identity shares)
        const dreamId = evidenceFor(scopeKey, live[0].id)!.dreamId;
        const row = store.get<any>(`SELECT id, status FROM dreams WHERE id = ?`, [dreamId]);
        expect(row?.status).toBe("done");
        // the rendered tier carries NO provenance (the placement law: render
        // budgets stay untaxed — dates/excerpts live in the side record only)
        const rendered = readFileSync(projectMemoryPath(project), "utf8");
        expect(rendered).not.toContain("dream:");
        expect(rendered).not.toContain("evidence");
    });
});
