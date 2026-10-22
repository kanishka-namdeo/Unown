/**
 * session-tools.ts — the default ACTIVE tool set for unown sessions.
 *
 * pi's own default is four tools (`read`, `bash`, `edit`, `write`) — a
 * deliberate minimalism (see the upstream philosophy docs). Unown's
 * reverse-engineering survey (Claude Code, Gemini CLI, OpenCode, Cursor,
 * Cline — every agent that ships dedicated search tools) says the
 * minimal set costs quality and tokens: without `grep`/`find`/`ls` the
 * model shells out through bash for every lookup, pays for the shell's
 * chatty output, and skips .gitignore-aware filtering entirely.
 *
 * Default composition (used only when the user has NOT configured
 * `defaultTools` in settings and no explicit `--tools` was passed):
 *
 *   - `read`, `bash`, `edit`, `write` — pi's base four, unchanged
 *   - `ls` — pure JS (node:fs), always safe
 *   - `grep` — enabled when a ripgrep binary answers on PATH
 *   - `find` — enabled when fd (or fdfind, Debian's spelling) is on PATH
 *
 * The binary detection exists because pi's grep/find shell out to rg/fd
 * and would otherwise auto-DOWNLOAD them on first use (ensureTool) — a
 * network side effect a DEFAULT first chat must not surprise anyone
 * with. When the binary is absent the session keeps pi's base four and
 * the system prompt's own guideline flips to "use bash for file
 * operations" (system-prompt.ts conditions that line on the active tool
 * set), so nothing degrades beyond the pre-change behavior.
 *
 * Pure module: no pi imports, no fs writes; PATH scanning only.
 */

import { statSync } from "node:fs";
import { join } from "node:path";

/** pi's base four — the upstream default, kept verbatim as the floor. */
export const BASE_SESSION_TOOLS: string[] = ["read", "bash", "edit", "write"];

/**
 * Resolve a binary name to an executable file on PATH, without spawning
 * anything. On Windows the PATHEXT extensions are probed (case-insensitive);
 * on POSIX the bare name only. Returns the first existing regular file, or
 * null. Never throws (an unreadable PATH entry is skipped).
 */
export function whichBinary(name: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string | null {
        const pathVar = env.PATH ?? env.Path ?? "";
        if (!pathVar || !name) return null;
        const isWin = platform === "win32";
        const dirs = pathVar.split(isWin ? ";" : ":");
        const exts: string[] = isWin
                ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
                          .split(";")
                          .map((e) => e.trim().toLowerCase())
                          .filter(Boolean)
                : [""];
        for (const dir of dirs) {
                if (!dir) continue;
                for (const ext of exts) {
                        const candidate = join(dir, isWin ? `${name}${ext}` : name);
                        try {
                                if (statSync(candidate).isFile()) return candidate;
                        } catch {
                                /* missing/unreadable — next */
                        }
                }
        }
        return null;
}

/**
 * The default active tool set for a unown session (see module doc).
 * Order matters only for display; pi registers tools by name.
 */
export function defaultSessionTools(env: NodeJS.ProcessEnv = process.env): string[] {
        const tools = [...BASE_SESSION_TOOLS];
        if (whichBinary("rg", env)) tools.push("grep");
        if (whichBinary("fd", env) || whichBinary("fdfind", env)) tools.push("find");
        tools.push("ls");
        return tools;
}
