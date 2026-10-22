/**
 * @earendil-works/pi-self-learning
 *
 * A self-learning layer for the pi coding agent, implementing the five
 * patterns Anthropic used to improve Claude Code with Claude:
 *
 *   1. Tiered Memory      — memory.ts + memzero.ts (policy > project > user > local;
 *                          the learning core is Mem0 — extraction, storage, search,
 *                          reconciliation — rendering to the same committable files)
 *   2. Self-Improving Harness — harness.ts (mine failures → patch → validate → ship)
 *   3. Routing            — router.ts   (interval + event jobs)
 *   4. Auto Dreaming      — dream.ts    (session notes → mem0 consolidation → render)
 *   5. Hooks              — hooks.ts    (PreToolUse/PostToolUse/SessionStart/Stop/...)
 *
 * plus sandbox.ts (isolated deploy & test sandboxes) and server.ts (REST+SSE API).
 */

export { bus, emit, emitAsync, onAsync, subscribe } from "./bus.ts";
export { runCli } from "./cli.ts";
export { listDreams, runDream, runProjectDream } from "./dream.ts";
export { listCycles, listImprovements, mineFailure, pickNextTask, runCycle, runRegression } from "./harness.ts";
export { createHooksExtension, decideBash, jailPath, logHook, syntaxCheck } from "./hooks.ts";
export { bridgeHealth, bridgeLog, chat, chatJson, chatText } from "./llm.ts";
export {
        ENGINE_SCOPE,
        getMemoryPlatform,
        importLegacyMarkdown,
        LexicalHashEmbedder,
        type MemoryPlatform,
        type MemoryPlatformEvent,
        type MemoryScope,
        memoryPlatformStatus,
        mem0Dir,
        mem0EmbedderMode,
        MEM0_DIM,
        projectScope,
        migrateLegacyScope,
        projectMemories,
        reconcileMemories,
        rememberNote,
        renderProjectMemoryMarkdown,
        searchMemories,
        setMemoryPlatformForTests,
        shipEngineRules,
        unshipEngineRules,
} from "./memzero.ts";
export {
        appendRules,
        history as memoryHistory,
        type MemoryOverlay,
        readTier,
        resolveMemory,
        rollback as memoryRollback,
        seedMemoryIfEmpty,
        snapshot as memorySnapshot,
        TIERS,
        type Tier,
        writeTier,
} from "./memory.ts";
export {
        createNote,
        ingestTerminalNote,
        type NoteKind,
        noteFromRun,
        pendingTerminalNotesByProject,
        slugifyProject,
        undreamedNotes,
} from "./notes.ts";
export {
        basenameSlug,
        normalizeGitRemote,
        projectKey,
        projectSlug,
        readGitRemoteUrl,
        resolveProjectIdentity,
} from "./project-identity.ts";
export { syncNoteOutbox } from "./outbox.ts";
export { JOB_DEFS, listJobs, Router, router, setJobEnabled } from "./router.ts";
export {
        ensureAgentDir,
        getRun,
        listRuns,
        type RunOptions,
        type RunResult,
        runAgent,
        type TranscriptEntry,
} from "./runner.ts";
export {
        createSandbox,
        execInSandbox,
        gcSandboxes,
        listSandboxes,
        seedFiles,
        snapshotFiles,
        verifyInSandbox,
} from "./sandbox.ts";
export { handleApi, startServer } from "./server.ts";
export { BRIDGE_URL, DATA_DIR, DB_PATH, store } from "./store.ts";
export { getTask, listTasks, seedTasks, TASK_DEFS } from "./tasks.ts";
export {
        archiveOutboxNote,
        deliverTerminalNote,
        ENGINE_URL,
        ensureUnownAgentDir,
        ensureUnownAgentDirAsync,
        ensureUnownAgentDirInfoAsync,
        initProjectMemory,
        probeBridgeHealth,
        projectMemoryPath,
        readOutboxNotes,
        resolveTerminalMemory,
        STRICT_HOOKS,
        UNOWN_AGENT_DIR,
        UNOWN_HOME,
        writeModelsJson,
        writeOutboxNote,
} from "./term.ts";
export { buildTerminalNote, createTerminalExtension } from "./termhooks.ts";
