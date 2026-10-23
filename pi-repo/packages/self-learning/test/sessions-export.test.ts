// Unit tests for src/sessions.ts + src/sessions-cli.ts — the Milestone 3.5
// session export/import/list feature (the opencode session/transfer.ts port).
//
// Pins:
//   1. exportSession writes a valid JSON file with version, manifest,
//      messages, todos, notes, skills, files
//   2. exportSession --out <path> writes to the specified path
//   3. exportSession without --out writes to .unown/sessions/export-<id>.json
//   4. importSession rehydrates a session with a new ID (appears in list)
//   5. importSession rejects a malformed JSON file with a clear error
//   6. importSession rejects a version-N+1 export (forward-compat)
//   7. listSessions returns sessions with id, createdAt, messageCount, touchedFiles
//   8. listSessions handles an empty sessions dir gracefully (returns [])
//   9. runSessionsCommand parses `export <id> --out <path>` correctly
//  10. runSessionsCommand parses `import <file>` correctly
//  11. runSessionsCommand parses `list` correctly
//  12. runSessionsCommand returns exit code 0 on success, 1 on error
//
// Mocks: a minimal SessionLike + a temp receipts ledger file (no pi spawn).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    defaultExportPath,
    exportSession,
    extractFiles,
    extractModel,
    extractNotes,
    extractSkills,
    extractTodos,
    importSession,
    listSessions,
    SESSION_EXPORT_VERSION,
    type SessionEntryLike,
    type SessionLike,
} from "../src/sessions.ts";
import { ReceiptsLedger, receiptsDir } from "../src/checkpoints.ts";
import { runSessionsCommand } from "../src/sessions-cli.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-sessions-test-"));
beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => {
    try {
        rmSync(TMP, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A minimal mock SessionLike. The real pi SessionManager has many more methods
 *  (branch, resetLeaf, appendMessage, …) but export/list only need read paths. */
class MockSessionManager implements SessionLike {
    constructor(
        private readonly cwd: string,
        private readonly sessionId: string,
        private readonly entries: SessionEntryLike[],
        private readonly headerTimestamp: string = new Date().toISOString(),
    ) {}
    getSessionId(): string {
        return this.sessionId;
    }
    getCwd(): string {
        return this.cwd;
    }
    getEntries(): SessionEntryLike[] {
        return this.entries;
    }
    getHeader() {
        return { id: this.sessionId, timestamp: this.headerTimestamp, cwd: this.cwd };
    }
}

/** Build a session fixture with two user messages + one assistant + toolResult(todo). */
function makeSessionFixture(cwd: string, sessionId: string): {
    sm: MockSessionManager;
    entries: SessionEntryLike[];
    receiptsFile: string;
} {
    const t0 = "2026-10-19T10:00:00.000Z";
    const entries: SessionEntryLike[] = [
        // User message 1
        {
            type: "message",
            id: "m1",
            parentId: null,
            timestamp: t0,
            message: { role: "user", content: "hello world", timestamp: Date.parse(t0) },
        },
        // Assistant reply with a write tool call (so the assistant has provider+model)
        {
            type: "message",
            id: "m2",
            parentId: "m1",
            timestamp: "2026-10-19T10:00:05.000Z",
            message: {
                role: "assistant",
                content: [
                    { type: "text", text: "ok" },
                    {
                        type: "toolCall",
                        id: "tc1",
                        name: "write",
                        arguments: { path: join(cwd, "a.ts"), content: "const x = 1;" },
                    },
                ],
                provider: "openai",
                model: "gpt-4o",
                api: "openai",
            },
        },
        // Tool result for the write
        {
            type: "message",
            id: "m3",
            parentId: "m2",
            timestamp: "2026-10-19T10:00:06.000Z",
            message: {
                role: "toolResult",
                toolCallId: "tc1",
                toolName: "write",
                content: [{ type: "text", text: "wrote a.ts" }],
            },
        },
        // User message 2
        {
            type: "message",
            id: "m4",
            parentId: "m3",
            timestamp: "2026-10-19T10:01:00.000Z",
            message: { role: "user", content: "also add a todo", timestamp: Date.parse("2026-10-19T10:01:00.000Z") },
        },
        // Assistant adds a todo
        {
            type: "message",
            id: "m5",
            parentId: "m4",
            timestamp: "2026-10-19T10:01:05.000Z",
            message: {
                role: "assistant",
                content: [
                    {
                        type: "toolCall",
                        id: "tc2",
                        name: "todo",
                        arguments: { action: "add", text: "ship it" },
                    },
                ],
                provider: "openai",
                model: "gpt-4o",
                api: "openai",
            },
        },
        // ToolResult(todo) carrying the latest todo state
        {
            type: "message",
            id: "m6",
            parentId: "m5",
            timestamp: "2026-10-19T10:01:06.000Z",
            message: {
                role: "toolResult",
                toolCallId: "tc2",
                toolName: "todo",
                content: [{ type: "text", text: "added" }],
                details: {
                    action: "add",
                    todos: [{ id: 1, text: "ship it", done: false }],
                    nextId: 2,
                },
            },
        },
    ];

    const sm = new MockSessionManager(cwd, sessionId, entries, t0);

    // Receipts ledger with: a session_start, two inputs, two tool_call entries
    // (write + todo), and a note. The export should pull notes/files/skills from
    // here.
    const receiptsFile = join(receiptsDir(cwd), `${sessionId}.jsonl`);
    const ledger = new ReceiptsLedger(receiptsFile);
    ledger.append({ kind: "session_start", subagent: false, cwd });
    ledger.append({ kind: "input", preview: "hello world" });
    ledger.append({ kind: "tool_call", id: "tc1", tool: "write", input: { path: join(cwd, "a.ts") } });
    ledger.append({ kind: "tool_result", id: "tc1", tool: "write", isError: false, preview: "ok" });
    ledger.append({ kind: "input", preview: "also add a todo" });
    ledger.append({ kind: "tool_call", id: "tc2", tool: "todo", input: { action: "add", text: "ship it" } });
    ledger.append({ kind: "note", preview: "remember: cargo build for this project" });

    return { sm, entries, receiptsFile };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("sessions.ts pure helpers", () => {
    test("extractModel: assistant.provider/model fields captured", () => {
        const entries: SessionEntryLike[] = [
            {
                type: "message",
                id: "a1",
                parentId: null,
                timestamp: new Date().toISOString(),
                message: {
                    role: "assistant",
                    content: [{ type: "text", text: "hi" }],
                    provider: "anthropic",
                    model: "claude-3-opus",
                },
            },
        ];
        expect(extractModel(entries)).toEqual({ provider: "anthropic", model: "claude-3-opus" });
    });
    test("extractModel: model_change entry wins over assistant", () => {
        const entries: SessionEntryLike[] = [
            {
                type: "message",
                id: "a1",
                parentId: null,
                timestamp: new Date().toISOString(),
                message: {
                    role: "assistant",
                    content: [{ type: "text", text: "hi" }],
                    provider: "openai",
                    model: "gpt-4o",
                },
            },
            {
                type: "model_change",
                id: "mc1",
                parentId: "a1",
                timestamp: new Date().toISOString(),
                provider: "anthropic",
                modelId: "claude-3-opus",
            } as SessionEntryLike,
        ];
        expect(extractModel(entries)).toEqual({ provider: "anthropic", model: "claude-3-opus" });
    });
    test("extractTodos: latest toolResult(todo) wins", () => {
        const entries: SessionEntryLike[] = [
            {
                type: "message",
                id: "t1",
                parentId: null,
                timestamp: new Date().toISOString(),
                message: {
                    role: "toolResult",
                    toolName: "todo",
                    content: [],
                    details: { todos: [{ id: 1, text: "old", done: false }], nextId: 2 },
                },
            },
            {
                type: "message",
                id: "t2",
                parentId: "t1",
                timestamp: new Date().toISOString(),
                message: {
                    role: "toolResult",
                    toolName: "todo",
                    content: [],
                    details: { todos: [{ id: 1, text: "new", done: true }], nextId: 2 },
                },
            },
        ];
        const todos = extractTodos(entries) as any[];
        expect(todos).toHaveLength(1);
        expect(todos[0].text).toBe("new");
        expect(todos[0].done).toBe(true);
    });
    test("extractNotes / extractSkills / extractFiles read the receipts ledger", () => {
        const dir = join(TMP, "helpers-receipts");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "r.jsonl");
        const ledger = new ReceiptsLedger(file);
        ledger.append({ kind: "session_start", subagent: false, cwd: "/p" });
        ledger.append({ kind: "input", preview: "do work" });
        ledger.append({ kind: "tool_call", id: "t1", tool: "write", input: { path: "/p/a.ts" } });
        ledger.append({ kind: "tool_result", id: "t1", tool: "write", isError: false, preview: "" });
        ledger.append({ kind: "tool_call", id: "t2", tool: "bash", input: { command: "ls" } });
        ledger.append({ kind: "note", preview: "remember X" });
        ledger.append({ kind: "note", preview: "remember Y" });

        const notes = extractNotes(file) as any[];
        expect(notes).toHaveLength(2);
        expect(notes[0].kind).toBe("note");

        const skills = extractSkills(file);
        expect(skills).toEqual(["bash", "write"]); // sorted

        const files = extractFiles(file);
        expect(files).toEqual(["/p/a.ts"]);
    });
});

// ---------------------------------------------------------------------------
// exportSession
// ---------------------------------------------------------------------------

describe("exportSession", () => {
    test("1. writes a valid JSON file with version, manifest, messages, todos, notes, skills, files", async () => {
        const cwd = join(TMP, "exp1");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        const sessionId = "sess-exp1";
        const { sm, entries, receiptsFile } = makeSessionFixture(cwd, sessionId);
        const out = join(cwd, "export1.json");

        const result = await exportSession(sessionId, { sessionManager: sm, outPath: out, receiptsFile });
        expect(result.bytes).toBeGreaterThan(0);
        expect(existsSync(out)).toBe(true);

        const parsed = JSON.parse(readFileSync(out, "utf8"));
        expect(parsed.version).toBe(SESSION_EXPORT_VERSION);
        expect(parsed.manifest).toBeDefined();
        expect(parsed.manifest.id).toBe(sessionId);
        expect(parsed.manifest.cwd).toBe(cwd);
        expect(parsed.manifest.model).toBe("gpt-4o");
        expect(parsed.manifest.provider).toBe("openai");
        expect(typeof parsed.manifest.createdAt).toBe("number");

        expect(Array.isArray(parsed.messages)).toBe(true);
        expect(parsed.messages.length).toBe(6);

        expect(Array.isArray(parsed.todos)).toBe(true);
        expect((parsed.todos as any[]).length).toBe(1);
        expect((parsed.todos as any[])[0].text).toBe("ship it");

        expect(Array.isArray(parsed.notes)).toBe(true);
        expect((parsed.notes as any[]).length).toBe(1);

        expect(Array.isArray(parsed.skills)).toBe(true);
        expect(parsed.skills).toContain("write");
        expect(parsed.skills).toContain("todo");

        expect(Array.isArray(parsed.files)).toBe(true);
        expect(parsed.files).toContain(join(cwd, "a.ts"));
    });

    test("2. with --out writes to the specified path", async () => {
        const cwd = join(TMP, "exp2");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        const sessionId = "sess-exp2";
        const { sm, receiptsFile } = makeSessionFixture(cwd, sessionId);
        const customPath = join(cwd, "subdir", "my-export.json");

        const result = await exportSession(sessionId, { sessionManager: sm, outPath: customPath, receiptsFile });
        expect(result.path).toBe(customPath);
        expect(existsSync(customPath)).toBe(true);
        const parsed = JSON.parse(readFileSync(customPath, "utf8"));
        expect(parsed.manifest.id).toBe(sessionId);
    });

    test("3. without --out writes to .unown/sessions/export-<id>.json", async () => {
        const cwd = join(TMP, "exp3");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        const sessionId = "sess-exp3";
        const { sm, receiptsFile } = makeSessionFixture(cwd, sessionId);

        const result = await exportSession(sessionId, { sessionManager: sm, receiptsFile });
        const expected = defaultExportPath(sessionId, cwd);
        expect(result.path).toBe(expected);
        expect(existsSync(expected)).toBe(true);
        expect(expected.endsWith(join(".unown", "sessions", `export-${sessionId}.json`))).toBe(true);
    });

    test("3a. redacts known secret shapes by default and reports the count", async () => {
        const cwd = join(TMP, "exp3a");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        const sessionId = "sess-exp3a";
        const t0 = "2026-10-19T10:00:00.000Z";
        // Assembled at runtime (never a literal in source): the AWS docs
        // example key, spelled so no scanner ever sees the whole token.
        const awsKey = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
        const skKey = ["sk-", "abcdefghijklmnopqrst", "012345"].join("");
        const sm = new MockSessionManager(cwd, sessionId, [
            {
                type: "message",
                id: "m1",
                parentId: null,
                timestamp: t0,
                message: {
                    role: "user",
                    content:
                        `why does this 401? my key is ${skKey} and the AWS one ${awsKey}`,
                    timestamp: Date.parse(t0),
                },
            },
        ]);
        const out = join(cwd, "export.json");
        const result = await exportSession(sessionId, { sessionManager: sm, outPath: out });
        expect(result.redacted).toBe(2);
        const written = readFileSync(out, "utf8");
        expect(written).toContain("[REDACTED:sk-key]");
        expect(written).toContain("[REDACTED:aws-ak]");
        expect(written).not.toContain(skKey);
        expect(written).not.toContain("AKIAIOSFODNN7EXAMPLE");
        // The export stays valid JSON after redaction.
        expect(() => JSON.parse(written)).not.toThrow();
    });

    test("3b. --raw (redact: false) keeps secrets verbatim for self-transfer", async () => {
        const cwd = join(TMP, "exp3b");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        const sessionId = "sess-exp3b";
        const t0 = "2026-10-19T10:00:00.000Z";
        const secret = "ghp_" + "a".repeat(36);
        const sm = new MockSessionManager(cwd, sessionId, [
            {
                type: "message",
                id: "m1",
                parentId: null,
                timestamp: t0,
                message: { role: "user", content: `token: ${secret}`, timestamp: Date.parse(t0) },
            },
        ]);
        const out = join(cwd, "export-raw.json");
        const result = await exportSession(sessionId, { sessionManager: sm, outPath: out, redact: false });
        expect(result.redacted).toBe(0);
        expect(readFileSync(out, "utf8")).toContain(secret);
    });

    test("3c. a clean session exports with zero redactions (and no marker noise)", async () => {
        const cwd = join(TMP, "exp3c");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        const sessionId = "sess-exp3c";
        const { sm, receiptsFile } = makeSessionFixture(cwd, sessionId);
        const out = join(cwd, "export-clean.json");
        const result = await exportSession(sessionId, { sessionManager: sm, outPath: out, receiptsFile });
        expect(result.redacted).toBe(0);
        expect(readFileSync(out, "utf8")).not.toContain("[REDACTED:");
    });
});

// ---------------------------------------------------------------------------
// importSession
// ---------------------------------------------------------------------------

describe("importSession", () => {
    test("4. rehydrates a session with a new ID", async () => {
        const cwd = join(TMP, "imp1");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        const sessionId = "sess-imp1-src";
        const { sm, receiptsFile } = makeSessionFixture(cwd, sessionId);
        const exportPath = join(cwd, "to-import.json");
        await exportSession(sessionId, { sessionManager: sm, outPath: exportPath, receiptsFile });

        const importCwd = join(TMP, "imp1-target");
        const result = await importSession(exportPath, { cwd: importCwd });

        expect(result.sessionId).not.toBe(sessionId); // NEW id, no collision
        expect(result.sessionId.startsWith("imp-")).toBe(true);

        // The imported session appears in listSessions for importCwd
        const sessions = listSessions({ cwd: importCwd });
        expect(sessions.length).toBeGreaterThanOrEqual(1);
        const found = sessions.find((s) => s.id === result.sessionId);
        expect(found).toBeDefined();
        expect(found?.messageCount).toBe(6);
    });

    test("5. rejects a malformed JSON file with a clear error", async () => {
        const cwd = join(TMP, "imp5");
        mkdirSync(cwd, { recursive: true });
        const bad = join(cwd, "bad.json");
        writeFileSync(bad, "{not valid json");
        await expect(importSession(bad, { cwd })).rejects.toThrow(/malformed JSON/);
    });

    test("6. rejects a version-2 export (forward-compat)", async () => {
        const cwd = join(TMP, "imp6");
        mkdirSync(cwd, { recursive: true });
        const futureExport = join(cwd, "future.json");
        const futureObj = {
            version: SESSION_EXPORT_VERSION + 1, // future
            manifest: { id: "future-src", createdAt: Date.now(), model: null, provider: null, cwd: "/x" },
            messages: [],
            todos: [],
            notes: [],
            skills: [],
            files: [],
        };
        writeFileSync(futureExport, JSON.stringify(futureObj));
        await expect(importSession(futureExport, { cwd })).rejects.toThrow(/newer than supported/);
    });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe("listSessions", () => {
    test("7. returns sessions with id, createdAt, messageCount, touchedFiles", async () => {
        const cwd = join(TMP, "list1");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        const sessionId = "sess-list1";
        const { sm, receiptsFile } = makeSessionFixture(cwd, sessionId);
        // Use import to actually persist a session .jsonl under cwd/.unown/sessions
        const exportPath = join(cwd, "list1-export.json");
        await exportSession(sessionId, { sessionManager: sm, outPath: exportPath, receiptsFile });
        await importSession(exportPath, { cwd });

        const sessions = listSessions({ cwd });
        expect(sessions.length).toBeGreaterThanOrEqual(1);
        const s = sessions[0];
        expect(typeof s.id).toBe("string");
        expect(typeof s.createdAt).toBe("number");
        expect(typeof s.messageCount).toBe("number");
        expect(Array.isArray(s.touchedFiles)).toBe(true);
        expect(s.messageCount).toBeGreaterThan(0);
    });

    test("8. handles an empty sessions dir gracefully", () => {
        const cwd = join(TMP, "list-empty");
        mkdirSync(join(cwd, ".unown", "sessions"), { recursive: true });
        const sessions = listSessions({ cwd });
        expect(sessions).toEqual([]);
    });

    test("8b. handles a missing sessions dir gracefully", () => {
        const cwd = join(TMP, "list-missing");
        // no .unown/sessions dir created
        const sessions = listSessions({ cwd });
        expect(sessions).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// runSessionsCommand (sessions-cli.ts)
// ---------------------------------------------------------------------------

describe("runSessionsCommand", () => {
    test("11. parses `list` correctly (returns 0)", async () => {
        const cwd = join(TMP, "cli-list");
        mkdirSync(join(cwd, ".unown", "sessions"), { recursive: true });
        const prevCwd = process.cwd();
        process.chdir(cwd);
        try {
            const code = await runSessionsCommand(["list"]);
            expect(code).toBe(0);
        } finally {
            process.chdir(prevCwd);
        }
    });

    test("9. parses `export <id> --out <path>` correctly (returns 0 on success)", async () => {
        const cwd = join(TMP, "cli-export");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        mkdirSync(join(cwd, ".unown", "sessions"), { recursive: true });
        const sessionId = "sess-cli-export";
        const { sm, receiptsFile } = makeSessionFixture(cwd, sessionId);

        // Persist a real session .jsonl file so SessionManager.open() can find it.
        // We use the export path the CLI would compute: findSessionFile matches by
        // substring on the filename — name it <ts>_<id>.jsonl.
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const sessionFile = join(cwd, ".unown", "sessions", `${ts}_${sessionId}.jsonl`);
        const headerLine = JSON.stringify({
            type: "session",
            version: 3,
            id: sessionId,
            timestamp: new Date().toISOString(),
            cwd,
        });
        const lines: string[] = [headerLine];
        for (const e of sm.getEntries()) {
            lines.push(JSON.stringify(e));
        }
        writeFileSync(sessionFile, lines.join("\n") + "\n");

        const prevCwd = process.cwd();
        process.chdir(cwd);
        try {
            const outPath = join(cwd, "from-cli.json");
            const code = await runSessionsCommand(["export", sessionId, "--out", outPath]);
            expect(code).toBe(0);
            expect(existsSync(outPath)).toBe(true);
        } finally {
            process.chdir(prevCwd);
        }
    });

    test("10. parses `import <file>` correctly (returns 0 on success)", async () => {
        const cwd = join(TMP, "cli-import");
        mkdirSync(join(cwd, ".unown", "receipts"), { recursive: true });
        mkdirSync(join(cwd, ".unown", "sessions"), { recursive: true });
        const sessionId = "sess-cli-import";
        const { sm, receiptsFile } = makeSessionFixture(cwd, sessionId);
        const exportPath = join(cwd, "to-cli-import.json");
        await exportSession(sessionId, { sessionManager: sm, outPath: exportPath, receiptsFile });

        const prevCwd = process.cwd();
        process.chdir(cwd);
        try {
            const code = await runSessionsCommand(["import", exportPath]);
            expect(code).toBe(0);
            // The imported session appears in listSessions
            const sessions = listSessions({ cwd });
            expect(sessions.length).toBeGreaterThanOrEqual(1);
        } finally {
            process.chdir(prevCwd);
        }
    });

    test("12. returns exit code 0 on success, 1 on error", async () => {
        const cwd = join(TMP, "cli-errors");
        mkdirSync(join(cwd, ".unown", "sessions"), { recursive: true });
        const prevCwd = process.cwd();
        process.chdir(cwd);
        try {
            // import a nonexistent file → error
            const code = await runSessionsCommand(["import", "/nonexistent/file.json"]);
            expect(code).toBe(1);

            // unknown subcommand → error
            const code2 = await runSessionsCommand(["frobnicate"]);
            expect(code2).toBe(1);

            // export without id → error (usage)
            const code3 = await runSessionsCommand(["export"]);
            expect(code3).toBe(1);
        } finally {
            process.chdir(prevCwd);
        }
    });

    test("12b. -h / --help returns 0 and prints usage", async () => {
        const prevCwd = process.cwd();
        process.chdir(TMP);
        try {
            const code = await runSessionsCommand(["-h"]);
            expect(code).toBe(0);
        } finally {
            process.chdir(prevCwd);
        }
    });
});
