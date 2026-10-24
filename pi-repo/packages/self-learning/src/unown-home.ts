/**
 * unown-home.ts — the single source of truth for the unown user-state root.
 *
 * Extracted from term.ts (2026-10-24 session-workflow round) so lightweight
 * modules (`sessions-cli.ts`, `tools.ts` slash commands, tests) can resolve
 * the user session store WITHOUT importing term.ts's heavier graph
 * (memzero, engine-supervisor, skill seeds…). term.ts re-exports
 * `resolveUnownHome` from here — one definition, no drift.
 *
 * The env-driven override (`UNOWN_HOME`) is read at CALL time, not module
 * load, so tests can point the CLI at a temp home per-test.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the unown home dir. `UNOWN_HOME` wins when set to a non-empty
 * string (an EMPTY string means "unset, use the real home" — the `??`
 * footgun term.ts documented: `join("", "agent")` is a cwd-relative
 * `agent/` dir, which put user state in whatever dir the CLI ran from).
 */
export function resolveUnownHome(env: NodeJS.ProcessEnv = process.env): string {
    return env.UNOWN_HOME || join(homedir(), ".unown");
}

/**
 * The user session store — `~/.unown/agent/sessions/` — where the TUI and
 * print mode persist every real session (cli.ts hands pi this flat dir as
 * `sessionDir`). Env-read at call time; see `resolveUnownHome`.
 */
export function resolveUserSessionDir(env: NodeJS.ProcessEnv = process.env): string {
    return join(resolveUnownHome(env), "agent", "sessions");
}
