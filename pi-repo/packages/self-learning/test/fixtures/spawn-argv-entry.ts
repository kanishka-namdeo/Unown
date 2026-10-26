// Compiled into a scratch binary by windows-spawn-verbatim.test.ts. It records
// the argv/execPath/import.meta.url that a REAL standalone binary reports, so
// the spawn gate feeds measured values into the production builders instead of
// hand-typed ones. It never runs the engine — it only reports what it received.
import { appendFileSync } from "node:fs";

const record = process.env.UNOWN_SPAWN_PROBE_RECORD;
if (!record) {
        console.error("UNOWN_SPAWN_PROBE_RECORD is not set");
        process.exit(2);
}
appendFileSync(
        record,
        `${JSON.stringify({
                argv: process.argv,
                execPath: process.execPath,
                metaUrl: import.meta.url,
        })}\n`,
);
