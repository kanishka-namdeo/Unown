/**
 * acp.ts — the Agent Client Protocol (ACP) adapter for `unown acp`.
 *
 * ACP (agentclientprotocol.com, protocol v1) is the editor-integration
 * protocol Zed speaks: JSON-RPC 2.0 over stdio, newline-delimited (one JSON
 * object per line, LF-only framing — no Content-Length headers), where the
 * EDITOR is the client and `unown acp` is the agent/server. This module is
 * the goose-port: it lets any ACP-capable editor drive the full unown agent
 * (memory, hooks, permissions, tools — the exact bootRuntime cli.ts uses)
 * instead of a stripped-down headless mode.
 *
 * Protocol scope implemented here (documented in docs/acp.md):
 *
 *   Editor -> agent (server methods):
 *     initialize                      version + capability negotiation
 *     newSession | session/new        create a session (both v1 and the
 *                                     pre-v1 draft name accepted; v1's
 *                                     snake_case is what current Zed sends)
 *     session/prompt                  send a prompt, get a StopReason
 *     session/cancel                  abort the in-flight prompt
 *     session/load                    resume a persisted unown session
 *     session/setMode | session/set_mode    accepted, no modes advertised
 *     session/setPermission | session/set_permission    draft-compat store
 *
 *   Agent -> editor (client methods / notifications):
 *     session/update                  streamed chunks, tool calls, thoughts
 *     session/request_permission      the permissions layer's `ask` flow
 *     fs/read_text_file               out-of-project reads when the client
 *                                     advertises the capability (mediated:
 *                                     the editor gets to authorize reads the
 *                                     plain terminal agent would do locally)
 *
 * Architecture, on documented seams only (the standing invariant):
 *   - mirrors pi's own rpc-mode discipline: stdout is taken over at start so
 *     nothing but protocol lines reaches it (console.log degrades to stderr),
 *     an LF-only line reader feeds stdin, stdin EOF disposes every runtime
 *     and exits 0, SIGTERM/SIGHUP clean up tracked children.
 *   - every session boots through the injected `boot` function — cli.ts's
 *     bootRuntime — so memory injection, terminal hooks, the permission gate
 *     and the unown tools are byte-identical to a terminal session.
 *   - the permission gate's `ask` flow rides the standard extension UI seam:
 *     sessions are bound with mode "rpc" + a uiContext whose select() maps to
 *     session/request_permission. Timeouts / editor errors degrade DENY
 *     (fail-closed — the documented headless policy in docs/permissions.md).
 *   - the read tool is re-registered through the extension tool seam (a
 *     registered tool with a built-in's name wins in the tool registry) with
 *     ReadOperations that mediate out-of-project reads through the editor.
 *     fs/write_text_file is deliberately NOT advertised: unown's write-path
 *     jail intentionally forbids out-of-project writes and an editor callback
 *     must not be able to override a hard guardrail.
 *
 * Purity: the protocol translations (event folding, content mapping, stop
 * reasons, permission option mapping) are exported pure functions pinned by
 * test/acp.test.ts; only the server loop touches stdio/process.
 */
import { promises as fsp } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
        createReadToolDefinition,
        detectSupportedImageMimeTypeFromFile,
        type ExtensionAPI,
        SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createPermissionGate, type PermissionGate } from "./permissions.ts";
import { STRICT_HOOKS, UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Protocol constants & wire types
// ---------------------------------------------------------------------------

/** ACP major protocol version this adapter speaks (v1, agentclientprotocol.com). */
export const ACP_PROTOCOL_VERSION = 1;

/** The `unown help acp` / `unown acp --help` page. */
export const ACP_HELP = `unown acp — run the ACP editor server on stdio

The Agent Client Protocol (ACP, agentclientprotocol.com) is the open protocol
editors speak to coding agents: JSON-RPC 2.0 over stdio, one JSON object per
LF-terminated line (no Content-Length headers). This command turns unown into
an ACP agent server — every session boots the full agent (tiered memory,
guardrail hooks, granular permissions, session tools), same as the terminal.

usage: unown acp [--verbose]
  --verbose, -v   protocol + session logging on stderr (stdout stays pure)

Point Zed (or any ACP client) at it:
  agent program: unown
  arguments:     acp

Protocol scope (docs/acp.md has the full contract):
  initialize, session/new (and the pre-v1 newSession alias), session/prompt,
  session/cancel, session/load (resume a persisted unown session),
  session/set_mode (accepted; no modes advertised), session/update streaming
  (message/thought chunks, tool calls), session/request_permission (the
  granular-permissions ask flow; timeouts deny fail-closed), and
  fs/read_text_file for absolute paths OUTSIDE the session cwd when the client
  advertises it. Editor-provided mcpServers are not wired (unown reads its own
  .unown/mcp.json); fs/write_text_file is deliberately not advertised (the
  write-path jail is a hard guardrail an editor must not override).

stdin EOF exits 0; SIGTERM/SIGHUP clean up tracked children first.`;

/** JSON-RPC 2.0 error codes used by this server. */
export const JSONRPC_ERRORS = {
        parseError: -32700,
        invalidRequest: -32600,
        methodNotFound: -32601,
        invalidParams: -32602,
        internalError: -32603,
        serverNotInitialized: -32002,
} as const;

/** ACP StopReason (v1 schema): end_turn | max_tokens | max_turn_requests | refusal | cancelled. */
export type AcpStopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

/** ACP ToolKind (v1 schema). */
export type AcpToolKind =
        | "read"
        | "edit"
        | "delete"
        | "move"
        | "search"
        | "execute"
        | "think"
        | "fetch"
        | "switch_mode"
        | "other";

/** ACP ContentBlock — the subset this adapter emits and accepts. */
export type AcpContentBlock =
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
        | { type: "resource_link"; uri: string; name?: string; title?: string }
        | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };

/** One session/update payload (loosely typed — the union is open in v1). */
export interface AcpSessionUpdate {
        sessionUpdate: string;
        [key: string]: unknown;
}

/** One ACP permission option presented to the user. */
export interface AcpPermissionOption {
        optionId: string;
        name: string;
        kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

/** Default timeout for fs callbacks (the editor stalled -> fail the tool call). */
export const ACP_FS_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Pure translations (unit-tested — no stdio, no process)
// ---------------------------------------------------------------------------

/** Flatten a pi user-message content (string | blocks) to plain text. */
export function textFromUserContent(content: unknown): string {
        if (typeof content === "string") return content;
        if (!Array.isArray(content)) return "";
        const parts: string[] = [];
        for (const block of content) {
                const b = block as { type?: string; text?: string };
                if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
        }
        return parts.join("\n");
}

/**
 * Convert an ACP `session/prompt` ContentBlock list into pi prompt input.
 * Text and resource blocks join the prompt text; image blocks become pi
 * image attachments; resource links become a "see <uri>" line the model can
 * act on (unown reads files itself, so a link is enough).
 * Throws Error on unsupported blocks (audio without the capability, etc.).
 */
export function piInputFromAcpPrompt(prompt: unknown): { text: string; images: Array<{ type: "image"; data: string; mimeType: string }> } {
        const blocks = Array.isArray(prompt) ? prompt : [];
        const textParts: string[] = [];
        const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
        for (const raw of blocks) {
                const b = raw as Record<string, any>;
                if (!b || typeof b !== "object" || typeof b.type !== "string") {
                        throw new Error(`unsupported prompt block: ${JSON.stringify(raw)?.slice(0, 120)}`);
                }
                switch (b.type) {
                        case "text":
                                if (typeof b.text === "string" && b.text) textParts.push(b.text);
                                break;
                        case "resource": {
                                const r = b.resource as { uri?: string; text?: string } | undefined;
                                const body = r && typeof r.text === "string" ? r.text : "";
                                const uri = r && typeof r.uri === "string" ? r.uri : "";
                                textParts.push(body || (uri ? `See ${uri}` : ""));
                                break;
                        }
                        case "resource_link": {
                                const uri = typeof b.uri === "string" ? b.uri : "";
                                const label = typeof b.name === "string" ? b.name : typeof b.title === "string" ? b.title : uri;
                                if (uri) textParts.push(`See ${label}${label !== uri ? ` (${uri})` : ""}`);
                                break;
                        }
                        case "image":
                                if (typeof b.data === "string" && typeof b.mimeType === "string") {
                                        images.push({ type: "image", data: b.data, mimeType: b.mimeType });
                                }
                                break;
                        default:
                                throw new Error(`unsupported prompt content block type: ${b.type}`);
                }
        }
        return { text: textParts.filter(Boolean).join("\n"), images };
}

/**
 * Map a pi StopReason to the ACP StopReason (v1 enum — the pre-v1 draft and
 * the task brief named these differently; v1 is what current clients parse):
 *
 *   pi "stop"     -> end_turn          (model finished without tool calls)
 *   pi "length"   -> max_tokens
 *   pi "aborted"  -> cancelled         (session/cancel drives pi's abort)
 *   pi "error"    -> refusal           (agent stopped; closest v1 reason)
 *   toolUse/deferred/pending/unknown   -> end_turn (turn completed normally)
 */
export function stopReasonFromPi(piStopReason: unknown, cancelledByClient = false): AcpStopReason {
        if (cancelledByClient) return "cancelled";
        switch (piStopReason) {
                case "length":
                        return "max_tokens";
                case "aborted":
                        return "cancelled";
                case "error":
                        return "refusal";
                default:
                        return "end_turn";
        }
}

/** Map a pi tool name to the ACP ToolKind (icons/UI treatment in the editor). */
export function toolKindFromName(toolName: string): AcpToolKind {
        const name = String(toolName ?? "").toLowerCase();
        if (name === "read") return "read";
        if (name === "edit" || name === "write") return "edit";
        if (name === "grep" || name === "find" || name === "ls" || name === "search") return "search";
        if (name === "bash" || name === "powershell") return "execute";
        if (name === "webfetch" || name === "fetch_url" || name === "web_search") return "fetch";
        if (name === "todo" || name === "think") return "think";
        return "other";
}

/** Short human title for a tool call, e.g. `read(src/acp.ts)` or `bash(git status)`. */
export function toolCallTitle(toolName: string, args: unknown): string {
        const a = (args ?? {}) as Record<string, unknown>;
        let preview = "";
        const p = a.path ?? a.file_path ?? a.command ?? a.pattern ?? a.query ?? a.url ?? a.prompt;
        if (typeof p === "string" && p) {
                preview = p.replace(/\s+/g, " ").trim();
                if (preview.length > 60) preview = `${preview.slice(0, 57)}...`;
        }
        return preview ? `${toolName}(${preview})` : String(toolName ?? "tool");
}

/** File locations for a tool call (Zed follow-along), when derivable from args. */
export function toolCallLocations(toolName: string, args: unknown, cwd: string): Array<{ path: string }> {
        const name = String(toolName ?? "").toLowerCase();
        if (name !== "read" && name !== "edit" && name !== "write") return [];
        const a = (args ?? {}) as Record<string, unknown>;
        const p = a.path ?? a.file_path;
        if (typeof p !== "string" || !p) return [];
        return [{ path: isAbsolute(p) ? p : resolve(cwd, p) }];
}

/** Map pi tool-result content blocks to ACP ToolCallContent entries. */
export function toolCallContentFromResult(result: unknown): Array<Record<string, unknown>> {
        const content = (result as { content?: unknown[] } | undefined)?.content;
        if (!Array.isArray(content)) return [];
        const out: Array<Record<string, unknown>> = [];
        for (const raw of content) {
                const b = raw as { type?: string; text?: string; data?: string; mimeType?: string };
                if (b?.type === "text" && typeof b.text === "string") {
                        out.push({ type: "content", content: { type: "text", text: b.text } });
                } else if (b?.type === "image" && typeof b.data === "string") {
                        out.push({ type: "content", content: { type: "image", data: b.data, mimeType: b.mimeType ?? "image/png" } });
                }
        }
        return out;
}

/** True when an absolute path escapes the session's project cwd (the write jail boundary). */
export function isPathOutsideProject(cwd: string, path: string): boolean {
        const rel = relative(resolve(cwd), resolve(path));
        return rel === "" || rel.startsWith("..") || isAbsolute(rel);
}

// ---------------------------------------------------------------------------
// Event folding: pi AgentSessionEvent -> ACP session/update payloads
// ---------------------------------------------------------------------------

/** Mutable state the event fold carries across one session's lifetime. */
export interface AcpTranslationState {
        cwd: string;
        /** Monotonic id source for ACP message ids. */
        seq: number;
        /** message id of the assistant message currently streaming, if any. */
        currentAssistantMessageId?: string;
        /** message ids that already streamed deltas (message_end must not re-emit). */
        streamedMessages: Set<string>;
        /** pi toolCallIds already announced as tool_call. */
        announcedToolCalls: Set<string>;
}

export function createAcpTranslationState(cwd: string): AcpTranslationState {
        return { cwd, seq: 0, streamedMessages: new Set(), announcedToolCalls: new Set() };
}

function nextMessageId(state: AcpTranslationState): string {
        state.seq += 1;
        return `msg-${state.seq}`;
}

function announceToolCall(state: AcpTranslationState, toolCall: { id?: string; name?: string; arguments?: unknown }): AcpSessionUpdate | null {
        const id = typeof toolCall?.id === "string" ? toolCall.id : "";
        if (!id || state.announcedToolCalls.has(id)) return null;
        state.announcedToolCalls.add(id);
        const name = typeof toolCall.name === "string" ? toolCall.name : "tool";
        return {
                sessionUpdate: "tool_call",
                toolCallId: id,
                title: toolCallTitle(name, toolCall.arguments),
                kind: toolKindFromName(name),
                status: "pending",
                locations: toolCallLocations(name, toolCall.arguments, state.cwd),
        };
}

/**
 * Fold ONE pi AgentSessionEvent into zero or more ACP session/update
 * payloads (pure apart from the state it mutates):
 *
 *   message_update(text_delta)      -> agent_message_chunk
 *   message_update(thinking_delta)  -> agent_thought_chunk
 *   message_update(toolcall_end)    -> tool_call (status pending)
 *   message_end(user)               -> user_message_chunk
 *   message_end(assistant)          -> chunks for non-streamed content
 *   tool_execution_start            -> tool_call_update (in_progress)
 *   tool_execution_update           -> tool_call_update (in_progress)
 *   tool_execution_end              -> tool_call_update (completed | failed)
 */
export function acpSessionUpdatesFromPiEvent(event: unknown, state: AcpTranslationState): AcpSessionUpdate[] {
        const e = event as Record<string, any>;
        if (!e || typeof e !== "object") return [];
        const updates: AcpSessionUpdate[] = [];

        switch (e.type) {
                case "message_start": {
                        if (e.message?.role === "assistant") state.currentAssistantMessageId = nextMessageId(state);
                        return updates;
                }

                case "message_update": {
                        if (e.message?.role !== "assistant") return updates;
                        const id = (state.currentAssistantMessageId ??= nextMessageId(state));
                        const ev = e.assistantMessageEvent as Record<string, any> | undefined;
                        if (!ev || typeof ev !== "object") return updates;
                        if (ev.type === "text_delta" && typeof ev.delta === "string") {
                                state.streamedMessages.add(id);
                                updates.push({ sessionUpdate: "agent_message_chunk", messageId: id, content: { type: "text", text: ev.delta } });
                        } else if (ev.type === "thinking_delta" && typeof ev.delta === "string") {
                                state.streamedMessages.add(id);
                                updates.push({ sessionUpdate: "agent_thought_chunk", messageId: id, content: { type: "text", text: ev.delta } });
                        } else if (ev.type === "toolcall_end" && ev.toolCall) {
                                const call = announceToolCall(state, ev.toolCall);
                                if (call) updates.push(call);
                        }
                        return updates;
                }

                case "message_end": {
                        const msg = e.message as Record<string, any> | undefined;
                        if (!msg) return updates;
                        if (msg.role === "user") {
                                updates.push({
                                        sessionUpdate: "user_message_chunk",
                                        messageId: nextMessageId(state),
                                        content: { type: "text", text: textFromUserContent(msg.content) },
                                });
                                return updates;
                        }
                        if (msg.role === "assistant") {
                                const id = state.currentAssistantMessageId ?? nextMessageId(state);
                                state.currentAssistantMessageId = undefined;
                                const streamed = state.streamedMessages.has(id);
                                const content = Array.isArray(msg.content) ? msg.content : [];
                                for (const raw of content) {
                                        const b = raw as Record<string, any>;
                                        if (b?.type === "text" && typeof b.text === "string" && !streamed) {
                                                updates.push({ sessionUpdate: "agent_message_chunk", messageId: id, content: { type: "text", text: b.text } });
                                        } else if (b?.type === "thinking" && typeof b.thinking === "string" && !streamed) {
                                                updates.push({ sessionUpdate: "agent_thought_chunk", messageId: id, content: { type: "text", text: b.thinking } });
                                        } else if (b?.type === "toolCall") {
                                                const call = announceToolCall(state, b);
                                                if (call) updates.push(call);
                                        }
                                }
                        }
                        return updates;
                }

                case "tool_execution_start": {
                        const call = announceToolCall(state, { id: e.toolCallId, name: e.toolName, arguments: e.args });
                        if (call) updates.push(call);
                        updates.push({ sessionUpdate: "tool_call_update", toolCallId: e.toolCallId, status: "in_progress" });
                        return updates;
                }

                case "tool_execution_update": {
                        updates.push({ sessionUpdate: "tool_call_update", toolCallId: e.toolCallId, status: "in_progress" });
                        return updates;
                }

                case "tool_execution_end": {
                        updates.push({
                                sessionUpdate: "tool_call_update",
                                toolCallId: e.toolCallId,
                                status: e.isError ? "failed" : "completed",
                                content: toolCallContentFromResult(e.result),
                        });
                        return updates;
                }

                default:
                        return updates;
        }
}

/**
 * Replay a persisted session's context entries as session/update payloads
 * (session/load MUST replay the conversation before responding).
 * Entry shape is read defensively: { id, message: { role, content, ... } }.
 */
export function acpUpdatesFromSessionEntries(entries: unknown[]): AcpSessionUpdate[] {
        const resultsByToolCallId = new Map<string, { content: unknown[]; isError: boolean }>();
        for (const raw of entries) {
                const m = (raw as { message?: Record<string, any> })?.message;
                if (m?.role === "toolResult" && typeof m.toolCallId === "string") {
                        resultsByToolCallId.set(m.toolCallId, { content: Array.isArray(m.content) ? m.content : [], isError: m.isError === true });
                }
        }
        const updates: AcpSessionUpdate[] = [];
        let seq = 0;
        const mid = () => `replay-${++seq}`;
        for (const raw of entries) {
                const entry = raw as { id?: string; message?: Record<string, any> };
                const msg = entry?.message;
                if (!msg) continue;
                if (msg.role === "user") {
                        updates.push({ sessionUpdate: "user_message_chunk", messageId: entry.id ?? mid(), content: { type: "text", text: textFromUserContent(msg.content) } });
                } else if (msg.role === "assistant") {
                        const id = entry.id ?? mid();
                        for (const block of Array.isArray(msg.content) ? msg.content : []) {
                                const b = block as Record<string, any>;
                                if (b?.type === "text" && typeof b.text === "string") {
                                        updates.push({ sessionUpdate: "agent_message_chunk", messageId: id, content: { type: "text", text: b.text } });
                                } else if (b?.type === "thinking" && typeof b.thinking === "string") {
                                        updates.push({ sessionUpdate: "agent_thought_chunk", messageId: id, content: { type: "text", text: b.thinking } });
                                } else if (b?.type === "toolCall" && typeof b.id === "string") {
                                        const result = resultsByToolCallId.get(b.id);
                                        updates.push({
                                                sessionUpdate: "tool_call",
                                                toolCallId: b.id,
                                                title: toolCallTitle(b.name, b.arguments),
                                                kind: toolKindFromName(b.name),
                                                status: result ? (result.isError ? "failed" : "completed") : "pending",
                                                locations: [],
                                                ...(result ? { content: toolCallContentFromResult({ content: result.content }) } : {}),
                                        });
                                }
                        }
                }
        }
        return updates;
}

// ---------------------------------------------------------------------------
// Permission option mapping (the gate's ask flow <-> ACP request_permission)
// ---------------------------------------------------------------------------

/**
 * Present the permission gate's dialog options as ACP PermissionOptions.
 * The gate asks with the exact strings "Allow once" / "Always allow (this
 * session)" / "Deny"; unknown options (other extensions' dialogs) degrade
 * to allow_once/reject_once by keyword so any select() can be mediated.
 */
export function acpPermissionOptionsFromDialogOptions(options: string[]): AcpPermissionOption[] {
        return options.map((name, i) => {
                const lower = name.toLowerCase();
                let kind: AcpPermissionOption["kind"];
                if (name === "Allow once") kind = "allow_once";
                else if (name === "Always allow (this session)") kind = "allow_always";
                else if (lower.includes("always") && (lower.includes("allow") || lower.includes("yes"))) kind = "allow_always";
                else if (lower.includes("deny") || lower.includes("reject") || lower.includes("cancel") || lower.includes("no")) kind = "reject_once";
                else kind = "allow_once";
                return { optionId: `opt_${i}`, name, kind };
        });
}

/** Map an ACP permission response back to the dialog option string it selected. */
export function dialogOptionFromPermissionResponse(
        options: string[],
        acpOptions: AcpPermissionOption[],
        outcome: { outcome?: string; optionId?: string } | undefined | null,
): string | undefined {
        if (!outcome || outcome.outcome !== "selected" || typeof outcome.optionId !== "string") return undefined;
        const idx = acpOptions.findIndex((o) => o.optionId === outcome.optionId);
        return idx >= 0 ? options[idx] : undefined;
}

// ---------------------------------------------------------------------------
// Stdout guard — mirrors coding-agent's output-guard.ts (not exported from
// the package root, so a local equivalent lives here): console.log degrades
// to stderr once taken over; protocol lines write through the ORIGINAL
// stdout write in a strictly ordered async tail.
// ---------------------------------------------------------------------------

interface StdoutGuard {
        rawWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
}

let stdoutGuard: StdoutGuard | undefined;
let protocolWriteTail: Promise<void> = Promise.resolve();

function writeProtocolChunk(text: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
                try {
                        const write = stdoutGuard ? stdoutGuard.rawWrite : (process.stdout.write.bind(process.stdout) as StdoutGuard["rawWrite"]);
                        write(text, (error) => (error ? reject(error) : resolve()));
                } catch (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                }
        });
}

function takeOverStdout(): void {
        if (stdoutGuard) return;
        const rawWrite = process.stdout.write.bind(process.stdout) as StdoutGuard["rawWrite"];
        const rawStderrWrite = process.stderr.write.bind(process.stderr) as StdoutGuard["rawWrite"];
        stdoutGuard = { rawWrite };
        process.stdout.write = ((chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown) => {
                // Everything that is not protocol output (extension console.log, banners)
                // must never corrupt stdout — it degrades to stderr.
                const cb = typeof encodingOrCallback === "function" ? encodingOrCallback : typeof callback === "function" ? callback : undefined;
                return rawStderrWrite(String(chunk), cb as () => void);
        }) as typeof process.stdout.write;
}

function writeProtocolLine(obj: unknown): void {
        const line = `${JSON.stringify(obj)}\n`;
        protocolWriteTail = protocolWriteTail
                .then(() => writeProtocolChunk(line))
                .catch((error) => {
                        console.error(`[unown-acp] protocol write failed: ${error instanceof Error ? error.message : String(error)}`);
                });
}

async function flushProtocolOutput(): Promise<void> {
        await protocolWriteTail;
}

// ---------------------------------------------------------------------------
// LF-only stdin line reader — mirrors coding-agent's rpc/jsonl.ts (strict
// JSONL framing: readline would also split on Unicode separators that are
// legal inside JSON strings).
// ---------------------------------------------------------------------------

function attachLineReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): () => void {
        let buffer = "";
        const onData = (chunk: string | Buffer) => {
                buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
                while (true) {
                        const newlineIndex = buffer.indexOf("\n");
                        if (newlineIndex === -1) return;
                        const line = buffer.slice(0, newlineIndex);
                        buffer = buffer.slice(newlineIndex + 1);
                        onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
                }
        };
        const onEnd = () => {
                if (buffer.length > 0) {
                        onLine(buffer);
                        buffer = "";
                }
        };
        stream.on("data", onData);
        stream.on("end", onEnd);
        return () => {
                stream.off("data", onData);
                stream.off("end", onEnd);
        };
}

// ---------------------------------------------------------------------------
// The mediated read tool (fs/read_text_file for out-of-project paths)
// ---------------------------------------------------------------------------

/** Path-jail predicate shared by the read mediation and tests. */
function acpReadMediationNeeded(cwd: string, path: string, enabled: () => boolean): boolean {
        return enabled() && typeof path === "string" && isAbsolute(path) && isPathOutsideProject(cwd, path);
}

/**
 * The extension that re-registers the `read` tool with editor-mediated
 * ReadOperations: paths inside the project cwd read locally (identical to
 * the terminal agent); absolute paths OUTSIDE the project go through the
 * editor's fs/read_text_file when it advertised the capability — the editor
 * gets to authorize reads the terminal agent would simply perform.
 */
export function createAcpReadToolExtension(opts: {
        cwd: string;
        fsReadEnabled: () => boolean;
        readViaClient: (path: string) => Promise<string>;
}) {
        return {
                name: "unown-acp-fs",
                hidden: true,
                factory(_pi: ExtensionAPI) {
                        const operations = {
                                async readFile(path: string): Promise<Buffer> {
                                        if (acpReadMediationNeeded(opts.cwd, path, opts.fsReadEnabled)) {
                                                const content = await opts.readViaClient(path);
                                                return Buffer.from(content, "utf8");
                                        }
                                        return fsp.readFile(path);
                                },
                                async access(path: string): Promise<void> {
                                        // When mediated, let the editor's read surface the real error.
                                        if (acpReadMediationNeeded(opts.cwd, path, opts.fsReadEnabled)) return;
                                        await fsp.access(path, fsConstants.R_OK);
                                },
                                async detectImageMimeType(path: string): Promise<string | null | undefined> {
                                        return detectSupportedImageMimeTypeFromFile(path);
                                },
                        };
                        // A registered tool with a built-in's name wins in the session tool
                        // registry (agent-session _refreshToolRegistry seeds built-ins first,
                        // then custom tools overwrite by name).
                        (_pi as any).registerTool(createReadToolDefinition(opts.cwd, { operations }));
                },
        };
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

/** What cli.ts injects: its bootRuntime (sessions, memory, hooks, tools). */
export type AcpRuntimeBoot = (
        cwd: string,
        verbose: boolean,
        bootOpts?: { sessionManager?: unknown; extraExtensions?: Array<{ name: string; hidden: boolean; factory: (pi: any) => void }> },
) => Promise<{ runtime: any }>;

export interface AcpServerOptions {
        boot: AcpRuntimeBoot;
        agentName?: string;
        agentVersion?: string;
        verbose?: boolean;
}

interface AcpSessionState {
        runtime: any;
        session: any;
        cwd: string;
        translation: AcpTranslationState;
        unsubscribe?: () => void;
        unsubscribeAgent?: () => void;
        /** set by session/cancel while a prompt is in flight */
        cancelled: boolean;
        promptInFlight: boolean;
        binding: AcpSessionBinding;
}

/** Closures the boot-time extensions use to reach this server (per session). */
interface AcpSessionBinding {
        acpSessionId?: string;
        fsReadEnabled: () => boolean;
        readViaClient: (path: string) => Promise<string>;
}

interface PendingClientRequest {
        resolve: (result: unknown) => void;
        cancel: () => void;
}

/** Find a persisted session file by unown session id (files are <timestamp>_<id>.jsonl). */
export function findUnownSessionFile(sessionsDir: string, sessionId: string): string | null {
        if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return null; // no path traversal in ids
        if (!existsSync(sessionsDir)) return null;
        const hits = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl") && (f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`));
        if (hits.length === 0) return null;
        hits.sort(); // newest timestamp first on ties
        return join(sessionsDir, hits[hits.length - 1]);
}

/**
 * Run the ACP server on stdio. Never returns normally (stdin EOF and signals
 * exit the process) — mirrors runRpcMode's "keep the process alive" shape.
 */
export async function runAcpServer(opts: AcpServerOptions): Promise<never> {
        const verbose = opts.verbose ?? false;
        const agentName = opts.agentName ?? "unown";
        const agentVersion = opts.agentVersion ?? "unknown";
        const log = (msg: string) => {
                if (verbose) console.error(`[unown-acp] ${msg}`);
        };

        takeOverStdout();

        const sessions = new Map<string, AcpSessionState>();
        const pendingClientRequests = new Map<number | string, PendingClientRequest>();
        let outboundSeq = 0;
        let clientFsReadTextFile = false;
        let clientFsWriteTextFile = false;
        let initialized = false;
        // v1 uses snake_case method names (fs/read_text_file); the pre-v1 draft
        // used camelCase (fs/readTextFile). Mirror whichever dialect the client
        // itself used for session creation, defaulting to v1.
        let clientSpeaksV1Methods = true;

        const sendResult = (id: number | string | undefined, result: unknown) => {
                writeProtocolLine({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), result });
        };
        const sendError = (id: number | string | undefined, code: number, message: string) => {
                writeProtocolLine({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), error: { code, message } });
        };
        const sendNotification = (method: string, params: unknown) => {
                writeProtocolLine({ jsonrpc: "2.0", method, params });
        };

        /** Send a request TO the editor and await its response (fail: undefined/throw). */
        function sendClientRequest<T>(method: string, params: unknown, timeoutMs: number): Promise<T | undefined> {
                outboundSeq += 1;
                const id = `unown-${outboundSeq}`;
                return new Promise<T | undefined>((resolve) => {
                        const timer = setTimeout(() => {
                                pendingClientRequests.delete(id);
                                resolve(undefined);
                        }, timeoutMs);
                        pendingClientRequests.set(id, {
                                resolve: (result) => {
                                        clearTimeout(timer);
                                        pendingClientRequests.delete(id);
                                        resolve(result as T | undefined);
                                },
                                cancel: () => {
                                        clearTimeout(timer);
                                        pendingClientRequests.delete(id);
                                        resolve(undefined);
                                },
                        });
                        writeProtocolLine({ jsonrpc: "2.0", id, method, params });
                });
        }

        // --- per-session binding closures (reach back into this server) --------

        function makeBinding(): AcpSessionBinding {
                const binding: AcpSessionBinding = {
                        acpSessionId: undefined,
                        fsReadEnabled: () => clientFsReadTextFile,
                        readViaClient: async (path: string) => {
                                const method = clientSpeaksV1Methods ? "fs/read_text_file" : "fs/readTextFile";
                                const response = await sendClientRequest<{ content?: unknown }>(
                                        method,
                                        { sessionId: binding.acpSessionId, path },
                                        ACP_FS_TIMEOUT_MS,
                                );
                                if (!response || typeof response.content !== "string") {
                                        throw new Error(`editor did not return content for ${path} (fs/read_text_file)`);
                                }
                                return response.content;
                        },
                };
                return binding;
        }

        /** The extension UI context: select/confirm map to session/request_permission. */
        function makeUIContext(state: AcpSessionState) {
                const askViaAcp = async (title: string, options: string[], timeoutMs: number): Promise<string | undefined> => {
                        const acpOptions = acpPermissionOptionsFromDialogOptions(options);
                        const toolCallId = `perm-${++outboundSeq}`;
                        const response = await sendClientRequest<{ outcome?: string; optionId?: string }>(
                                "session/request_permission",
                                {
                                        sessionId: state.binding.acpSessionId,
                                        toolCall: { toolCallId, title, status: "pending" },
                                        options: acpOptions,
                                },
                                timeoutMs,
                        );
                        return dialogOptionFromPermissionResponse(options, acpOptions, response);
                };
                return {
                        select: (title: string, options: string[], dialogOpts?: { timeout?: number }) =>
                                askViaAcp(title, options, dialogOpts?.timeout ?? 120_000),
                        confirm: async (title: string, message: string, dialogOpts?: { timeout?: number }) => {
                                const picked = await askViaAcp(
                                        `${title}${message ? ` — ${message}` : ""}`,
                                        ["Confirm", "Cancel"],
                                        dialogOpts?.timeout ?? 120_000,
                                );
                                return picked === "Confirm";
                        },
                        input: async (_title: string, _placeholder?: string, dialogOpts?: { timeout?: number }) => {
                                // ACP v1 has no text-input request surface (elicitation is the v1
                                // future). Resolve undefined — callers treat that as cancelled,
                                // which is the fail-closed direction for every current caller.
                                void dialogOpts;
                                return undefined;
                        },
                        notify: (message: string, type?: "info" | "warning" | "error") => {
                                console.error(`[unown-acp] notify(${type ?? "info"}): ${message}`);
                        },
                        onTerminalInput: () => () => {},
                        setStatus: () => {},
                        setWorkingMessage: () => {},
                        setWorkingVisible: () => {},
                        setWorkingIndicator: () => {},
                        setHiddenThinkingLabel: () => {},
                        setWidget: () => {},
                        setFooter: () => {},
                        setHeader: () => {},
                        setTitle: () => {},
                        custom: async () => undefined as never,
                        pasteToEditor: () => {},
                        setEditorText: () => {},
                        getEditorText: () => "",
                        editor: async () => undefined,
                        addAutocompleteProvider: () => {},
                        setEditorComponent: () => {},
                        getEditorComponent: () => undefined,
                        get theme() {
                                return (undefined as never);
                        },
                        getAllThemes: () => [] as never,
                        getTheme: () => undefined as never,
                        setTheme: () => ({ success: false, error: "not supported in ACP mode" }) as never,
                        getToolsExpanded: () => false,
                        setToolsExpanded: () => {},
                };
        }

        const rebindSession = async (state: AcpSessionState): Promise<void> => {
                const session = state.runtime.session;
                state.session = session;
                await session.bindExtensions({
                        uiContext: makeUIContext(state),
                        mode: "rpc",
                        commandContextActions: {
                                waitForIdle: () => session.waitForIdle(),
                                newSession: async (options: unknown) => state.runtime.newSession(options),
                                fork: async (entryId: string, forkOptions: unknown) => {
                                        const result = await state.runtime.fork(entryId, forkOptions);
                                        return { cancelled: result.cancelled };
                                },
                                navigateTree: async (targetId: string, options: any) => {
                                        const result = await session.navigateTree(targetId, options);
                                        return { cancelled: result.cancelled };
                                },
                                switchSession: async (sessionPath: string, options: unknown) => state.runtime.switchSession(sessionPath, options),
                                reload: async () => {
                                        await session.reload();
                                },
                        },
                        onError: (err: { extensionPath?: string; event?: string; error?: string }) => {
                                console.error(`[unown-acp] extension error (${err?.extensionPath} ${err?.event}): ${err?.error}`);
                        },
                });
                state.unsubscribe?.();
                state.unsubscribeAgent?.();
                state.unsubscribe = session.subscribe((event: unknown) => {
                        const updates = acpSessionUpdatesFromPiEvent(event, state.translation);
                        for (const update of updates) {
                                sendNotification("session/update", { sessionId: state.binding.acpSessionId, update });
                        }
                });
                // Backpressure: the agent pauses while protocol writes drain (rpc-mode seam).
                state.unsubscribeAgent = session.agent?.subscribe?.(async () => {
                        await protocolWriteTail;
                });
        };

        const createSession = async (
                params: { cwd?: unknown },
                mode: "new" | "load",
                requestedSessionId?: string,
        ): Promise<{ sessionId: string }> => {
                const cwd = typeof params?.cwd === "string" && params.cwd ? params.cwd : process.cwd();
                if (!isAbsolute(cwd)) {
                        throw Object.assign(new Error(`session cwd must be an absolute path: ${cwd}`), { code: JSONRPC_ERRORS.invalidParams });
                }
                const binding = makeBinding();
                const extraExtensions = [
                        createAcpReadToolExtension({
                                cwd,
                                fsReadEnabled: binding.fsReadEnabled,
                                readViaClient: binding.readViaClient,
                        }),
                ];
                let sessionManager: unknown;
                if (mode === "load") {
                        if (!requestedSessionId) {
                                throw Object.assign(new Error("session/load requires a sessionId"), { code: JSONRPC_ERRORS.invalidParams });
                        }
                        const file = findUnownSessionFile(join(UNOWN_AGENT_DIR, "sessions"), requestedSessionId);
                        if (!file) {
                                throw Object.assign(new Error(`session not found: ${requestedSessionId}`), { code: JSONRPC_ERRORS.invalidParams });
                        }
                        sessionManager = SessionManager.open(file, join(UNOWN_AGENT_DIR, "sessions"), cwd);
                        log(`loading session ${requestedSessionId} from ${file}`);
                }
                const { runtime } = await opts.boot(cwd, verbose, { sessionManager, extraExtensions });
                const session = runtime.session;
                const acpSessionId = String(session.sessionId ?? "");
                binding.acpSessionId = acpSessionId;
                const state: AcpSessionState = {
                        runtime,
                        session,
                        cwd,
                        translation: createAcpTranslationState(cwd),
                        cancelled: false,
                        promptInFlight: false,
                        binding,
                };
                sessions.set(acpSessionId, state);
                runtime.setRebindSession(async () => {
                        await rebindSession(state);
                });
                await rebindSession(state);
                log(`session ${mode === "load" ? "loaded" : "created"}: ${acpSessionId} (cwd ${cwd})`);
                return { sessionId: acpSessionId };
        };

        const disposeAll = async (): Promise<void> => {
                for (const state of sessions.values()) {
                        try {
                                state.unsubscribe?.();
                                state.unsubscribeAgent?.();
                                await state.runtime.dispose();
                        } catch (error) {
                                console.error(`[unown-acp] dispose failed: ${error instanceof Error ? error.message : String(error)}`);
                        }
                }
                sessions.clear();
        };

        const shutdown = async (exitCode = 0): Promise<never> => {
                await disposeAll();
                detachInput();
                process.stdin.pause();
                await flushProtocolOutput();
                process.exit(exitCode);
        };

        // --- request handlers ---------------------------------------------------

        const handleInitialize = (id: number | string | undefined, params: Record<string, any>) => {
                const caps = params?.clientCapabilities ?? {};
                clientFsReadTextFile = caps?.fs?.readTextFile === true;
                clientFsWriteTextFile = caps?.fs?.writeTextFile === true;
                initialized = true;
                log(
                        `initialized: client ${params?.clientInfo?.name ?? "?"} ${params?.clientInfo?.version ?? "?"} ` +
                                `(protocolVersion ${params?.protocolVersion ?? "?"}, fs read=${clientFsReadTextFile} write=${clientFsWriteTextFile})`,
                );
                sendResult(id, {
                        protocolVersion: ACP_PROTOCOL_VERSION,
                        agentCapabilities: {
                                loadSession: true,
                                promptCapabilities: { image: true, audio: false, embeddedContext: true },
                        },
                        authMethods: [],
                        agentInfo: { name: agentName, version: agentVersion },
                });
        };

        const handlePrompt = async (id: number | string | undefined, params: Record<string, any>) => {
                const state = sessions.get(String(params?.sessionId ?? ""));
                if (!state) {
                        sendError(id, JSONRPC_ERRORS.invalidParams, `unknown session: ${params?.sessionId}`);
                        return;
                }
                let input: { text: string; images: Array<{ type: "image"; data: string; mimeType: string }> };
                try {
                        input = piInputFromAcpPrompt(params?.prompt);
                } catch (error) {
                        sendError(id, JSONRPC_ERRORS.invalidParams, error instanceof Error ? error.message : String(error));
                        return;
                }
                if (!input.text && input.images.length === 0) {
                        sendError(id, JSONRPC_ERRORS.invalidParams, "prompt is empty (no text or image content)");
                        return;
                }
                state.cancelled = false;
                state.promptInFlight = true;
                try {
                        // followUp: a second prompt while streaming queues after the current
                        // turn (PromptOptions requires a streamingBehavior when streaming).
                        await state.session.prompt(input.text, {
                                ...(input.images.length ? { images: input.images } : {}),
                                source: "rpc",
                                streamingBehavior: "followUp",
                        });
                } catch (error) {
                        // Cancellation aborts the provider stream — the spec REQUIRES the
                        // semantically meaningful cancelled stop reason, never an error.
                        if (state.cancelled) {
                                state.promptInFlight = false;
                                sendResult(id, { stopReason: "cancelled" });
                                return;
                        }
                        state.promptInFlight = false;
                        sendError(id, JSONRPC_ERRORS.internalError, error instanceof Error ? error.message : String(error));
                        return;
                }
                state.promptInFlight = false;
                const messages = (state.session.state?.messages ?? []) as Array<Record<string, any>>;
                const last = messages[messages.length - 1];
                const finalStop = last?.role === "assistant" ? last.stopReason : undefined;
                sendResult(id, { stopReason: stopReasonFromPi(finalStop, state.cancelled) });
        };

        const handleCancel = async (params: Record<string, any>) => {
                const state = sessions.get(String(params?.sessionId ?? ""));
                if (!state) return;
                state.cancelled = true;
                try {
                        await state.session.abort();
                } catch (error) {
                        log(`cancel failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        };

        const handleLoad = async (id: number | string | undefined, params: Record<string, any>) => {
                const result = await createSession(params, "load", typeof params?.sessionId === "string" ? params.sessionId : undefined);
                // Replay the loaded conversation as session/update notifications
                // before responding (the spec's load contract).
                const state = sessions.get(result.sessionId);
                if (state) {
                        const entries = state.session.sessionManager?.buildContextEntries?.() ?? [];
                        for (const update of acpUpdatesFromSessionEntries(entries)) {
                                sendNotification("session/update", { sessionId: result.sessionId, update });
                        }
                }
                sendResult(id, {});
        };

        const handleSetPermission = (id: number | string | undefined, params: Record<string, any>) => {
                // Pre-v1 draft compat: editors used to (re)state a permission decision.
                // v1 carries decisions in the session/request_permission response, which
                // the permissions gate already persists ("Always allow (this session)"
                // becomes a session allow rule). Accept, acknowledge, and keep the
                // decision in the log for diagnostics.
                log(`setPermission: ${JSON.stringify(params)?.slice(0, 300)}`);
                sendResult(id, {});
        };

        const ensureInitialized = (id: number | string | undefined): boolean => {
                if (initialized) return true;
                sendError(id, JSONRPC_ERRORS.serverNotInitialized, "server not initialized: call initialize first");
                return false;
        };

        const handleMessage = async (msg: Record<string, any>): Promise<void> => {
                const id = msg.id;
                const method = typeof msg.method === "string" ? msg.method : undefined;

                // Response to one of OUR outbound requests (has result/error, no method).
                if (method === undefined) {
                        if (("result" in msg || "error" in msg) && pendingClientRequests.has(id)) {
                                const pending = pendingClientRequests.get(id)!;
                                pending.resolve(msg.result);
                        }
                        return;
                }

                switch (method) {
                        case "initialize":
                                handleInitialize(id, msg.params ?? {});
                                return;
                        case "newSession":
                        case "session/new": {
                                if (!ensureInitialized(id)) return;
                                clientSpeaksV1Methods = method === "session/new";
                                try {
                                        sendResult(id, await createSession(msg.params ?? {}, "new"));
                                } catch (error) {
                                        sendError(id, (error as { code?: number })?.code ?? JSONRPC_ERRORS.internalError, error instanceof Error ? error.message : String(error));
                                }
                                return;
                        }
                        case "session/load": {
                                if (!ensureInitialized(id)) return;
                                try {
                                        await handleLoad(id, msg.params ?? {});
                                } catch (error) {
                                        sendError(id, (error as { code?: number })?.code ?? JSONRPC_ERRORS.internalError, error instanceof Error ? error.message : String(error));
                                }
                                return;
                        }
                        case "session/prompt": {
                                if (!ensureInitialized(id)) return;
                                await handlePrompt(id, msg.params ?? {});
                                return;
                        }
                        case "session/cancel": {
                                await handleCancel(msg.params ?? {});
                                // Tolerant: if a client sent it as a request, acknowledge.
                                if (id !== undefined) sendResult(id, {});
                                return;
                        }
                        case "session/setMode":
                        case "session/set_mode": {
                                // No modes are advertised (unown's plan mode is a boot-time flag,
                                // not a mid-session switch). Empty-capability response per spec.
                                if (id !== undefined) sendResult(id, {});
                                return;
                        }
                        case "session/setPermission":
                        case "session/set_permission": {
                                handleSetPermission(id, msg.params ?? {});
                                return;
                        }
                        case "$/cancel_request": {
                                // The client cancelled one of our in-flight requests (e.g. the
                                // permission ask after a session/cancel): resolve it as cancelled.
                                const cancelId = (msg.params as { id?: number | string })?.id;
                                if (cancelId !== undefined) pendingClientRequests.get(cancelId)?.cancel();
                                return;
                        }
                        default: {
                                // Unknown method on the agent: -32601 for requests; notifications
                                // are ignored (JSON-RPC 2.0).
                                if (id !== undefined) {
                                        sendError(id, JSONRPC_ERRORS.methodNotFound, `method not found: ${method}`);
                                } else {
                                        log(`ignoring unknown notification: ${method}`);
                                }
                                return;
                        }
                }
        };

        const handleInputLine = async (line: string) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                let parsed: unknown;
                try {
                        parsed = JSON.parse(trimmed);
                } catch {
                        // Garbage-line tolerance: skip anything that is not JSON (an editor
                        // interleaving a stray log line must never kill the agent).
                        log(`skipping non-JSON input line (${trimmed.slice(0, 80)})`);
                        return;
                }
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                        // Batches are not part of ACP; skip rather than die.
                        log("skipping non-object JSON line");
                        return;
                }
                try {
                        await handleMessage(parsed as Record<string, any>);
                } catch (error) {
                        const msg = parsed as { id?: number | string };
                        sendError(msg.id, JSONRPC_ERRORS.internalError, error instanceof Error ? error.message : String(error));
                }
                await protocolWriteTail;
        };

        const onInputEnd = () => {
                void shutdown(0);
        };
        process.stdin.on("end", onInputEnd);
        const detachInput = (() => {
                const detachLines = attachLineReader(process.stdin, (line) => {
                        void handleInputLine(line);
                });
                return () => {
                        detachLines();
                        process.stdin.off("end", onInputEnd);
                };
        })();

        // Signal hygiene mirrors rpc-mode: kill tracked detached children, dispose.
        const signalCleanupHandlers: Array<() => void> = [];
        const signals: NodeJS.Signals[] = ["SIGTERM"];
        if (process.platform !== "win32") signals.push("SIGHUP");
        for (const signal of signals) {
                const handler = () => {
                        void shutdown(signal === "SIGHUP" ? 129 : 143);
                };
                process.on(signal, handler);
                signalCleanupHandlers.push(() => process.off(signal, handler));
        }

        // Keep the process alive forever (stdin drives everything).
        return new Promise(() => {}) as never;
}
