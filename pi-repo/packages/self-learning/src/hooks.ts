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
 * Every decision is logged to the hook_log table and pushed to the live bus.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, resolve as resolvePath } from "node:path";
import { emit } from "./bus.ts";
import { store } from "./store.ts";

export interface RunHookContext {
        runId: string;
        sandboxRoot: string; // absolute path the run is jailed to
        memoryVersion: number;
}

export type HookName = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStop";

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
                        return tail ? `${real}/${tail}` : real;
                } catch {
                        /* missing path (or broken symlink) — climb one level */
                }
                const parent = dirname(dir);
                if (parent === dir) return p; // reached "/" without an existing ancestor
                tail = tail ? `${basename(dir)}/${tail}` : basename(dir);
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
export function createHooksExtension(ctx: RunHookContext) {
        const factory = (pi: any) => {
                // --- SessionStart ---------------------------------------------------
                pi.on("session_start", (_event: any, _ectx: any) => {
                        logHook(ctx.runId, "SessionStart", null, "log", `session started (memory v${ctx.memoryVersion})`);
                });

                // --- UserPromptSubmit -----------------------------------------------
                pi.on("input", (event: any, _ectx: any) => {
                        const text = typeof event?.text === "string" ? event.text.slice(0, 300) : "";
                        logHook(ctx.runId, "UserPromptSubmit", null, "log", `prompt submitted: "${text}"`);
                });

                // --- PreToolUse -----------------------------------------------------
                pi.on("tool_call", (event: any, _ectx: any) => {
                        const tool = event?.toolName as string;
                        const input = event?.input ?? {};
                        let decision: PreToolDecision = { block: false };

                        if (tool === "bash" || tool === "powershell") {
                                const command = String(input.command ?? "");
                                decision = decideBash(command);
                        } else if (tool === "write" || tool === "edit" || tool === "read") {
                                const p = String(input.path ?? input.file_path ?? "");
                                if (p) {
                                        const jail = jailPath(ctx.sandboxRoot, p);
                                        if (!jail.ok) {
                                                decision = { block: true, reason: `path escapes the sandbox: ${p} (resolved ${jail.resolved})` };
                                        }
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
                pi.on("tool_result", (event: any, _ectx: any) => {
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
                pi.on("agent_end", (event: any, _ectx: any) => {
                        const messages = Array.isArray(event?.messages) ? event.messages.length : 0;
                        logHook(ctx.runId, "Stop", null, "log", `agent loop ended after ${messages} messages`);
                });
        };
        return { name: "self-learning-hooks", factory, hidden: true } as const;
}
