/**
 * @earendil-works/pi-self-learning
 *
 * A self-learning layer for the pi coding agent, implementing the five
 * patterns Anthropic used to improve Claude Code with Claude:
 *
 *   1. Tiered Memory      — memory.ts   (policy > project > user > local)
 *   2. Self-Improving Harness — harness.ts (mine failures → patch → validate → ship)
 *   3. Routing            — router.ts   (interval + event jobs)
 *   4. Auto Dreaming      — dream.ts    (session notes → consolidated memory)
 *   5. Hooks              — hooks.ts    (PreToolUse/PostToolUse/SessionStart/Stop/...)
 *
 * plus sandbox.ts (isolated deploy & test sandboxes) and server.ts (REST+SSE API).
 */
export { store, DATA_DIR, DB_PATH, BRIDGE_URL } from "./store.ts";
export { chat, chatText, chatJson, bridgeHealth, bridgeLog } from "./llm.ts";
export {
        seedMemoryIfEmpty,
        resolveMemory,
        readTier,
        writeTier,
        appendRules,
        snapshot as memorySnapshot,
        history as memoryHistory,
        rollback as memoryRollback,
        TIERS,
        type Tier,
        type MemoryOverlay,
} from "./memory.ts";
export { createHooksExtension, decideBash, jailPath, syntaxCheck, logHook } from "./hooks.ts";
export { createSandbox, seedFiles, verifyInSandbox, snapshotFiles, listSandboxes, gcSandboxes, execInSandbox } from "./sandbox.ts";
export { seedTasks, listTasks, getTask, TASK_DEFS } from "./tasks.ts";
export { runAgent, getRun, listRuns, ensureAgentDir, type RunResult, type RunOptions, type TranscriptEntry } from "./runner.ts";
export { runCycle, runRegression, mineFailure, pickNextTask, listCycles, listImprovements } from "./harness.ts";
export { runDream, runProjectDream, listDreams } from "./dream.ts";
export { Router, router, listJobs, setJobEnabled, JOB_DEFS } from "./router.ts";
export { startServer, handleApi } from "./server.ts";
export { emit, emitAsync, subscribe, onAsync, bus } from "./bus.ts";
export { createNote, ingestTerminalNote, undreamedNotes, noteFromRun, pendingTerminalNotesByProject, slugifyProject, type NoteKind } from "./notes.ts";
export {
        UNOWN_HOME,
        UNOWN_AGENT_DIR,
        ENGINE_URL,
        STRICT_HOOKS,
        ensureUnownAgentDir,
        initProjectMemory,
        resolveTerminalMemory,
        projectMemoryPath,
        writeModelsJson,
        writeOutboxNote,
        deliverTerminalNote,
        readOutboxNotes,
        archiveOutboxNote,
} from "./term.ts";
export { createTerminalExtension, buildTerminalNote } from "./termhooks.ts";
export { syncNoteOutbox } from "./outbox.ts";
export { runCli } from "./cli.ts";
