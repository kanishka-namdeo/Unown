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
 *   PostToolUse — syntax gate: broken JS/TS gets the transpiler error fed
 *                 back to the agent instead of compounding.
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
import { deliverTerminalNote } from "./term.ts";

export interface TerminalHookOptions {
        cwd: string; // the user's real project directory
        engineUrl: string;
        strict?: boolean; // sandbox-grade deny-list (no network, no git push)
        verbose?: boolean; // print hook decisions to stderr
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
const SYSTEM_TREE = /^\/(?:etc|usr|var|bin|sbin|boot|lib|lib64|opt|srv|root)(?:\/|$)/;
const SYSTEM_TREE_WIN = /^[a-zA-Z]:[\\/](?:Windows|Program Files(?: \(x86\))?|PerfLogs|System Volume Information|\$Recycle\.Bin)(?:[\\/]|$)/i;
const RAW_DEVICE = /^\/dev\/(?:sd|nvme|hd|vd|xvd|mmcblk|loop|disk|mem|kmem|sr)/;
const RAW_DEVICE_WIN = /^\\\\\\.\\(?:physicaldrive|cdrom|[a-zA-Z]:)/i;
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
                let resolved = jailPath(cwd, target).resolved;
                for (const link of links) {
                        if (resolved === link.path || resolved.startsWith(`${link.path}/`)) {
                                resolved = `${resolvePath(cwd, link.target)}${resolved.slice(link.path.length)}`;
                        }
                }
                if (
                        SYSTEM_TREE.test(resolved) ||
                        SYSTEM_TREE_WIN.test(resolved) ||
                        RAW_DEVICE.test(resolved) ||
                        RAW_DEVICE_WIN.test(resolved) ||
                        SSH_TRUST_DIR.test(resolved)
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

        // Session state accumulated for the exit note
        let prompts = 0;
        let toolCalls = 0;
        const toolNames = new Set<string>();
        let lastAssistantText = "";
        let sessionStartTs = Date.now();

        const factory = (pi: any) => {
                pi.on("session_start", () => {
                        sessionStartTs = Date.now();
                        log(`session started in ${opts.cwd}`);
                });

                pi.on("input", (event: any) => {
                        if (typeof event?.text === "string" && event.text.trim()) prompts++;
                });

                pi.on("tool_call", (event: any) => {
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
                        return undefined;
                });

                pi.on("agent_end", (event: any) => {
                        // Capture the final assistant message of each turn for the note.
                        try {
                                const messages = Array.isArray(event?.messages) ? event.messages : [];
                                for (let i = messages.length - 1; i >= 0; i--) {
                                        const m = messages[i];
                                        if (m?.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
                                                lastAssistantText = m.content.trim();
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
