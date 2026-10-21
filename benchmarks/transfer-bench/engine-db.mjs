/**
 * engine-db.mjs — locate the live engine's SQLite DB (the v3 precedent: the
 * notes table is read directly for control-arm purity and audit snapshots).
 * Source-mode engines keep it at <repo>/db/selflearning.db (store.ts DB_PATH).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function resolveEngineDb() {
        const candidates = [
                process.env.UNOWN_ENGINE_DB,
                join("/home/z/my-project/repos/Unown", "db", "selflearning.db"),
                join(homedir(), ".unown", "db", "selflearning.db"),
        ].filter(Boolean);
        for (const c of candidates) if (existsSync(c)) return c;
        throw new Error(`engine DB not found (tried: ${candidates.join(", ")})`);
}
