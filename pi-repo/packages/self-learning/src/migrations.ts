/**
 * migrations.ts — forward-only schema migration for `~/.unown` user state.
 *
 * The state dir grows (agent/{models,auth,settings}.json, memory/, notes/,
 * update-check.json, update-state.json …). When a future release changes a
 * file's shape, the change ships as an ordered migration here instead of an
 * ad-hoc "if old shape then …" buried in a consumer — the pattern used by
 * kubectl config conversions, Claude Code's versioned ~/.claude.json and the
 * forward-only runner design.
 *
 * Contract:
 *   - `~/.unown/migrations.json` records { version, history[] }
 *   - migrations run IN ORDER, are idempotent, and each gets the home dir
 *   - every migration backs up the files it intends to touch BEFORE moving
 *     them (copy, never rename: a failed run leaves the original intact)
 *   - a failing migration is NON-FATAL (warn + record) — a broken cosmetic
 *     migration must never brick the CLI
 *   - today there are ZERO migrations: version 1 is the current shape, and
 *     the runner exists so the first real migration has somewhere to land
 *
 * Runs after `unown update` applies a new version, and is reported by
 * `unown doctor` (schema version + last migration result).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** UNOWN_HOME — mirrors term.ts (kept local: update.ts imports this module,
 *  so importing back from it would be circular). `||` not `??`: an empty
 *  value (bun auto-loads .env; .env.example ships it empty) means unset. */
function unownHomeLocal(env: NodeJS.ProcessEnv = process.env): string {
        return env.UNOWN_HOME || join(homedir(), ".unown");
}

export interface Migration {
        from: number; // applies when the recorded version equals this
        name: string;
        /** Returns true on success. Must be idempotent and never throw (runner
         *  catches, but a migration that throws mid-write is a bug). */
        run: (home: string) => Promise<boolean> | boolean;
}

export const CURRENT_STATE_VERSION = 1;

/** The ordered registry — empty at v1 by design (see module doc). */
export const MIGRATIONS: Migration[] = [];

export interface MigrationState {
        version: number;
        history?: { name: string; at: string; ok: boolean }[];
}

export function migrationsPath(home: string): string {
        return join(home, "migrations.json");
}

function readState(home: string): MigrationState {
        try {
                const parsed = JSON.parse(readFileSync(migrationsPath(home), "utf8")) as MigrationState;
                if (typeof parsed.version === "number") return parsed;
        } catch {
                // absent or unreadable — first run
        }
        return { version: 1 };
}

function writeState(home: string, state: MigrationState): void {
        const p = migrationsPath(home);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Copy `home/rel` to `home/rel.backup-<stamp>` before a migration touches it. */
export function backupStateFile(home: string, rel: string, stamp: string): boolean {
        const src = join(home, rel);
        if (!existsSync(src)) return false;
        const dst = join(home, `${rel}.backup-${stamp}`);
        try {
                copyFileSync(src, dst);
                return true;
        } catch {
                return false;
        }
}

export interface MigrationResult {
        version: number;
        applied: string[];
        failed: { name: string; error: string }[];
}

/** Apply every pending migration up to CURRENT_STATE_VERSION. */
export async function runMigrations(home: string, registry: Migration[] = MIGRATIONS): Promise<MigrationResult> {
        const state = readState(home);
        const result: MigrationResult = { version: state.version, applied: [], failed: [] };
        const history = state.history ?? [];

        let version = state.version;
        // loop instead of map so a failed migration does not stall the ones after
        // it (forward-only: each migration keys off its own `from` version)
        let progressed = true;
        while (progressed) {
                progressed = false;
                for (const m of registry) {
                        if (m.from !== version) continue;
                        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                        try {
                                const ok = await m.run(home);
                                if (ok) {
                                        version++;
                                        result.applied.push(m.name);
                                        history.push({ name: m.name, at: new Date().toISOString(), ok: true });
                                        progressed = true; // re-scan: the next migration may key off the new version
                                } else {
                                        result.failed.push({ name: m.name, error: "returned false" });
                                        history.push({ name: m.name, at: new Date().toISOString(), ok: false });
                                }
                        } catch (err) {
                                const message = err instanceof Error ? err.message : String(err);
                                result.failed.push({ name: m.name, error: message });
                                history.push({ name: m.name, at: new Date().toISOString(), ok: false });
                        }
                }
        }

        const finalVersion = Math.max(version, CURRENT_STATE_VERSION);
        writeState(home, { version: finalVersion, history: history.slice(-20) });
        result.version = finalVersion;
        return result;
}

/** Read the recorded schema version without running anything (doctor). */
export function readMigrationState(home: string): MigrationState {
        return readState(home);
}
