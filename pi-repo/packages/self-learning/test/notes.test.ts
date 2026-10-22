// Unit tests for src/notes.ts — slugifyProject determinism, the run-note
// builders, and the note-store queries — plus buildTerminalNote from
// src/termhooks.ts.
//
// Task ref: engine unit tests, module 4/4 (slugifyProject determinism +
// buildTerminalNote truncation). NOTE: buildTerminalNote actually lives in
// src/termhooks.ts:181 (re-exported from index.ts), not notes.ts — tested here
// because it is the terminal-note builder paired with notes.ts' store side.
//
// This file imports ./_env.ts FIRST: notes.ts eagerly opens the engine's
// SQLite store via src/store.ts at module load — the redirect keeps all db
// fixtures under /tmp (the live engine state is never touched). termhooks.ts
// additionally pulls term.ts/hooks.ts (pure-at-load; UNOWN_HOME is redirected).
//
// QUIRK/BUG comments pin current behavior; the modules are NOT modified.

import "./_env.ts";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
        createNote,
        ingestTerminalNote,
        markDreamed,
        noteFromRun,
        pendingTerminalNotesByProject,
        slugifyProject,
        undreamedNotes,
} from "../src/notes.ts";
import { resetShieldTelemetry } from "../src/shield.ts";
import { store } from "../src/store.ts";
import { buildTerminalNote } from "../src/termhooks.ts";

beforeAll(() => {
        store.run(`DELETE FROM notes`);
});

afterAll(() => {
        store.run(`DELETE FROM notes`);
});

const FIXED_NOW = Date.UTC(2026, 9, 16, 12, 0, 0); // 2026-10-16T12:00:00Z

function withFixedNow<T>(fn: () => T): T {
        const real = Date.now;
        Date.now = () => FIXED_NOW;
        try {
                return fn();
        } finally {
                Date.now = real;
        }
}

/** Strictly increasing fake clock — makes created_at ordering deterministic. */
function withSequencedClock<T>(fn: () => T): T {
        const real = Date.now;
        let t = FIXED_NOW;
        Date.now = () => (t += 1_000);
        try {
                return fn();
        } finally {
                Date.now = real;
        }
}

// ---------------------------------------------------------------------------
// slugifyProject — determinism + normalization
// ---------------------------------------------------------------------------

describe("slugifyProject", () => {
        // The composite contract (project-identity.ts): `<cleaned-base>-<identity6>`
        // where identity6 = sha256(path:<resolved path>)[:6] for no-git directories.
        // The cleaning rules of the BASE are unchanged from the legacy slug; the
        // key makes the slug location-unique (same basename ≠ same scope) while
        // staying deterministic.
        const keyOf = (p: string) => {
                const resolved = resolve(p);
                const identity = process.platform === "win32" ? `path:${resolved.toLowerCase()}` : `path:${resolved}`;
                return createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 6);
        };
        const composite = (p: string, base: string) => `${base}-${keyOf(p)}`;

        test.each([
                ["/home/z/my-project", "my-project"],
                ["/home/z/my-project/", "my-project"], // trailing slash ignored by basename
                ["/srv/Unown.Engine", "unown-engine"], // case + dot separators
                ["/x/My_Project!", "my-project"], // non-alnum runs collapse to one hyphen
                ["/x/A--B", "a-b"],
                ["/x/-abc-", "abc"], // edge hyphens stripped
                ["/x/Café Pro", "caf-pro"], // non-ASCII letters are separators, not preserved
                ["/x/ÜBER", "ber"], // QUIRK: non-ASCII head chars are dropped, not transliterated
                ["/x/a.b.c", "a-b-c"],
        ])("%s -> %s-<key6>", (path, expectedBase) => {
                expect(slugifyProject(path)).toBe(composite(path, expectedBase));
        });

        test("deterministic: repeated calls are stable", () => {
                const a = slugifyProject("/home/z/unown/pi-repo/packages/self-learning");
                const b = slugifyProject("/home/z/unown/pi-repo/packages/self-learning");
                const c = slugifyProject("/home/z/unown/pi-repo/packages/self-learning");
                expect(a).toBe(b);
                expect(b).toBe(c);
                expect(a).toBe(composite("/home/z/unown/pi-repo/packages/self-learning", "self-learning"));
        });

        test("REGRESSION (was QUIRK): the base is capped, then the 6-hex key appends", () => {
                const long = "z".repeat(40);
                expect(slugifyProject(`/x/${long}`)).toBe(`z`.repeat(26) + "-" + keyOf(`/x/${long}`));
        });

        test("fallback base 'project' when the basename cleans to nothing", () => {
                expect(slugifyProject("/")).toBe(composite("/", "project")); // basename("/") === ""
                expect(slugifyProject("")).toBe(composite("", "project"));
                expect(slugifyProject("/x/..")).toBe(composite("/x/..", "project"));
                expect(slugifyProject("/x/!!!")).toBe(composite("/x/!!!", "project"));
                expect(slugifyProject("/x/___")).toBe(composite("/x/___", "project"));
        });

        test("QUIRK: hidden dirs lose their leading dot ('.git' -> 'git-<key>')", () => {
                expect(slugifyProject("/srv/app/.git")).toBe(composite("/srv/app/.git", "git"));
        });

        test("REGRESSION (fixes the old QUIRK): same basename, different parent → DIFFERENT slugs", () => {
                // The legacy key discarded parent paths, so /a/proj and /b/proj shared
                // one memory scope (the same-basename collision the composite key fixes).
                expect(slugifyProject("/a/proj")).not.toBe(slugifyProject("/b/proj"));
                expect(slugifyProject("/a/proj")).not.toBe(slugifyProject("/b/deep/proj"));
                // same path is still stable
                expect(slugifyProject("/a/proj")).toBe(slugifyProject("/a/proj"));
        });
});

// ---------------------------------------------------------------------------
// createNote / ingestTerminalNote / undreamedNotes / markDreamed
// ---------------------------------------------------------------------------

describe("createNote", () => {
        test("benchmark default: kind benchmark, no project fields, run_id recorded", () => {
                const id = createNote("run-1", "note body", undefined, undefined);
                expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
                const row = store.get<{
                        run_id: string;
                        content: string;
                        kind: string;
                        project_path: string | null;
                        project_slug: string | null;
                }>(`SELECT run_id, content, kind, project_path, project_slug FROM notes WHERE id = ?`, [id]);
                expect(row).toEqual({
                        run_id: "run-1",
                        content: "note body",
                        kind: "benchmark",
                        project_path: null,
                        project_slug: null,
                });
        });

        test("with projectPath: slug computed and stored (composite form)", () => {
                const id = createNote("run-2", "terminal body", "terminal", "/home/z/My_Project");
                const row = store.get<{ kind: string; project_path: string; project_slug: string }>(
                        `SELECT kind, project_path, project_slug FROM notes WHERE id = ?`,
                        [id],
                );
                expect(row?.kind).toBe("terminal");
                expect(row?.project_path).toBe("/home/z/My_Project");
                expect(row?.project_slug).toBe(slugifyProject("/home/z/My_Project"));
                expect(row?.project_slug).toMatch(/^my-project-[0-9a-f]{6}$/);
        });

        test("ingestTerminalNote: kind terminal, run_id null, slug set (composite)", () => {
                const id = ingestTerminalNote("terminal note", "/srv/alpha");
                const row = store.get<{ run_id: string | null; kind: string; project_slug: string }>(
                        `SELECT run_id, kind, project_slug FROM notes WHERE id = ?`,
                        [id],
                );
                expect(row?.run_id).toBeNull();
                expect(row?.kind).toBe("terminal");
                expect(row?.project_slug).toBe(slugifyProject("/srv/alpha"));
                expect(row?.project_slug).toMatch(/^alpha-[0-9a-f]{6}$/);
        });
});

describe("undreamedNotes", () => {
        test("returns newest-first (created_at DESC) with kind filter and limit", () => {
                store.run(`DELETE FROM notes`);
                const ids: string[] = [];
                withSequencedClock(() => {
                        ids.push(createNote("r", "t1", "terminal", "/srv/alpha"));
                        ids.push(ingestTerminalNote("t2", "/srv/alpha"));
                        ids.push(ingestTerminalNote("t3", "/srv/beta"));
                        createNote("r", "b1"); // benchmark kind
                        createNote("r", "b2");
                });
                // No filter: all 5, newest first.
                expect(undreamedNotes().map((n: { content: string }) => n.content)).toEqual(["b2", "b1", "t3", "t2", "t1"]);
                // Kind filter: terminal only.
                expect(undreamedNotes(24, "terminal").map((n: { content: string }) => n.content)).toEqual(["t3", "t2", "t1"]);
                // Limit: top-2 of the filtered set.
                expect(undreamedNotes(2, "terminal").map((n: { content: string }) => n.content)).toEqual(["t3", "t2"]);
                // Projection: rows carry the grouping fields.
                expect(Object.keys(undreamedNotes(1)[0] as object).sort()).toEqual(
                        ["content", "created_at", "id", "kind", "project_path", "project_slug", "run_id"].sort(),
                );
                expect(ids).toHaveLength(3);
        });

        test("markDreamed removes notes from the undreamed set", () => {
                store.run(`DELETE FROM notes`);
                const id1 = ingestTerminalNote("keep me", "/srv/alpha");
                const id2 = ingestTerminalNote("dream me", "/srv/alpha");
                markDreamed([id2], "dream-42");
                const remaining = undreamedNotes(24, "terminal").map((n: { content: string }) => n.content);
                expect(remaining).toEqual(["keep me"]);
                const row = store.get<{ dream_id: string }>(`SELECT dream_id FROM notes WHERE id = ?`, [id2]);
                expect(row?.dream_id).toBe("dream-42");
                expect(id1).not.toBe(id2);
        });
});

describe("pendingTerminalNotesByProject", () => {
        test("groups undreamed terminal notes by project PATH (recomputed slug)", () => {
                store.run(`DELETE FROM notes`);
                withSequencedClock(() => {
                        ingestTerminalNote("alpha-1", "/srv/alpha");
                        ingestTerminalNote("beta-1", "/srv/beta");
                        ingestTerminalNote("alpha-2", "/srv/alpha");
                });
                const groups = pendingTerminalNotesByProject();
                const alphaSlug = slugifyProject("/srv/alpha");
                const betaSlug = slugifyProject("/srv/beta");
                expect(groups.map((g) => g.slug)).toEqual([alphaSlug, betaSlug]); // groups follow note recency order
                const alpha = groups.find((g) => g.slug === alphaSlug);
                expect(alpha?.projectPath).toBe("/srv/alpha");
                expect(alpha?.notes.map((n: { content: string }) => n.content)).toEqual(["alpha-2", "alpha-1"]);
                const beta = groups.find((g) => g.slug === betaSlug);
                expect(beta?.notes).toHaveLength(1);
        });

        test("REGRESSION: two same-named directories in different parents group SEPARATELY", () => {
                // The pre-composite grouping (by stored slug) let /a/api and /b/api share
                // one dream group — consolidating two unrelated projects' notes into one
                // memory scope. Grouping by path + recomputing the slug keeps them apart.
                store.run(`DELETE FROM notes`);
                withSequencedClock(() => {
                        ingestTerminalNote("work-api-note", "/work/api");
                        ingestTerminalNote("personal-api-note", "/personal/api");
                });
                const groups = pendingTerminalNotesByProject();
                expect(groups).toHaveLength(2);
                expect(groups[0]?.slug).not.toBe(groups[1]?.slug);
                expect(groups[0]?.notes.map((n: { content: string }) => n.content)).toEqual(["personal-api-note"]);
                expect(groups[1]?.notes.map((n: { content: string }) => n.content)).toEqual(["work-api-note"]);
        });

        test("REGRESSION: legacy rows under the old basename slug heal onto the composite scope", () => {
                // Notes written before the composite key carry project_slug 'alpha'
                // (basename-only). At dream time the group recomputes the slug from the
                // stored project_path, so the notes land in the composite scope — the
                // stored slug is display data only.
                store.run(`DELETE FROM notes`);
                store.run(
                        `INSERT INTO notes (id, run_id, content, created_at, kind, project_path, project_slug) VALUES (?, NULL, ?, ?, 'terminal', '/srv/alpha', 'alpha')`,
                        ["legacy-composite-1", "legacy note", 1000],
                );
                const groups = pendingTerminalNotesByProject();
                expect(groups).toHaveLength(1);
                expect(groups[0]?.slug).toBe(slugifyProject("/srv/alpha"));
                expect(groups[0]?.slug).toMatch(/^alpha-[0-9a-f]{6}$/);
                expect(groups[0]?.projectPath).toBe("/srv/alpha");
        });

        test("QUIRK: legacy rows with a null project_slug land in an 'unknown' group with empty path", () => {
                // Rows written before the project columns existed (or by raw SQL) have
                // project_slug NULL; pendingTerminalNotesByProject buckets them under
                // 'unknown' with projectPath '' (notes.ts:55-56).
                store.run(`DELETE FROM notes`);
                store.run(
                        `INSERT INTO notes (id, run_id, content, created_at, kind, project_path, project_slug) VALUES (?, NULL, ?, ?, 'terminal', NULL, NULL)`,
                        ["legacy-1", "legacy note", 1000],
                );
                const groups = pendingTerminalNotesByProject();
                expect(groups).toHaveLength(1);
                expect(groups[0]?.slug).toBe("unknown");
                expect(groups[0]?.projectPath).toBe("");
                expect(groups[0]?.notes.map((n: { content: string }) => n.content)).toEqual(["legacy note"]);
        });
});

// ---------------------------------------------------------------------------
// noteFromRun — the benchmark-note builder (pure)
// ---------------------------------------------------------------------------

describe("noteFromRun", () => {
        const baseRun = {
                id: "run-abcdef123456",
                kind: "baseline",
                status: "passed",
                taskId: "fix-fizzbuzz",
        } as const;

        test("header line: run id truncated to 8 chars, kind, task, uppercased status", () => {
                const note = noteFromRun({ ...baseRun, toolsUsed: [] });
                const [header] = note.split("\n");
                expect(header).toBe("Run run-abcd (baseline) on task fix-fizzbuzz: PASSED");
        });

        test("an 8-char run id is kept whole", () => {
                const note = noteFromRun({ ...baseRun, id: "12345678" });
                expect(note).toContain("Run 12345678 (baseline)");
        });

        test("null taskId renders as 'interactive'", () => {
                const note = noteFromRun({ ...baseRun, taskId: null });
                expect(note).toContain("on task interactive:");
        });

        test("status is uppercased", () => {
                expect(noteFromRun({ ...baseRun, status: "failed" })).toContain(": FAILED");
        });

        test("Verification line present only when verifySummary is set", () => {
                expect(noteFromRun({ ...baseRun, verifySummary: "2/3 assertions" })).toContain("Verification: 2/3 assertions");
                expect(noteFromRun({ ...baseRun, verifySummary: null })).not.toContain("Verification:");
        });

        test("Tools line: 'none' when no tools were used; deduped names otherwise", () => {
                expect(noteFromRun({ ...baseRun, toolsUsed: [] })).toContain("Tools used: none");
                expect(noteFromRun({ ...baseRun, toolsUsed: undefined })).toContain("Tools used: none");
                const note = noteFromRun({ ...baseRun, toolCalls: 3, toolsUsed: ["bash", "edit", "bash"] });
                expect(note).toContain("Tools used: 3 calls (bash, edit)");
        });

        test("failure evidence: matched lines only, trimmed, capped at 6, 200 chars each", () => {
                const lines = [
                        "  AssertionError: expected 1 to equal 2", // match (assert/AssertionError)
                        "plain stdout noise", // no match
                        "not implemented yet", // match
                        "✗ checklist item failed", // match
                        "error: ENOENT", // match
                        "warning: deprecated", // no match
                        "fail: case seven", // match (case-insensitive FAIL)
                        "tamper detected", // match
                ];
                const note = noteFromRun({ ...baseRun, status: "failed", verifyLog: lines.join("\n") });
                expect(note).toContain("Failure evidence:");
                expect(note).toContain("  - AssertionError: expected 1 to equal 2"); // trimmed
                expect(note).not.toContain("plain stdout noise");
                expect(note).not.toContain("warning: deprecated");
                // Capped at 6 bullets.
                expect(note.split("\n").filter((l) => l.startsWith("  - "))).toHaveLength(6);
        });

        test("failure evidence lines are sliced to 200 chars", () => {
                const longLine = `AssertionError: ${"x".repeat(300)}`;
                const note = noteFromRun({ ...baseRun, status: "failed", verifyLog: longLine });
                const bullet = note.split("\n").find((l) => l.startsWith("  - "));
                expect(bullet).toHaveLength(4 + 200); // "  - " + 200-char slice
        });

        test("QUIRK: a passed run includes no failure evidence even when the log has matches", () => {
                const note = noteFromRun({ ...baseRun, status: "passed", verifyLog: "AssertionError: boom" });
                expect(note).not.toContain("Failure evidence:");
        });

        test("agent's final words are included and truncated to 300 chars", () => {
                const text = "y".repeat(500);
                const note = noteFromRun({ ...baseRun, lastAssistantText: text });
                const line = note.split("\n").find((l) => l.startsWith("Agent's final words:"));
                expect(line).toBe(`Agent's final words: ${text.slice(0, 300)}`);
                expect(note).not.toContain("y".repeat(301));
        });

        test("empty lastAssistantText omits the final-words line", () => {
                expect(noteFromRun({ ...baseRun, lastAssistantText: undefined })).not.toContain("Agent's final words:");
        });
});

// ---------------------------------------------------------------------------
// buildTerminalNote (src/termhooks.ts — exported there, not in notes.ts)
// ---------------------------------------------------------------------------

describe("buildTerminalNote", () => {
        const info = {
                cwd: "/srv/demo",
                prompts: 3,
                toolCalls: 5,
                toolNames: ["bash", "read"],
                lastAssistantText: "all green",
                sessionStartTs: FIXED_NOW,
        };

        // M10: buildTerminalNote reads the session's shield telemetry — a
        // CORPUS-WARMED counter (earlier suites in this one-process run flag
        // tool outputs) would add the injection-suspicion line. These shape
        // tests pin the CLEAN session; the telemetry line has its own test.
        beforeEach(() => resetShieldTelemetry());

        test("canonical shape: outcome-first header, final outcome, labeled metadata line", () => {
                const note = withFixedNow(() => buildTerminalNote(info));
                expect(note).toBe(
                        [
                                "Terminal session outcome in /srv/demo:",
                                "Final outcome: all green",
                                "Session metadata (never extractable — counts and duration only): 3 prompt(s), 5 tool call(s) (bash, read), 1 min.",
                        ].join("\n"),
                );
        });

        test.each([
                [0, "1 min"], // same-instant session: round(0)=0 clamped up by Math.max(1, …)
                [29_999, "1 min"], // QUIRK: sub-30s sessions round to 0 -> clamped to 1
                [30_000, "1 min"], // exactly 30s rounds to 1
                [90_000, "2 min"],
                [25 * 60_000, "25 min"],
        ])("session duration %dms renders as (%s)", (elapsedMs, expected) => {
                const note = withFixedNow(() => buildTerminalNote({ ...info, sessionStartTs: FIXED_NOW - elapsedMs }));
                expect(note).toContain(`${expected}.`);
        });

        test("QUIRK: there is no '0 min' — Math.max(1, …) clamps the rounding floor", () => {
                const note = withFixedNow(() => buildTerminalNote({ ...info, sessionStartTs: FIXED_NOW }));
                expect(note).not.toContain("0 min");
        });

        test("final outcome is truncated to 400 chars", () => {
                const text = "z".repeat(600);
                const note = withFixedNow(() => buildTerminalNote({ ...info, lastAssistantText: text }));
                const line = note.split("\n").find((l) => l.startsWith("Final outcome:"));
                expect(line).toBe(`Final outcome: ${text.slice(0, 400)}`);
        });

        test("empty lastAssistantText omits the final-outcome line", () => {
                const note = withFixedNow(() => buildTerminalNote({ ...info, lastAssistantText: "" }));
                expect(note).not.toContain("Final outcome:");
                expect(note.split("\n")).toHaveLength(2);
        });

        test("no tool names -> no parenthetical tool list", () => {
                const note = withFixedNow(() => buildTerminalNote({ ...info, toolNames: [] }));
                const [header, , metadata] = note.split("\n");
                expect(header).toBe("Terminal session outcome in /srv/demo:");
                // No parenthetical tool list after "tool call(s)" in the metadata line.
                expect(metadata).toContain("5 tool call(s),");
                expect(metadata).not.toMatch(/tool call\(s\) \(/);
                expect(note).not.toContain("(bash");
        });

        test("subagent sessions are tagged '[subagent]' via UNOWN_SUBAGENT", () => {
                const real = process.env.UNOWN_SUBAGENT;
                process.env.UNOWN_SUBAGENT = "1";
                try {
                        const note = withFixedNow(() => buildTerminalNote(info));
                        expect(note).toContain("Terminal session [subagent] outcome in /srv/demo");
                } finally {
                        process.env.UNOWN_SUBAGENT = real;
                }
                // Off again (the value _env.ts pins).
                const plain = withFixedNow(() => buildTerminalNote(info));
                expect(plain).toContain("Terminal session outcome in /srv/demo");
        });
});
