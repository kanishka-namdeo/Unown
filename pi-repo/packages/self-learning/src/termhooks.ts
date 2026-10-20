/**
 * termhooks.ts — hooks + note capture for `unown` terminal sessions.
 *
 * Same hook semantics as hooks.ts (the engine's sandbox variant) but tuned for
 * a real interactive coding session in the user's project directory:
 *
 *   PreToolUse  — catastrophic-command deny-list (rm on / or home incl.
 *                 wrapped/expansion/split-flag/long-flag forms and system
 *                 directories, fork bombs, su, mkfs/dd/wipefs, world-
 *                 writable chmod on / and system trees, find/xargs/base64/
 *                 curl/printf/escape-based payloads piped to a shell, writes
 *                 to system paths, SSH trust files and raw devices — incl.
 *                 redirect targets that only reach those paths through an
 *                 in-project symlink); write-path jail to the project dir +
 *                 /tmp (reads stay unrestricted; symlinked escapes are
 *                 realpath-resolved). Network and git push are ALLOWED —
 *                 real work needs them (piping fetched bytes into a shell
 *                 is NOT network use and stays denied). Set
 *                 UNOWN_STRICT_HOOKS=1 to get the sandbox-grade deny-list
 *                 (adds sudo, ssh, network and git push).
 *                 AFTER those hard-coded checks pass, the granular
 *                 permissions layer (permissions.ts, docs/permissions.md)
 *                 evaluates user-configured allow/deny/ask rules — it can
 *                 only ADD restrictions, never weaken the checks above.
 *   PostToolUse — syntax gate: broken JS/TS gets the transpiler error fed
 *                 back to the agent instead of compounding; injection shield:
 *                 bash/powershell stdout is scanned for prompt injections and
 *                 suspect output gets a `[unown-injection-shield]` banner
 *                 prepended (content unmodified) via the same feedback
 *                 mechanism (UNOWN_INJECTION_SHIELD=0 disables).
 *   Stop        — captures the last assistant message for the session note.
 *   SessionEnd  — on session_shutdown the accumulated session note is
 *                 delivered to the engine (POST /api/notes) or written to the
 *                 outbox for later sync; AutoDream then consolidates it into
 *                 the project's .unown/memory/project.md.
 */
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { decideBash, jailPath, syntaxCheck } from "./bash-policy.ts";
import { assistantTextOf } from "./messages.ts";
import { createPermissionGate, type PermissionGate, type ToolCallDecision } from "./permissions.ts";
import { annotateToolOutput, recordShieldFlag, shieldEnabled } from "./shield.ts";
import { deliverTerminalNote } from "./term.ts";
import {
        engineAssumedDown,
        getEngineStatusInfo,
        describeSpawnCircuit,
        startEngineStatusLoop,
        stopEngineStatusLoop,
} from "./engine-status.ts";
import { decideAdversary } from "./adversary.ts";
import {
    hasHandlersFor,
    loadHooksConfig,
    projectHooksConfigPath,
    runHooksForEvent,
    type HookEvent,
    type HookEventName,
    type HookRunContext,
} from "./hooks-config.ts";
import { getActiveMcpManager } from "./mcp.ts";
import { trustBypassed, trustConfig, trustStatePath } from "./config-trust.ts";

export interface TerminalHookOptions {
        cwd: string; // the user's real project directory
        engineUrl: string;
        strict?: boolean; // sandbox-grade deny-list (no network, no git push)
        verbose?: boolean; // print hook decisions to stderr
        /** Injected permission gate (cli.ts shares one with the /permissions
         *  extension so session state — always-allow rules, trust notices —
         *  spans both). When absent a private gate is created; the layer is
         *  inert unless a permissions config exists. */
        permissions?: PermissionGate;
}

/** Terminal deny-list: catastrophic only. Network + git push allowed.
 *
 * Rules are deliberately UNANCHORED (substring) and tolerate trailing
 * quotes/parens/backticks/globs after the destructive target, so wrapped
 * payloads (`bash -c 'rm -rf /'`, `$(rm -rf /)`, `rm -rf /*`, `${HOME}`)
 * match too — same convention as hooks.ts BASH_DENY (which this list
 * mirrors for the catastrophic classes; strict sessions run both). */
const TERMINAL_BASH_DENY: { pattern: RegExp; reason: string }[] = [
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
        {
                // backreference on the function name: catches `:(){ :|:& };:` AND
                // `bomb(){ bomb|bomb& };bomb` (any self-piping recursion shape)
                pattern: /(\w+|:)\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;\s*\1(?!\w)/,
                reason: "refusing fork bomb",
        },
        { pattern: /\bsu\s/, reason: "refusing user switching" },
        { pattern: /mkfs(\.|\s)/, reason: "refusing filesystem format" },
        { pattern: /dd\s+[^\n]*of=\/dev\/(sd|nvme|hd)/, reason: "refusing raw writes to disk devices" },
        { pattern: /\bwipefs\b/, reason: "refusing disk signature wipe" },
        { pattern: />\s*\/(etc|usr|var|bin|root)\//, reason: "refusing writes to system paths" },
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
                // World-writable chmod on root AND on system trees (`chmod -R 777 /etc`
                // used to slip past the `/`-only tail).
                pattern:
                        /\bchmod\s+(?:-[a-zA-Z]+\s+)*777\s+\/(?:\s|\/|\*|['"`;|&)]|$|(?:etc|usr|var|bin|sbin|boot|lib|lib64|opt|srv|home|root)(?:\/|\s|['"`;|&)]|$))/,
                reason: "refusing world-writable chmod on system trees",
        },
        { pattern: /\bfind\b[^\n]*(?:-delete\b|-exec\s+rm\b)/, reason: "refusing find-based deletion" },
        {
                // Option values may be attached (`-I{}`) or separate (`-n 2`) — the old
                // `-[a-zA-Z]+\s+` shape let `xargs -I{} rm -rf {}` through.
                pattern: /\bxargs\b[^\n|;]*\brm\b/,
                reason: "refusing piped deletion via xargs",
        },
        {
                pattern: /\b(?:base64|openssl)\b[^\n|]*\|\s*(?:sh|bash)\b/,
                reason: "refusing decoded payloads piped to a shell",
        },
        {
                // Network-fetched code piped to a shell (curl|sh, wget -qO-|bash) —
                // same class as the base64 rule above. Plain curl/wget (no pipe
                // into a shell) stays allowed: real work needs the network.
                pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh|dash|ksh)\b/,
                reason: "refusing downloaded payloads piped to a shell",
        },
        {
                // printf builds the payload string at runtime — catches hex-escaped
                // (`printf '\x72m -rf /'`) and quote-split (`printf 'r''m -rf /'`) rm.
                pattern: /\bprintf\b[^\n|]*\|\s*(?:sh|bash|zsh|dash|ksh)\b/,
                reason: "refusing printf-built payloads piped to a shell",
        },
        {
                // Hex/octal escape sequences feeding a shell (`echo -e '\x72m …' | sh`).
                pattern: /(?:\\x[0-9a-fA-F]{2}|\\[0-7]{3})[^\n|;&]*\|\s*(?:sh|bash|zsh|dash|ksh)\b/,
                reason: "refusing escape-obfuscated payloads piped to a shell",
        },
        {
                // tee writes files just like a redirect but dodges the `>` rules.
                pattern: /\btee\b[^\n|;&]*(?:\.ssh\/|\/(?:etc|usr|var|bin|sbin|boot|lib|root)\/)/,
                reason: "refusing tee writes to system paths / SSH trust files",
        },
        // ---- Windows catastrophic family. Matched on ALL platforms on
        // purpose: Git Bash, WSL and the powershell tool make every Windows
        // spelling reachable from any host. Mirrors the POSIX catastrophic
        // classes above (drive root = `/`, system trees incl. the Users hive =
        // /etc + /home); benign Windows-native reads (dir, Get-*, reg query,
        // vssadmin list) stay allowed.
        { pattern: /\bformat\s+[a-zA-Z]:/i, reason: "refusing drive format" },
        {
                // cmd tree deletes (del/rd/rmdir/erase) on drive roots — twin of
                // the rm-on-filesystem-root rule. Flags may be `/`- or `-`-style,
                // any order; `C:\` and `C:\*` blocked, `C:\subdir` not (same
                // split as `rm /` vs `rm /etc`).
                pattern:
                        /\b(?:del|rd|rmdir|erase)\s+(?:[-/][a-zA-Z?*]+\s+)*[a-zA-Z]:[\\/](?:\s|\*|['"`;|&)]|[\\/]|$)/i,
                reason: "refusing delete on Windows drive roots",
        },
        {
                // …and on Windows system trees, incl. the Users hive (the POSIX
                // rm rules block /home the same way — use relative paths for
                // in-profile work, exactly the POSIX story).
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
                // rm-root rule. `Remove-Item -Recurse .\build` etc. stays
                // allowed (catastrophic-only bar).
                pattern:
                        /\bremove-item\s(?=[^\n]*-recurse\b)[^\n]*[a-zA-Z]:[\\/](?:\s|\*|['"`;|&)]|[\\/]|$)/i,
                reason: "refusing recursive delete on Windows drive roots",
        },
        {
                // …and against Windows system trees (incl. Users — same
                // rationale as the del rules).
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
        {
                // Raw device namespace writes (\\.\PhysicalDrive, \\.\CdRom,
                // \\.\C:) via redirect — twin of the /dev rule, incl. the
                // Git Bash //./ spelling.
                pattern: />\s*(?:\\\\|\/\/)\.[\\/]/i,
                reason: "refusing raw writes to Windows devices via redirect",
        },
];

const STRICT_EXTRA_DENY: { pattern: RegExp; reason: string }[] = [
        { pattern: /\bsudo\b/, reason: "sudo is not permitted" },
        {
                pattern:
                        /\b(curl|wget|nc|netcat)\b(?![^\n|;&]*(?:127\.0\.0\.1|localhost)\b)[^\n|;&]*(?:https?:\/\/|ftp:\/\/|\d+\.\d+\.\d+\.\d+|[a-z0-9-]+\.[a-z]{2,})/i,
                reason: "network access to external hosts is denied (strict hooks)",
        },
        { pattern: /\bssh\b[^\n]*@/, reason: "ssh to remote hosts is denied (strict hooks)" },
        { pattern: /\bgit\s+push\b/, reason: "git push is denied (strict hooks)" },
];

function decideTerminalBash(command: string, strict: boolean) {
        for (const rule of strict ? [...TERMINAL_BASH_DENY, ...STRICT_EXTRA_DENY] : TERMINAL_BASH_DENY) {
                if (rule.pattern.test(command)) return { block: true, reason: rule.reason };
        }
        if (strict) {
                const sandboxDecision = decideBash(command);
                if (sandboxDecision.block) return sandboxDecision;
        }
        return { block: false };
}

/** Safe write roots outside the project jail: the OS temp dir (realpath-
 *  resolved, so a symlinked TMPDIR still compares equal — jailPath returns
 *  realpath-resolved paths) plus POSIX /tmp (kept even when TMPDIR points
 *  elsewhere: /tmp stays the conventional scratch space on every POSIX host
 *  and the pre-existing policy allowed it). Computed once at module load.
 *  Both separator styles are honored (jailPath resolves with node:path, which
 *  yields backslash paths on Windows). */
const TMP_ROOTS: string[] = (() => {
        const roots = new Set<string>();
        for (const dir of [tmpdir(), "/tmp"]) {
                if (!dir) continue;
                roots.add(dir);
                try {
                        roots.add(realpathSync(dir));
                } catch {
                        /* not present — the literal spelling is enough */
                }
        }
        return [...roots];
})();

function insideRoot(root: string, p: string): boolean {
        // Degenerate roots ("", "/", "\", "C:\", …) would prefix-match entire
        // namespaces — never treat them as an allowed root (Bun's win32
        // realpath of "/tmp" can yield such forms on some hosts).
        if (!root || root === "/" || root === "\\" || /^[a-zA-Z]:[\\/]?$/.test(root)) return false;
        return p === root || p.startsWith(`${root}/`) || p.startsWith(`${root}\\`);
}

/** Path policy for terminal sessions: writes confined to the project dir and
 *  the system temp dir. `tmpRoots` overrides the computed set (unit tests
 *  inject a portable root); callers that omit it keep the default policy. */
export function terminalPathOk(cwd: string, p: string, tmpRoots: string[] = TMP_ROOTS): boolean {
        const jail = jailPath(cwd, p);
        if (jail.ok) return true;
        return tmpRoots.some((r) => insideRoot(r, jail.resolved));
}

// ---------------------------------------------------------------------------
// Bash redirect hardening: a `> target` that lexically looks harmless can
// point at /etc (or ~/.ssh, or a raw disk) through an in-project symlink —
// `ln -s /etc/passwd p && echo hacked > p`. jailPath realpaths the deepest
// existing ancestor, so re-checking every redirect target closes exactly
// that escape while `> out.txt`, `> /tmp/x`, `> ~/notes.md`, `2> /dev/null`
// and `2>&1` keep working (fail-open only for paths that resolve into the
// safe write set). `ln -s A B && … > B…` is simulated too — the link does
// not exist yet when the hook runs, but the redirect later in the same
// compound command will follow it. Regex-denied commands are handled above;
// this is the symlink/indirection half the regexes cannot see.
// ---------------------------------------------------------------------------
const REDIRECT_TARGET = />{1,2}\s*([^\s;|&]+)/g;
const LN_SYMLINK = /\bln\s+(?:-[a-zA-Z-]+\s+)*-s\s+(?:-[a-zA-Z-]+\s+)?(\S+)\s+([^\s;&|>]+)/g;
// POSIX originals kept; the _WIN twins add the Windows forms (drive-letter
// system trees, the \\.\ device namespace and backslash .ssh paths).
// They mirror the POSIX semantics exactly: the tree itself or anything under
// it. Fail-closed note: the .ssh twin also catches POSIX filenames containing
// literal backslashes around a .ssh segment — blocking there is the safe side.
// The optional `private/` prefix covers macOS, where /etc, /var & co. are
// symlinks into /private/… — jailPath realpaths through them, so the plain
// spellings would silently miss every symlink-indirected escape on darwin.
const SYSTEM_TREE = /^\/(?:private\/)?(?:etc|usr|var|bin|sbin|boot|lib|lib64|opt|srv|root)(?:\/|$)/;
const SYSTEM_TREE_WIN = /^[a-zA-Z]:[\\/](?:Windows|Program Files(?: \(x86\))?|PerfLogs|System Volume Information|\$Recycle\.Bin)(?:[\\/]|$)/i;
const RAW_DEVICE = /^\/dev\/(?:sd|nvme|hd|vd|xvd|mmcblk|loop|disk|mem|kmem|sr)/;
const RAW_DEVICE_WIN = /^\\\\\.\\(?:physicaldrive|cdrom|[a-zA-Z]:)/i;
const SSH_TRUST_DIR = /(^|[\\/])\.ssh[\\/]/;

function stripQuotes(s: string): string {
        return s.replace(/^["']+|["']+$/g, "");
}

/** True when a redirect target in `command` resolves into a system tree, an
 *  SSH trust directory or a raw device (directly, via an existing symlink,
 *  or via an `ln -s` earlier in the same command). */
export function bashRedirectEscape(cwd: string, command: string): string | null {
        // Symlinks the SAME command is about to create — apply them on top of
        // the (lexical) redirect resolution before the deny-set check.
        const links: Array<{ target: string; path: string }> = [];
        for (const m of command.matchAll(LN_SYMLINK)) {
                links.push({ target: stripQuotes(m[1]), path: resolvePath(cwd, stripQuotes(m[2])) });
        }
        for (const match of command.matchAll(REDIRECT_TARGET)) {
                const target = stripQuotes(match[1]);
                if (!target || target.startsWith("&")) continue; // `2>&1` style dup
                // LEXICAL FAST PATH — raw devices and ssh trust dirs are NEVER
                // legitimate write targets on any OS, so they are denied on
                // sight with no tmp exemption (win32 resolution of \\.\
                // device paths is implementation-defined in bun; and a
                // degenerate tmp root must never exempt a disk device).
                if (RAW_DEVICE.test(target) || RAW_DEVICE_WIN.test(target) || SSH_TRUST_DIR.test(target)) {
                        return `redirect target escapes the safe write set: ${target}`;
                }
                // System trees: denied on sight too, unless the target lexically
                // falls inside an allowed tmp root (macOS /var/folders/…) — the
                // resolved-path layer below re-confirms with symlink knowledge.
                if (
                        (SYSTEM_TREE.test(target) || SYSTEM_TREE_WIN.test(target)) &&
                        !TMP_ROOTS.some((r) => insideRoot(r, target))
                ) {
                        return `redirect target escapes the safe write set: ${target}`;
                }
                let resolved = jailPath(cwd, target).resolved;
                for (const link of links) {
                        if (resolved === link.path || resolved.startsWith(`${link.path}/`)) {
                                resolved = `${resolvePath(cwd, link.target)}${resolved.slice(link.path.length)}`;
                        }
                }
                // Allowed write roots are EXEMPT before the deny check (macOS:
                // os.tmpdir() lives under /private/var/…, which the private-
                // prefixed SYSTEM_TREE below would otherwise deny — over-blocking
                // every legitimate `> /tmp/…` scratch redirect on darwin).
                if (TMP_ROOTS.some((r) => insideRoot(r, resolved))) continue;
                // Defense-in-depth: node:path resolution can mangle device
                // paths (\\.\PhysicalDrive1 gains a drive prefix on win32) and
                // other unusual absolute forms, so the raw user-supplied target
                // is tested against the lexical deny regexes as well. Order
                // matters: the tmp exemption above ran on the RESOLVED path, so
                // legitimate `> /var/folders/…/T/log` spellings (macOS tmpdir)
                // never reach this deny set even though "^/var" matches them.
                if (
                        SYSTEM_TREE.test(resolved) ||
                        SYSTEM_TREE_WIN.test(resolved) ||
                        RAW_DEVICE.test(resolved) ||
                        RAW_DEVICE_WIN.test(resolved) ||
                        SSH_TRUST_DIR.test(resolved) ||
                        SYSTEM_TREE.test(target) ||
                        SYSTEM_TREE_WIN.test(target) ||
                        RAW_DEVICE.test(target) ||
                        RAW_DEVICE_WIN.test(target) ||
                        SSH_TRUST_DIR.test(target)
                ) {
                        return `redirect target escapes the safe write set: ${target} (resolved ${resolved})`;
                }
        }
        return null;
}

// ---------------------------------------------------------------------------
// User-configurable hooks (Milestone 1) — terminal-session runtime
//
// BEHAVIOR.md contract: user handlers in `.unown/hooks.json` (project,
// trust-gated) and `~/.unown/agent/hooks.json` (user, always trusted) ride
// on top of the built-in policies in EVERY session, engine runs and terminal
// sessions alike. hooks-config.ts owns the schema + handler runners; this
// section gives the terminal its dispatch runtime:
//   - callLlm for `prompt`/`agent` handlers rides the llm-bridge
//     (PI_BRIDGE_URL, the recommended stack) — a direct, streamless
//     /v1/chat/completions call, mirroring llm.ts:chat()'s request shape but
//     with zero engine imports (no bus, no SQLite). When the bridge is down
//     the handler reports the error and fails open, exactly like an engine
//     run whose callLlm is absent.
//   - callMcp for `mcp` handlers reaches the LIVE interactive MCP session
//     through mcp.ts:getActiveMcpManager() — never a second client. Before
//     the session connects any servers the handler errors + fails open.
//   - a module-level publish (emitTerminalHookEvent) lets sibling modules
//     emit the standalone events pi does not fire itself: tools.ts' task
//     tool emits SubagentStart/TaskCompleted; the PreToolUse deny path
//     emits PermissionRequest (M1.3, docs/BEHAVIOR.md).
// ---------------------------------------------------------------------------

/** Bridge base URL for terminal hook LLM calls, read at CALL time like llm.ts. */
function terminalBridgeUrl(): string {
        return process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031"; // `||`: empty .env value means unset
}

/** callLlm for `prompt`/`agent` hook handlers in terminal sessions. */
async function terminalCallLlm(prompt: string, model?: string): Promise<string> {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60_000);
        try {
                const res = await fetch(`${terminalBridgeUrl()}/v1/chat/completions`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                                model: model || process.env.PI_MODEL_ID || "kimi-k2.5",
                                messages: [{ role: "user", content: prompt }],
                                max_tokens: 2048,
                                stream: false,
                                thinking: { type: "disabled" },
                        }),
                        signal: ctrl.signal,
                });
                if (!res.ok) {
                        const text = await res.text().catch(() => "");
                        throw new Error(`llm-bridge ${res.status}: ${text.slice(0, 200)}`);
                }
                const completion = await res.json();
                const message = completion?.choices?.[0]?.message;
                const text =
                        typeof message?.content === "string" && message.content.length > 0
                                ? message.content
                                : typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0
                                  ? message.reasoning_content
                                  : "";
                if (!text) throw new Error("llm: empty completion");
                return text;
        } finally {
                clearTimeout(timer);
        }
}

/** callMcp for `mcp` hook handlers — reaches the live interactive session. */
async function terminalCallMcp(server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
        const manager = getActiveMcpManager();
        if (!manager) throw new Error("mcp handler: no live MCP session (servers not connected yet)");
        const result = await manager.callTool(server, tool, args);
        if (result.isError) throw new Error(String(result.text).slice(0, 200));
        return result.text;
}

/** The active terminal user-hooks runtime (one per process; subagent
 *  children spawn their own `unown` process with their own extension). */
let activeTerminalHooks: { handlers: Partial<Record<HookEventName, unknown[]>>; ctx: HookRunContext } | null = null;

/** True when the current terminal session has any user hooks loaded. */
export function terminalHooksActive(): boolean {
        return activeTerminalHooks !== null;
}

/** Emit a standalone user-hook event (SubagentStart / TaskCompleted /
 *  PermissionRequest) into the active terminal session's hook runtime.
 *  No-op without a session or without handlers for the event; failures are
 *  swallowed (hooks augment the session, they can never break it). */
export async function emitTerminalHookEvent(name: HookEventName, evt: Partial<HookEvent>): Promise<void> {
        const runtime = activeTerminalHooks;
        if (!runtime) return;
        const handlers = runtime.handlers[name];
        if (!Array.isArray(handlers) || handlers.length === 0) return;
        try {
                await runHooksForEvent(handlers as any, { name, ...evt } as HookEvent, runtime.ctx);
        } catch {
                /* fail-open by contract */
        }
}

export function createTerminalExtension(opts: TerminalHookOptions) {
        const strict = opts.strict ?? false;
        const verbose = opts.verbose ?? false;
        const log = (msg: string) => {
                if (verbose) console.error(`[unown] ${msg}`);
        };
        // Granular permissions gate (2-d). Created eagerly — the load is two
        // file stats + (rarely) a read — and shared with the /permissions
        // extension when cli.ts injects one. Failures inside the gate fail
        // OPEN to the hard-coded guardrails by contract (permissions.ts).
        const permissionGate: PermissionGate =
                opts.permissions ?? createPermissionGate({ cwd: opts.cwd, strict, verbose });

        // Session state accumulated for the exit note
        let prompts = 0;
        let toolCalls = 0;
        const toolNames = new Set<string>();
        let lastAssistantText = "";
        let sessionStartTs = Date.now();

        // User-configurable hooks (Milestone 1): load once per session;
        // `/hooks trust` re-runs this loader after an approval. Project-scoped
        // `.unown/hooks.json` is trust-gated exactly like mcp.json — an
        // untrusted file contributes NOTHING (refuse-first) and the session
        // surfaces the approval action.
        let resolvedHooks = loadHooksConfig(opts.cwd);
        let userHookHandlers = resolvedHooks.config.hooks;
        let hasUserHooks = Object.values(userHookHandlers).some((a) => Array.isArray(a) && a.length > 0);
        const hookRunCtx: HookRunContext = {
                runId: "terminal",
                sandboxRoot: opts.cwd,
                callLlm: terminalCallLlm,
                callMcp: terminalCallMcp,
        };
        const publishHooksRuntime = () => {
                activeTerminalHooks = hasUserHooks ? { handlers: userHookHandlers, ctx: hookRunCtx } : null;
        };
        publishHooksRuntime();

        /** Dispatch one user-hook event; never throws; logs outputs in -v. */
        const fireUser = async (name: HookEventName, evt: HookEvent) => {
                if (!hasHandlersFor({ version: 1, hooks: userHookHandlers }, name)) return undefined;
                try {
                        const r = await runHooksForEvent((userHookHandlers[name] as any) ?? [], evt, hookRunCtx);
                        if (verbose) for (const o of r.outputs) log(`user hook ${name}: [${o.kind}] ${o.message}`);
                        return r;
                } catch (err: any) {
                        log(`user hook ${name} failed (fail-open): ${String(err?.message ?? err)}`);
                        return undefined;
                }
        };

        const factory = (pi: any) => {
                pi.on("session_start", async (_event: any, ctx: any) => {
                        sessionStartTs = Date.now();
                        log(`session started in ${opts.cwd}`);
                        // M6 degraded-mode awareness: one unref'd probe loop for the
                        // process — footer line (memory: up|down|paused), ONE toast
                        // per state transition, gated auto-start kicks. Started here
                        // (never in the factory — extensions.md: no timers at factory
                        // scope); survives /new|resume|fork reloads, stopped at quit.
                        startEngineStatusLoop({
                                onFooter: (text) => {
                                        try {
                                                if (!ctx?.hasUI || typeof ctx.ui?.setStatus !== "function") return;
                                                ctx.ui.setStatus("engine", text);
                                        } catch {
                                                /* the footer is cosmetic — degrade silently */
                                        }
                                },
                                onToast: (message, level) => {
                                        try {
                                                ctx?.ui?.notify?.(message, level);
                                        } catch {
                                                /* non-fatal */
                                        }
                                },
                        });
                        // One-shot notice when the project permissions config is
                        // gated by trust (same UX as /mcp's untrusted banner).
                        const notice = permissionGate.consumeUntrustedNotice();
                        if (notice) {
                                try {
                                        ctx?.ui?.notify?.(notice, "warning");
                                } catch {
                                        /* non-fatal */
                                }
                        }
                        // Same refuse-first UX for the project hooks config.
                        if (resolvedHooks.approvalNeeded) {
                                try {
                                        ctx?.ui?.notify?.(
                                                `a project .unown/hooks.json is UNTRUSTED — its handlers are withheld until approved. Run /hooks trust, or set UNOWN_TRUST_PROJECT_CONFIG=1 (CI/headless bypass).`,
                                                "warning",
                                        );
                                } catch {
                                        /* non-fatal */
                                }
                        }
                        await fireUser("SessionStart", { name: "SessionStart" });
                });

                pi.on("input", async (event: any) => {
                        const text = typeof event?.text === "string" ? event.text : "";
                        if (text.trim()) prompts++;
                        // UserPromptSubmit — full text (capped at 4 KB so a
                        // template can't interpolate a whole file into a
                        // command; the engine logs cap at 300 chars but
                        // prompt-review handlers need the real payload).
                        if (text.trim()) {
                                await fireUser("UserPromptSubmit", { name: "UserPromptSubmit", prompt: text.slice(0, 4000) });
                        }
                });

                pi.on("tool_call", async (event: any, ctx: any) => {
                        const tool = event?.toolName as string;
                        const input = event?.input ?? {};
                        /** Single deny point: logs, emits the M1.3
                         *  PermissionRequest user-hook event, returns pi's
                         *  block shape. Every deny path funnels here. */
                        const deny = (reason: string) => {
                                log(`PreToolUse DENY ${tool}: ${reason}`);
                                void emitTerminalHookEvent("PermissionRequest", {
                                        name: "PermissionRequest",
                                        tool,
                                        context: { reason },
                                });
                                return { block: true, reason, terminate: false };
                        };
                        let decision: { block: boolean; reason?: string } = { block: false };

                        if (tool === "bash" || tool === "powershell") {
                                const command = String(input.command ?? "");
                                decision = decideTerminalBash(command, strict);
                                if (!decision.block) {
                                        // Regex layer passed — still check redirect targets for
                                        // symlink indirection into system paths / .ssh / devices.
                                        const escape = bashRedirectEscape(opts.cwd, command);
                                        if (escape) decision = { block: true, reason: escape };
                                }
                        } else if (tool === "write" || tool === "edit") {
                                const p = String(input.path ?? input.file_path ?? "");
                                if (p && !terminalPathOk(opts.cwd, p)) {
                                        decision = {
                                                block: true,
                                                reason: `write path escapes the project directory: ${p} (use the project dir or the system temp dir)`,
                                        };
                                }
                        }

                        if (decision.block) return deny(decision.reason!);

                        // Granular permissions layer (permissions.ts) — runs only
                        // AFTER the hard-coded deny-list + jail above passed, so it
                        // can only add restrictions: no rule can unlock `rm -rf /`
                        // or an out-of-jail write. Zero-surprise default: with no
                        // config files the check is inert.
                        try {
                                const perm = permissionGate.check(tool, input);
                                if (perm.blocked && perm.reason) return deny(perm.reason);
                                if (perm.needsAsk && perm.evaluation) {
                                        // The ask flow needs the extension ctx (ui.select).
                                        // Returns a thenable — pi's emitToolCall awaits
                                        // its handlers, so this is the sanctioned seam.
                                        const asking = permissionGate.handleAsk(tool, input, perm.evaluation, ctx);
                                        const resolved: ToolCallDecision | undefined = await asking;
                                        if (resolved?.block) return deny(resolved.reason!);
                                }
                        } catch (err: any) {
                                log(`permissions layer failed (fail-open to the hard-coded guardrails): ${err?.message ?? err}`);
                        }

                        // Adversary mode (M1.4): file-gated LLM reviewer over
                        // bash/powershell/write/edit — inert until the user opts in
                        // by creating the gate file (decideAdversary checks its
                        // existence first). callLlm rides the bridge; LLM errors
                        // fail OPEN (the built-in policies already passed).
                        try {
                                const adv = await decideAdversary(tool, input, undefined, terminalCallLlm);
                                if (adv.block) return deny(adv.reason ?? "denied by adversary reviewer");
                        } catch (err: any) {
                                log(`adversary reviewer error (fail-open): ${String(err?.message ?? err)}`);
                        }

                        // User-configurable PreToolUse hooks (M1): last word
                        // after every built-in layer. deny/stop blocks; mutate
                        // rewrites the tool input (same contract as engine runs).
                        const pre = await fireUser("PreToolUse", { name: "PreToolUse", tool, input });
                        if (pre) {
                                if (pre.decision === "deny" || pre.decision === "stop") {
                                        return deny(pre.reason ?? `denied by user hook (${pre.decision})`);
                                }
                                if (pre.decision === "mutate" && pre.mutatedInput) {
                                        event.input = pre.mutatedInput;
                                        log(`PreToolUse user hook MUTATED ${tool} input`);
                                }
                        }

                        toolCalls++;
                        if (tool) toolNames.add(tool);
                        return undefined;
                });

                pi.on("tool_result", async (event: any) => {
                        const tool = event?.toolName as string;
                        const input = event?.input ?? {};
                        let result: { content: any[]; isError?: boolean } | undefined;
                        if (tool === "write" || tool === "edit") {
                                const fileName = String(input.path ?? "");
                                const content = tool === "write" ? input.content : null;
                                const augment = syntaxCheck(fileName, content);
                                if (augment) {
                                        log(`PostToolUse syntax gate flagged ${fileName}`);
                                        result = {
                                                content: [...(event.content ?? []), { type: "text", text: augment.appended }],
                                                isError: true,
                                        };
                                }
                        }
                        // Injection shield: bash/powershell stdout is live hostile-content
                        // surface (a booby-trapped command's output, a fetched script's
                        // banner). Scan it and PREPEND the shield banner to suspect
                        // output — same feedback mechanism the syntax gate uses, but the
                        // result is NOT an error: the content passes through unmodified
                        // below the banner so the agent keeps working with the data.
                        // annotateToolOutput is fail-open; the wrapper below additionally
                        // guards content-shape surprises so no result is ever dropped.
                        if (tool === "bash" || tool === "powershell") {
                                if (shieldEnabled()) {
                                        try {
                                                const blocks = Array.isArray(event.content) ? event.content : [];
                                                const stdout = blocks
                                                        .map((b: any) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
                                                        .filter(Boolean)
                                                        .join("\n");
                                                const annotated = annotateToolOutput(stdout, tool, {
                                                        onFlag: (info) => {
                                                                log(`injection shield flagged ${info.source}: ${info.flags.join(", ")}`);
                                                                recordShieldFlag(pi, info);
                                                        },
                                                });
                                                if (annotated !== stdout) {
                                                        result = { content: [{ type: "text", text: annotated }] };
                                                }
                                        } catch {
                                                /* fail-open: never break a tool result */
                                        }
                                }
                        }
                        // User-configurable PostToolUse hooks (M1): feedback /
                        // warning / error outputs surface to the model — same
                        // merge contract as engine runs (feedback appends a
                        // [PostToolUse:hook:<kind>] block; error marks isError).
                        const post = await fireUser("PostToolUse", {
                                name: "PostToolUse",
                                tool,
                                input,
                                result: event?.result,
                        });
                        if (post) {
                                for (const o of post.outputs) {
                                        if (o.kind === "feedback" || o.kind === "warning" || o.kind === "error") {
                                                result = result ?? { content: [...(event.content ?? [])], isError: false };
                                                result.content = [
                                                        ...(result.content ?? []),
                                                        { type: "text", text: `[PostToolUse:hook:${o.kind}] ${o.message}` },
                                                ];
                                                if (o.kind === "error") result.isError = true;
                                        }
                                }
                        }
                        return result;
                });

                pi.on("agent_end", async (event: any) => {
                        // Capture the final assistant message of each turn for the note.
                        // pi's assistant content is an ARRAY of typed blocks (TextContent |
                        // ThinkingContent | ToolCall) — the old string-only check matched
                        // NOTHING, so every note shipped without its "Final outcome:" line.
                        try {
                                const messages = Array.isArray(event?.messages) ? event.messages : [];
                                for (let i = messages.length - 1; i >= 0; i--) {
                                        const text = assistantTextOf(messages[i]);
                                        if (text) {
                                                lastAssistantText = text;
                                                break;
                                        }
                                }
                        } catch {
                                /* best effort */
                        }
                        // Stop (M1): fired on every agent-loop end, same as engine runs.
                        await fireUser("Stop", { name: "Stop" });
                });

                // Pre/PostModelRequest + Pre/PostCompact (M1): the pi seams the
                // engine's hooks extension rides; identical no-op-until-configured
                // semantics in terminal sessions.
                pi.on("before_provider_request", async () => {
                        await fireUser("PreModelRequest", { name: "PreModelRequest" });
                });
                pi.on("after_provider_response", async () => {
                        await fireUser("PostModelRequest", { name: "PostModelRequest" });
                });
                pi.on("session_before_compact", async () => {
                        await fireUser("PreCompact", { name: "PreCompact" });
                });
                pi.on("session_compact", async () => {
                        await fireUser("PostCompact", { name: "PostCompact" });
                });

                // /hooks — the user-configurable hooks surface in the TUI:
                // status (sources, per-event counts, adversary gate) and
                // `/hooks trust` to approve a withheld project .unown/hooks.json
                // (the /mcp trust UX, mirrored for the hooks gate). Guarded:
                // minimal hosts and test harnesses may expose only `on`.
                if (typeof pi?.registerCommand === "function") {
                        pi.registerCommand("engine", {
                        description:
                                "Memory-engine status + degraded-mode diagnosis: /engine — what's up/down, queued notes, auto-start circuit, actions",
                        handler: async (_args: string, ctx: any) => {
                                try {
                                        const info = getEngineStatusInfo();
                                        const lines: string[] = [];
                                        lines.push(`memory engine — ${opts.engineUrl}`);
                                        if (info.state === "up") {
                                                const upMin = Math.max(1, Math.round((Date.now() - info.since) / 60000));
                                                lines.push(
                                                        `  status: UP${info.pid ? ` (pid ${info.pid})` : ""}${info.busyMs !== undefined && info.busyMs > 0 ? ` · busy on '${info.activeJob ?? "job"}' ${Math.round(info.busyMs / 1000)}s` : " · router idle"} · observed ${upMin}m ago in this session`,
                                                );
                                        } else if (info.state === "starting") {
                                                lines.push("  status: STARTING — a start was kicked, first probes pending (~seconds)");
                                        } else if (info.state === "paused") {
                                                lines.push("  status: PAUSED — chat works, memory reads use the last engine write, notes keep queuing locally");
                                        } else if (info.state === "down") {
                                                lines.push("  status: DOWN — chat unaffected; notes queue locally and sync when it returns");
                                        } else {
                                                lines.push("  status: unknown (first probe pending)");
                                        }
                                        lines.push(`  outbox: ${info.queuedNotes} queued${info.droppedNotes > 0 ? ` · ${info.droppedNotes} dropped while offline (oldest-first, cap ${"UNOWN_OUTBOX_MAX"})` : ""}`);
                                        lines.push(`  auto-start: ${describeSpawnCircuit(info.spawn)}`);
                                        if (info.state !== "up") {
                                                lines.push("  memory files on disk keep serving the agent (last engine write is the fallback)");
                                                lines.push("  actions: unown engine start · unown engine status · /learning (memory stack)");
                                        } else {
                                                lines.push("  actions: /learning (memory stack) · unown engine stop · dashboard :3000");
                                        }
                                        ctx.ui?.notify?.(lines.join("\n"), "info");
                                } catch (err: any) {
                                        ctx.ui?.notify?.(`/engine failed: ${err?.message ?? err}`, "error");
                                }
                        },
                        });
                        pi.registerCommand("hooks", {
                        description:
                                "User-configurable hooks status: /hooks — /hooks trust approves a project .unown/hooks.json",
                        handler: async (args: string, ctx: any) => {
                                const sub = (args ?? "").trim().toLowerCase();
                                const projectFile = projectHooksConfigPath(opts.cwd);
                                if (sub === "trust") {
                                        if (trustBypassed()) {
                                                ctx.ui.notify("UNOWN_TRUST_PROJECT_CONFIG is set — the trust gate is already bypassed.", "info");
                                                return;
                                        }
                                        if (!existsSync(projectFile)) {
                                                ctx.ui.notify("No project .unown/hooks.json found — nothing to trust.", "info");
                                                return;
                                        }
                                        const ok = trustConfig(projectFile, { statePath: trustStatePath() });
                                        if (!ok) {
                                                ctx.ui.notify(`Trusting ${projectFile} failed (unreadable file or unwritable trust state).`, "error");
                                                return;
                                        }
                                        log(`trusted ${projectFile} — reloading hooks`);
                                        resolvedHooks = loadHooksConfig(opts.cwd);
                                        userHookHandlers = resolvedHooks.config.hooks;
                                        hasUserHooks = Object.values(userHookHandlers).some((a) => Array.isArray(a) && a.length > 0);
                                        publishHooksRuntime();
                                        const count = Object.values(userHookHandlers).reduce(
                                                (n, a) => n + (Array.isArray(a) ? a.length : 0),
                                                0,
                                        );
                                        ctx.ui.notify(`Trusted ${projectFile} — ${count} handler(s) active.`, "info");
                                        return;
                                }
                                // Status report.
                                const lines: string[] = [];
                                const anyHandlers = Object.values(userHookHandlers).some((a) => Array.isArray(a) && a.length > 0);
                                if (!anyHandlers) {
                                        lines.push("No user hooks configured.");
                                } else {
                                        lines.push("User hooks (docs/BEHAVIOR.md):");
                                        for (const [name, handlers] of Object.entries(userHookHandlers)) {
                                                if (Array.isArray(handlers) && handlers.length > 0) {
                                                        lines.push(`  ${name}: ${handlers.length} handler(s)`);
                                                }
                                        }
                                }
                                if (resolvedHooks.sources.user.length) lines.push(`user config: ${resolvedHooks.sources.user.join(", ")}`);
                                if (resolvedHooks.sources.project.length) lines.push(`project config (trusted): ${resolvedHooks.sources.project.join(", ")}`);
                                if (resolvedHooks.approvalNeeded) {
                                        lines.push(
                                                `⚠ project .unown/hooks.json is UNTRUSTED — its handlers are withheld. Run /hooks trust, or set UNOWN_TRUST_PROJECT_CONFIG=1 (CI/headless bypass).`,
                                        );
                                }
                                ctx.ui.notify(lines.join("\n"), "info");
                        },
                        });
                }

                pi.on("session_shutdown", async (event: any, _ctx: any) => {
                        if (event?.reason !== "quit") return; // new/resume/fork reloads keep the session alive
                        if (prompts === 0 && toolCalls === 0) {
                                stopEngineStatusLoop();
                                return; // nothing happened — no note
                        }
                        try {
                                const note = buildTerminalNote({
                                        cwd: opts.cwd,
                                        prompts,
                                        toolCalls,
                                        toolNames: [...toolNames],
                                        lastAssistantText,
                                        sessionStartTs,
                                });
                                // M6 fast path: a recent probe says the engine is down
                                // (or the crash-loop circuit gave up) → skip the probe
                                // + POST entirely, land in the outbox instantly, keep
                                // the quit snappy even against a hanging port.
                                const assumeDown = engineAssumedDown();
                                const result = await deliverTerminalNote(
                                        { content: note, projectPath: opts.cwd, ts: Date.now() },
                                        { assumeDown },
                                );
                                log(`session note ${result.delivered ? "delivered to engine" : "queued in outbox"} (${result.via})`);
                        } catch (err: any) {
                                log(`failed to deliver session note: ${err?.message ?? err}`);
                        } finally {
                                stopEngineStatusLoop();
                        }
                });
        };

        return { name: "unown-terminal", factory, hidden: true } as const;
}

export function buildTerminalNote(info: {
        cwd: string;
        prompts: number;
        toolCalls: number;
        toolNames: string[];
        lastAssistantText: string;
        sessionStartTs: number;
}): string {
        const durMin = Math.max(1, Math.round((Date.now() - info.sessionStartTs) / 60000));
        const subagentTag = process.env.UNOWN_SUBAGENT === "1" ? " [subagent]" : "";
        const lines: string[] = [];
        lines.push(
                `Terminal session${subagentTag} in ${info.cwd} (${durMin} min): ${info.prompts} prompt(s), ${info.toolCalls} tool call(s)${info.toolNames.length ? ` (${info.toolNames.join(", ")})` : ""}.`,
        );
        if (info.lastAssistantText) lines.push(`Final outcome: ${info.lastAssistantText.slice(0, 400)}`);
        lines.push(
                `If the session hit failures or discovered project-specific pitfalls, record them as concise imperative rules; otherwise record any durable project conventions worth remembering.`,
        );
        return lines.join("\n");
}
