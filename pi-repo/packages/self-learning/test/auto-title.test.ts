// Unit tests for src/auto-title.ts — session auto-titling (v0.0.7 parity).
//
// Pins, in order of the module's guard chain:
//   (a) autoTitlesEnabled parsing — ON by default, empty string = unset,
//       "0"/"false"/"off" (case-insensitive) disable, env read at call time.
//   (b) hasEnoughTitleMaterial edge cases — 12-char user boundary, assistant
//       with no text blocks, toolResult role, malformed entries.
//   (c) buildTitleMessages — slot order (first user, first assistant, last
//       user, last assistant), dedup, 1500-char per-message cap, total cap.
//   (d) generateSessionTitle — the pinned prompt + call opts, and every
//       rejection lane: >48 chars, empty, whitespace-only, multi-line,
//       markdown headers, chat throwing, non-string reply; wrapping quotes
//       are STRIPPED (a quoted title is still a title), quotes-only is not.
//   (e) maybeAutoTitleSession — every guard reason, plus the SUCCESS path
//       writing a real session_info entry into a real pi session .jsonl
//       (verified by a reverse-walk mirroring SessionManager.getSessionName
//       AND by SessionManager.open().getSessionName() itself).
//   (f) the race guard — sessionName() flipping to a value between the
//       first check and the write leaves the file untouched.
//
// No network, no engine store: the chat fn is a stub, env is either an
// explicit object or a saved/restored process.env mutation. _env.ts must
// stay the first import (store.ts SQLite bootstrap).
import "./_env.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
    autoTitlesEnabled,
    buildTitleMessages,
    generateSessionTitle,
    hasEnoughTitleMaterial,
    maybeAutoTitleSession,
    messageText,
    titleAttemptKey,
    type TitleChatFn,
} from "../src/auto-title.ts";

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

/** The pinned system prompt (duplicated verbatim — a silent prompt edit must fail here). */
const PINNED_SYSTEM_PROMPT =
    "You title coding sessions. Reply with ONLY a 3-6 word title (max 48 chars), no quotes, no trailing punctuation, single line. Plain text.";

/** A minimal pi message entry. parentId chains root→leaf like the real writer. */
function msgEntry(role: "user" | "assistant" | "toolResult", content: unknown, n: number): unknown {
    return {
        type: "message",
        id: `m${n}`,
        parentId: n === 1 ? null : `m${n - 1}`,
        timestamp: `2026-01-01T00:00:0${n}.000Z`,
        message: { role, content },
    };
}

/** A user/assistant pair with enough material to title. */
const GOOD_ENTRIES: unknown[] = [
    msgEntry("user", "Please fix the login bug in the auth module", 1),
    msgEntry("assistant", [{ type: "text", text: "I will patch the auth flow." }], 2),
];

interface RecordedCall {
    messages: Array<{ role: string; content: string }>;
    opts?: { maxTokens?: number; timeoutMs?: number };
}

/** Chat stub: records every call, replies with `reply` or throws it. */
function chatStub(reply: string | Error): { chat: TitleChatFn; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const chat: TitleChatFn = async (messages, opts) => {
        calls.push({ messages: messages.map((m) => ({ role: m.role, content: m.content })), opts });
        if (reply instanceof Error) throw reply;
        return reply;
    };
    return { chat, calls };
}

/** A non-string-replying stub (defensive lane: chat is typed but trust nothing). */
const notStringChat = (async () => undefined as unknown as string) as TitleChatFn;

/** Write a minimal VALID pi session .jsonl; returns its path + parsed entries. */
function writeSessionFile(dir: string, messageEntries: unknown[]): { file: string; entries: unknown[] } {
    const id = randomUUID();
    const file = join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    const header = { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: dir };
    const all = [header, ...messageEntries];
    writeFileSync(file, all.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    return { file, entries: all };
}

/** Non-empty lines of a JSONL file. */
function jsonlLines(file: string): string[] {
    return readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
}

/** Reverse-walk for the latest session_info name — mirrors SessionManager.getSessionName semantics. */
function latestSessionInfoName(file: string): string | undefined {
    const lines = jsonlLines(file);
    for (let i = lines.length - 1; i >= 0; i--) {
        const entry = JSON.parse(lines[i]) as { type?: unknown; name?: unknown };
        if (entry.type === "session_info") {
            return typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name.trim() : undefined;
        }
    }
    return undefined;
}

const tmpDirs: string[] = [];
function makeTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "unown-auto-title-"));
    tmpDirs.push(dir);
    return dir;
}

// process.env.UNOWN_AUTO_TITLES must be controlled around every
// maybeAutoTitleSession call (the flag is read at CALL time, by design).
const PREV_FLAG = process.env.UNOWN_AUTO_TITLES;

beforeEach(() => {
    delete process.env.UNOWN_AUTO_TITLES;
});

afterEach(() => {
    if (PREV_FLAG === undefined) delete process.env.UNOWN_AUTO_TITLES;
    else process.env.UNOWN_AUTO_TITLES = PREV_FLAG;
    while (tmpDirs.length > 0) {
        const dir = tmpDirs.pop();
        if (dir !== undefined) {
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {
                /* best-effort cleanup */
            }
        }
    }
});

// ---------------------------------------------------------------------------
// (a) autoTitlesEnabled
// ---------------------------------------------------------------------------

describe("autoTitlesEnabled", () => {
    test("on by default; empty string counts as unset", () => {
        expect(autoTitlesEnabled({})).toBe(true);
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "" })).toBe(true);
    });

    test('"0"/"false"/"off" disable, case-insensitively', () => {
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "0" })).toBe(false);
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "false" })).toBe(false);
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "off" })).toBe(false);
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "FALSE" })).toBe(false);
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "Off" })).toBe(false);
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: " 0 " })).toBe(false);
    });

    test("any other value keeps the feature on", () => {
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "1" })).toBe(true);
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "true" })).toBe(true);
        expect(autoTitlesEnabled({ UNOWN_AUTO_TITLES: "yes" })).toBe(true);
    });

    test("default arg reads the LIVE process env at call time", () => {
        expect(autoTitlesEnabled()).toBe(true);
        process.env.UNOWN_AUTO_TITLES = "off";
        expect(autoTitlesEnabled()).toBe(false);
        process.env.UNOWN_AUTO_TITLES = "";
        expect(autoTitlesEnabled()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// (b) hasEnoughTitleMaterial + messageText
// ---------------------------------------------------------------------------

describe("hasEnoughTitleMaterial", () => {
    test("12-char user boundary (trimmed) + any assistant text", () => {
        expect(hasEnoughTitleMaterial([msgEntry("user", "aaaaaaaaaaaa", 1), msgEntry("assistant", "x", 2)])).toBe(true);
        expect(hasEnoughTitleMaterial([msgEntry("user", "aaaaaaaaaaa", 1), msgEntry("assistant", "x", 2)])).toBe(false);
        expect(hasEnoughTitleMaterial([msgEntry("user", "  aaaaaaaaaa  ", 1), msgEntry("assistant", "x", 2)])).toBe(false);
    });

    test("missing either side fails", () => {
        expect(hasEnoughTitleMaterial([msgEntry("user", "aaaaaaaaaaaa", 1)])).toBe(false);
        expect(hasEnoughTitleMaterial([msgEntry("assistant", "x", 1)])).toBe(false);
        expect(hasEnoughTitleMaterial([])).toBe(false);
    });

    test("assistant with only non-text blocks does not count", () => {
        const assistantToolOnly = msgEntry("assistant", [{ type: "toolCall", name: "edit" }], 2);
        expect(hasEnoughTitleMaterial([msgEntry("user", "aaaaaaaaaaaa", 1), assistantToolOnly])).toBe(false);
    });

    test("toolResult role never counts as assistant", () => {
        expect(
            hasEnoughTitleMaterial([msgEntry("toolResult", "x" .repeat(20), 1), msgEntry("user", "aaaaaaaaaaaa", 2)]),
        ).toBe(false);
    });

    test("text blocks are joined and count toward the user minimum", () => {
        const blocks = msgEntry("user", [{ type: "text", text: "hello " }, { type: "text", text: "world rule" }], 1);
        expect(hasEnoughTitleMaterial([blocks, msgEntry("assistant", [{ type: "text", text: "ok" }], 2)])).toBe(true);
    });

    test("malformed entries are ignored, never fatal", () => {
        expect(hasEnoughTitleMaterial([null, 42, "x", {}, { type: "session" }, { type: "message", message: "str" }])).toBe(
            false,
        );
        expect(
            hasEnoughTitleMaterial([
                null,
                msgEntry("user", "aaaaaaaaaaaa", 1),
                { type: "message", message: "str" },
                msgEntry("assistant", "yes", 2),
            ]),
        ).toBe(true);
    });
});

describe("messageText", () => {
    test("string content passes through", () => {
        expect(messageText("hello")).toBe("hello");
    });

    test("text blocks are joined with newlines; other blocks skipped", () => {
        expect(
            messageText([
                { type: "text", text: "a" },
                { type: "thinking", text: "hidden" },
                { type: "toolCall", name: "bash" },
                { type: "text", text: "b" },
            ]),
        ).toBe("a\nb");
    });

    test("junk inside the array is skipped; non-array non-string is empty", () => {
        expect(messageText([null, 42, { type: "text", text: "ok" }, { type: "text" }])).toBe("ok");
        expect(messageText(undefined)).toBe("");
        expect(messageText(42)).toBe("");
        expect(messageText({ type: "text", text: "no" })).toBe("");
    });
});

// ---------------------------------------------------------------------------
// (c) buildTitleMessages
// ---------------------------------------------------------------------------

describe("buildTitleMessages", () => {
    test("single pair is not duplicated", () => {
        const out = buildTitleMessages(GOOD_ENTRIES);
        expect(out).toEqual([
            { role: "user", content: "Please fix the login bug in the auth module" },
            { role: "assistant", content: "I will patch the auth flow." },
        ]);
    });

    test("four messages: first user, first assistant, last user, last assistant", () => {
        const entries = [
            msgEntry("user", "first user ask here", 1),
            msgEntry("assistant", "first reply", 2),
            msgEntry("user", "last user ask here", 3),
            msgEntry("assistant", "last reply", 4),
        ];
        expect(buildTitleMessages(entries).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
        expect(buildTitleMessages(entries).map((m) => m.content)).toEqual([
            "first user ask here",
            "first reply",
            "last user ask here",
            "last reply",
        ]);
    });

    test("slot order, deduped by position (one assistant among two users)", () => {
        const entries = [
            msgEntry("user", "first user ask", 1),
            msgEntry("user", "second user ask", 2),
            msgEntry("assistant", "only reply", 3),
        ];
        const out = buildTitleMessages(entries);
        expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
        expect(out.map((m) => m.content)).toEqual(["first user ask", "only reply", "second user ask"]);
    });

    test("per-message cap at 1500 chars", () => {
        const entries = [msgEntry("user", "x".repeat(3000), 1), msgEntry("assistant", "y".repeat(2000), 2)];
        const out = buildTitleMessages(entries);
        expect(out.length).toBe(2);
        expect(out[0].content.length).toBe(1500);
        expect(out[1].content.length).toBe(1500);
        expect(out[0].content.startsWith("xxx")).toBe(true);
    });

    test("total cap drops whole later slots once the budget is spent", () => {
        const entries = [
            msgEntry("user", "a".repeat(60), 1),
            msgEntry("assistant", "b".repeat(60), 2),
            msgEntry("user", "c".repeat(60), 3),
            msgEntry("assistant", "d".repeat(60), 4),
        ];
        const out = buildTitleMessages(entries, 100);
        expect(out.length).toBe(1);
        expect(out[0]).toEqual({ role: "user", content: "a".repeat(60) });
    });

    test("malformed or empty-text entries yield an empty context", () => {
        expect(buildTitleMessages([null, 42, "x", { type: "session" }, { type: "message", message: "str" }])).toEqual([]);
        const assistantToolOnly = msgEntry("assistant", [{ type: "toolCall", name: "edit" }], 1);
        expect(buildTitleMessages([assistantToolOnly])).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// (d) generateSessionTitle
// ---------------------------------------------------------------------------

describe("generateSessionTitle", () => {
    test("good reply: pinned prompt, call opts, transcript user message", async () => {
        const { chat, calls } = chatStub("Fix login auth flow");
        const title = await generateSessionTitle(GOOD_ENTRIES, chat);
        expect(title).toBe("Fix login auth flow");
        expect(calls.length).toBe(1);
        expect(calls[0].messages.length).toBe(2);
        expect(calls[0].messages[0]).toEqual({ role: "system", content: PINNED_SYSTEM_PROMPT });
        expect(calls[0].messages[1].role).toBe("user");
        expect(calls[0].messages[1].content.startsWith("Title this session:")).toBe(true);
        expect(calls[0].messages[1].content).toContain("Please fix the login bug in the auth module");
        expect(calls[0].messages[1].content).toContain("user: Please fix the login bug in the auth module");
        expect(calls[0].opts).toEqual({ maxTokens: 32, timeoutMs: 20000 });
    });

    test("empty context never calls the chat fn", async () => {
        const { chat, calls } = chatStub("Fix login auth flow");
        expect(await generateSessionTitle([], chat)).toBeUndefined();
        expect(await generateSessionTitle([null, 42], chat)).toBeUndefined();
        expect(calls.length).toBe(0);
    });

    test("48 chars pass, 49 do not", async () => {
        const ok = chatStub("a".repeat(48));
        expect(await generateSessionTitle(GOOD_ENTRIES, ok.chat)).toBe("a".repeat(48));
        const tooLong = chatStub("a".repeat(49));
        expect(await generateSessionTitle(GOOD_ENTRIES, tooLong.chat)).toBeUndefined();
    });

    test("empty and whitespace-only replies are rejected", async () => {
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub("").chat)).toBeUndefined();
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub("   \n\t ").chat)).toBeUndefined();
    });

    test("multi-line replies are rejected", async () => {
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub("Fix login\nauth flow").chat)).toBeUndefined();
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub("Fix login\r\nauth flow").chat)).toBeUndefined();
    });

    test("wrapping quotes are stripped; quotes-only is rejected", async () => {
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub('"Fix login auth flow"').chat)).toBe("Fix login auth flow");
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub("'Fix login auth flow'").chat)).toBe("Fix login auth flow");
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub("\u201cFix login auth flow\u201d").chat)).toBe(
            "Fix login auth flow",
        );
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub('""').chat)).toBeUndefined();
    });

    test("markdown headers are rejected", async () => {
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub("## Fix login bug").chat)).toBeUndefined();
        expect(await generateSessionTitle(GOOD_ENTRIES, chatStub("# Fix login bug").chat)).toBeUndefined();
    });

    test("chat throwing returns undefined (never throws)", async () => {
        const { chat } = chatStub(new Error("llm-bridge 500: upstream down"));
        expect(await generateSessionTitle(GOOD_ENTRIES, chat)).toBeUndefined();
    });

    test("non-string reply returns undefined", async () => {
        expect(await generateSessionTitle(GOOD_ENTRIES, notStringChat)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// (e)+(f) maybeAutoTitleSession
// ---------------------------------------------------------------------------

describe("maybeAutoTitleSession", () => {
    test("no session file (undefined or missing on disk) → no-session-file", async () => {
        const { chat, calls } = chatStub("Fix login auth flow");
        const res = await maybeAutoTitleSession({
            sessionFile: undefined,
            sessionName: () => undefined,
            entries: () => GOOD_ENTRIES,
            chat: chatStub("Fix login auth flow").chat,
        });
        expect(res.titled).toBe(false);
        expect(res.reason).toBe("no-session-file");
        expect(res.title).toBeUndefined();

        const res2 = await maybeAutoTitleSession({
            sessionFile: join(makeTmp(), "does-not-exist.jsonl"),
            sessionName: () => undefined,
            entries: () => GOOD_ENTRIES,
            chat,
        });
        expect(res2.titled).toBe(false);
        expect(res2.reason).toBe("no-session-file");
        expect(calls.length).toBe(0);
    });

    test("UNOWN_AUTO_TITLES=0 → disabled, no chat call, file untouched", async () => {
        const dir = makeTmp();
        const { file, entries } = writeSessionFile(dir, GOOD_ENTRIES);
        const { chat, calls } = chatStub("Fix login auth flow");
        process.env.UNOWN_AUTO_TITLES = "0";
        const res = await maybeAutoTitleSession({
            sessionFile: file,
            sessionName: () => undefined,
            entries: () => entries,
            chat,
        });
        expect(res.titled).toBe(false);
        expect(res.reason).toBe("disabled");
        expect(calls.length).toBe(0);
        expect(jsonlLines(file).length).toBe(3);
    });

    test("session already named → already-named, no chat call, file untouched", async () => {
        const dir = makeTmp();
        const { file, entries } = writeSessionFile(dir, GOOD_ENTRIES);
        const { chat, calls } = chatStub("Fix login auth flow");
        const res = await maybeAutoTitleSession({
            sessionFile: file,
            sessionName: () => "user named it",
            entries: () => entries,
            chat,
        });
        expect(res.titled).toBe(false);
        expect(res.reason).toBe("already-named");
        expect(calls.length).toBe(0);
        expect(jsonlLines(file).length).toBe(3);
    });

    test("caller's alreadyTitled guard → already-attempted, no chat call", async () => {
        const dir = makeTmp();
        const { file, entries } = writeSessionFile(dir, GOOD_ENTRIES);
        const { chat, calls } = chatStub("Fix login auth flow");
        const res = await maybeAutoTitleSession({
            sessionFile: file,
            sessionName: () => undefined,
            entries: () => entries,
            chat,
            alreadyTitled: () => true,
        });
        expect(res.titled).toBe(false);
        expect(res.reason).toBe("already-attempted");
        expect(calls.length).toBe(0);
        expect(jsonlLines(file).length).toBe(3);
    });

    test("not enough material → not-enough-material, no chat call", async () => {
        const dir = makeTmp();
        const thin = [msgEntry("user", "hi", 1), msgEntry("assistant", "x", 2)];
        const { file, entries } = writeSessionFile(dir, thin);
        const { chat, calls } = chatStub("Fix login auth flow");
        const res = await maybeAutoTitleSession({
            sessionFile: file,
            sessionName: () => undefined,
            entries: () => entries,
            chat,
        });
        expect(res.titled).toBe(false);
        expect(res.reason).toBe("not-enough-material");
        expect(calls.length).toBe(0);
        expect(jsonlLines(file).length).toBe(3);
    });

    test("chat failure → no-valid-title, file untouched", async () => {
        const dir = makeTmp();
        const { file, entries } = writeSessionFile(dir, GOOD_ENTRIES);
        const { chat, calls } = chatStub(new Error("timeout"));
        const res = await maybeAutoTitleSession({
            sessionFile: file,
            sessionName: () => undefined,
            entries: () => entries,
            chat,
        });
        expect(res.titled).toBe(false);
        expect(res.reason).toBe("no-valid-title");
        expect(calls.length).toBe(1);
        expect(jsonlLines(file).length).toBe(3);
    });

    test("corrupt session file → write-failed (SessionManager.open throws, swallowed)", async () => {
        const dir = makeTmp();
        const file = join(dir, "corrupt.jsonl");
        writeFileSync(file, "this is not jsonl\n", "utf8");
        const res = await maybeAutoTitleSession({
            sessionFile: file,
            sessionName: () => undefined,
            entries: () => GOOD_ENTRIES,
            chat: chatStub("Fix login auth flow").chat,
        });
        expect(res.titled).toBe(false);
        expect(res.reason).toBe("write-failed");
    });

    test("success: appends a session_info entry the picker's reverse-walk finds", async () => {
        const dir = makeTmp();
        const { file, entries } = writeSessionFile(dir, GOOD_ENTRIES);
        const before = jsonlLines(file);
        const res = await maybeAutoTitleSession({
            sessionFile: file,
            sessionName: () => undefined,
            entries: () => entries,
            chat: chatStub("Fix login auth flow").chat,
        });
        expect(res.titled).toBe(true);
        expect(res.title).toBe("Fix login auth flow");
        expect(res.reason).toBe("titled");

        // Append-only: the original three lines are byte-identical, one line added.
        const after = jsonlLines(file);
        expect(after.length).toBe(before.length + 1);
        expect(after.slice(0, before.length)).toEqual(before);

        // Reverse-walk (mirrors getSessionName): LAST session_info entry carries the title.
        expect(latestSessionInfoName(file)).toBe("Fix login auth flow");

        // And the real reader agrees — the entry is a well-formed pi session_info.
        expect(existsSync(file)).toBe(true);
        expect(SessionManager.open(file).getSessionName()).toBe("Fix login auth flow");
    });

    test("race: sessionName() set on the second check → no write, chat still called", async () => {
        const dir = makeTmp();
        const { file, entries } = writeSessionFile(dir, GOOD_ENTRIES);
        let nameCalls = 0;
        const sessionName = (): string | undefined => {
            nameCalls++;
            return nameCalls >= 2 ? "user named it mid-flight" : undefined;
        };
        const { chat, calls } = chatStub("Fix login auth flow");
        const res = await maybeAutoTitleSession({
            sessionFile: file,
            sessionName,
            entries: () => entries,
            chat,
        });
        expect(res.titled).toBe(false);
        expect(res.reason).toBe("named-during-generation");
        expect(calls.length).toBe(1); // the LLM call happened…
        expect(jsonlLines(file).length).toBe(3); // …but nothing was written
    });
});

// ---------------------------------------------------------------------------
// titleAttemptKey
// ---------------------------------------------------------------------------

describe("titleAttemptKey", () => {
    test("stable, prefixed, distinct per session id", () => {
        expect(titleAttemptKey("abc")).toBe(titleAttemptKey("abc"));
        expect(titleAttemptKey("abc")).toBe("unown:auto-title:abc");
        expect(titleAttemptKey("abc")).not.toBe(titleAttemptKey("abd"));
    });
});
