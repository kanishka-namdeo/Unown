/**
 * hooks.ts — Hooks (pattern 5/5).
 *
 * A pi inline-extension implementing Claude-Code-style hook semantics on top
 * of pi's native extension events:
 *
 *   SessionStart      -> pi `session_start`
 *   UserPromptSubmit  -> pi `input`
 *   PreToolUse        -> pi `tool_call`        (allow / deny / mutate)
 *   PostToolUse       -> pi `tool_result`      (augment result, auto-checks)
 *   Stop              -> pi `agent_end`
 *   SubagentStop      -> emitted by the harness when a sub-run finishes
 *
 * Milestone 1 (2026-10-19) added the multi-type user-hook layer:
 *
 *   PreModelRequest   -> pi `before_provider_request`
 *   PostModelRequest  -> pi `after_provider_response`
 *   PreCompact        -> pi `session_before_compact`
 *   PostCompact       -> pi `session_compact`
 *   SubagentStart     -> emitted by `task` tool (in tools.ts)
 *   TaskCompleted     -> emitted by `task` tool (in tools.ts)
 *   PermissionRequest -> emitted when a tool_call would be denied
 *
 * User-configured handlers (`.unown/hooks.json` or `~/.unown/agent/hooks.json`)
 * run for every event via `runHooksForEvent` from `./hooks-config.ts`. The
 * project config is gated by `config-trust.ts` (refuse-first when untrusted).
 *
 * Two PreToolUse guards ride on top: `decideAdversary` (file-gated LLM
 * reviewer, `./adversary.ts`) and `decideInjection` (regex + optional ML
 * classifier, `./injection-scanner.ts`). Both return PreToolDecision and
 * compose with `decideBash`/`jailPath` below. SA-B2 adds the
 * instruction-set write gate (`./instruction-guard.ts` — engine runs may
 * never write AGENTS.md/.unown rule files, same policy as the terminal) and
 * the TOCTOU re-check: a PreToolUse user hook that mutates the tool input
 * gets the built-in gates re-run on the mutated input before it executes.
 *
 * Every decision is logged to the hook_log table and pushed to the live bus.
 */
import { emit } from "./bus.ts";
import { adversaryPath, decideAdversary, type AdversaryConfig } from "./adversary.ts";
import { decideInjection, injectionScannerPath } from "./injection-scanner.ts";
import { instructionWriteDeny } from "./instruction-guard.ts";
import {
    hasHandlersFor,
    loadHooksConfig,
    runHooksForEvent,
    type HookEvent,
    type HookEventName,
    type HookHandler,
    type HookRunContext,
} from "./hooks-config.ts";
import { store } from "./store.ts";

export interface RunHookContext {
        runId: string;
        sandboxRoot: string; // absolute path the run is jailed to
        memoryVersion: number;
        /** Optional: where the agent's project root is (for hooks.json lookup). */
        projectDir?: string;
        /** Optional: LLM-call entrypoint for `prompt`/`agent` hook handlers. */
        callLlm?: (prompt: string, model?: string) => Promise<string>;
        /** Optional: MCP-call entrypoint for `mcp` hook handlers. */
        callMcp?: (server: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;
        /** Optional: explicit adversary config (defaults to ~/.config/unown/adversary.md). */
        adversary?: AdversaryConfig | null;
}

export type HookName = HookEventName;

export function logHook(
        runId: string | null,
        hook: HookName,
        tool: string | null,
        decision: string,
        reason: string,
        details?: unknown,
) {
        store.run(`INSERT INTO hook_log (ts, run_id, hook, tool, decision, reason, details) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
                Date.now(),
                runId,
                hook,
                tool,
                decision,
                reason,
                details ? JSON.stringify(details).slice(0, 4000) : null,
        ]);
        emit("hook", { runId, hook, tool, decision, reason, ts: Date.now() });
}

// The pure policy layer (BASH_DENY, decideBash, jailPath, syntaxCheck) lives
// in ./bash-policy.ts since M2 — the terminal agent imports it WITHOUT the
// engine's persistence (logHook -> store). Re-exported here so engine-side
// importers (and the hooks test suite) are unchanged.
export { decideBash, jailPath, syntaxCheck } from "./bash-policy.ts";
export type { PreToolDecision, PostToolAugment } from "./bash-policy.ts";
import { decideBash, jailPath, syntaxCheck } from "./bash-policy.ts";
import type { PreToolDecision } from "./bash-policy.ts";

// ---------------------------------------------------------------------------
// The pi inline extension
// ---------------------------------------------------------------------------

/**
 * Build the HookRunContext used by user-configured hooks, merging the
 * caller's RunHookContext with the LLM/MCP entrypoints. Returns null when
 * no hooks.json config exists (so the call site can skip the run).
 */
function maybeLoadUserHooks(ctx: RunHookContext): {
    handlers: Partial<Record<HookEventName, HookHandler[]>>;
    approvalNeeded: boolean;
} | null {
    if (!ctx.projectDir) return null;
    const resolved = loadHooksConfig(ctx.projectDir);
    const any = Object.values(resolved.config.hooks).some((arr) => Array.isArray(arr) && arr.length > 0);
    if (!any && !resolved.approvalNeeded) return null;
    return { handlers: resolved.config.hooks, approvalNeeded: resolved.approvalNeeded };
}

/** Bridge a RunHookContext into the hooks-config runtime context. */
function toHookRunContext(ctx: RunHookContext): HookRunContext {
    return {
        runId: ctx.runId,
        sandboxRoot: ctx.sandboxRoot,
        callLlm: ctx.callLlm,
        callMcp: ctx.callMcp,
    };
}

/** Compose a PreToolDecision from the user-hooks result. */
function userHooksToDecision(result: { decision: string; reason?: string; outputs: unknown[] }): PreToolDecision {
    if (result.decision === "deny" || result.decision === "stop") {
        return { block: true, reason: result.reason ?? `denied by user hook (${result.decision})` };
    }
    return { block: false };
}

export function createHooksExtension(ctx: RunHookContext) {
        const factory = (pi: any) => {
                const userHooks = maybeLoadUserHooks(ctx);
                const hookCtx = toHookRunContext(ctx);

                // --- SessionStart ---------------------------------------------------
                pi.on("session_start", async (_event: any, _ectx: any) => {
                        logHook(ctx.runId, "SessionStart", null, "log", `session started (memory v${ctx.memoryVersion})`);
                        if (userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "SessionStart")) {
                                const evt: HookEvent = { name: "SessionStart" };
                                try {
                                        await runHooksForEvent(userHooks.handlers.SessionStart ?? [], evt, hookCtx);
                                } catch (err: any) {
                                        logHook(ctx.runId, "SessionStart", null, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }
                });

                // --- UserPromptSubmit -----------------------------------------------
                pi.on("input", async (event: any, _ectx: any) => {
                        const text = typeof event?.text === "string" ? event.text.slice(0, 300) : "";
                        logHook(ctx.runId, "UserPromptSubmit", null, "log", `prompt submitted: "${text}"`);
                        if (userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "UserPromptSubmit")) {
                                const evt: HookEvent = { name: "UserPromptSubmit", prompt: text };
                                try {
                                        const r = await runHooksForEvent(userHooks.handlers.UserPromptSubmit ?? [], evt, hookCtx);
                                        for (const o of r.outputs) {
                                                logHook(ctx.runId, "UserPromptSubmit", null, o.kind, o.message);
                                        }
                                } catch (err: any) {
                                        logHook(ctx.runId, "UserPromptSubmit", null, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }
                });

                // --- PreModelRequest (pi `before_provider_request`) -----------------
                pi.on("before_provider_request", async (_event: any, _ectx: any) => {
                        if (userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "PreModelRequest")) {
                                const evt: HookEvent = { name: "PreModelRequest" };
                                try {
                                        await runHooksForEvent(userHooks.handlers.PreModelRequest ?? [], evt, hookCtx);
                                        logHook(ctx.runId, "PreModelRequest", null, "log", "pre-model hook ran");
                                } catch (err: any) {
                                        logHook(ctx.runId, "PreModelRequest", null, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }
                });

                // --- PostModelRequest (pi `after_provider_response`) ----------------
                pi.on("after_provider_response", async (_event: any, _ectx: any) => {
                        if (userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "PostModelRequest")) {
                                const evt: HookEvent = { name: "PostModelRequest" };
                                try {
                                        await runHooksForEvent(userHooks.handlers.PostModelRequest ?? [], evt, hookCtx);
                                        logHook(ctx.runId, "PostModelRequest", null, "log", "post-model hook ran");
                                } catch (err: any) {
                                        logHook(ctx.runId, "PostModelRequest", null, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }
                });

                // --- PreCompact (pi `session_before_compact`) -----------------------
                pi.on("session_before_compact", async (_event: any, _ectx: any) => {
                        if (userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "PreCompact")) {
                                const evt: HookEvent = { name: "PreCompact" };
                                try {
                                        await runHooksForEvent(userHooks.handlers.PreCompact ?? [], evt, hookCtx);
                                        logHook(ctx.runId, "PreCompact", null, "log", "pre-compact hook ran");
                                } catch (err: any) {
                                        logHook(ctx.runId, "PreCompact", null, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }
                });

                // --- PostCompact (pi `session_compact`) -----------------------------
                pi.on("session_compact", async (_event: any, _ectx: any) => {
                        if (userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "PostCompact")) {
                                const evt: HookEvent = { name: "PostCompact" };
                                try {
                                        await runHooksForEvent(userHooks.handlers.PostCompact ?? [], evt, hookCtx);
                                        logHook(ctx.runId, "PostCompact", null, "log", "post-compact hook ran");
                                } catch (err: any) {
                                        logHook(ctx.runId, "PostCompact", null, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }
                });

                // --- PreToolUse -----------------------------------------------------
                pi.on("tool_call", async (event: any, _ectx: any) => {
                        const tool = event?.toolName as string;
                        const input = event?.input ?? {};
                        let decision: PreToolDecision = { block: false };

                        /** SA-B2 — the hard-coded built-in gate stack for one
                         *  (tool, input): bash deny regex + injection scanner;
                         *  path jail + instruction-set guard + injection
                         *  scanner. ONE code path shared by the initial check
                         *  and the post-mutation re-check (the TOCTOU fix) —
                         *  duplication is how the second path rots open. */
                        const builtInGates = (toolName: string, toolInput: Record<string, unknown>): PreToolDecision => {
                                if (toolName === "bash" || toolName === "powershell") {
                                        const command = String(toolInput.command ?? "");
                                        const bash = decideBash(command);
                                        if (bash.block) return bash;
                                        // Prompt-injection scanner (regex + optional ML classifier).
                                        const inj = decideInjection(toolName, toolInput, ctx.sandboxRoot);
                                        if (inj.block) return inj;
                                        return { block: false };
                                }
                                if (toolName === "write" || toolName === "edit" || toolName === "read") {
                                        const p = String(toolInput.path ?? toolInput.file_path ?? "");
                                        if (p) {
                                                const jail = jailPath(ctx.sandboxRoot, p);
                                                if (!jail.ok) {
                                                        return { block: true, reason: `path escapes the sandbox: ${p} (resolved ${jail.resolved})` };
                                                }
                                        }
                                        // SA-B2 — the SAME instruction-set write policy the
                                        // terminal gate enforces: engine agent runs must never
                                        // write instruction files (AGENTS.md / .unown/skills/** /
                                        // hooks.json / .claude/settings.json …). The engine
                                        // sandbox is an isolated dir, but the run's effective
                                        // project root — and, when set, the real project dir —
                                        // both carry the policy: a hijacked engine agent writing
                                        // its own rule files persists across runs exactly like a
                                        // terminal one (AutoRedClaw arXiv:2610.27244).
                                        if (p && (toolName === "write" || toolName === "edit")) {
                                                const roots =
                                                        ctx.projectDir && ctx.projectDir !== ctx.sandboxRoot
                                                                ? [ctx.sandboxRoot, ctx.projectDir]
                                                                : [ctx.sandboxRoot];
                                                for (const root of roots) {
                                                        const guard = instructionWriteDeny(root, p);
                                                        if (guard.deny) return { block: true, reason: guard.reason! };
                                                }
                                        }
                                        // Injection scanner also scans write content.
                                        if (toolName === "write" || toolName === "edit") {
                                                const inj = decideInjection(toolName, toolInput, ctx.sandboxRoot);
                                                if (inj.block) return inj;
                                        }
                                        return { block: false };
                                }
                                return { block: false };
                        };

                        // 1) Built-in policies: bash deny regex + path jail +
                        //    instruction-set guard + injection scanner.
                        decision = builtInGates(tool, input);

                        // 2) Adversary mode (file-gated LLM reviewer) — only when the
                        //    built-in policies allowed, and only when the gate file exists.
                        if (!decision.block && ctx.adversary !== null) {
                                try {
                                        const adv = await decideAdversary(tool, input, ctx.adversary ?? undefined, ctx.callLlm);
                                        if (adv.block) decision = adv;
                                } catch (err: any) {
                                        logHook(ctx.runId, "PreToolUse", tool, "error", `adversary reviewer error: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }

                        // 3) User-configured hooks (multi-type: command/http/mcp/prompt/agent).
                        if (!decision.block && userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "PreToolUse")) {
                                const evt: HookEvent = { name: "PreToolUse", tool, input };
                                try {
                                        const r = await runHooksForEvent(userHooks.handlers.PreToolUse ?? [], evt, hookCtx);
                                        if (r.decision === "deny" || r.decision === "stop") {
                                                decision = userHooksToDecision(r);
                                        } else if (r.decision === "mutate" && r.mutatedInput) {
                                                // SA-B2 — TOCTOU re-check: the built-in gates
                                                // (and any approval that may have happened)
                                                // covered the ORIGINAL input; the mutated one
                                                // has passed NOTHING. Re-run the full built-in
                                                // stack on it BEFORE applying — a once-approved
                                                // poisoned hook must not become a policy bypass
                                                // (hooks ADD policy, never subtract). See
                                                // embracethered.com/blog/posts/2026/
                                                // toctou-agent-what-you-click-is-not-what-you-get/.
                                                const recheck = builtInGates(tool, r.mutatedInput);
                                                if (recheck.block) {
                                                        // The standard deny row below (logHook at the end of
                                                        // this handler) records decision + reason; the
                                                        // handler outputs are still logged by the hook layer.
                                                        decision = {
                                                                block: true,
                                                                reason: `mutated tool input failed policy re-check: ${recheck.reason}`,
                                                        };
                                                } else {
                                                        // Replace the tool input with the mutated version.
                                                        event.input = r.mutatedInput;
                                                        for (const o of r.outputs) logHook(ctx.runId, "PreToolUse", tool, "mutate", o.message);
                                                }
                                        } else {
                                                for (const o of r.outputs) logHook(ctx.runId, "PreToolUse", tool, o.kind, o.message);
                                        }
                                } catch (err: any) {
                                        logHook(ctx.runId, "PreToolUse", tool, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }

                        const details = {
                                tool,
                                input:
                                        tool === "bash" || tool === "powershell"
                                                ? String(input.command ?? "").slice(0, 500)
                                                : tool === "write"
                                                        ? { path: input.path, bytes: String(input.content ?? "").length }
                                                        : tool === "edit"
                                                                ? { path: input.path }
                                                                : input,
                        };
                        logHook(
                                ctx.runId,
                                "PreToolUse",
                                tool,
                                decision.block ? "deny" : "allow",
                                decision.block ? (decision.reason ?? "denied by policy") : "allowed",
                                details,
                        );
                        return decision.block ? { block: true, reason: decision.reason, terminate: false } : undefined;
                });

                // --- PostToolUse ----------------------------------------------------
                pi.on("tool_result", async (event: any, _ectx: any) => {
                        const tool = event?.toolName as string;
                        const input = event?.input ?? {};
                        let result: any;

                        if (tool === "write" || tool === "edit") {
                                const fileName = String(input.path ?? "");
                                const content = tool === "write" ? input.content : null;
                                const augment = syntaxCheck(fileName, content);
                                if (augment) {
                                        result = {
                                                content: [...(event.content ?? []), { type: "text", text: augment.appended }],
                                                isError: true,
                                        };
                                        logHook(ctx.runId, "PostToolUse", tool, "augment", `syntax gate flagged ${fileName}`, { fileName });
                                }
                        }

                        // User-configured PostToolUse hooks.
                        if (userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "PostToolUse")) {
                                const evt: HookEvent = { name: "PostToolUse", tool, input, result: event?.result };
                                try {
                                        const r = await runHooksForEvent(userHooks.handlers.PostToolUse ?? [], evt, hookCtx);
                                        for (const o of r.outputs) {
                                                logHook(ctx.runId, "PostToolUse", tool, o.kind, o.message);
                                                // Surface the user hook's feedback to the model.
                                                if (o.kind === "feedback" || o.kind === "warning" || o.kind === "error") {
                                                        result = result ?? {
                                                                content: [...(event.content ?? [])],
                                                                isError: false,
                                                        };
                                                        result.content = [
                                                                ...(result.content ?? []),
                                                                { type: "text", text: `[PostToolUse:hook:${o.kind}] ${o.message}` },
                                                        ];
                                                        if (o.kind === "error") result.isError = true;
                                                }
                                        }
                                } catch (err: any) {
                                        logHook(ctx.runId, "PostToolUse", tool, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }

                        if (!result) {
                                const isError = Boolean(event?.isError);
                                logHook(
                                        ctx.runId,
                                        "PostToolUse",
                                        tool,
                                        isError ? "log-error" : "log",
                                        `tool finished (isError=${isError})`,
                                );
                        }
                        return result;
                });

                // --- Stop -----------------------------------------------------------
                pi.on("agent_end", async (event: any, _ectx: any) => {
                        const messages = Array.isArray(event?.messages) ? event.messages.length : 0;
                        logHook(ctx.runId, "Stop", null, "log", `agent loop ended after ${messages} messages`);
                        if (userHooks && hasHandlersFor({ version: 1, hooks: userHooks.handlers }, "Stop")) {
                                const evt: HookEvent = { name: "Stop" };
                                try {
                                        await runHooksForEvent(userHooks.handlers.Stop ?? [], evt, hookCtx);
                                } catch (err: any) {
                                        logHook(ctx.runId, "Stop", null, "error", `user hook failed: ${err instanceof Error ? err.message : String(err)}`);
                                }
                        }
                });

                // Surface untrusted-project hooks.json via the bus so /doctor can
                // pick it up.
                if (userHooks?.approvalNeeded) {
                        emit("hook:approval-needed", { runId: ctx.runId });
                }
        };
        return { name: "self-learning-hooks", factory, hidden: true } as const;
}

// ---------------------------------------------------------------------------
// Standalone emitters for events pi doesn't fire itself (SubagentStart, etc.)
// ---------------------------------------------------------------------------

/** Emit a SubagentStart event — called by the `task` tool when a sub-run starts. */
export function emitSubagentStart(ctx: RunHookContext, subRunId: string, description: string): void {
        logHook(ctx.runId, "SubagentStart", "task", "log", `subagent ${subRunId} started: ${description}`);
        emit("hook:subagent-start", { runId: ctx.runId, subRunId, description });
}

/** Emit a TaskCompleted event — called by the `task` tool when a sub-run finishes. */
export function emitTaskCompleted(ctx: RunHookContext, subRunId: string, status: string): void {
        logHook(ctx.runId, "TaskCompleted", "task", "log", `subagent ${subRunId} completed: ${status}`);
        emit("hook:task-completed", { runId: ctx.runId, subRunId, status });
}

/** Emit a PermissionRequest event — called when a tool_call is about to be denied. */
export function emitPermissionRequest(ctx: RunHookContext, tool: string, reason: string): void {
        logHook(ctx.runId, "PermissionRequest", tool, "deny", reason);
        emit("hook:permission-request", { runId: ctx.runId, tool, reason });
}

// Re-export the new types for callers (cli.ts, doctor.ts, info.ts).
export type { HookConfig, HookHandler, HookEventName, HookOutputEntry } from "./hooks-config.ts";
export { countHandlers, loadHooksConfig as loadHooks, projectHooksConfigPath, userHooksConfigPath } from "./hooks-config.ts";
export { adversaryPath, injectionScannerPath };
