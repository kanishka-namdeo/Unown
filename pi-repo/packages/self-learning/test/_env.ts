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
import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// os.tmpdir()-based so the suite is portable (Windows %TEMP%, macOS
// /var/folders); on Linux this is still /tmp — the historical location.
// REALPATH-RESOLVED on purpose: on macOS /var and /var/folders are symlinks
// into /private/…, and the modules under test (store.ts data dir, termhooks
// TMP_ROOTS) resolve through realpath — a literal TEST_TMP would make every
// `DATA_DIR.startsWith(TEST_TMP)` tripwire fail on darwin.
const TEST_TMP_LITERAL = join(tmpdir(), "engine-tests-b");

mkdirSync(TEST_TMP_LITERAL, { recursive: true });

// Materialize the redirected roots UP FRONT (the round-two CI bug fix):
// src/store.ts only mkdirs dirname(DB_PATH) (= TEST_TMP) at module load, and
// DATA_DIR (<TEST_TMP>/data) is otherwise created lazily by whichever test
// first writes a memory tier. A tripwire test that realpathSync(DATA_DIR)s
// before that (bun's file execution order varies by platform/runner) hit
// ENOENT — CI ubuntu receipt 39072290887, `memory.test.ts:60 lstats a
// /tmp/engine-tests-b subtree … an earlier test removed`. Creating both
// redirect targets here makes the invariant order-independent: whenever the
// env redirect was honored, the roots exist.
mkdirSync(join(TEST_TMP_LITERAL, "data"), { recursive: true });
mkdirSync(join(TEST_TMP_LITERAL, "unown-home"), { recursive: true });

export const TEST_TMP = (() => {
        try {
                return realpathSync(TEST_TMP_LITERAL);
        } catch {
                return TEST_TMP_LITERAL; // exotic host: keep the literal spelling
        }
})();

process.env.PI_SELFLEARNING_DB ??= `${TEST_TMP}/selflearning.db`;
process.env.PI_SELFLEARNING_DATA ??= `${TEST_TMP}/data`;
// Dead endpoint (nothing listens on port 9): suite-a's llm.ts probes must
// never reach the live bridge.
process.env.PI_BRIDGE_URL ??= "http://127.0.0.1:9";
// Terminal-agent home away from the developer's real ~/.unown (termhooks.ts
// pulls term.ts, which reads UNOWN_HOME at module load).
process.env.UNOWN_HOME ??= `${TEST_TMP}/unown-home`;
// The web results store stays OFF for the suite by default: the existing
// websearch/provider tests are cache-blind (they assert upstream call
// counts), and a warmed store would make them order-dependent. The store's
// own integration tests re-enable it locally against a per-run temp dir.
process.env.UNOWN_WEB_CACHE ??= "0";
// Deterministic default for buildTerminalNote's [subagent] tag (read per call).
process.env.UNOWN_SUBAGENT ??= "";
