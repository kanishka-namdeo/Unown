/**
 * crash.ts — local crash records (the zero-telemetry crash-reporting path).
 *
 * Unown's privacy contract: NOTHING is ever sent anywhere — no Sentry, no
 * statsig, no upload. When the CLI crashes, the answer is a LOCAL record
 * under the user's own UNOWN_HOME that they can attach to a report
 * themselves (`unown info` prints the bundle; `unown bug` can prefill a
 * GitHub issue later).
 *
 * Deliberately records NO argv (prompts may contain secrets) and NO
 * environment — only the error, the version, and the platform.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** Write a sanitized local crash record; returns its path, or null when even that failed. */
export function writeCrashRecord(err: unknown, opts: { home?: string } = {}): string | null {
        try {
                // `||` not `??`: an empty UNOWN_HOME (bun auto-loads .env, where
                // .env.example ships it empty) means "unset" — see term.ts.
                const home = opts.home ?? (process.env.UNOWN_HOME || join(homedir(), ".unown"));
                const dir = join(home, "crashes");
                mkdirSync(dir, { recursive: true });
                const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
                let version = "unknown";
                try {
                        // The ROOT package.json is the version source of truth (same
                        // contract as `unown --version`): <repo-root>/package.json, found
                        // relative to this package's src/ dir (src -> package -> packages ->
                        // pi-repo -> repo root).
                        version = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "package.json"), "utf8")).version;
                } catch {
                        /* version is best-effort */
                }
                const e = err as { message?: string; stack?: string } | null;
                writeFileSync(
                        path,
                        JSON.stringify(
                                {
                                        ts: new Date().toISOString(),
                                        version,
                                        platform: `${process.platform}/${process.arch}`,
                                        runtime: typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`,
                                        error: { message: e?.message ?? String(err), stack: e?.stack ?? null },
                                        note: "local crash record only — nothing was sent anywhere; delete freely",
                                },
                                null,
                                2,
                        ),
                        "utf8",
                );
                return path;
        } catch {
                // Never mask the original error with crash-logging failures.
                return null;
        }
}
