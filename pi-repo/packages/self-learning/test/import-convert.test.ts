// Unit tests for src/import-convert.ts — the v0.0.7 foreign-session import
// converters (Claude Code / Codex transcripts → native unown sessions), plus
// the `--from` wiring in sessions-cli.ts.
//
// Pins:
//   1. detectSessionFormat: unown / claude / codex / unknown fixtures
//   2. detectSessionFormat: blank + malformed line tolerance, and the
//      claude-vs-codex .message-nesting disambiguation
//   3. convertClaudeSession: 6-line fixture → header shape (fresh id, cwd
//      passed through), linear parent chain, role mapping, toolCall /
//      toolResult fidelity, summary + file-history-snapshot skipped,
//      timestamps preserved
//   4. convertClaudeSession: plain-string content vs block-array content
//   5. convertClaudeSession: null on summary-only input; fallback cwd/epoch
//   6. convertCodexSession: session_meta header, message / function_call /
//      function_call_output mapping, arguments JSON-STRING parsed to an
//      object, turn_context skipped
//   7. serializeConverted / writeConvertedSession: <ts>_<id>.jsonl naming
//      convention, byte count, line-by-line parse-back
//   8. convertAndWriteSession: unown → skipped (reason), unknown → skipped,
//      auto end-to-end writes the file, never throws
//   9. round-trip: the written session survives listSessions (the real
//      loader behind `unown sessions list`) with id + messageCount intact
//  10. runSessionsCommand: `import <file> [--from F]` in both argument
//      orders converts end-to-end; the portable-JSON path is unchanged;
//      skip reasons surface on stderr
//
// Mocks: none for the converters (pure functions); CLI tests chdir into
// mkdtemp dirs and capture stdout/stderr around runSessionsCommand.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
    convertAndWriteSession,
    convertClaudeSession,
    convertCodexSession,
    detectSessionFormat,
    serializeConverted,
    writeConvertedSession,
    type ConvertedSession,
} from "../src/import-convert.ts";
import { listSessions } from "../src/sessions.ts";
import { runSessionsCommand } from "../src/sessions-cli.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-import-convert-"));
afterAll(() => {
    try {
        rmSync(TMP, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

/** JSONL fixture builder: objects → one JSON string per line. */
function jl(...objs: Array<Record<string, unknown>>): string[] {
    return objs.map((o) => JSON.stringify(o));
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const fixedNewId = () => "01234567-89ab-4cde-8f01-234567890abc";

// ---------------------------------------------------------------------------
// Fixtures — shapes lifted from the real tools' storage
// ---------------------------------------------------------------------------

/** Claude Code ~/.claude/projects/<slug>/<session>.jsonl — summary line,
 *  user text, assistant text+tool_use, user tool_result, assistant text,
 *  file-history-snapshot meta line. */
const CLAUDE_FIXTURE: string[] = jl(
    { type: "summary", summary: "Fix the login bug", leafUuid: "u0" },
    {
        type: "user",
        uuid: "u1",
        timestamp: "2026-10-23T21:13:48.114Z",
        cwd: "/home/z/claude-proj",
        sessionId: "s-claude-1",
        version: "1.0.66",
        parentUuid: null,
        message: { role: "user", content: "please run the tests" },
    },
    {
        type: "assistant",
        uuid: "u2",
        timestamp: "2026-10-23T21:13:49.000Z",
        parentUuid: "u1",
        message: {
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [
                { type: "text", text: "Running the tests now" },
                { type: "tool_use", id: "toolu_01", name: "bash", input: { command: "bun test", timeout: 5000 } },
            ],
        },
    },
    {
        type: "user",
        uuid: "u3",
        timestamp: "2026-10-23T21:13:50.250Z",
        parentUuid: "u2",
        message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "3 pass\n0 fail", is_error: false }],
        },
    },
    {
        type: "assistant",
        uuid: "u4",
        timestamp: "2026-10-23T21:13:51.000Z",
        parentUuid: "u3",
        message: { role: "assistant", content: [{ type: "text", text: "All green." }] },
    },
    { type: "file-history-snapshot", uuid: "u5", timestamp: "2026-10-23T21:13:51.500Z" },
);

/** Codex ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl — session_meta,
 *  turn_context, user input_text, function_call (arguments as a JSON STRING),
 *  function_call_output, assistant output_text. */
const CODEX_FIXTURE: string[] = jl(
    {
        type: "session_meta",
        payload: {
            id: "rollout-x",
            timestamp: "2026-10-24T10:00:00.000Z",
            cwd: "/home/z/codex-proj",
            originator: "codex_cli_rs",
            cli_version: "0.140.0",
        },
    },
    { type: "turn_context", payload: { model: "gpt-5.1-codex", cwd: "/home/z/codex-proj", approval_policy: "never" } },
    { type: "message", role: "user", content: [{ type: "input_text", text: "list the files" }], timestamp: "2026-10-24T10:00:01.000Z" },
    {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({ command: ["ls", "-la"] }),
        call_id: "call_01",
        timestamp: "2026-10-24T10:00:02.000Z",
    },
    { type: "function_call_output", call_id: "call_01", output: "file-a.ts\nfile-b.ts" },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "There are 2 files." }], timestamp: "2026-10-24T10:00:04.000Z" },
);

/** Native unown/pi session .jsonl — header line + message entries. */
const UNOWN_FIXTURE: string[] = jl(
    { type: "session", id: "01a16a9c-df13-79e5-989e-ca49d145cd91", timestamp: "2026-10-23T21:13:48.051Z", cwd: "/home/z/proj" },
    { type: "message", id: "e1", parentId: null, timestamp: "2026-10-23T21:13:48.100Z", message: { role: "user", content: "hi" } },
    {
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: "2026-10-23T21:13:49.100Z",
        message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    },
);

/** Entry-level views over a ConvertedSession (entries are Records). */
function roles(converted: ConvertedSession): string[] {
    return converted.entries.map((e) => (e.message as { role: string }).role);
}

function entryTimestamps(converted: ConvertedSession): string[] {
    return converted.entries.map((e) => e.timestamp as string);
}

// ---------------------------------------------------------------------------
// detectSessionFormat
// ---------------------------------------------------------------------------

describe("detectSessionFormat", () => {
    test("1. detects unown (session header leads the file)", () => {
        expect(detectSessionFormat(UNOWN_FIXTURE)).toBe("unown");
    });

    test("1. detects claude (nested .message + .uuid lines)", () => {
        expect(detectSessionFormat(CLAUDE_FIXTURE)).toBe("claude");
    });

    test("1. detects codex (session_meta leads the file)", () => {
        expect(detectSessionFormat(CODEX_FIXTURE)).toBe("codex");
    });

    test("1. detects codex without session_meta (flat message lines)", () => {
        const lines = jl(
            { type: "message", role: "user", content: "hi" },
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
        );
        expect(detectSessionFormat(lines)).toBe("codex");
    });

    test("2. disambiguates by nesting: claude nests .message, codex flattens", () => {
        const claude = jl({ type: "user", uuid: "u1", message: { role: "user", content: "hi" } });
        expect(detectSessionFormat(claude)).toBe("claude");
        const codex = jl({ type: "message", role: "user", content: "hi" });
        expect(detectSessionFormat(codex)).toBe("codex");
    });

    test("2. tolerates blank and malformed lines (incl. before the header)", () => {
        expect(detectSessionFormat(["", "   ", "not json at all", ...CLAUDE_FIXTURE, ""])).toBe("claude");
        expect(detectSessionFormat(["", "garbage {{{", ...UNOWN_FIXTURE])).toBe("unown");
        expect(detectSessionFormat(["", "42", "null", "[]"])).toBe("unknown");
    });

    test("1. returns unknown for unrecognized shapes and empty input", () => {
        expect(detectSessionFormat(jl({ hello: "world" }))).toBe("unknown");
        expect(detectSessionFormat(["random text", "more random text"])).toBe("unknown");
        expect(detectSessionFormat([])).toBe("unknown");
    });
});

// ---------------------------------------------------------------------------
// convertClaudeSession
// ---------------------------------------------------------------------------

describe("convertClaudeSession", () => {
    test("3. converts the 6-line fixture into a valid unown session", () => {
        const converted = convertClaudeSession(CLAUDE_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" });
        expect(converted).not.toBeNull();
        // Header shape: fresh id, cwd passed through, first message timestamp.
        expect(converted!.header).toEqual({
            type: "session",
            id: "01234567-89ab-4cde-8f01-234567890abc",
            timestamp: "2026-10-23T21:13:48.114Z",
            cwd: "/home/z/claude-proj",
        });
        // Summary + file-history-snapshot skipped → 4 usable messages.
        expect(converted!.entries.length).toBe(4);
        expect(roles(converted!)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    });

    test("3. keeps the parent chain linear with fresh entry ids", () => {
        const converted = convertClaudeSession(CLAUDE_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        expect(converted.entries[0].parentId).toBe(null);
        for (let i = 1; i < converted.entries.length; i++) {
            expect(converted.entries[i].parentId).toBe(converted.entries[i - 1].id);
        }
        // Entry ids are fresh (distinct from each other and from the header id).
        const ids = new Set(converted.entries.map((e) => e.id as string));
        expect(ids.size).toBe(converted.entries.length);
        expect(ids.has(converted.header.id)).toBe(false);
    });

    test("3. maps tool_use → toolCall and tool_result → toolResult with fidelity", () => {
        const converted = convertClaudeSession(CLAUDE_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        const assistant = converted.entries[1].message as {
            model?: string;
            content: Array<{ type: string; text?: string; id?: string; name?: string; arguments?: unknown }>;
        };
        expect(assistant.model).toBe("claude-sonnet-4-5");
        expect(assistant.content[0]).toEqual({ type: "text", text: "Running the tests now" });
        expect(assistant.content[1]).toEqual({
            type: "toolCall",
            id: "toolu_01",
            name: "bash",
            arguments: { command: "bun test", timeout: 5000 },
        });
        const toolResult = converted.entries[2].message as {
            toolCallId?: string;
            isError: boolean;
            content: Array<{ type: string; text: string }>;
        };
        expect(toolResult.role).toBe("toolResult");
        expect(toolResult.toolCallId).toBe("toolu_01");
        expect(toolResult.isError).toBe(false);
        expect(toolResult.content).toEqual([{ type: "text", text: "3 pass\n0 fail" }]);
        const last = converted.entries[3].message as { content: Array<{ type: string; text: string }> };
        expect(last.content).toEqual([{ type: "text", text: "All green." }]);
    });

    test("3. preserves timestamps verbatim (and stamps numeric message clocks)", () => {
        const converted = convertClaudeSession(CLAUDE_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        expect(entryTimestamps(converted)).toEqual([
            "2026-10-23T21:13:48.114Z",
            "2026-10-23T21:13:49.000Z",
            "2026-10-23T21:13:50.250Z",
            "2026-10-23T21:13:51.000Z",
        ]);
        expect(typeof (converted.entries[0].message as { timestamp: number }).timestamp).toBe("number");
        expect((converted.entries[0].message as { timestamp: number }).timestamp).toBe(Date.parse("2026-10-23T21:13:48.114Z"));
    });

    test("4. accepts plain-string content and block-array content alike", () => {
        const lines = jl(
            { type: "user", uuid: "a1", timestamp: "2026-10-23T22:00:00.000Z", cwd: "/w", message: { role: "user", content: "plain string question" } },
            {
                type: "user",
                uuid: "a2",
                timestamp: "2026-10-23T22:00:01.000Z",
                message: { role: "user", content: [{ type: "text", text: "block one" }, { type: "text", text: "block two" }] },
            },
        );
        const converted = convertClaudeSession(lines, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        expect(converted.entries.length).toBe(2);
        expect((converted.entries[0].message as { content: string }).content).toBe("plain string question");
        expect((converted.entries[1].message as { content: string }).content).toBe("block one\nblock two");
    });

    test("5. returns null on summary-only input, falls back to cwd/epoch", () => {
        expect(convertClaudeSession(jl({ type: "summary", summary: "A title" }), { newId: fixedNewId, fallbackCwd: "/f" })).toBeNull();
        const noMeta = jl({ type: "user", uuid: "b1", message: { role: "user", content: "no cwd, no timestamp" } });
        const converted = convertClaudeSession(noMeta, { newId: fixedNewId, fallbackCwd: "/fallback-cwd" })!;
        expect(converted.header.cwd).toBe("/fallback-cwd");
        expect(converted.header.timestamp).toBe(EPOCH_ISO);
        expect(entryTimestamps(converted)).toEqual([EPOCH_ISO]);
    });
});

// ---------------------------------------------------------------------------
// convertCodexSession
// ---------------------------------------------------------------------------

describe("convertCodexSession", () => {
    test("6. converts the rollout fixture into a valid unown session", () => {
        const converted = convertCodexSession(CODEX_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" });
        expect(converted).not.toBeNull();
        // session_meta payload → header; turn_context skipped.
        expect(converted!.header).toEqual({
            type: "session",
            id: "01234567-89ab-4cde-8f01-234567890abc",
            timestamp: "2026-10-24T10:00:00.000Z",
            cwd: "/home/z/codex-proj",
        });
        expect(converted!.entries.length).toBe(4);
        expect(roles(converted!)).toEqual(["user", "assistant", "toolResult", "assistant"]);
        expect((converted!.entries[0].message as { content: string }).content).toBe("list the files");
        expect((converted!.entries[3].message as { content: string }).content).toBe("There are 2 files.");
    });

    test("6. parses the function_call arguments JSON STRING into an object", () => {
        const converted = convertCodexSession(CODEX_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        const assistant = converted.entries[1].message as {
            content: Array<{ type: string; id: string; name: string; arguments: unknown }>;
        };
        expect(assistant.content.length).toBe(1);
        const toolCall = assistant.content[0];
        expect(toolCall.type).toBe("toolCall");
        expect(toolCall.id).toBe("call_01");
        expect(toolCall.name).toBe("shell");
        // The wire format is a JSON STRING; the converter must parse it.
        expect(typeof toolCall.arguments).toBe("object");
        expect(toolCall.arguments).toEqual({ command: ["ls", "-la"] });
        const toolResult = converted.entries[2].message as {
            toolCallId?: string;
            content: Array<{ type: string; text: string }>;
        };
        expect(toolResult.role).toBe("toolResult");
        expect(toolResult.toolCallId).toBe("call_01");
        expect(toolResult.content).toEqual([{ type: "text", text: "file-a.ts\nfile-b.ts" }]);
    });

    test("6. falls back to epoch timestamps and keeps the chain linear", () => {
        const converted = convertCodexSession(CODEX_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        // The function_call_output line has no timestamp → ISO epoch.
        expect(entryTimestamps(converted)).toEqual([
            "2026-10-24T10:00:01.000Z",
            "2026-10-24T10:00:02.000Z",
            EPOCH_ISO,
            "2026-10-24T10:00:04.000Z",
        ]);
        expect(converted.entries[0].parentId).toBe(null);
        for (let i = 1; i < converted.entries.length; i++) {
            expect(converted.entries[i].parentId).toBe(converted.entries[i - 1].id);
        }
    });

    test("6. handles plain-string message content and bad arguments fallback", () => {
        const lines = jl(
            { type: "message", role: "user", content: "just a string" },
            { type: "function_call", name: "shell", arguments: "not-json{{{", call_id: "call_02" },
        );
        const converted = convertCodexSession(lines, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        expect((converted.entries[0].message as { content: string }).content).toBe("just a string");
        const toolCall = (converted.entries[1].message as { content: Array<{ arguments: unknown }> }).content[0];
        expect(toolCall.arguments).toEqual({ raw: "not-json{{{" });
        // No session_meta → fallbackCwd + epoch header.
        expect(converted.header.cwd).toBe("/fallback");
        expect(converted.header.timestamp).toBe(EPOCH_ISO);
    });

    test("5. returns null when nothing usable exists", () => {
        expect(convertCodexSession(jl({ type: "turn_context", payload: { model: "x" } }), { newId: fixedNewId, fallbackCwd: "/f" })).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// serializeConverted / writeConvertedSession
// ---------------------------------------------------------------------------

describe("serializeConverted / writeConvertedSession", () => {
    test("7. serializes header + entries, one JSON per line, trailing newline", () => {
        const converted = convertClaudeSession(CLAUDE_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        const text = serializeConverted(converted);
        expect(text.endsWith("\n")).toBe(true);
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        expect(lines.length).toBe(1 + converted.entries.length);
        const header = JSON.parse(lines[0]) as { type: string; id: string; cwd: string };
        expect(header.type).toBe("session");
        expect(header.id).toBe(converted.header.id);
        for (const line of lines) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });

    test("7. writes <timestamp>_<id>.jsonl into the target dir (recursive mkdir)", () => {
        const converted = convertClaudeSession(CLAUDE_FIXTURE, { newId: fixedNewId, fallbackCwd: "/fallback" })!;
        const targetDir = join(TMP, "serialize", "nested", "sessions");
        const written = writeConvertedSession(converted, targetDir);
        expect(existsSync(written.path)).toBe(true);
        expect(written.bytes).toBe(Buffer.byteLength(serializeConverted(converted)));
        expect(basename(written.path)).toBe("2026-10-23T21-13-48-114Z_01234567-89ab-4cde-8f01-234567890abc.jsonl");
        expect(basename(written.path)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[0-9a-f-]{36}\.jsonl$/);
        // The written file parses back line-by-line, header first.
        const lines = readFileSync(written.path, "utf8").split("\n").filter((l) => l.trim().length > 0);
        expect(lines.length).toBe(1 + converted.entries.length);
        expect((JSON.parse(lines[0]) as { id: string }).id).toBe(converted.header.id);
    });
});

// ---------------------------------------------------------------------------
// convertAndWriteSession
// ---------------------------------------------------------------------------

describe("convertAndWriteSession", () => {
    test("8. skips unown input with a reason (directly resumable, no conversion)", () => {
        const result = convertAndWriteSession(UNOWN_FIXTURE, { targetDir: join(TMP, "skip"), fallbackCwd: "/f" });
        expect(result.format).toBe("unown");
        expect(result.skipped).toBe(true);
        expect(result.path).toBeUndefined();
        expect(result.reason).toContain("already a unown session");
        // Nothing was written — the skip path doesn't even create the dir.
        expect(existsSync(join(TMP, "skip"))).toBe(false);
    });

    test("8. skips unknown input with a reason", () => {
        const result = convertAndWriteSession(["garbage", "{\"a\":1}"], { targetDir: join(TMP, "skip"), fallbackCwd: "/f" });
        expect(result.format).toBe("unknown");
        expect(result.skipped).toBe(true);
        expect(result.reason).toContain("unrecognized session format");
    });

    test("8. skips when the declared format has no usable messages", () => {
        const result = convertAndWriteSession(jl({ type: "summary", summary: "only a title" }), {
            format: "claude",
            targetDir: join(TMP, "skip"),
            fallbackCwd: "/f",
        });
        expect(result.skipped).toBe(true);
        expect(result.reason).toContain("no usable messages");
    });

    test("8. auto-detects and writes end-to-end (claude)", () => {
        const targetDir = join(TMP, "auto-claude");
        const result = convertAndWriteSession(CLAUDE_FIXTURE, { targetDir, fallbackCwd: "/f" });
        expect(result.format).toBe("claude");
        expect(result.skipped).toBe(false);
        expect(result.bytes).toBeGreaterThan(0);
        expect(result.path).toBeDefined();
        expect(existsSync(result.path!)).toBe(true);
        // Default newId is crypto.randomUUID → v4-shaped header id.
        const header = JSON.parse(readFileSync(result.path!, "utf8").split("\n")[0]) as { id: string };
        expect(header.id).toMatch(UUID_V4);
    });

    test("8. explicit format wins over auto-detection (codex)", () => {
        const targetDir = join(TMP, "explicit-codex");
        const result = convertAndWriteSession(CODEX_FIXTURE, { format: "codex", targetDir, fallbackCwd: "/f" });
        expect(result.format).toBe("codex");
        expect(result.skipped).toBe(false);
        expect(existsSync(result.path!)).toBe(true);
    });

    test("8. never throws — I/O failures degrade to skipped results", () => {
        // targetDir under a FILE (not a dir) → writeFileSync must fail.
        const blocker = join(TMP, "blocker");
        writeFileSync(blocker, "i am a file");
        const result = convertAndWriteSession(CLAUDE_FIXTURE, {
            targetDir: join(blocker, "sub", "dir"),
            fallbackCwd: "/f",
        });
        expect(result.skipped).toBe(true);
        expect(result.reason).toContain("conversion failed");
    });
});

// ---------------------------------------------------------------------------
// Round-trip with the real loaders
// ---------------------------------------------------------------------------

describe("round-trip with the real session loaders", () => {
    test("9. converted session survives listSessions + JSONL re-parse", () => {
        const sessionDir = join(TMP, "round-trip", "sessions");
        const result = convertAndWriteSession(CLAUDE_FIXTURE, { targetDir: sessionDir, fallbackCwd: "/f" });
        expect(result.skipped).toBe(false);
        // listSessions is the production loader behind `unown sessions list`.
        const sessions = listSessions({ sessionDir });
        expect(sessions.length).toBe(1);
        expect(sessions[0].messageCount).toBe(4);
        // FileSessionLike (sessions-cli.ts) is not exported, so re-parse the
        // JSONL directly and assert what it would assert: header + entries.
        const lines = readFileSync(result.path!, "utf8").split("\n").filter((l) => l.trim().length > 0);
        const header = JSON.parse(lines[0]) as { type: string; id: string; cwd: string };
        expect(header.type).toBe("session");
        expect(header.id).toBe(sessions[0].id);
        expect(header.cwd).toBe("/home/z/claude-proj");
        const entries = lines.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
        expect(entries.length).toBe(4);
        expect(entries.map((e) => (e.message as { role: string }).role)).toEqual([
            "user",
            "assistant",
            "toolResult",
            "assistant",
        ]);
        expect(entries[0].parentId).toBe(null);
        for (let i = 1; i < entries.length; i++) {
            expect(entries[i].parentId).toBe(entries[i - 1].id);
        }
    });

    test("9. codex round-trip keeps the toolCall → toolResult pairing", () => {
        const sessionDir = join(TMP, "round-trip-codex", "sessions");
        const result = convertAndWriteSession(CODEX_FIXTURE, { targetDir: sessionDir, fallbackCwd: "/f" });
        expect(result.skipped).toBe(false);
        const sessions = listSessions({ sessionDir });
        expect(sessions[0].messageCount).toBe(4);
        const lines = readFileSync(result.path!, "utf8").split("\n").filter((l) => l.trim().length > 0);
        const entries = lines.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
        const toolCall = (entries[1].message as { content: Array<{ id: string }> }).content[0];
        const toolResult = entries[2].message as { toolCallId: string };
        expect(toolResult.toolCallId).toBe(toolCall.id);
    });
});

// ---------------------------------------------------------------------------
// runSessionsCommand: `import <file> [--from F]`
// ---------------------------------------------------------------------------

/** Run `fn` with process.stdout / process.stderr writes captured (restored
 *  afterwards) — pins the CLI's user-facing output without spawning a tty. */
async function captureConsole(fn: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    let out = "";
    let err = "";
    process.stdout.write = ((chunk: unknown) => {
        out += String(chunk);
        return true;
    }) as typeof origOut;
    process.stderr.write = ((chunk: unknown) => {
        err += String(chunk);
        return true;
    }) as typeof origErr;
    try {
        const code = await fn();
        return { code, out, err };
    } finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
    }
}

/** chdir into a fresh dir, write a claude/codex/unown fixture file there. */
function cliDir(name: string, fixture: string[]): { cwd: string; file: string } {
    const cwd = join(TMP, name);
    mkdirSync(cwd, { recursive: true });
    const file = join(cwd, "session.jsonl");
    writeFileSync(file, fixture.join("\n") + "\n");
    return { cwd, file };
}

/** chdir wrapper: run the command in `cwd`, restore the previous cwd. */
async function inDir<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
    const prev = process.cwd();
    process.chdir(cwd);
    try {
        return await fn();
    } finally {
        process.chdir(prev);
    }
}

describe("runSessionsCommand import --from", () => {
    test("10. converts a claude .jsonl end-to-end (auto) into <cwd>/.unown/sessions", async () => {
        const { cwd, file } = cliDir("cli-claude", CLAUDE_FIXTURE);
        const { code, out } = await inDir(cwd, () => captureConsole(() => runSessionsCommand(["import", file])));
        expect(code).toBe(0);
        expect(out).toContain("Imported claude session");
        expect(out).toMatch(/new id [0-9a-f-]{36}/);
        expect(out).toContain("(4 messages,");
        expect(out).toContain("/resume or unown sessions list will show it");
        const sessions = listSessions({ cwd });
        expect(sessions.length).toBe(1);
        expect(sessions[0].messageCount).toBe(4);
    });

    test("10. accepts the flag in either order (--from before or after the file)", async () => {
        const a = cliDir("cli-order-a", CODEX_FIXTURE);
        const ra = await inDir(a.cwd, () => captureConsole(() => runSessionsCommand(["import", "--from", "codex", a.file])));
        expect(ra.code).toBe(0);
        expect(ra.out).toContain("Imported codex session");
        expect(listSessions({ cwd: a.cwd })[0].messageCount).toBe(4);

        const b = cliDir("cli-order-b", CODEX_FIXTURE);
        const rb = await inDir(b.cwd, () => captureConsole(() => runSessionsCommand(["import", b.file, "--from", "codex"])));
        expect(rb.code).toBe(0);
        expect(listSessions({ cwd: b.cwd })[0].messageCount).toBe(4);
    });

    test("10. skips an already-unown .jsonl with the reason on stderr (exit 1)", async () => {
        const { cwd, file } = cliDir("cli-unown", UNOWN_FIXTURE);
        const { code, err } = await inDir(cwd, () => captureConsole(() => runSessionsCommand(["import", file])));
        expect(code).toBe(1);
        expect(err).toContain("already a unown session");
        expect(listSessions({ cwd }).length).toBe(0);
    });

    test("10. rejects an invalid --from value (exit 1)", async () => {
        const { cwd, file } = cliDir("cli-bogus", CLAUDE_FIXTURE);
        const { code, err } = await inDir(cwd, () => captureConsole(() => runSessionsCommand(["import", file, "--from", "gemini"])));
        expect(code).toBe(1);
        expect(err).toContain("invalid --from value");
    });

    test("10. keeps the portable-JSON export path (existing behavior)", async () => {
        const cwd = join(TMP, "cli-portable");
        mkdirSync(cwd, { recursive: true });
        const exportPath = join(cwd, "to-import.json");
        writeFileSync(
            exportPath,
            JSON.stringify({
                version: 1,
                manifest: { id: "src-1", createdAt: 0, model: null, provider: null, cwd: "/tmp" },
                messages: [{ role: "user", content: "hello" }],
            }),
        );
        const { code, out } = await inDir(cwd, () => captureConsole(() => runSessionsCommand(["import", exportPath])));
        expect(code).toBe(0);
        expect(out).toContain("Imported session");
        const sessions = listSessions({ cwd });
        expect(sessions.length).toBe(1);
        expect(sessions[0].messageCount).toBe(1);
    });

    test("10. a missing .jsonl falls through to importSession's file-not-found error", async () => {
        const cwd = join(TMP, "cli-missing");
        mkdirSync(cwd, { recursive: true });
        const { code, err } = await inDir(cwd, () =>
            captureConsole(() => runSessionsCommand(["import", join(cwd, "nope.jsonl")])),
        );
        expect(code).toBe(1);
        expect(err).toContain("file not found");
    });

    test("10. usage error when no file argument is present", async () => {
        const { code, err } = await captureConsole(() => runSessionsCommand(["import", "--from", "claude"]));
        expect(code).toBe(1);
        expect(err).toContain("usage: unown sessions import");
    });
});
