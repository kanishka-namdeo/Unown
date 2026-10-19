/**
 * boot.ts — how an unown process starts, in one place.
 *
 * `bin/unown` calls this, and so does every compiled release binary. The entry
 * lives here rather than in the shim because `bun build --compile bin/unown`
 * silently produces a no-op executable (exit 0, no output, ~6 modules bundled):
 * the extensionless shim is not recognised as a main module, so the artifact
 * entry must be an extension-bearing module.
 */
import { runCli } from "./cli.ts";
import { writeCrashRecord } from "./crash.ts";

export function boot(argv: string[]): void {
    runCli(argv).catch((err: unknown) => {
        // A crash used to print one bare line and vanish. The privacy-first
        // answer (zero telemetry: nothing is ever SENT) is a LOCAL crash record
        // the user can attach to a report themselves — see crash.ts.
        const crashPath = writeCrashRecord(err);
        const e = err as { message?: string } | null;
        console.error("unown:", e?.message ?? String(err));
        if (crashPath) console.error(`crash record: ${crashPath} — attach it if you report this (also: unown info)`);
        process.exit(1);
    });
}

// Self-invoke when this module IS the process (a compiled release binary is
// built from it directly). `bin/unown` imports it and calls boot() itself, and
// import.meta.main is false there — measured on bun 1.4.2 in both shapes, so
// neither path can start the CLI twice.
if (import.meta.main) boot(process.argv.slice(2));
