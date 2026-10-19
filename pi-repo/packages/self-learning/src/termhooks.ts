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
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { decideBash, jailPath, syntaxCheck } from "./hooks.ts";
import { assistantTextOf } from "./messages.ts";
import { createPermissionGate, type PermissionGate, type ToolCallDecision } from "./permissions.ts";
import { annotateToolOutput, recordShieldFlag, shieldEnabled } from "./shield.ts";
import { deliverTerminalNote } from "./term.ts";

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

        const factory = (pi: any) => {
                pi.on("session_start", (_event: any, ctx: any) => {
                        sessionStartTs = Date.now();
                        log(`session started in ${opts.cwd}`);
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
                });

                pi.on("input", (event: any) => {
                        if (typeof event?.text === "string" && event.text.trim()) prompts++;
                });

                pi.on("tool_call", (event: any, ctx: any) => {
                        const tool = event?.toolName as string;
                        const input = event?.input ?? {};
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

                        if (decision.block) {
                                log(`PreToolUse DENY ${tool}: ${decision.reason}`);
                                return { block: true, reason: decision.reason, terminate: false };
                        }

                        // Granular permissions layer (permissions.ts) — runs only
                        // AFTER the hard-coded deny-list + jail above passed, so it
                        // can only add restrictions: no rule can unlock `rm -rf /`
                        // or an out-of-jail write. Zero-surprise default: with no
                        // config files the check is inert.
                        try {
                                const perm = permissionGate.check(tool, input);
                                if (perm.blocked && perm.reason) {
                                        log(`PreToolUse DENY ${tool}: ${perm.reason}`);
                                        return { block: true, reason: perm.reason, terminate: false };
                                }
                                if (perm.needsAsk && perm.evaluation) {
                                        // The ask flow needs the extension ctx (ui.select).
                                        // Returns a thenable — pi's emitToolCall awaits
                                        // its handlers, so this is the sanctioned seam.
                                        const asking = permissionGate.handleAsk(tool, input, perm.evaluation, ctx);
                                        return (async () => {
                                                const resolved: ToolCallDecision | undefined = await asking;
                                                if (resolved?.block) {
                                                        log(`PreToolUse DENY ${tool}: ${resolved.reason}`);
                                                        return {
                                                                block: true,
                                                                reason: resolved.reason,
                                                                terminate: resolved.terminate ?? false,
                                                        };
                                                }
                                                toolCalls++;
                                                if (tool) toolNames.add(tool);
                                                return undefined;
                                        })();
                                }
                        } catch (err: any) {
                                log(`permissions layer failed (fail-open to the hard-coded guardrails): ${err?.message ?? err}`);
                        }
                        toolCalls++;
                        if (tool) toolNames.add(tool);
                        return undefined;
                });

                pi.on("tool_result", (event: any) => {
                        const tool = event?.toolName as string;
                        const input = event?.input ?? {};
                        if (tool === "write" || tool === "edit") {
                                const fileName = String(input.path ?? "");
                                const content = tool === "write" ? input.content : null;
                                const augment = syntaxCheck(fileName, content);
                                if (augment) {
                                        log(`PostToolUse syntax gate flagged ${fileName}`);
                                        return {
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
                                                        return { content: [{ type: "text", text: annotated }] };
                                                }
                                        } catch {
                                                /* fail-open: never break a tool result */
                                        }
                                }
                        }
                        return undefined;
                });

                pi.on("agent_end", (event: any) => {
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
                });

                pi.on("session_shutdown", async (event: any, _ctx: any) => {
                        if (event?.reason !== "quit") return; // new/resume/fork reloads keep the session alive
                        if (prompts === 0 && toolCalls === 0) return; // nothing happened — no note
                        try {
                                const note = buildTerminalNote({
                                        cwd: opts.cwd,
                                        prompts,
                                        toolCalls,
                                        toolNames: [...toolNames],
                                        lastAssistantText,
                                        sessionStartTs,
                                });
                                const result = await deliverTerminalNote({ content: note, projectPath: opts.cwd, ts: Date.now() });
                                log(`session note ${result.delivered ? "delivered to engine" : "queued in outbox"} (${result.via})`);
                        } catch (err: any) {
                                log(`failed to deliver session note: ${err?.message ?? err}`);
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
