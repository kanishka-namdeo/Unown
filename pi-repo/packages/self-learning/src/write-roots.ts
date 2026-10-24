/**
 * write-roots.ts — session-scoped additional working directories
 * (Claude Code --add-dir / /add-dir parity; the 2026-10-24 trust round).
 *
 * Problem: every major terminal agent (Claude Code, Gemini CLI, Codex CLI)
 * lets the user grant the session additional working directories for
 * multi-repo work — a backend agent that also needs to touch the sibling
 * `../frontend`, a docs checkout, a shared config repo. Unown's terminal
 * write jail is hard-coded to the project dir + the OS temp dir (verified:
 * termhooks.ts terminalPathOk), so such work was impossible without
 * weakening the jail globally.
 *
 * Contract (the security shape, unchanged in spirit):
 *   - Additional roots are USER-INITIATED (a typed /add-dir command or an
 *     explicit --add-dir flag) — the same trust basis as Claude Code's
 *     --add-dir: the user is granting access, not the repo. That is why they
 *     are NOT config-file-driven in a cloned repo (a committed
 *     .unown/settings.json listing extra roots would be an attacker-scoped
 *     jail break-in waiting to happen); the project-settings layer may list
 *     them ONLY through the same trust gate every other project config
 *     passes (config-trust.ts).
 *   - Roots extend the WRITE jail only (edit/write tools + bash redirect
 *     targets). Bash READ access was never jailed (only the catastrophic
 *     deny-list applies), so nothing else changes.
 *   - The instruction-set write gate (SA-B2 — AGENTS.md, .unown/hooks.json,
 *     skills/**, ...) stays FINAL and root-independent: adding a directory
 *     that contains an AGENTS.md does not unlock writing it. Changes to the
 *     instruction set still go through a PR for human review.
 *   - Roots are realpath-resolved at add time (a symlinked root compares
 *     equal after jailPath's realpath resolution — the same trick the temp
 *     roots use), degenerate roots ("/", "C:\") are never accepted, and the
 *     project dir itself is quietly accepted-but-redundant (it is already
 *     jailed).
 *   - Session-scoped only: the registry lives in module state and dies with
 *     the process. Nothing is persisted here.
 */

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** Result of adding roots: what landed, what was refused and why. */
export interface WriteRootsResult {
    /** Realpath-resolved roots now active (the full registry). */
    roots: string[];
    /** Inputs that were accepted in this call (resolved). */
    added: string[];
    /** Inputs refused in this call, with the reason. */
    skipped: Array<{ input: string; reason: string }>;
}

/** The module-scoped registry (session-scoped by construction). */
let sessionRoots: string[] = [];

/** A degenerate root would prefix-match entire namespaces — never allowed
 *  (mirrors termhooks.ts insideRoot's guard, which also protects consumers). */
function isDegenerateRoot(root: string): boolean {
    if (!root || root === "/" || root === "\\") return true;
    return /^[a-zA-Z]:[\\/]?$/.test(root);
}

/**
 * Resolve one user-supplied root candidate against `cwd`.
 * Relative paths resolve like a shell would (cwd-relative). Returns the
 * realpath-resolved absolute path, or a refusal reason.
 */
export function resolveWriteRoot(cwd: string, input: string): { ok: true; root: string } | { ok: false; reason: string } {
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, reason: "empty path" };
    const absolute = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
    let st;
    try {
        st = statSync(absolute);
    } catch {
        return { ok: false, reason: `does not exist: ${absolute}` };
    }
    if (!st.isDirectory()) return { ok: false, reason: `not a directory: ${absolute}` };
    let real: string;
    try {
        real = realpathSync(absolute);
    } catch {
        return { ok: false, reason: `cannot resolve (realpath failed): ${absolute}` };
    }
    if (isDegenerateRoot(real)) return { ok: false, reason: `refusing degenerate root: ${real}` };
    return { ok: true, root: real };
}

/** Set the full registry from a list of inputs (the --add-dir boot path).
 *  Order is preserved, duplicates collapse, invalid entries are skipped with
 *  reasons (never fatal — a bad flag value must not kill the session). */
export function setSessionWriteRoots(cwd: string, inputs: readonly string[]): WriteRootsResult {
    const roots: string[] = [];
    const added: string[] = [];
    const skipped: Array<{ input: string; reason: string }> = [];
    for (const input of inputs) {
        const res = resolveWriteRoot(cwd, input);
        if (!res.ok) {
            skipped.push({ input, reason: res.reason });
            continue;
        }
        if (roots.includes(res.root)) continue; // duplicate (or same dir via two spellings)
        roots.push(res.root);
        added.push(res.root);
    }
    sessionRoots = roots;
    return { roots, added, skipped };
}

/** Add one root to the registry (the /add-dir command path). */
export function addSessionWriteRoot(cwd: string, input: string): WriteRootsResult {
    return setSessionWriteRoots(cwd, [...sessionRoots, input]);
}

/** The active roots (realpath-resolved). Copy returned — callers can't mutate. */
export function sessionWriteRoots(): string[] {
    return [...sessionRoots];
}

/** Clear the registry (the /add-dir clear path; also used by tests). */
export function clearSessionWriteRoots(): void {
    sessionRoots = [];
}
