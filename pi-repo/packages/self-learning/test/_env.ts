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
// The outbox joins the order-independent roots (the 2026-10-27/28 release
// finds): the H2 heal pin reads UNOWN_OUTBOX_DIR right after a delivery
// that never touched the durable lane, and outbox-deadletter lists it at
// module scope — on a bucket-b worker whose earlier neighbors never
// outboxed a note the dir does not exist yet (the outbox write paths mkdir
// lazily), and bun's file execution order varies by platform/runner/
// scheduling, so the unguarded reads hit ENOENT — the v0.0.32 ubuntu
// release leg, the live-preview round's ubuntu CI + release legs, and the
// slug-keyed re-fix's own ubuntu release leg (61bae14) all crashed the
// same scandir. The dir materializes up front with the other redirect
// targets; the H2 pin's read also folds the no-dir case away itself.
mkdirSync(join(TEST_TMP_LITERAL, "unown-home", "notes", "outbox"), { recursive: true });

export const TEST_TMP = (() => {
        try {
                return realpathSync(TEST_TMP_LITERAL);
        } catch {
                return TEST_TMP_LITERAL; // exotic host: keep the literal spelling
        }
})();

process.env.PI_SELFLEARNING_DB ??= `${TEST_TMP}/selflearning.db`;
process.env.PI_SELFLEARNING_DATA ??= `${TEST_TMP}/data`;
// Never touch a live checkout's .run from the suite: on Windows a running
// engine can hold .run/engine.log exclusively (EBUSY on the spawn path), and
// the runtime files are per-profile anyway. The canonical override is
// UNOWN_RUNTIME_DIR (engine-supervisor.runDir).
process.env.UNOWN_RUNTIME_DIR ??= `${TEST_TMP}/run`;
// Dead endpoint (nothing listens on port 9): suite-a's llm.ts probes must
// never reach the live bridge.
process.env.PI_BRIDGE_URL ??= "http://127.0.0.1:9";
// Terminal-agent home away from the developer's real ~/.unown (termhooks.ts
// pulls term.ts, which reads UNOWN_HOME at module load).
// TRUTHINESS, not ??=: the checkout .env ships optional vars as `KEY=` and
// bun auto-loads it, so UNOWN_HOME arrives SET-BUT-EMPTY — `??=` keeps the
// empty string, term.ts's resolveUnownHome treats empty as unset (the repo
// `||` convention), and every test that writes agent config (models-catalog's
// writeAgentConfig) silently hit the REAL ~/.unown (the 2026-10-22 incident:
// a full-suite run rewrote a live Agnes install to openai/sk-test).
if (!process.env.UNOWN_HOME) process.env.UNOWN_HOME = `${TEST_TMP}/unown-home`;
// The web results store stays OFF for the suite by default: the existing
// websearch/provider tests are cache-blind (they assert upstream call
// counts), and a warmed store would make them order-dependent. The store's
// own integration tests re-enable it locally against a per-run temp dir.
process.env.UNOWN_WEB_CACHE ??= "0";
// Deterministic default for buildTerminalNote's [subagent] tag (read per call).
process.env.UNOWN_SUBAGENT ??= "";
// Governor ceilings OFF for the suite by default (governor.test.ts sets its
// own explicit limits per case): the shared redirected store accumulates
// llm_ledger rows from every file whose code path touches llm.ts chat()
// (against the dead bridge above — those are FAILED calls, but they still
// count toward the CALL budget), and the router tests assert real job
// executions that a stray 60-call/hour ceiling would silently skip.
process.env.PI_ENGINE_MAX_CALLS_HOUR ??= "0";
process.env.PI_ENGINE_MAX_TOKENS_HOUR ??= "0";
process.env.PI_ENGINE_MAX_TOKENS_DAY ??= "0";
// Same reasoning for the breaker: files that exercise llm.ts chat() against
// the dead bridge record consecutive failures, and the breaker state is
// in-memory for the WHOLE test process — without a huge threshold here, any
// later router/harness test would see "upstream backoff" and skip its
// learning jobs (run_count never moves, until() times out). governor.test.ts
// pins the real threshold semantics with explicit per-case overrides.
process.env.PI_LLM_BREAKER_THRESHOLD ??= "1000000";
// M3: never spawn engine children from test processes — the supervisor's
// spawn path launches `unown engine serve`, which from a bun test process
// would re-execute the test file. The spawn path is validated live
// (unown engine start against the real stack) instead.
process.env.PI_DISABLE_ENGINE_SPAWN ??= "1";
// Same class, the scheduler's env hot-reload: an in-process engine booted by
// the suite ticks reloadEnvIfChanged() on the DEFAULT state-root path, which
// in a checkout is the REPO's own .env — its live values (PI_BRIDGE_URL,
// model pins) hot-applied over these redirects mid-suite (the mine-guard
// dead-bridge lane and the models-catalog isolation tripwire both tripped on
// it). The hot-reload unit tests pass an explicit envPath and bypass the
// guard; live behavior is validated by the real stack.
process.env.PI_DISABLE_ENV_HOT_RELOAD ??= "1";
// M3: the supervisor's health probes must never find the DEVELOPER's live
// engine (:3030) from inside the suite — same dead-port convention the CLI
// helpers use. Tests that boot a real engine on an ephemeral port override
// this per-case.
process.env.UNOWN_ENGINE_URL ??= "http://127.0.0.1:9";
// Mem0 platform: the unit suite runs the deterministic LEXICAL embedder.
// The ONNX lane is install-on-demand (local-ml owns its own node_modules) and
// absent on stripped CI/sandboxes — `auto` would probe it at first platform
// use, and a half-installed lane (files present, @huggingface/transformers
// missing) fails at EMBED time deep inside mem0's pipeline. Tests that want
// the real platform inject it via opts.platform / setMemoryPlatformForTests
// (the fake is fully deterministic); anything that accidentally reaches the
// singleton still gets the hermetic lexical backend. Live lanes
// (memory-live/memory-poison) claim their own env under their gates.
process.env.PI_MEM0_EMBEDDER ??= "lexical";
