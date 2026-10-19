/**
 * hooks-config.ts — user-configurable multi-type hooks (Milestone 1).
 *
 * Reverse-engineered from the converged hook contract in claude code, codex,
 * cursor and goose: handlers of multiple types (command / HTTP / MCP-tool /
 * Prompt / Agent), output entries with semantic kinds (Warning / Stop /
 * Feedback / Context / Error), and async execution mode.
 *
 * Schema (`.unown/hooks.json`, project-scoped, gated by config-trust.ts):
 *
 * ```json
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       { "matcher": "bash", "type": "command",
 *         "command": "echo 'bash called' >> /tmp/hook.log",
 *         "timeoutMs": 5000 },
 *       { "matcher": "write", "type": "prompt",
 *         "prompt": "Review this write for security issues: {{input.path}}",
 *         "model": "kimi-k2.5", "timeoutMs": 30000 },
 *       { "matcher": "bash", "type": "http",
 *         "url": "https://internal-approval.example.com/hooks/pre-bash",
 *         "timeoutMs": 5000, "failClosed": true },
 *       { "matcher": "*", "type": "mcp",
 *         "mcpServer": "approver", "mcpTool": "review",
 *         "timeoutMs": 30000 }
 *     ],
 *     "PostToolUse": [...],
 *     "PreCompact": [...]
 *   }
 * }
 * ```
 *
 * Trust model: project-scoped `.unown/hooks.json` is gated by
 * `config-trust.ts` exactly like `.unown/mcp.json` and `.unown/lsp.json` —
 * a cloned repo's hooks config is attacker-controlled, so refuse-first.
 * User-scoped `~/.unown/agent/hooks.json` is always trusted.
 *
 * Purity: fs + crypto + http only (no pi imports). The handler runners are
 * fully unit-testable with mocked fetch / spawn / llm.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    TRUST_BYPASS_ENV,
    configFingerprint,
    isConfigTrusted,
    trustApprovalNeeded,
    trustBypassed,
    trustStatePath,
} from "./config-trust.ts";
import { UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HookHandlerType = "command" | "http" | "mcp" | "prompt" | "agent";

export interface HookHandler {
    /** Type of handler — selects the runner. */
    type: HookHandlerType;
    /** Tool-name matcher for PreToolUse/PostToolUse. "*" or absent = all. */
    matcher?: string;
    /** command: shell command to run. {{var}} tokens are interpolated. */
    command?: string;
    /** http: URL to POST the event JSON to. */
    url?: string;
    /** http: optional shared secret, sent as `Authorization: Bearer <key>`. */
    apiKey?: string;
    /** http: optional extra headers (raw object). */
    headers?: Record<string, string>;
    /** mcp: MCP server name (must be configured in `.unown/mcp.json`). */
    mcpServer?: string;
    /** mcp: MCP tool name on that server. */
    mcpTool?: string;
    /** prompt / agent: prompt template ({{var}} interpolation). */
    prompt?: string;
    /** prompt / agent: model override (defaults to PI_MODEL_ID). */
    model?: string;
    /** Common. */
    timeoutMs?: number;
    /** If true, fire-and-forget — don't block the turn on the result. */
    async?: boolean;
    /** If true, runner errors are treated as `deny` (else `allow`). */
    failClosed?: boolean;
}

export type HookEventName =
    | "SessionStart"
    | "UserPromptSubmit"
    | "PreToolUse"
    | "PostToolUse"
    | "Stop"
    | "SubagentStop"
    | "PreModelRequest"
    | "PostModelRequest"
    | "PreCompact"
    | "PostCompact"
    | "SubagentStart"
    | "TaskCompleted"
    | "PermissionRequest";

export interface HookConfig {
    version: 1;
    hooks: Partial<Record<HookEventName, HookHandler[]>>;
}

/** Semantic output entry — surfaces to the model + the dashboard. */
export interface HookOutputEntry {
    kind: "warning" | "stop" | "feedback" | "context" | "error";
    message: string;
    details?: Record<string, unknown>;
}

export interface HookRunResult {
    /** Coarse decision the caller maps to pi's tool_call block/allow/mutate. */
    decision: "allow" | "deny" | "mutate" | "warn" | "stop";
    reason?: string;
    outputs: HookOutputEntry[];
    /** For "mutate": the new input to substitute (PreToolUse only). */
    mutatedInput?: Record<string, unknown>;
    /** True if the handler ran async (caller should not block). */
    asyncRan?: boolean;
}

export interface HookEvent {
    name: HookEventName;
    tool?: string;
    input?: Record<string, unknown>;
    result?: unknown;
    prompt?: string;
    /** Free-form fields the runner interpolates into templates. */
    context?: Record<string, unknown>;
}

export interface HookRunContext {
    runId: string;
    sandboxRoot: string;
    /** Invoked by the `prompt` / `agent` handler type to call the LLM. */
    callLlm?: (prompt: string, model?: string) => Promise<string>;
    /** Invoked by the `mcp` handler type to call an MCP tool. */
    callMcp?: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Config loading (project-scoped + user-scoped, with trust gate)
// ---------------------------------------------------------------------------

const PROJECT_CONFIG = ".unown/hooks.json";
const USER_CONFIG = "hooks.json"; // resolved under UNOWN_AGENT_DIR

export function projectHooksConfigPath(projectDir: string): string {
    return join(projectDir, PROJECT_CONFIG);
}

export function userHooksConfigPath(agentDir: string = UNOWN_AGENT_DIR): string {
    return join(agentDir, USER_CONFIG);
}

/**
 * Read a hooks config from disk, returning null when missing or corrupt.
 * Does NOT apply the trust gate — the caller decides.
 */
export function readHooksConfig(path: string): HookConfig | null {
    if (!existsSync(path)) return null;
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        return null;
    }
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.hooks !== "object" || parsed.hooks === null) return null;
    const hooks: HookConfig["hooks"] = {};
    for (const [name, handlers] of Object.entries(parsed.hooks)) {
        if (!Array.isArray(handlers)) continue;
        // Keep the array (even empty) so the config round-trips; non-object /
        // missing-type entries are filtered out individually.
        const valid = handlers.filter((h: any) => h && typeof h === "object" && typeof h.type === "string");
        hooks[name as HookEventName] = valid as HookHandler[];
    }
    return { version: 1, hooks };
}

export interface ResolvedHooksConfig {
    /** Effective merged config (user + project, project wins per-key). */
    config: HookConfig;
    /** True if a project config exists but was NOT loaded (trust gate). */
    approvalNeeded: boolean;
    /** Where each handler came from (for `/doctor`). */
    sources: { user: string[]; project: string[]; untrustedProject: string[] };
}

/**
 * Load + merge user-scoped and project-scoped hooks configs. The project
 * config is gated by `config-trust.ts` — refuse-first when untrusted.
 */
export function loadHooksConfig(projectDir: string, agentDir: string = UNOWN_AGENT_DIR): ResolvedHooksConfig {
    const sources: ResolvedHooksConfig["sources"] = { user: [], project: [], untrustedProject: [] };

    // User-scoped — always trusted.
    const userPath = userHooksConfigPath(agentDir);
    const userCfg = readHooksConfig(userPath);
    if (userCfg) sources.user.push(userPath);

    // Project-scoped — trust gate.
    const projPath = projectHooksConfigPath(projectDir);
    let projCfg: HookConfig | null = null;
    let approvalNeeded = false;
    if (existsSync(projPath)) {
        if (trustBypassed()) {
            projCfg = readHooksConfig(projPath);
            if (projCfg) sources.project.push(projPath);
        } else if (isConfigTrusted(projPath, { statePath: trustStatePath(agentDir) })) {
            projCfg = readHooksConfig(projPath);
            if (projCfg) sources.project.push(projPath);
        } else {
            approvalNeeded = true;
            sources.untrustedProject.push(projPath);
        }
    }
    // Merge: project wins per-event-name (replaces user's array for that event).
    const merged: HookConfig["hooks"] = {};
    if (userCfg) for (const [k, v] of Object.entries(userCfg.hooks)) merged[k as HookEventName] = v!;
    if (projCfg) for (const [k, v] of Object.entries(projCfg.hooks)) merged[k as HookEventName] = v!;

    return {
        config: { version: 1, hooks: merged },
        approvalNeeded,
        sources,
    };
}

/** Fingerprint the project hooks config (used by `/doctor` and trust flow). */
export function fingerprintHooksConfig(projectDir: string): string | null {
    const p = projectHooksConfigPath(projectDir);
    return existsSync(p) ? configFingerprint(p) : null;
}

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;

/**
 * Interpolate `{{var}}` tokens with values from `event`. Supports
 * `{{tool}}`, `{{input.path}}`, `{{input.command}}`, `{{prompt}}`, and
 * anything in `event.context`. Missing tokens render as empty strings —
 * NEVER throw, so a malformed template can't crash the agent loop.
 */
export function interpolateTemplate(template: string, event: HookEvent): string {
    const lookup = (path: string): unknown => {
        if (path === "tool") return event.tool ?? "";
        if (path === "prompt") return event.prompt ?? "";
        if (path === "name") return event.name;
        if (path.startsWith("input.")) {
            const key = path.slice("input.".length);
            return (event.input as any)?.[key] ?? "";
        }
        if (path.startsWith("result.")) {
            const key = path.slice("result.".length);
            return (event.result as any)?.[key] ?? "";
        }
        if (path.startsWith("context.")) {
            const key = path.slice("context.".length);
            return (event.context as any)?.[key] ?? "";
        }
        if (path === "input") return JSON.stringify(event.input ?? {});
        return (event as any)?.[path] ?? "";
    };
    return template.replace(TEMPLATE_RE, (_m, key: string) => {
        const v = lookup(key);
        if (v === null || v === undefined) return "";
        if (typeof v === "string") return v;
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        try {
            return JSON.stringify(v);
        } catch {
            return String(v);
        }
    });
}

// ---------------------------------------------------------------------------
// Handler runners — one per type
// ---------------------------------------------------------------------------

/** Run a shell command, capture stdout+stderr, return {exit, stdout, stderr}. */
function runCommand(
    command: string,
    env: Record<string, string>,
    timeoutMs: number,
): Promise<{ exit: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
        const child = spawn(command, {
            shell: true,
            env: { ...process.env, ...env },
            windowsHide: true,
            // detached:true puts the child in its own process group on POSIX,
            // so we can kill the whole tree with process.kill(-pid). On
            // Windows, detached alone is enough (CREATE_NEW_PROCESS_GROUP).
            detached: true,
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                if (child.pid) {
                    if (process.platform === "win32") {
                        // No process groups or signals on Windows: taskkill
                        // /F /T is the tree kill (the convention the Windows
                        // docs state for the lifecycle scripts), and it is
                        // what actually reaches the grandchildren — with
                        // shell:true the direct child is cmd.exe, so killing
                        // it alone would leave the payload (node.exe, …)
                        // holding the stdio pipes open, the "close" event
                        // would never fire, and the timeout would hang the
                        // caller instead of resolving as timedOut.
                        spawn(`taskkill /F /T /PID ${child.pid}`, {
                            shell: true,
                            windowsHide: true,
                            stdio: "ignore",
                        });
                    } else {
                        try {
                            // Kill the entire process group so orphaned
                            // grandchildren (e.g. `sleep` under a shell) die
                            // with the shell.
                            process.kill(-child.pid, "SIGKILL");
                        } catch {
                            // Group kill failed — fall back to direct kill.
                            child.kill("SIGKILL");
                        }
                    }
                } else {
                    child.kill("SIGKILL");
                }
            } catch {
                /* already gone */
            }
        }, Math.max(100, Math.min(timeoutMs, 60_000)));
        child.stdout?.on("data", (d) => {
            stdout += d.toString();
            if (stdout.length > 64 * 1024) stdout = stdout.slice(0, 64 * 1024);
        });
        child.stderr?.on("data", (d) => {
            stderr += d.toString();
            if (stderr.length > 64 * 1024) stderr = stderr.slice(0, 64 * 1024);
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            resolve({ exit: -1, stdout, stderr: stderr + String(err), timedOut });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ exit: code ?? -1, stdout, stderr, timedOut });
        });
        // Allow the parent process to exit even if the child is somehow still
        // running (defensive — the timeout + SIGKILL above should handle it).
        child.unref();
    });
}

/** POST the event JSON to a URL, return the response body. */
async function runHttp(
    url: string,
    body: unknown,
    timeoutMs: number,
    apiKey?: string,
    extraHeaders?: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(500, Math.min(timeoutMs, 60_000)));
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "unown-hooks/1.0",
            ...(extraHeaders ?? {}),
        };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, body: text.slice(0, 64 * 1024) };
    } catch (err: any) {
        return { ok: false, status: 0, body: "", error: String(err?.message ?? err) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Parse a hook handler's structured output. Handlers may return:
 * - A plain string (treated as `feedback`)
 * - An object `{decision?, reason?, outputs?, mutatedInput?}`
 * - A JSON-encoded string of the above
 *
 * Returns null when the output cannot be parsed (caller treats as `allow`).
 */
function parseHandlerOutput(raw: unknown): HookRunResult | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        // Try JSON first (handlers may return JSON-encoded structured output).
        if (trimmed.startsWith("{")) {
            try {
                return parseHandlerOutput(JSON.parse(trimmed));
            } catch {
                /* fall through */
            }
        }
        return {
            decision: "allow",
            outputs: [{ kind: "feedback", message: trimmed.slice(0, 4096) }],
        };
    }
    if (typeof raw === "object") {
        const obj = raw as Record<string, any>;
        const decision = ["allow", "deny", "mutate", "warn", "stop"].includes(obj.decision)
            ? obj.decision
            : "allow";
        const outputs: HookOutputEntry[] = obj.outputs
            ? (obj.outputs
                  .map((o: any): HookOutputEntry | null => {
                      if (!o || typeof o !== "object") return null;
                      const kind = o.kind;
                      if (!["warning", "stop", "feedback", "context", "error"].includes(kind)) return null;
                      return { kind, message: String(o.message ?? "").slice(0, 4096), details: o.details };
                  })
                  .filter((x: any): x is HookOutputEntry => x !== null))
            : [];
        if (typeof obj.message === "string" && outputs.length === 0) {
            outputs.push({ kind: "feedback", message: obj.message.slice(0, 4096) });
        }
        return {
            decision,
            reason: typeof obj.reason === "string" ? obj.reason.slice(0, 1024) : undefined,
            outputs,
            mutatedInput: typeof obj.mutatedInput === "object" && obj.mutatedInput ? obj.mutatedInput : undefined,
        };
    }
    return null;
}

/**
 * Run a single hook handler. Returns `allow` with no outputs when the handler
 * is async (caller should not block); returns `deny` on handler error when
 * `failClosed` is set, else `allow` with an error output.
 */
export async function runHookHandler(
    handler: HookHandler,
    event: HookEvent,
    ctx: HookRunContext,
): Promise<HookRunResult> {
    const timeoutMs = Math.max(100, Math.min(handler.timeoutMs ?? 10_000, 60_000));

    // Async handlers fire-and-forget; caller doesn't block.
    if (handler.async) {
        // We still execute (so the side effect happens), but resolve immediately.
        runHookHandlerSync(handler, event, ctx, timeoutMs).catch(() => {
            /* swallowed — async by contract */
        });
        return { decision: "allow", outputs: [], asyncRan: true };
    }

    try {
        return await runHookHandlerSync(handler, event, ctx, timeoutMs);
    } catch (err: any) {
        const msg = String(err?.message ?? err).slice(0, 1024);
        if (handler.failClosed) {
            return {
                decision: "deny",
                reason: `hook handler error (failClosed): ${msg}`,
                outputs: [{ kind: "error", message: msg }],
            };
        }
        return {
            decision: "allow",
            outputs: [{ kind: "error", message: `hook handler error: ${msg}` }],
        };
    }
}

async function runHookHandlerSync(
    handler: HookHandler,
    event: HookEvent,
    ctx: HookRunContext,
    timeoutMs: number,
): Promise<HookRunResult> {
    switch (handler.type) {
        case "command": {
            if (!handler.command) {
                return { decision: "allow", outputs: [{ kind: "error", message: "command handler missing `command`" }] };
            }
            const cmd = interpolateTemplate(handler.command, event);
            const env: Record<string, string> = {
                UNOWN_HOOK_EVENT: event.name,
                UNOWN_HOOK_TOOL: event.tool ?? "",
                UNOWN_RUN_ID: ctx.runId,
            };
            const { exit, stdout, stderr, timedOut } = await runCommand(cmd, env, timeoutMs);
            if (timedOut) {
                return {
                    decision: handler.failClosed ? "deny" : "allow",
                    reason: `command timed out after ${timeoutMs}ms`,
                    outputs: [{ kind: "error", message: `command timed out` }],
                };
            }
            // Convention: exit 0 = allow (with optional stdout as feedback),
            // exit 2 = deny (stderr is the reason), other non-zero = warn.
            if (exit === 0) {
                const parsed = parseHandlerOutput(stdout);
                return parsed ?? { decision: "allow", outputs: [] };
            }
            if (exit === 2) {
                return {
                    decision: "deny",
                    reason: stderr.trim() || `command exited ${exit}`,
                    outputs: [{ kind: "stop", message: stderr.trim() || `command denied (exit ${exit})` }],
                };
            }
            return {
                decision: "warn",
                reason: stderr.trim() || `command exited ${exit}`,
                outputs: [{ kind: "warning", message: stderr.trim() || stdout.trim() || `command exited ${exit}` }],
            };
        }

        case "http": {
            if (!handler.url) {
                return { decision: "allow", outputs: [{ kind: "error", message: "http handler missing `url`" }] };
            }
            const body = {
                event: event.name,
                tool: event.tool ?? null,
                input: event.input ?? null,
                result: event.result ?? null,
                prompt: event.prompt ?? null,
                context: event.context ?? null,
                runId: ctx.runId,
                ts: Date.now(),
            };
            const { ok, status, body: respBody, error } = await runHttp(
                handler.url,
                body,
                timeoutMs,
                handler.apiKey,
                handler.headers,
            );
            if (!ok) {
                if (handler.failClosed) {
                    return {
                        decision: "deny",
                        reason: `http ${status}: ${error ?? respBody.slice(0, 256)}`,
                        outputs: [{ kind: "error", message: `http ${status}: ${error ?? respBody.slice(0, 256)}` }],
                    };
                }
                return {
                    decision: "allow",
                    outputs: [{ kind: "warning", message: `http ${status}: ${error ?? "non-200 response"}` }],
                };
            }
            const parsed = parseHandlerOutput(respBody);
            return parsed ?? { decision: "allow", outputs: [] };
        }

        case "mcp": {
            if (!handler.mcpServer || !handler.mcpTool) {
                return {
                    decision: "allow",
                    outputs: [{ kind: "error", message: "mcp handler missing `mcpServer`/`mcpTool`" }],
                };
            }
            if (!ctx.callMcp) {
                return {
                    decision: "allow",
                    outputs: [{ kind: "error", message: "mcp handler: no callMcp in context" }],
                };
            }
            const args = {
                event: event.name,
                tool: event.tool ?? null,
                input: event.input ?? null,
                prompt: event.prompt ?? null,
            };
            try {
                const result = await Promise.race([
                    ctx.callMcp(handler.mcpServer, handler.mcpTool, args),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("mcp timeout")), timeoutMs),
                    ),
                ]);
                const parsed = parseHandlerOutput(result);
                return parsed ?? { decision: "allow", outputs: [] };
            } catch (err: any) {
                if (handler.failClosed) {
                    return {
                        decision: "deny",
                        reason: `mcp error: ${String(err?.message ?? err)}`,
                        outputs: [{ kind: "error", message: `mcp error: ${String(err?.message ?? err)}` }],
                    };
                }
                return {
                    decision: "allow",
                    outputs: [{ kind: "warning", message: `mcp error: ${String(err?.message ?? err)}` }],
                };
            }
        }

        case "prompt":
        case "agent": {
            if (!handler.prompt) {
                return {
                    decision: "allow",
                    outputs: [{ kind: "error", message: `${handler.type} handler missing \`prompt\`` }],
                };
            }
            if (!ctx.callLlm) {
                return {
                    decision: "allow",
                    outputs: [{ kind: "error", message: `${handler.type} handler: no callLlm in context` }],
                };
            }
            const promptText = interpolateTemplate(handler.prompt, event);
            try {
                const result = await Promise.race([
                    ctx.callLlm(promptText, handler.model),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error(`${handler.type} timeout`)), timeoutMs),
                    ),
                ]);
                const parsed = parseHandlerOutput(result);
                return parsed ?? { decision: "allow", outputs: [{ kind: "feedback", message: String(result).slice(0, 1024) }] };
            } catch (err: any) {
                if (handler.failClosed) {
                    return {
                        decision: "deny",
                        reason: `${handler.type} error: ${String(err?.message ?? err)}`,
                        outputs: [{ kind: "error", message: `${handler.type} error: ${String(err?.message ?? err)}` }],
                    };
                }
                return {
                    decision: "allow",
                    outputs: [{ kind: "warning", message: `${handler.type} error: ${String(err?.message ?? err)}` }],
                };
            }
        }

        default:
            return {
                decision: "allow",
                outputs: [{ kind: "error", message: `unknown handler type: ${(handler as any).type}` }],
            };
    }
}

/**
 * Run all handlers for an event. Merges results:
 * - any `deny` → deny (first wins, others short-circuit)
 * - any `mutate` → mutate (later mutates stack on top of earlier ones)
 * - any `stop` → stop (terminal — like deny but with a different reason)
 * - any `warn` → warn (continue, but surface the warning)
 * - else allow
 *
 * Async handlers (handler.async=true) run fire-and-forget and don't affect the
 * merged decision.
 */
export async function runHooksForEvent(
    handlers: HookHandler[],
    event: HookEvent,
    ctx: HookRunContext,
): Promise<HookRunResult> {
    if (handlers.length === 0) return { decision: "allow", outputs: [] };

    // Filter by matcher (PreToolUse/PostToolUse only).
    const matching = handlers.filter((h) => {
        if (!h.matcher || h.matcher === "*") return true;
        if (!event.tool) return false;
        // Simple glob: `bash` matches `bash`; `bash|powershell` matches either.
        if (h.matcher.includes("|")) {
            return h.matcher.split("|").map((s) => s.trim()).includes(event.tool);
        }
        return h.matcher === event.tool;
    });

    const outputs: HookOutputEntry[] = [];
    let decision: HookRunResult["decision"] = "allow";
    let reason: string | undefined;
    let mutatedInput: Record<string, unknown> | undefined = event.input;
    let asyncRan = false;

    for (const handler of matching) {
        const result = await runHookHandler(handler, event, ctx);
        if (result.asyncRan) {
            asyncRan = true;
            continue;
        }
        outputs.push(...result.outputs);
        if (result.mutatedInput) {
            mutatedInput = { ...(mutatedInput ?? {}), ...result.mutatedInput };
        }
        if (decision !== "deny" && decision !== "stop") {
            // deny and stop are terminal — later handlers don't override.
            if (result.decision === "deny" || result.decision === "stop" || result.decision === "mutate" || result.decision === "warn") {
                decision = result.decision;
                if (result.reason) reason = result.reason;
            }
        }
    }

    return {
        decision,
        reason,
        outputs,
        mutatedInput: decision === "mutate" ? mutatedInput : undefined,
        asyncRan,
    };
}

/** Whether a config has any handlers for the given event. */
export function hasHandlersFor(cfg: HookConfig, name: HookEventName): boolean {
    return Array.isArray(cfg.hooks[name]) && (cfg.hooks[name]!.length > 0);
}

/** Count total handlers across all events (for `/doctor`). */
export function countHandlers(cfg: HookConfig): number {
    let n = 0;
    for (const handlers of Object.values(cfg.hooks)) {
        if (Array.isArray(handlers)) n += handlers.length;
    }
    return n;
}

/** Compute a stable hash of the config (for change detection). */
export function configHash(cfg: HookConfig): string {
    const json = JSON.stringify(cfg);
    return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

// Re-export trust helpers so callers don't need a second import.
export { TRUST_BYPASS_ENV, trustApprovalNeeded };
