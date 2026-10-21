// acp.test.ts — the ACP adapter (src/acp.ts) contract.
//
// Two layers, mirroring the repo's testing strategy:
//   1. Unit tests over the PURE protocol translations (event folding, content
//      mapping, stop reasons, permission option mapping, session-file lookup)
//      — no stdio, no runtime.
//   2. One hermetic integration test: the REAL `bin/unown acp` spawned as a
//      subprocess against the local mock bridge (the golden-harness pattern:
//      private UNOWN_HOME, dead engine URL, sanitized env, /dev/null-adjacent
//      stdin control). Speaks JSON-RPC over stdio like an editor would.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
        acpPermissionOptionsFromDialogOptions,
        acpSessionUpdatesFromPiEvent,
        acpUpdatesFromSessionEntries,
        createAcpTranslationState,
        dialogOptionFromPermissionResponse,
        findUnownSessionFile,
        isPathOutsideProject,
        piInputFromAcpPrompt,
        stopReasonFromPi,
        textFromUserContent,
        toolCallContentFromResult,
        toolCallLocations,
        toolCallTitle,
        toolKindFromName,
} from "../src/acp.ts";

// ---------------------------------------------------------------------------
// 1. Prompt content mapping
// ---------------------------------------------------------------------------
describe("acp — textFromUserContent", () => {
        test("string passthrough; non-array garbage is empty", () => {
                expect(textFromUserContent("hello")).toBe("hello");
                expect(textFromUserContent(42)).toBe("");
                expect(textFromUserContent(null)).toBe("");
        });
        test("joins text blocks, ignores non-text blocks", () => {
                expect(
                        textFromUserContent([
                                { type: "text", text: "a" },
                                { type: "image", data: "zzz" },
                                { type: "text", text: "b" },
                        ]),
                ).toBe("a\nb");
        });
});

describe("acp — piInputFromAcpPrompt", () => {
        test("text blocks join with newlines", () => {
                const out = piInputFromAcpPrompt([
                        { type: "text", text: "fix" },
                        { type: "text", text: "the tests" },
                ]);
                expect(out.text).toBe("fix\nthe tests");
                expect(out.images).toEqual([]);
        });
        test("resource with inline text wins over uri; without text becomes a See line", () => {
                expect(piInputFromAcpPrompt([{ type: "resource", resource: { uri: "file:///x", text: "body" } }]).text).toBe("body");
                expect(piInputFromAcpPrompt([{ type: "resource", resource: { uri: "file:///x" } }]).text).toBe("See file:///x");
        });
        test("resource_link renders label + uri", () => {
                const out = piInputFromAcpPrompt([{ type: "resource_link", uri: "file:///a/b.ts", name: "b.ts" }]);
                expect(out.text).toBe("See b.ts (file:///a/b.ts)");
        });
        test("image blocks become pi image attachments", () => {
                const out = piInputFromAcpPrompt([{ type: "image", data: "QUJD", mimeType: "image/png" }]);
                expect(out.images).toEqual([{ type: "image", data: "QUJD", mimeType: "image/png" }]);
                expect(out.text).toBe("");
        });
        test("unsupported block types throw (the adapter must not silently drop content)", () => {
                expect(() => piInputFromAcpPrompt([{ type: "audio", data: "zz" }])).toThrow(/unsupported/);
                expect(() => piInputFromAcpPrompt(["nope"])).toThrow(/unsupported/);
        });
});

// ---------------------------------------------------------------------------
// 2. Stop reasons + tool mapping
// ---------------------------------------------------------------------------
describe("acp — stopReasonFromPi (v1 enum)", () => {
        test("pi stop reasons map to ACP v1 StopReasons", () => {
                expect(stopReasonFromPi("stop")).toBe("end_turn");
                expect(stopReasonFromPi("length")).toBe("max_tokens");
                expect(stopReasonFromPi("aborted")).toBe("cancelled");
                expect(stopReasonFromPi("error")).toBe("refusal");
                expect(stopReasonFromPi("toolUse")).toBe("end_turn");
                expect(stopReasonFromPi(undefined)).toBe("end_turn");
        });
        test("client cancellation overrides everything", () => {
                expect(stopReasonFromPi("stop", true)).toBe("cancelled");
                expect(stopReasonFromPi("error", true)).toBe("cancelled");
        });
});

describe("acp — toolKindFromName / toolCallTitle / toolCallLocations", () => {
        test("kind mapping for the editors' UI treatment", () => {
                expect(toolKindFromName("read")).toBe("read");
                expect(toolKindFromName("edit")).toBe("edit");
                expect(toolKindFromName("write")).toBe("edit");
                expect(toolKindFromName("grep")).toBe("search");
                expect(toolKindFromName("bash")).toBe("execute");
                expect(toolKindFromName("webfetch")).toBe("fetch");
                expect(toolKindFromName("todo")).toBe("think");
                expect(toolKindFromName("mcp__custom")).toBe("other");
        });
        test("title previews the salient argument and truncates", () => {
                expect(toolCallTitle("read", { path: "src/acp.ts" })).toBe("read(src/acp.ts)");
                expect(toolCallTitle("bash", { command: "git   status" })).toBe("bash(git status)");
                const long = "x".repeat(80);
                expect(toolCallTitle("bash", { command: long })).toHaveLength("bash(".length + 57 + "...".length + 1);
                expect(toolCallTitle("todo", {})).toBe("todo");
        });
        test("locations only for file tools; relative paths resolve against cwd", () => {
                // resolve() on BOTH sides: the impl resolves; on POSIX
                // join(cwd, p) === resolve(cwd, p) but on win32 resolve adds
                // the drive while join does not — the expectations must be
                // computed with the impl's own semantics.
                const cwd = "/tmp/proj";
                expect(toolCallLocations("read", { path: "/abs/a.ts" }, cwd)).toEqual([{ path: "/abs/a.ts" }]);
                expect(toolCallLocations("edit", { path: "src/a.ts" }, cwd)).toEqual([{ path: resolve(cwd, "src/a.ts") }]);
                expect(toolCallLocations("bash", { command: "ls" }, cwd)).toEqual([]);
                expect(toolCallLocations("read", {}, cwd)).toEqual([]);
        });
});

describe("acp — toolCallContentFromResult", () => {
        test("text and image blocks map; non-array results are empty", () => {
                expect(toolCallContentFromResult({ content: [{ type: "text", text: "ok" }] })).toEqual([
                        { type: "content", content: { type: "text", text: "ok" } },
                ]);
                expect(toolCallContentFromResult({ content: [{ type: "image", data: "QUJD" }] })).toEqual([
                        { type: "content", content: { type: "image", data: "QUJD", mimeType: "image/png" } },
                ]);
                expect(toolCallContentFromResult(undefined)).toEqual([]);
                expect(toolCallContentFromResult({ content: "nope" })).toEqual([]);
        });
});

// ---------------------------------------------------------------------------
// 3. Event folding (pi AgentSessionEvent -> ACP session/update)
// ---------------------------------------------------------------------------
describe("acp — acpSessionUpdatesFromPiEvent", () => {
        test("assistant text/thinking deltas stream as chunks; the message id is stable per message", () => {
                const st = createAcpTranslationState("/tmp");
                const a = acpSessionUpdatesFromPiEvent({ type: "message_start", message: { role: "assistant" } }, st);
                expect(a).toEqual([]);
                const b = acpSessionUpdatesFromPiEvent(
                        { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "Hi" } },
                        st,
                );
                expect(b).toEqual([{ sessionUpdate: "agent_message_chunk", messageId: "msg-1", content: { type: "text", text: "Hi" } }]);
                const c = acpSessionUpdatesFromPiEvent(
                        { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } },
                        st,
                );
                expect(c).toEqual([{ sessionUpdate: "agent_thought_chunk", messageId: "msg-1", content: { type: "text", text: "hmm" } }]);
        });
        test("message_end(user) -> user_message_chunk; non-user/assistant events are ignored", () => {
                const st = createAcpTranslationState("/tmp");
                const u = acpSessionUpdatesFromPiEvent({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "go" }] } }, st);
                expect(u).toEqual([{ sessionUpdate: "user_message_chunk", messageId: "msg-1", content: { type: "text", text: "go" } }]);
                expect(acpSessionUpdatesFromPiEvent({ type: "message_end", message: { role: "toolResult" } }, st)).toEqual([]);
                expect(acpSessionUpdatesFromPiEvent({ type: "unrelated_event" }, st)).toEqual([]);
                expect(acpSessionUpdatesFromPiEvent(null, st)).toEqual([]);
        });
        test("a streamed assistant message is not re-emitted at message_end (no double chunks)", () => {
                const st = createAcpTranslationState("/tmp");
                acpSessionUpdatesFromPiEvent({ type: "message_start", message: { role: "assistant" } }, st);
                acpSessionUpdatesFromPiEvent(
                        { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "x" } },
                        st,
                );
                const end = acpSessionUpdatesFromPiEvent(
                        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "x" }] } },
                        st,
                );
                expect(end).toEqual([]);
        });
        test("a NON-streamed assistant message emits its content at message_end", () => {
                const st = createAcpTranslationState("/tmp");
                const end = acpSessionUpdatesFromPiEvent(
                        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "whole" }] } },
                        st,
                );
                expect(end).toEqual([{ sessionUpdate: "agent_message_chunk", messageId: "msg-1", content: { type: "text", text: "whole" } }]);
        });
        test("tool calls announce once (dedupe), then execution lifecycle updates status", () => {
                const st = createAcpTranslationState("/tmp");
                const announce = acpSessionUpdatesFromPiEvent(
                        { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "call-1", name: "read", arguments: { path: "a.ts" } } } },
                        st,
                );
                expect(announce).toEqual([
                        {
                                sessionUpdate: "tool_call",
                                toolCallId: "call-1",
                                title: "read(a.ts)",
                                kind: "read",
                                status: "pending",
                                locations: [{ path: resolve("/tmp", "a.ts") }],
                        },
                ]);
                // same id again: no re-announce
                expect(
                        acpSessionUpdatesFromPiEvent(
                                { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "call-1", name: "read" } } },
                                st,
                        ),
                ).toEqual([]);
                const start = acpSessionUpdatesFromPiEvent({ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: {} }, st);
                expect(start.some((u) => u.sessionUpdate === "tool_call_update" && u.status === "in_progress")).toBe(true);
                const ok = acpSessionUpdatesFromPiEvent(
                        { type: "tool_execution_end", toolCallId: "call-1", result: { content: [{ type: "text", text: "contents" }] }, isError: false },
                        st,
                );
                expect(ok).toEqual([
                        {
                                sessionUpdate: "tool_call_update",
                                toolCallId: "call-1",
                                status: "completed",
                                content: [{ type: "content", content: { type: "text", text: "contents" } }],
                        },
                ]);
                const fail = acpSessionUpdatesFromPiEvent({ type: "tool_execution_end", toolCallId: "call-1", isError: true }, st);
                expect(fail[0].status).toBe("failed");
        });
});

describe("acp — acpUpdatesFromSessionEntries (session/load replay)", () => {
        test("replays users, assistant text and tool calls with matched results", () => {
                const updates = acpUpdatesFromSessionEntries([
                        { id: "e1", message: { role: "user", content: [{ type: "text", text: "list files" }] } },
                        { id: "e2", message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }] } },
                        { id: "e3", message: { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "a b" }], isError: false } },
                        { id: "e4", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
                ]);
                const kinds = updates.map((u) => u.sessionUpdate);
                expect(kinds).toEqual(["user_message_chunk", "tool_call", "agent_message_chunk"]);
                expect(updates[1].status).toBe("completed"); // matched toolResult
                expect(updates[1].content).toEqual([{ type: "content", content: { type: "text", text: "a b" } }]);
        });
        test("a tool call whose result never arrived stays pending; entries without messages are skipped", () => {
                const updates = acpUpdatesFromSessionEntries([
                        { id: "e1", message: { role: "assistant", content: [{ type: "toolCall", id: "c9", name: "read" }] } },
                        { id: "e2" },
                ]);
                expect(updates[0].status).toBe("pending");
        });
});

// ---------------------------------------------------------------------------
// 4. Permission mapping (the ask flow <-> session/request_permission)
// ---------------------------------------------------------------------------
describe("acp — permission option mapping", () => {
        test("the gate's exact option strings map to ACP kinds", () => {
                const opts = acpPermissionOptionsFromDialogOptions(["Allow once", "Always allow (this session)", "Deny"]);
                expect(opts).toEqual([
                        { optionId: "opt_0", name: "Allow once", kind: "allow_once" },
                        { optionId: "opt_1", name: "Always allow (this session)", kind: "allow_always" },
                        { optionId: "opt_2", name: "Deny", kind: "reject_once" },
                ]);
        });
        test("unknown dialog options degrade by keyword (any extension's select can be mediated)", () => {
                const opts = acpPermissionOptionsFromDialogOptions(["Yes, do it always", "Cancel that"]);
                expect(opts[0].kind).toBe("allow_always");
                expect(opts[1].kind).toBe("reject_once");
                expect(acpPermissionOptionsFromDialogOptions(["whatever"])[0].kind).toBe("allow_once");
        });
        test("responses map back to the original option strings; junk stays undefined (deny fail-closed)", () => {
                const options = ["Allow once", "Deny"];
                const acpOptions = acpPermissionOptionsFromDialogOptions(options);
                expect(dialogOptionFromPermissionResponse(options, acpOptions, { outcome: "selected", optionId: "opt_0" })).toBe("Allow once");
                expect(dialogOptionFromPermissionResponse(options, acpOptions, { outcome: "selected", optionId: "opt_1" })).toBe("Deny");
                expect(dialogOptionFromPermissionResponse(options, acpOptions, { outcome: "selected", optionId: "opt_99" })).toBeUndefined();
                expect(dialogOptionFromPermissionResponse(options, acpOptions, { outcome: "cancelled" })).toBeUndefined();
                expect(dialogOptionFromPermissionResponse(options, acpOptions, undefined)).toBeUndefined();
        });
});

// ---------------------------------------------------------------------------
// 5. Session file lookup (session/load)
// ---------------------------------------------------------------------------
describe("acp — findUnownSessionFile", () => {
        test("matches timestamped suffix names, newest first; rejects traversal and unknown", () => {
                const dir = mkdtempSync(join(tmpdir(), "unown-acp-sessions-"));
                try {
                        mkdirSync(dir, { recursive: true });
                        writeFileSync(join(dir, "2026-10-19T10-00-00-000Z_deadbeef.jsonl"), "{}");
                        writeFileSync(join(dir, "2026-10-19T11-00-00-000Z_cafebabe.jsonl"), "{}");
                        writeFileSync(join(dir, "2026-10-19T09-00-00-000Z_cafebabe.jsonl"), "{}");
                        expect(findUnownSessionFile(dir, "cafebabe")).toContain("11-00-00");
                        expect(findUnownSessionFile(dir, "deadbeef")).toContain("10-00-00");
                        expect(findUnownSessionFile(dir, "nope")).toBeNull();
                        expect(findUnownSessionFile(dir, "../etc/passwd")).toBeNull();
                        expect(findUnownSessionFile(join(dir, "missing"), "cafebabe")).toBeNull();
                } finally {
                        rmSync(dir, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// 6. Project boundary (the mediated-read boundary)
// ---------------------------------------------------------------------------
describe("acp — isPathOutsideProject", () => {
        test("inside is false; siblings and parents are outside; cwd itself counts as outside", () => {
                expect(isPathOutsideProject("/tmp/proj", "/tmp/proj/src/a.ts")).toBe(false);
                expect(isPathOutsideProject("/tmp/proj", "/tmp/proj/../proj2/a.ts")).toBe(true);
                expect(isPathOutsideProject("/tmp/proj", "/etc/passwd")).toBe(true);
                expect(isPathOutsideProject("/tmp/proj", "/tmp/proj")).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// 7. Integration: the real `unown acp` server over stdio, mock bridge
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { startMockBridge, type MockBridge } from "./cli/helpers.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url)); // NOT .pathname — on win32 that yields "/D:/…" and every spawn dies with ENOENT
const UNOWN_BIN = join(REPO_ROOT, "bin", "unown");
const LONG = { timeout: 150_000 } as const;

interface Wire {
        send(obj: unknown): void;
        request(method: string, params: unknown, timeoutMs?: number): Promise<any>;
        notifications: Array<{ method: string; params: any }>;
        agentRequests: Array<{ id: string | number; method: string; params: any }>;
        exit(): Promise<number>;
        kill(): void;
}

function startAcp(bridge: MockBridge, root: string): Wire {
        const unownHome = join(root, "home");
        const projDir = join(root, "proj");
        mkdirSync(unownHome, { recursive: true });
        mkdirSync(projDir, { recursive: true });
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
                if (v === undefined) continue;
                if (/^(UNOWN_|PI_|BRIDGE_)/.test(k)) continue;
                env[k] = v;
        }
        env.UNOWN_HOME = unownHome;
        env.UNOWN_ENGINE_URL = "http://127.0.0.1:9"; // dead engine: notes queue locally
        env.PI_BRIDGE_URL = bridge.url;
        env.PI_SELFLEARNING_DB = join(root, "db", "selflearning.db");
        env.PI_SELFLEARNING_DATA = join(root, "data");
        // The sanitization above strips PI_DISABLE_ENGINE_SPAWN (set by
        // test/_env.ts for THIS process) — without re-arming it, the spawned
        // CLI's M6 auto-start latch fires `unown engine serve` DETACHED when
        // the ACP session touches the engine lane, and that child survives
        // the test process holding :3030 with this temp dir's token. The CI
        // full-stack smoke later reuses the ghost as "already healthy"
        // (probeHttpOk counts 401 as present) and then fails to authenticate
        // against it — "engine did not survive the launcher exit" (all 3 OSes,
        // b754c7a). No subprocess of a test may ever auto-start an engine.
        env.PI_DISABLE_ENGINE_SPAWN = "1";
        // Windows: bin/unown is a bun shebang script (spawn of a POSIX script
        // dies with ENOENT), and Node's CVE-2024-27980 fix rejects args with
        // cmd.exe metacharacters for .bat/.cmd shims — route through bun,
        // the same pattern as test/cli/helpers.ts runUnown.
        const useBun = process.platform === "win32";
        const child = useBun
                ? spawn("bun", [UNOWN_BIN, "acp"], { cwd: projDir, env, stdio: ["pipe", "pipe", "pipe"] })
                : spawn(UNOWN_BIN, ["acp"], { cwd: projDir, env, stdio: ["pipe", "pipe", "pipe"] });

        const pending = new Map<string | number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
        const notifications: Array<{ method: string; params: any }> = [];
        const agentRequests: Array<{ id: string | number; method: string; params: any }> = [];
        let buf = "";
        child.stdout.on("data", (chunk: Buffer) => {
                buf += chunk.toString("utf8");
                let idx: number;
                while ((idx = buf.indexOf("\n")) !== -1) {
                        const line = buf.slice(0, idx).trim();
                        buf = buf.slice(idx + 1);
                        if (!line) continue;
                        let msg: any;
                        try {
                                msg = JSON.parse(line);
                        } catch {
                                continue; // garbage tolerance is the server's job; client ignores too
                        }
                        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
                                const p = pending.get(msg.id);
                                pending.delete(msg.id);
                                p?.resolve(msg);
                        } else if (msg.method && msg.id !== undefined) {
                                agentRequests.push(msg);
                        } else if (msg.method) {
                                notifications.push(msg);
                        }
                }
        });
        const stderrTail: string[] = [];
        child.stderr.on("data", (c: Buffer) => stderrTail.push(c.toString("utf8")));

        const wire: Wire = {
                send(obj) {
                        child.stdin.write(`${JSON.stringify(obj)}\n`);
                },
                request(method, params, timeoutMs = 60_000) {
                        const id = `t-${pending.size + 1}-${Math.random().toString(36).slice(2, 8)}`;
                        return new Promise((resolve, reject) => {
                                const timer = setTimeout(() => {
                                        pending.delete(id);
                                        reject(new Error(`timeout awaiting ${method}; stderr: ${stderrTail.join("").slice(-400)}`));
                                }, timeoutMs);
                                pending.set(id, {
                                        resolve: (v) => {
                                                clearTimeout(timer);
                                                resolve(v);
                                        },
                                        reject,
                                });
                                child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
                        });
                },
                notifications,
                agentRequests,
                exit() {
                        child.stdin.end();
                        return new Promise((resolve) => child.on("close", (c) => resolve(c ?? -1)));
                },
                kill() {
                        child.kill("SIGKILL");
                },
        };
        return wire;
}

describe("acp — integration (real CLI, mock bridge)", () => {
        test(
                "initialize -> session/new -> session/prompt -> updates stream -> unknown method errors -> EOF exits 0",
                async () => {
                        const bridge: MockBridge = startMockBridge();
                        const root = mkdtempSync(join(tmpdir(), "unown-acp-e2e-"));
                        const wire = startAcp(bridge, root);
                        try {
                                // garbage line first: the server must tolerate and keep serving
                                wire.send("this is not json");

                                const init = await wire.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
                                expect(init.error).toBeUndefined();
                                expect(init.result.protocolVersion).toBe(1);
                                expect(init.result.agentInfo).toMatchObject({ name: "unown" });
                                expect(typeof init.result.agentInfo.version).toBe("string");

                                const ns = await wire.request("session/new", { cwd: join(root, "proj"), mcpServers: [] });
                                expect(ns.error).toBeUndefined();
                                expect(typeof ns.result.sessionId).toBe("string");
                                expect(ns.result.sessionId.length).toBeGreaterThan(0);

                                const prompt = await wire.request(
                                        "session/prompt",
                                        { sessionId: ns.result.sessionId, prompt: [{ type: "text", text: "say hi" }] },
                                        120_000,
                                );
                                expect(prompt.error).toBeUndefined();
                                expect(prompt.result.stopReason).toBe("end_turn");

                                // streaming happened: at least the user echo + assistant chunks
                                const updates = wire.notifications.filter((n) => n.method === "session/update");
                                const kinds = updates.map((u) => u.params?.update?.sessionUpdate);
                                expect(kinds).toContain("user_message_chunk");
                                expect(kinds).toContain("agent_message_chunk");
                                const text = updates
                                        .filter((u) => u.params?.update?.sessionUpdate === "agent_message_chunk")
                                        .map((u) => u.params.update.content?.text ?? "")
                                        .join("");
                                expect(text).toContain("Mock reply: done");

                                // the prompt reached the model through the full unown boot
                                const lastReq = bridge.requests[bridge.requests.length - 1];
                                expect(lastReq).toBeDefined();
                                expect(lastReq.userTexts.join("\n")).toContain("say hi");

                                // JSON-RPC discipline: unknown method -> -32601 with the id echoed
                                const bad = await wire.request("bogus/method", {});
                                expect(bad.error).toBeDefined();
                                expect(bad.error.code).toBe(-32601);

                                const code = await wire.exit();
                                expect(code).toBe(0);
                        } finally {
                                wire.kill();
                                bridge.close();
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                LONG,
        );
});
