// Shared test-environment bootstrap for the self-learning engine unit tests.
//
// MUST be the FIRST import of every test file in this directory: src/store.ts
// opens its SQLite database at module scope, and static imports evaluate in
// declaration order — so this file gets to choose the database before any src
// module loads. Without it the tests would open the LIVE engine database
// (<repo>/db/selflearning.db, served by the bun --hot engine on :3030).
//
// Values are only set when unset, so a parallel test suite that brings its own
// redirect keeps theirs.
//
// Co-owned by the parallel a/b engine-test suites (a: llm/memory/tasks/notes;
// b: the /tmp/engine-tests-b default below). The extra redirects (dead bridge
// endpoint, isolated UNOWN_HOME) keep suite-a's llm/termhooks imports away
// from the live llm-bridge (:3031) and the developer's real ~/.unown.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// os.tmpdir()-based so the suite is portable (Windows %TEMP%, macOS
// /var/folders); on Linux this is still /tmp — the historical location.
export const TEST_TMP = join(tmpdir(), "engine-tests-b");

mkdirSync(TEST_TMP, { recursive: true });

process.env.PI_SELFLEARNING_DB ??= `${TEST_TMP}/selflearning.db`;
process.env.PI_SELFLEARNING_DATA ??= `${TEST_TMP}/data`;
// Dead endpoint (nothing listens on port 9): suite-a's llm.ts probes must
// never reach the live bridge.
process.env.PI_BRIDGE_URL ??= "http://127.0.0.1:9";
// Terminal-agent home away from the developer's real ~/.unown (termhooks.ts
// pulls term.ts, which reads UNOWN_HOME at module load).
process.env.UNOWN_HOME ??= `${TEST_TMP}/unown-home`;
// Deterministic default for buildTerminalNote's [subagent] tag (read per call).
process.env.UNOWN_SUBAGENT ??= "";
