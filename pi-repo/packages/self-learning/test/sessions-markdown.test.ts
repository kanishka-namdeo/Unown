// Unit tests for the 2026-10-24 session-workflow round in src/sessions.ts +
// src/sessions-cli.ts:
//
//   1. renderSessionMarkdown — header table, transcript, tool-call bullets,
//      fenced tool results, backtick-safe fences, truncation, todos, notes
//   2. exportSessionMarkdown — writes .md, default-on secrets redaction,
//      --raw (redact:false) keeps secrets verbatim
//   3. listUserSessions — the USER session store (~/.unown/agent/sessions):
//      cwd filtering by header, allProjects mode, tolerant parsing
//   4. listAllSessions — merged project+user listing with dedupe
//   5. findUserSessionFile — id lookup in the flat user store
//   6. runSessionsCommand — `export <id> --format md` + `list` reading both
//      stores (UNOWN_HOME pointed at a temp dir)
//
// Mocks: a minimal SessionLike + temp dirs (no pi spawn).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    defaultMarkdownExportPath,
    exportSessionMarkdown,
    findUserSessionFile,
    listAllSessions,
    listSessions,
    listUserSessions,
    renderSessionMarkdown,
    type SessionEntryLike,
    type SessionExport,
    type SessionLike,
} from "../src/sessions.ts";
import { runSessionsCommand } from "../src/sessions-cli.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-sessions-md-test-"));
beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => {
    try {
        rmSync(TMP, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function makeExportFixture(): SessionExport {
    return {
        version: 1,
        manifest: {
            id: "s-md-1",
            createdAt: Date.parse("2026-10-24T10:00:00.000Z"),
            model: "agnes-3.0-flash",
            provider: "zai-bridge",
            cwd: "/tmp/proj",
        },
        messages: [
            { role: "user", content: [{ type: "text", text: "write hello.ts" }] },
            {
                role: "assistant",
                model: "agnes-3.0-flash",
                content: [
                    { type: "text", text: "Creating the file now." },
                    { type: "toolCall", id: "tc1", name: "write", arguments: { path: "hello.ts", content: "console.log(1)" } },
                ],
                usage: { input: 100, output: 12 },
            },
            {
                role: "toolResult",
                toolName: "write",
                isError: false,
                content: [{ type: "text", text: "Successfully wrote 15 bytes to hello.ts" }],
            },
            {
                role: "assistant",
                model: "agnes-3.0-flash",
                content: [{ type: "text", text: "Done — hello.ts is in place." }],
                usage: { input: 130, output: 8 },
            },
        ],
        todos: [
            { id: 1, subject: "write the file", status: "completed" },
            { id: 2, subject: "run the tests", status: "in_progress" },
            { id: 3, subject: "deleted task", status: "deleted" },
        ],
        notes: [{ seq: 1, ts: Date.parse("2026-10-24T10:05:00.000Z"), kind: "note", preview: "cargo build for this project" }],
        skills: ["write"],
        files: ["/tmp/proj/hello.ts"],
    };
}

// ---------------------------------------------------------------------------
// renderSessionMarkdown (pure)
// ---------------------------------------------------------------------------

describe("renderSessionMarkdown", () => {
    test("header table carries manifest + stats", () => {
        const md = renderSessionMarkdown(makeExportFixture());
        expect(md).toContain("# Unown session — s-md-1");
        expect(md).toContain("| Model | agnes-3.0-flash (zai-bridge) |");
        expect(md).toContain("| Project | /tmp/proj |");
        // message counts: 1 user, 2 assistant, 1 tool result
        expect(md).toContain("1 user, 2 assistant, 1 tool results");
        // token totals: 100+130 in, 12+8 out
        expect(md).toContain("| Tokens | 230 in · 20 out |");
        expect(md).toContain("| Tools used | write |");
    });

    test("transcript renders user prose, tool-call bullets and fenced results", () => {
        const md = renderSessionMarkdown(makeExportFixture());
        expect(md).toContain("**User:**");
        expect(md).toContain("write hello.ts");
        expect(md).toContain("**Assistant (agnes-3.0-flash):**");
        expect(md).toContain("Creating the file now.");
        expect(md).toContain("- `write` → hello.ts");
        expect(md).toContain("**Tool result — `write`** (ok)");
        expect(md).toContain("Successfully wrote 15 bytes to hello.ts");
    });

    test("todos render as checkboxes; deleted skipped", () => {
        const md = renderSessionMarkdown(makeExportFixture());
        expect(md).toContain("- [x] write the file");
        expect(md).toContain("- [ ] run the tests *(in progress)*");
        expect(md).not.toContain("deleted task");
    });

    test("notes render as quoted lines", () => {
        const md = renderSessionMarkdown(makeExportFixture());
        expect(md).toContain("## Notes");
        expect(md).toContain("cargo build for this project");
    });

    test("fences outgrow backtick runs inside payloads (CommonMark safety)", () => {
        const evil = "```\ncode with ``` inside and ```` too\n```";
        const ex = makeExportFixture();
        ex.messages = [
            { role: "user", content: [{ type: "text", text: "run" }] },
            { role: "toolResult", toolName: "bash", isError: false, content: [{ type: "text", text: evil }] },
        ];
        const md = renderSessionMarkdown(ex);
        // The fence around THIS payload must be LONGER than any backtick run
        // inside it — find the fenced block that wraps the payload text.
        const fencePairs = [...md.matchAll(/^(`{3,})$([\s\S]*?)^\1$/gm)];
        expect(fencePairs.length).toBeGreaterThanOrEqual(1);
        const payloadFence = fencePairs.find((m) => m[2].includes("code with ``` inside"));
        expect(payloadFence).not.toBeUndefined();
        const maxRun = Math.max(...(evil.match(/`+/g) ?? []).map((r) => r.length));
        expect(payloadFence![1].length).toBeGreaterThan(maxRun);
    });

    test("long tool results truncate with an explicit marker", () => {
        const ex = makeExportFixture();
        const long = "x".repeat(5000);
        ex.messages.push({ role: "toolResult", toolName: "read", isError: false, content: [{ type: "text", text: long }] });
        const md = renderSessionMarkdown(ex, { maxToolResultChars: 1000 });
        expect(md).toContain("[truncated");
        expect(md).not.toContain("x".repeat(1500));
    });

    test("error tool results are marked", () => {
        const ex = makeExportFixture();
        ex.messages.push({ role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "boom" }] });
        const md = renderSessionMarkdown(ex);
        expect(md).toContain("**Tool result — `bash`** (error)");
    });

    test("thinking blocks are omitted from the transcript", () => {
        const ex = makeExportFixture();
        ex.messages.push({
            role: "assistant",
            content: [{ type: "thinking", thinking: "internal reasoning" }, { type: "text", text: "visible" }],
        } as any);
        const md = renderSessionMarkdown(ex);
        expect(md).not.toContain("internal reasoning");
        expect(md).toContain("visible");
    });
});

// ---------------------------------------------------------------------------
// exportSessionMarkdown (fs)
// ---------------------------------------------------------------------------

describe("exportSessionMarkdown", () => {
    test("writes a .md file with default-on redaction", async () => {
        const cwd = join(TMP, "md-export-1");
        const entries: SessionEntryLike[] = [
            {
                type: "message",
                id: "m1",
                parentId: null,
                timestamp: new Date().toISOString(),
                message: { role: "user", content: [{ type: "text", text: "use key sk-abcdefghijklmnopqrstuvwxyz012345" }] },
            },
        ];
        const sm = new MockSessionManager(cwd, "sess-redact", entries);
        const result = await exportSessionMarkdown("sess-redact", { sessionManager: sm, receiptsFile: "" });
        expect(result.path).toBe(defaultMarkdownExportPath("sess-redact", cwd));
        expect(existsSync(result.path)).toBeTrue();
        const text = readFileSync(result.path, "utf8");
        expect(text).toContain("[REDACTED:sk-key]");
        expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
        expect(result.redacted).toBeGreaterThanOrEqual(1);
        expect(result.bytes).toBeGreaterThan(0);
    });

    test("redact:false keeps secrets verbatim (--raw)", async () => {
        const cwd = join(TMP, "md-export-2");
        const secret = "sk-abcdefghijklmnopqrstuvwxyz012345";
        const entries: SessionEntryLike[] = [
            {
                type: "message",
                id: "m1",
                parentId: null,
                timestamp: new Date().toISOString(),
                message: { role: "user", content: [{ type: "text", text: `use key ${secret}` }] },
            },
        ];
        const sm = new MockSessionManager(cwd, "sess-raw", entries);
        const result = await exportSessionMarkdown("sess-raw", { sessionManager: sm, receiptsFile: "", redact: false });
        expect(result.redacted).toBe(0);
        const text = readFileSync(result.path, "utf8");
        expect(text).toContain(secret);
    });

    test("JSON and markdown exports share the same assembly (same messages)", async () => {
        const { exportSession } = await import("../src/sessions.ts");
        const cwd = join(TMP, "md-export-3");
        const entries: SessionEntryLike[] = [
            {
                type: "message",
                id: "m1",
                parentId: null,
                timestamp: new Date().toISOString(),
                message: { role: "user", content: [{ type: "text", text: "hi" }] },
            },
        ];
        const sm = new MockSessionManager(cwd, "sess-both", entries);
        const j = await exportSession("sess-both", { sessionManager: sm, receiptsFile: "" });
        const m = await exportSessionMarkdown("sess-both", { sessionManager: sm, receiptsFile: "" });
        const json = JSON.parse(readFileSync(j.path, "utf8"));
        expect(json.messages).toHaveLength(1);
        const md = readFileSync(m.path, "utf8");
        expect(md).toContain("hi");
        expect(md).toContain("sess-both");
    });
});

// ---------------------------------------------------------------------------
// User session store (listUserSessions / listAllSessions / findUserSessionFile)
// ---------------------------------------------------------------------------

/** Write a flat user-store session file: `<ts>_<id>.jsonl` with a cwd header. */
function writeUserSession(userDir: string, id: string, cwd: string, messageCount = 2, ts = "2026-10-24T09:00:00.000Z") {
    mkdirSync(userDir, { recursive: true });
    const lines = [JSON.stringify({ type: "session", version: 3, id, timestamp: ts, cwd })];
    for (let i = 0; i < messageCount; i++) {
        lines.push(
            JSON.stringify({
                type: "message",
                id: `m${i}`,
                parentId: null,
                timestamp: ts,
                message: { role: "user", content: [{ type: "text", text: `msg ${i}` }] },
            }),
        );
    }
    const file = join(userDir, `2026-10-24T09-00-00-000Z_${id}.jsonl`);
    writeFileSync(file, lines.join("\n") + "\n");
    return file;
}

describe("listUserSessions", () => {
    test("filters by header cwd (resolve-equal) and tags source=user", () => {
        const userDir = join(TMP, "user-store-1");
        const projA = join(TMP, "projA");
        const projB = join(TMP, "projB");
        writeUserSession(userDir, "sess-a1", projA);
        writeUserSession(userDir, "sess-a2", projA);
        writeUserSession(userDir, "sess-b1", projB);

        const list = listUserSessions({ cwd: projA, userSessionDir: userDir });
        expect(list.map((s) => s.id).sort()).toEqual(["sess-a1", "sess-a2"]);
        expect(list.every((s) => s.source === "user")).toBeTrue();
        expect(list[0].messageCount).toBe(2);
    });

    test("allProjects:true drops the cwd filter", () => {
        const userDir = join(TMP, "user-store-2");
        writeUserSession(userDir, "sess-x", join(TMP, "projX"));
        writeUserSession(userDir, "sess-y", join(TMP, "projY"));
        const list = listUserSessions({ userSessionDir: userDir, allProjects: true });
        expect(list).toHaveLength(2);
    });

    test("tolerates a missing dir and broken files", () => {
        expect(listUserSessions({ cwd: TMP, userSessionDir: join(TMP, "nope") })).toEqual([]);
        const userDir = join(TMP, "user-store-3");
        mkdirSync(userDir, { recursive: true });
        writeFileSync(join(userDir, "broken.jsonl"), "{not json}\n");
        writeUserSession(userDir, "sess-ok", join(TMP, "projC"));
        const list = listUserSessions({ cwd: join(TMP, "projC"), userSessionDir: userDir });
        expect(list.map((s) => s.id)).toEqual(["sess-ok"]);
    });

    test("findUserSessionFile matches by filename substring", () => {
        const userDir = join(TMP, "user-store-4");
        writeUserSession(userDir, "sess-findme", join(TMP, "projD"));
        expect(findUserSessionFile(userDir, "sess-findme")).toContain("sess-findme");
        expect(findUserSessionFile(userDir, "sess-missing")).toBeNull();
    });
});

describe("listAllSessions", () => {
    test("merges user + project lanes; project wins on id collision", () => {
        const cwd = join(TMP, "projM");
        const userDir = join(TMP, "user-store-5");
        const projectDir = join(cwd, ".unown", "sessions");
        writeUserSession(userDir, "sess-m1", cwd, 3);
        writeUserSession(userDir, "sess-m2", cwd, 1);
        // project import lane: same id as a user session + a unique import
        mkdirSync(projectDir, { recursive: true });
        const lines = [
            JSON.stringify({ type: "session", version: 3, id: "sess-m1", timestamp: "2026-10-24T10:00:00.000Z", cwd }),
            JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "", message: { role: "user", content: "x" } }),
        ];
        writeFileSync(join(projectDir, "2026-10-24T10-00-00-000Z_sess-m1.jsonl"), lines.join("\n") + "\n");
        writeFileSync(
            join(projectDir, "2026-10-24T10-05-00-000Z_imp-1.jsonl"),
            [
                JSON.stringify({ type: "session", version: 3, id: "imp-1", timestamp: "2026-10-24T10:05:00.000Z", cwd }),
            ].join("\n") + "\n",
        );

        const merged = listAllSessions({ cwd, userSessionDir: userDir });
        expect(merged.map((s) => s.id).sort()).toEqual(["imp-1", "sess-m1", "sess-m2"]);
        const m1 = merged.find((s) => s.id === "sess-m1")!;
        expect(m1.source).toBe("project"); // import wins on collision
        expect(m1.messageCount).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// CLI wiring (runSessionsCommand)
// ---------------------------------------------------------------------------

describe("runSessionsCommand — markdown + both stores", () => {
    test("export <id> --format md writes markdown from the USER store", async () => {
        const home = mkdtempSync(join(tmpdir(), "unown-home-"));
        const userDir = join(home, "agent", "sessions");
        const cwd = mkdtempSync(join(tmpdir(), "unown-cwd-"));
        const prevHome = process.env.UNOWN_HOME;
        const prevCwd = process.cwd();
        process.env.UNOWN_HOME = home;
        try {
            writeUserSession(userDir, "cli-sess-1", cwd, 2);
            const code = await runSessionsCommand(["export", "cli-sess-1", "--format", "md"]);
            expect(code).toBe(0);
            const out = defaultMarkdownExportPath("cli-sess-1", cwd);
            expect(existsSync(out)).toBeTrue();
            const md = readFileSync(out, "utf8");
            expect(md).toContain("# Unown session — cli-sess-1");
            expect(md).toContain("**User:**");
        } finally {
            if (prevHome === undefined) delete process.env.UNOWN_HOME;
            else process.env.UNOWN_HOME = prevHome;
            process.chdir(prevCwd);
            rmSync(home, { recursive: true, force: true });
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test("list finds user-store sessions for this cwd (the invisible-session fix)", async () => {
        const home = mkdtempSync(join(tmpdir(), "unown-home-"));
        const userDir = join(home, "agent", "sessions");
        const cwd = mkdtempSync(join(tmpdir(), "unown-cwd-"));
        const prevHome = process.env.UNOWN_HOME;
        const prevCwd = process.cwd();
        process.env.UNOWN_HOME = home;
        process.chdir(cwd);
        try {
            writeUserSession(userDir, "cli-list-1", cwd, 2);
            // Before the fix, listSessions saw only <cwd>/.unown/sessions (empty).
            expect(listSessions({ cwd })).toHaveLength(0);
            const code = await runSessionsCommand(["list"]);
            expect(code).toBe(0);
        } finally {
            if (prevHome === undefined) delete process.env.UNOWN_HOME;
            else process.env.UNOWN_HOME = prevHome;
            process.chdir(prevCwd);
            rmSync(home, { recursive: true, force: true });
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test("invalid --format is rejected with exit 1", async () => {
        const code = await runSessionsCommand(["export", "whatever", "--format", "yaml"]);
        expect(code).toBe(1);
    });
});
