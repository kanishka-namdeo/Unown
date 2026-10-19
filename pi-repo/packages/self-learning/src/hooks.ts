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
 * compose with `decideBash`/`jailPath` below.
 *
 * Every decision is logged to the hook_log table and pushed to the live bus.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { emit } from "./bus.ts";
import { adversaryPath, decideAdversary, type AdversaryConfig } from "./adversary.ts";
import { decideInjection, injectionScannerPath } from "./injection-scanner.ts";
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

// ---------------------------------------------------------------------------
// PreToolUse policies
// ---------------------------------------------------------------------------
// Rules are deliberately UNANCHORED (substring) and the destructive targets
// tolerate trailing quotes/parens/backticks/globs, so wrapped payloads
// (`bash -c 'rm -rf /'`, `$(rm -rf /)`, `xargs rm -rf /`, `rm -rf /*`) match
// too. The network rule keeps an explicit loopback exemption (127.0.0.1 /
// localhost) so engine-side bridge calls stay allowed. Flag groups tolerate
// short/long/split options (`rm --no-preserve-root -rf /`, `rm -r -f ~`), rm
// covers system directories (not just `/`), and payloads piped to a shell are
// denied whether base64-decoded, downloaded (curl|sh) or printf/escape-built.
const BASH_DENY: { pattern: RegExp; reason: string }[] = [
        {
                // Flags tolerate short (-rf), long (--no-preserve-root) and split
                // (-r -f) forms, so `rm --no-preserve-root -rf /` cannot sneak past.
                pattern: /\brm\s+(?:-{1,2}[a-zA-Z][a-zA-Z-]*\s+)*\/(?:\s|\/|\*|['"`;|&)]|$)/,
                reason: "refusing rm on filesystem root",
        },
        {
                // rm on system directories (incl. /home): `rm -rf /etc` etc. — the
                // root rule above only matches `/` itself.
                pattern: /\brm\s+(?:-{1,2}[a-zA-Z][a-zA-Z-]*\s+)*\/(?:etc|usr|var|bin|sbin|boot|lib|lib64|opt|srv|root|home)(?:\/|\s|['"`;|&)]|$)/,
                reason: "refusing rm on system directories",
        },
        {
                // Recursive flag may be split (`rm -r -f ~`) or long (--recursive);
                // the lookahead keeps plain non-recursive `rm ~/file` allowed.
                pattern: /\brm\s(?=[^\n]*-[a-zA-Z]*r)(?:-{1,2}[a-zA-Z][a-zA-Z-]*\s+)*(?:~|\$HOME|\$\{HOME\}|\/home)(?:\/|\s|['"`;|&)]|$)/,
                reason: "refusing recursive delete of home directories",
        },
        { pattern: /\bsudo\b/, reason: "sudo is not permitted in the sandbox" },
        { pattern: /\bsu\s/, reason: "switching users with su is not permitted in the sandbox" },
        {
                // backreference on the function name: catches `:(){ :|:& };:` AND
                // `bomb(){ bomb|bomb& };bomb` (any self-piping recursion shape)
                pattern: /(\w+|:)\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;\s*\1(?!\w)/,
                reason: "refusing fork bomb",
        },
        {
                pattern:
                        /\b(curl|wget|nc|netcat)\b(?![^\n|;&]*(?:127\.0\.0\.1|localhost)\b)[^\n|;&]*(?:https?:\/\/|ftp:\/\/|\d+\.\d+\.\d+\.\d+|[a-z0-9-]+\.[a-z]{2,})/i,
                reason: "network access to external hosts is denied in the sandbox",
        },
        { pattern: /\bssh\b[^\n]*@/, reason: "ssh to remote hosts is denied in the sandbox" },
        { pattern: /\bgit\s+push\b/, reason: "git push is denied in the sandbox" },
        { pattern: />\s*\/(etc|usr|var|bin|home|root)\//, reason: "redirecting writes to system paths is denied" },
        {
                // SSH trust files under any spelling of the home directory (~, $HOME,
                // /home/<user>, /root) — persistence via authorized_keys.
                pattern: />\s*(?:~|\$HOME|\$\{HOME\}|\/home\/\S+|\/root)\/\.ssh\//,
                reason: "refusing writes to SSH trust files (~/.ssh/authorized_keys)",
        },
        {
                pattern: />\s*\/dev\/(?:sd|nvme|hd|vd|xvd|mmcblk|loop|disk|mem|kmem|sr)/,
                reason: "refusing raw writes to disk devices via redirect",
        },
        {
                // Raw Windows device namespace writes (\\.\PhysicalDrive …),
                // incl. the Git Bash //./ spelling.
                pattern: />\s*(?:\\\\|\/\/)\.[\\/]/i,
                reason: "refusing raw writes to Windows devices via redirect",
        },
        { pattern: /\b(pkill|killall)\b/, reason: "signaling processes outside the sandbox is denied" },
        { pattern: /\bfind\b[^\n]*(?:-delete\b|-exec\s+rm\b)/, reason: "find-based deletion is denied in the sandbox" },
        {
                // Option values may be attached (`-I{}`) or separate (`-n 2`) — the old
                // `-[a-zA-Z]+\s+` shape let `xargs -I{} rm -rf {}` through.
                pattern: /\bxargs\b[^\n|;]*\brm\b/,
                reason: "piped deletion via xargs rm is denied in the sandbox",
        },
        {
                pattern: /\b(?:base64|openssl)\b[^\n|]*\|\s*(?:sh|bash)\b/,
                reason: "decoded payloads piped to a shell are denied in the sandbox",
        },
        {
                // Network-fetched code piped to a shell (curl|sh, wget -qO-|bash) — same
                // class as the base64 rule above.
                pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh|dash|ksh)\b/,
                reason: "downloaded payloads piped to a shell are denied",
        },
        {
                // printf builds the payload string at runtime — catches hex-escaped
                // (`printf '\x72m -rf /'`) and quote-split (`printf 'r''m -rf /'`) rm.
                pattern: /\bprintf\b[^\n|]*\|\s*(?:sh|bash|zsh|dash|ksh)\b/,
                reason: "printf-built payloads piped to a shell are denied",
        },
        {
                // Hex/octal escape sequences feeding a shell (`echo -e '\x72m …' | sh`).
                pattern: /(?:\\x[0-9a-fA-F]{2}|\\[0-7]{3})[^\n|;&]*\|\s*(?:sh|bash|zsh|dash|ksh)\b/,
                reason: "escape-obfuscated payloads piped to a shell are denied",
        },
        {
                // tee writes files just like a redirect but dodges the `>` rules.
                pattern: /\btee\b[^\n|;&]*(?:\.ssh\/|\/(?:etc|usr|var|bin|sbin|boot|lib|root)\/)/,
                reason: "tee writes to system paths / SSH trust files are denied",
        },
        { pattern: /mkfs(\.|\s)/, reason: "refusing filesystem format" },
        { pattern: /dd\s+[^\n]*of=\/dev\/(sd|nvme|hd)/, reason: "refusing raw writes to disk devices" },
        { pattern: /\bwipefs\b/, reason: "refusing disk signature wipe" },
        {
                // World-writable chmod on root AND on system trees (`chmod -R 777 /etc`
                // used to slip past the `/`-only tail).
                pattern:
                        /\bchmod\s+(?:-[a-zA-Z]+\s+)*777\s+\/(?:\s|\/|\*|['"`;|&)]|$|(?:etc|usr|var|bin|sbin|boot|lib|lib64|opt|srv|home|root)(?:\/|\s|['"`;|&)]|$))/,
                reason: "refusing world-writable chmod on system trees",
        },
        // ---- Windows catastrophic family. Matched on ALL platforms on
        // purpose: Git Bash, WSL and the powershell tool (whose commands reach
        // decideBash through the same tool_call path as bash) make every
        // Windows spelling reachable from any host. Mirrors the POSIX
        // catastrophic classes above; benign Windows-native reads (dir, Get-*,
        // reg query, vssadmin list) stay allowed.
        { pattern: /\bformat\s+[a-zA-Z]:/i, reason: "refusing drive format" },
        {
                // cmd tree deletes on drive roots — twin of the rm-on-root rule
                // (`C:\` and `C:\*` blocked, `C:\subdir` not).
                pattern:
                        /\b(?:del|rd|rmdir|erase)\s+(?:[-/][a-zA-Z?*]+\s+)*[a-zA-Z]:[\\/](?:\s|\*|['"`;|&)]|[\\/]|$)/i,
                reason: "refusing delete on Windows drive roots",
        },
        {
                // …and on Windows system trees, incl. the Users hive (the POSIX
                // rm rules block /home the same way).
                pattern:
                        /\b(?:del|rd|rmdir|erase)\s+(?:[-/][a-zA-Z?*]+\s+)*[a-zA-Z]:[\\/](?:Windows|Program Files(?: \(x86\))?|PerfLogs|System Volume Information|\$Recycle\.Bin|Users)(?:[\\/]|['"`;|&)]|\s|$)/i,
                reason: "refusing delete on Windows system trees",
        },
        { pattern: /\breg\s+(?:add|delete|import)\b/i, reason: "refusing registry modification" },
        { pattern: /\bbcdedit\b/i, reason: "refusing boot-configuration edits" },
        { pattern: /\bdiskpart\b/i, reason: "refusing disk partitioning" },
        { pattern: /\bvssadmin\s+delete\b/i, reason: "refusing shadow-copy deletion" },
        { pattern: /\bwbadmin\s+delete\b/i, reason: "refusing backup deletion" },
        { pattern: /\btakeown\s[^\n]*\/f\b/i, reason: "refusing ownership takeover" },
        { pattern: /\bcipher\s+\/w\b/i, reason: "refusing free-space wipe" },
        { pattern: /\bset-executionpolicy\b/i, reason: "refusing execution-policy changes" },
        { pattern: /\b(?:powershell|pwsh)(?:\.exe)?\s[^\n]*-encodedcommand\b/i, reason: "refusing encoded command payloads" },
        {
                // Recursive Remove-Item against drive roots — twin of the
                // rm-on-root rule; `Remove-Item -Recurse .\build` stays allowed.
                pattern:
                        /\bremove-item\s(?=[^\n]*-recurse\b)[^\n]*[a-zA-Z]:[\\/](?:\s|\*|['"`;|&)]|[\\/]|$)/i,
                reason: "refusing recursive delete on Windows drive roots",
        },
        {
                pattern:
                        /\bremove-item\s(?=[^\n]*-recurse\b)[^\n]*[a-zA-Z]:[\\/](?:Windows|Program Files(?: \(x86\))?|PerfLogs|System Volume Information|\$Recycle\.Bin|Users)(?:[\\/]|['"`;|&)]|\s|$)/i,
                reason: "refusing recursive delete on Windows system trees",
        },
        {
                // Killing the processes Windows cannot re-launch cleanly.
                pattern: /\btaskkill\s[^\n]*\/im\s+["']?(?:svchost|wininit|csrss|lsass|explorer)\b/i,
                reason: "refusing kills of critical system processes",
        },
        { pattern: /\bstop-process\s[^\n]*-name\s+["']?(?:svchost|wininit|csrss|lsass)\b/i, reason: "refusing kills of critical system processes" },
];

export interface PreToolDecision {
        block: boolean;
        reason?: string;
}

export function decideBash(command: string): PreToolDecision {
        for (const rule of BASH_DENY) {
                if (rule.pattern.test(command)) return { block: true, reason: rule.reason };
        }
        return { block: false };
}

/**
 * Resolve the deepest EXISTING ancestor of `p` to its real (symlink-free)
 * location and re-attach the non-existent tail lexically. Falls back to the
 * lexical path when nothing exists up to the filesystem root, so creating
 * brand-new files still works (only existing symlinks are resolved).
 */
function realpathAncestor(p: string): string {
        let dir = p;
        let tail = "";
        for (;;) {
                try {
                        const real = realpathSync(dir);
                        // join() (not `${real}/${tail}`): canonical separators on
                        // win32 (downstream compares use both styles) and no
                        // double slash when the existing ancestor is "/" itself
                        // (macOS hosts without /root — "//root/…" would dodge
                        // every ^/… deny regex).
                        return tail ? join(real, tail) : real;
                } catch {
                        /* missing path (or broken symlink) — climb one level */
                }
                const parent = dirname(dir);
                if (parent === dir) return p; // reached "/" without an existing ancestor
                tail = tail ? join(basename(dir), tail) : basename(dir);
                dir = parent;
        }
}

export function jailPath(sandboxRoot: string, p: string): { ok: boolean; resolved: string } {
        const resolved = resolvePath(sandboxRoot, p ?? ".");
        const lexicalOk =
                resolved === sandboxRoot || resolved.startsWith(`${sandboxRoot}/`) || resolved.startsWith(`${sandboxRoot}\\`);
        // Symlink hardening: a path that is lexically inside the jail can still
        // point outside via an in-jail symlink (proj/link -> /etc). Resolve the
        // deepest existing ancestor with realpath and re-check the prefix; the
        // root itself is realpathed the same way so a symlinked jail root keeps
        // working. New files (no existing ancestor below the root) resolve
        // lexically — the agent must be able to create files.
        let root = sandboxRoot;
        try {
                root = realpathSync(sandboxRoot);
        } catch {
                /* jail root does not exist yet — keep the lexical prefix */
        }
        const real = realpathAncestor(resolved);
        const realOk = real === root || real.startsWith(`${root}/`) || real.startsWith(`${root}\\`);
        return { ok: lexicalOk && realOk, resolved: real };
}

// ---------------------------------------------------------------------------
// PostToolUse: syntax gate for JS/TS files (the "auto-format / lint" analog)
// ---------------------------------------------------------------------------
const CHECKABLE = /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/;

export interface PostToolAugment {
        isError: boolean;
        appended: string;
}

export function syntaxCheck(fileName: string | undefined, content: string | undefined | null): PostToolAugment | null {
        if (!fileName || !CHECKABLE.test(fileName) || typeof content !== "string") return null;
        try {
                const transpiler = new Bun.Transpiler({
                        loader: CHECKABLE.test(".ts") && /\.(ts|mts|cts|tsx)$/.test(fileName) ? "ts" : "js",
                });
                transpiler.transformSync(content);
                return null;
        } catch (err: any) {
                const msg = String(err?.message ?? err).slice(0, 600);
                return {
                        isError: true,
                        appended: `\n\n[PostToolUse:hooks] Syntax check FAILED for ${fileName}:\n${msg}\nFix the syntax error before continuing.`,
                };
        }
}

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
                                        logHook(ctx.runId, "SessionStart", null, "error", `user hook failed: ${String(err?.message ?? err)}`);
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
                                        logHook(ctx.runId, "UserPromptSubmit", null, "error", `user hook failed: ${String(err?.message ?? err)}`);
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
                                        logHook(ctx.runId, "PreModelRequest", null, "error", `user hook failed: ${String(err?.message ?? err)}`);
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
                                        logHook(ctx.runId, "PostModelRequest", null, "error", `user hook failed: ${String(err?.message ?? err)}`);
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
                                        logHook(ctx.runId, "PreCompact", null, "error", `user hook failed: ${String(err?.message ?? err)}`);
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
                                        logHook(ctx.runId, "PostCompact", null, "error", `user hook failed: ${String(err?.message ?? err)}`);
                                }
                        }
                });

                // --- PreToolUse -----------------------------------------------------
                pi.on("tool_call", async (event: any, _ectx: any) => {
                        const tool = event?.toolName as string;
                        const input = event?.input ?? {};
                        let decision: PreToolDecision = { block: false };

                        // 1) Built-in policies: bash deny regex + path jail.
                        if (tool === "bash" || tool === "powershell") {
                                const command = String(input.command ?? "");
                                decision = decideBash(command);
                                // 1b) Prompt-injection scanner (regex + optional ML classifier).
                                if (!decision.block) {
                                        const inj = decideInjection(tool, input, ctx.sandboxRoot);
                                        if (inj.block) decision = inj;
                                }
                        } else if (tool === "write" || tool === "edit" || tool === "read") {
                                const p = String(input.path ?? input.file_path ?? "");
                                if (p) {
                                        const jail = jailPath(ctx.sandboxRoot, p);
                                        if (!jail.ok) {
                                                decision = { block: true, reason: `path escapes the sandbox: ${p} (resolved ${jail.resolved})` };
                                        }
                                }
                                // 1c) Injection scanner also scans write content.
                                if (!decision.block && (tool === "write" || tool === "edit")) {
                                        const inj = decideInjection(tool, input, ctx.sandboxRoot);
                                        if (inj.block) decision = inj;
                                }
                        }

                        // 2) Adversary mode (file-gated LLM reviewer) — only when the
                        //    built-in policies allowed, and only when the gate file exists.
                        if (!decision.block && ctx.adversary !== null) {
                                try {
                                        const adv = await decideAdversary(tool, input, ctx.adversary ?? undefined, ctx.callLlm);
                                        if (adv.block) decision = adv;
                                } catch (err: any) {
                                        logHook(ctx.runId, "PreToolUse", tool, "error", `adversary reviewer error: ${String(err?.message ?? err)}`);
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
                                                // Replace the tool input with the mutated version.
                                                event.input = r.mutatedInput;
                                                for (const o of r.outputs) logHook(ctx.runId, "PreToolUse", tool, "mutate", o.message);
                                        } else {
                                                for (const o of r.outputs) logHook(ctx.runId, "PreToolUse", tool, o.kind, o.message);
                                        }
                                } catch (err: any) {
                                        logHook(ctx.runId, "PreToolUse", tool, "error", `user hook failed: ${String(err?.message ?? err)}`);
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
                                        logHook(ctx.runId, "PostToolUse", tool, "error", `user hook failed: ${String(err?.message ?? err)}`);
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
                                        logHook(ctx.runId, "Stop", null, "error", `user hook failed: ${String(err?.message ?? err)}`);
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
