/**
 * term.ts — terminal-agent configuration & per-project memory.
 *
 * Shared by the `unown` CLI (terminal sessions in the user's real cwd) and the
 * engine (project dreams + note-outbox sync). Contains NO pi imports — pure
 * filesystem + env logic — so both processes can use it freely.
 *
 * Layout:
 *   $UNOWN_HOME (default ~/.unown)
 *     agent/                 pi agent dir (models.json, auth.json, settings.json, sessions/)
 *     memory/policy.md       optional enterprise policy (tier 0)
 *     memory/user.md         global user memory (tier 2)
 *     notes/outbox/*.md      terminal session notes not yet delivered to the engine
 *     notes/done/*.md        notes after ingestion (archive)
 *   <project>/.unown/
 *     memory/project.md      project memory (tier 1) — what AutoDream maintains
 *     memory/local.md        local overrides (tier 3, gitignored)
 *     .gitignore             ignores local.md
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { pruneToBudget } from "./budget.ts";
import { seedAddonsConfig } from "./addons/config.ts";
import { spawnEngineDetached } from "./engine-supervisor.ts";
import { MEMORY_GUIDE, MEMORY_GUIDE_PATH } from "./memory-guide.ts";
import { STARTER_SKILLS } from "./skill-seeds.ts";
import { UNOWN_THEME, UNOWN_THEME_NAME } from "./theme.ts";

/**
 * Resolve the unown user-state home. `||`, not `??`: bun auto-loads the
 * repo-root `.env` (and `scripts/start.ts` exports it to every child), and
 * the shipped `.env.example` documents optional vars as `UNOWN_HOME=` — an
 * EMPTY string. `??` passed that through as `join("", "agent")` = a
 * cwd-relative `agent/` dir, so a fresh clone (`cp .env.example .env`) put
 * user state in whatever directory the CLI ran from. An empty value means
 * "unset, use the real home".
 */
export function resolveUnownHome(env: NodeJS.ProcessEnv = process.env): string {
        return env.UNOWN_HOME || join(homedir(), ".unown");
}

export const UNOWN_HOME = resolveUnownHome();
export const UNOWN_AGENT_DIR = join(UNOWN_HOME, "agent");
export const UNOWN_MEMORY_DIR = join(UNOWN_HOME, "memory");
export const UNOWN_NOTES_DIR = join(UNOWN_HOME, "notes");
export const UNOWN_OUTBOX_DIR = join(UNOWN_NOTES_DIR, "outbox");
export const UNOWN_NOTES_DONE_DIR = join(UNOWN_NOTES_DIR, "done");
// All env defaults below use `||`, never `??`: bun auto-loads the repo-root
// .env (and scripts/start.ts exports it to every child), where optional vars
// ship EMPTY ("KEY=") — an empty string must mean "unset", not override the
// default with a broken value (see resolveUnownHome above for the full story).
export const ENGINE_URL = (process.env.UNOWN_ENGINE_URL || "http://127.0.0.1:3030").replace(/\/+$/, "");
export const STRICT_HOOKS = /^(1|true|yes)$/i.test(process.env.UNOWN_STRICT_HOOKS ?? "");

// ---------------------------------------------------------------------------
// Agent dir (models.json etc.) — mirrors runner.ts ensureAgentDir but for the
// terminal agent dir. Users can hand-edit ~/.unown/agent/models.json to point
// at any OpenAI-compatible endpoint.
// ---------------------------------------------------------------------------
/** Result of ensuring the agent dir — `created` marks a FIRST run. */
export interface AgentDirInit {
        dir: string;
        created: boolean;
        provider: string;
        modelId: string;
}

let lastInit: AgentDirInit | null = null;

/** The bridge's served model ids — BRIDGE_KNOWN_MODELS (comma-separated;
 *  the allow-list the llm-bridge routes, see mini-services/llm-bridge).
 *  Used wherever models.json is seeded so the FULL catalog is registered
 *  (one entry per served id, defaultModel first): /model, --model and the
 *  subagent routing frontmatter can then route between them without a
 *  manual models.json edit. */
export function bridgeKnownModels(defaultModel: string): string[] {
        const raw = process.env.BRIDGE_KNOWN_MODELS || "kimi-k2.5,qwen3.7-plus,qwen3.6-plus";
        const ids = raw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        return [defaultModel, ...ids.filter((id) => id !== defaultModel)];
}

export function writeModelsJson(agentDir: string): { path: string; fresh: boolean; provider: string; modelId: string } {
        mkdirSync(agentDir, { recursive: true });
        const modelsPath = join(agentDir, "models.json");
        const provider = process.env.PI_PROVIDER || "zai-bridge";
        const modelId = process.env.PI_MODEL_ID || "kimi-k2.5";
        const baseUrl = (process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031").replace(/\/+$/, "");
        if (existsSync(modelsPath)) return { path: modelsPath, fresh: false, provider, modelId }; // never clobber user edits
        // The bridge placeholder key satisfies pi auth; when the bridge itself
        // requires a shared secret (BRIDGE_API_KEY), use it so the CLI matches.
        // `||`: BRIDGE_API_KEY="" (the .env.example default) must keep the
        // placeholder — with `??` the empty string leaked into models.json and
        // every session died with "No API key found".
        const apiKey = process.env.BRIDGE_API_KEY || "bridge-local";
        writeFileSync(
                modelsPath,
                JSON.stringify(
                        {
                                providers: {
                                        [provider]: {
                                                baseUrl: `${baseUrl}/v1`,
                                                api: "openai-completions",
                                                apiKey,
                                                models: bridgeKnownModels(modelId).map((id) => ({
                                                        id,
                                                        name: `${id} (via unown)`,
                                                        contextWindow: 131072,
                                                        maxTokens: 8192,
                                                        input: ["text", "image"],
                                                })),
                                        },
                                },
                        },
                        null,
                        2,
                ),
                "utf8",
        );
        return { path: modelsPath, fresh: true, provider, modelId };
}

/** Seed the starter Agent Skills into ~/.unown/agent/skills/ (never clobbers user edits). */
export function seedStarterSkills(agentDir: string): string {
        const skillsDir = join(agentDir, "skills");
        mkdirSync(skillsDir, { recursive: true });
        for (const skill of STARTER_SKILLS) {
                const dir = join(skillsDir, skill.dir);
                const file = join(dir, "SKILL.md");
                if (existsSync(file)) continue;
                mkdirSync(dir, { recursive: true });
                writeFileSync(file, skill.skillMd, "utf8");
        }
        return skillsDir;
}

/** Seed the unown brand theme into ~/.unown/agent/themes/ (never clobbers). */
export function seedUnownTheme(agentDir: string): string {
        const themesDir = join(agentDir, "themes");
        mkdirSync(themesDir, { recursive: true });
        const themePath = join(themesDir, `${UNOWN_THEME_NAME}.json`);
        if (!existsSync(themePath)) writeFileSync(themePath, `${JSON.stringify(UNOWN_THEME, null, "\t")}\n`, "utf8");
        return themePath;
}

export function ensureUnownAgentDirInfo(): AgentDirInit {
        const models = writeModelsJson(UNOWN_AGENT_DIR);
        const authPath = join(UNOWN_AGENT_DIR, "auth.json");
        if (!existsSync(authPath)) writeFileSync(authPath, "{}", "utf8");
        seedUnownTheme(UNOWN_AGENT_DIR);
        const settingsPath = join(UNOWN_AGENT_DIR, "settings.json");
        const settingsExisted = existsSync(settingsPath);
        if (!settingsExisted) {
                // Default provider/model pinned (no first-run picker) and the brand theme
                // selected — the same defaults `unown setup` builds on; re-run setup to
                // switch providers.
                writeFileSync(
                        settingsPath,
                        `${JSON.stringify(
                                {
                                    defaultProvider: models.provider,
                                    defaultModel: models.modelId,
                                    theme: UNOWN_THEME_NAME,
                                    // Fullscreen alt-screen TUI: the layout engine the split-view display mode
                                    // (band + files dock) is built on. Switch back any time via /settings
                                    // (Interface layout); existing installs keep their saved settings.
                                    tuiMode: "fullscreen",
                                },
                                null,
                                2,
                        )}\n`,
                        "utf8",
                );
        }
        mkdirSync(join(UNOWN_AGENT_DIR, "sessions"), { recursive: true });
        seedStarterSkills(UNOWN_AGENT_DIR);
        // TUI addons (ask_user_question / todo / advisor) — seeded only when
        // absent, so user edits always survive (see addons/config.ts).
        seedAddonsConfig();
        const init: AgentDirInit = {
                dir: UNOWN_AGENT_DIR,
                created: models.fresh || !settingsExisted,
                provider: models.provider,
                modelId: models.modelId,
        };
        if (!lastInit) lastInit = init; // first call in this process wins — repeated ensures are idempotent
        return lastInit;
}

/** String-returning wrapper (existing callers). */
export function ensureUnownAgentDir(): string {
        return ensureUnownAgentDirInfo().dir;
}

/** The last ensureUnownAgentDirInfo() result (null before the first call). */
export function unownAgentDirInit(): AgentDirInit | null {
        return lastInit;
}

// ---------------------------------------------------------------------------
// Memory seeds & resolution
// ---------------------------------------------------------------------------
const POLICY_SEED = `# Tier 0 — Policy (non-negotiable guardrails)

- Never delete or overwrite files outside the current working directory.
- Always verify your work by running the available tests / build before declaring success.
- Keep changes minimal: do exactly what the task asks for.
- Never edit tests to make them pass; fix the root cause instead.
`;

const USER_SEED = `# Tier 2 — User Memory (global)

- The user values minimal diffs and clear, idiomatic code.
- Prefer standard library functions over hand-rolled logic.
`;

const PROJECT_SEED = `# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
(empty — AutoDream fills this from session notes)

## Known pitfalls
(empty)
`;

const LOCAL_SEED = `# Tier 3 — Local Overrides

(empty — most specific tier; anything here overrides the tiers above; gitignored)
`;

/** Scaffold <project>/.unown/ (idempotent). Returns the .unown dir. */
export function initProjectMemory(projectDir: string): string {
        const unownDir = join(projectDir, ".unown");
        const memDir = join(unownDir, "memory");
        mkdirSync(memDir, { recursive: true });
        const projectMd = join(memDir, "project.md");
        if (!existsSync(projectMd)) writeFileSync(projectMd, PROJECT_SEED, "utf8");
        const localMd = join(memDir, "local.md");
        if (!existsSync(localMd)) writeFileSync(localMd, LOCAL_SEED, "utf8");
        const gitignore = join(unownDir, ".gitignore");
        if (!existsSync(gitignore)) writeFileSync(gitignore, "# local overrides & scratch\nlocal.md\n*.local.md\n", "utf8");
        return unownDir;
}

export interface TerminalMemoryFile {
        path: string; // virtual path shown to the agent
        /** The real filesystem path (M6: /learning staleness stats this — `path`
         * carries a display parenthetical and is NOT a valid fs path). */
        fsPath: string;
        content: string;
        tier: string;
}

export function projectMemoryPath(projectDir: string): string {
        return join(projectDir, ".unown", "memory", "project.md");
}

/**
 * True when a project's memory file is still the untouched AutoDream seed —
 * i.e. no real content has ever shipped (the "first mint" moment the dream
 * guard treats with the strictest policy: no version rows + pristine file).
 */
export function isPristineSeedProjectMemory(content: string): boolean {
        const t = content.trim();
        if (t === PROJECT_SEED.trim()) return true;
        // Seed-marker fallback: the seed's empty-section markers are present and
        // there is no bullet-rule content beyond the seed's own two bullets.
        return t.includes("(empty — AutoDream fills this from session notes)") && !/^[-*]\s+(?!This file is maintained)/m.test(t);
}

/** Resolve the full 4-tier memory stack for a terminal session in projectDir. */
export function resolveTerminalMemory(projectDir: string): TerminalMemoryFile[] {
        initProjectMemory(projectDir);
        const files: TerminalMemoryFile[] = [];

        // Tier 0 — policy (global, optional override)
        const policyPath = join(UNOWN_MEMORY_DIR, "policy.md");
        files.push({
                path: "memory/tier0-policy.md (enterprise policy — highest authority)",
                fsPath: policyPath,
                content: existsSync(policyPath) ? readFileSync(policyPath, "utf8") : POLICY_SEED,
                tier: "policy",
        });

        // Tier 1 — project (per-project, AutoDream-maintained)
        files.push({
                path: ".unown/memory/project.md (project memory — maintained by AutoDream & you)",
                fsPath: projectMemoryPath(projectDir),
                content: readFileSync(projectMemoryPath(projectDir), "utf8"),
                tier: "project",
        });

        // Tier 2 — user (global)
        const userPath = join(UNOWN_MEMORY_DIR, "user.md");
        let userContent: string;
        if (existsSync(userPath)) userContent = readFileSync(userPath, "utf8");
        else {
                mkdirSync(UNOWN_MEMORY_DIR, { recursive: true });
                writeFileSync(userPath, USER_SEED, "utf8");
                userContent = USER_SEED;
        }
        files.push({
                path: "memory/tier2-user.md (user memory — global preferences)",
                fsPath: userPath,
                content: userContent,
                tier: "user",
        });

        // Tier 3 — local overrides (per-project, gitignored)
        const localPath = join(projectDir, ".unown", "memory", "local.md");
        files.push({
                path: ".unown/memory/local.md (local overrides — highest precedence)",
                fsPath: localPath,
                content: existsSync(localPath) ? readFileSync(localPath, "utf8") : LOCAL_SEED,
                tier: "local",
        });

        return files;
}

/** DB-free provenance line for a terminal memory tier (source path only). */
function terminalProvenanceLine(tier: string): string {
        switch (tier) {
                case "policy":
                        return `<!-- source: global policy file (~/.unown/memory/policy.md) -->`;
                case "project":
                        return `<!-- source: project memory (.unown/memory/project.md — maintained by AutoDream & your edits) -->`;
                case "user":
                        return `<!-- source: global user memory (~/.unown/memory/user.md) -->`;
                case "local":
                        return `<!-- source: local overrides (.unown/memory/local.md — highest precedence, gitignored) -->`;
                default:
                        return `<!-- source: unown memory -->`;
        }
}

/**
 * The memory files actually injected into a TERMINAL session's system prompt
 * (cli.ts / tools.ts): the tier guide + the four tiers with a source comment
 * prepended to the content — mirroring the engine path's
 * resolveMemoryForAgent so both paths carry the same semantics (precedence,
 * hints-not-instructions, provenance) into the model's context — and the
 * same §5.5 hard-sum budget (PI_MEMORY_TOTAL_CHARS): when the stack grows
 * past the cap, the OLDEST rule blocks (guide/policy exempt) are dropped
 * from the INJECTION only; the files on disk are untouched.
 */
export function terminalMemoryForAgent(projectDir: string): TerminalMemoryFile[] {
        const files = resolveTerminalMemory(projectDir);
        const withGuide = [
                { path: MEMORY_GUIDE_PATH, content: MEMORY_GUIDE, tier: "guide" },
                ...files.map((f) => ({
                        ...f,
                        content: `${terminalProvenanceLine(f.tier)}\n${f.content}`,
                })),
        ];
        const { files: budgeted } = pruneToBudget(withGuide);
        return budgeted.map((f) => ({ path: f.path, content: f.content, tier: f.tier ?? "memory" }));
}

// ---------------------------------------------------------------------------
// Note delivery: outbox files + direct POST to the engine
// ---------------------------------------------------------------------------
export function slugifyPath(projectDir: string): string {
        const base = basename(projectDir) || "project";
        return (
                base
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-+|-+$/g, "")
                        .slice(0, 32) || "project"
        );
}

export interface OutboxNote {
        content: string;
        projectPath: string;
        ts: number;
}

/** Content cap parity: the engine's HTTP lane rejects >20k (server.ts) — the
 * outbox must not become the bypass (an oversized queued note would sail
 * through ingest uncapped). Truncation, not rejection: the note's value is
 * mostly in its head. */
const OUTBOX_CONTENT_CAP = 20_000;
/** Max queued outbox files before the oldest are dropped (Sentry-style
 * maxCacheItems; 0 = unlimited). Surfaced via outboxStats(). */
export const OUTBOX_MAX = (() => {
        // `||`, not `??`: an unset-or-EMPTY value (the .env.example spelling)
        // means the DOCUMENTED default of 200 — `Number("") === 0` used to
        // pass the `>= 0` guard and silently turn every default install
        // unlimited, dead-lettering the cap M6 exists to add (test-suite find).
        const raw = process.env.UNOWN_OUTBOX_MAX || "";
        if (raw === "") return 200;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200;
})();

/** Where the dropped-while-offline counter lives (next to the outbox). */
const OUTBOX_STATE_FILE = join(UNOWN_NOTES_DIR, "outbox-state.json");

export interface OutboxStats {
        queued: number;
        dropped: number;
}

/** Queued + lifetime-dropped counts for the footer, /engine, doctor and `engine status`. */
export function outboxStats(): OutboxStats {
        let queued = 0;
        try {
                for (const name of readdirSync(UNOWN_OUTBOX_DIR)) if (name.endsWith(".md")) queued++;
        } catch {
                /* no outbox dir yet */
        }
        let dropped = 0;
        try {
                const raw = JSON.parse(readFileSync(OUTBOX_STATE_FILE, "utf8"));
                dropped = Number(raw?.dropped) || 0;
        } catch {
                /* no counter yet */
        }
        return { queued, dropped };
}

/** Bump the dropped counter (best effort — read-only home keeps count 0). */
function recordDroppedNote() {
        try {
                const dropped = outboxStats().dropped + 1;
                mkdirSync(UNOWN_NOTES_DIR, { recursive: true });
                writeFileSync(OUTBOX_STATE_FILE, JSON.stringify({ dropped, lastDroppedAt: Date.now() }), "utf8");
        } catch {
                /* cosmetic counter only */
        }
}

/** Enforce the outbox cap: drop OLDEST files first, count every drop. */
function enforceOutboxCap() {
        if (OUTBOX_MAX <= 0) return;
        try {
                const files = readdirSync(UNOWN_OUTBOX_DIR).filter((n) => n.endsWith(".md")).sort(); // names start with Date.now() — sortable
                for (const victim of files.slice(0, Math.max(0, files.length - OUTBOX_MAX + 1))) {
                        try {
                                rmSync(join(UNOWN_OUTBOX_DIR, victim));
                                recordDroppedNote();
                        } catch {
                                /* best effort */
                        }
                }
        } catch {
                /* no dir / unreadable — the write itself will surface real problems */
        }
}

/** Persist a note as an outbox file (delivered to the engine by the sync job). */
export function writeOutboxNote(note: OutboxNote): string {
        mkdirSync(UNOWN_OUTBOX_DIR, { recursive: true });
        // Date.now() alone collides when two notes for the same project land in
        // the same millisecond (the second write silently OVERWRITES the first —
        // found live by the outbox dedup test). A short random tail makes the
        // name unique while staying sortable and greppable.
        const name = `${Date.now()}-${randomUUID().slice(0, 6)}-${slugifyPath(note.projectPath)}.md`;
        const content = note.content.length > OUTBOX_CONTENT_CAP ? `${note.content.slice(0, OUTBOX_CONTENT_CAP)}\n(truncated)` : note.content;
        const body = `---\nproject: ${note.projectPath}\nts: ${note.ts}\n---\n${content}\n`;
        const p = join(UNOWN_OUTBOX_DIR, name);
        enforceOutboxCap();
        writeFileSync(p, body, "utf8");
        return p;
}

/** Overall deadline for one delivery attempt. The per-fetch timeouts
 * (probe 1.2s + POST 4s) are worst-case ADDITIVE when the engine URL points
 * at a hanging (not refusing) port — and session_shutdown awaits this call,
 * so a wedged network path could hold the TUI exit for ~5.2s. The budget
 * races the whole attempt; on expiry the note lands in the outbox (the
 * durable path) and the caller proceeds. */
const NOTE_DELIVERY_BUDGET_MS = (() => {
        const n = Number(process.env.UNOWN_NOTE_BUDGET_MS ?? "");
        return Number.isFinite(n) && n >= 500 ? Math.floor(n) : 2_500;
})();

/**
 * Deliver a terminal note: POST to the engine, fall back to the outbox file.
 *
 * M6 degraded-mode fast path: `assumeDown: true` (the caller learned the
 * engine is down from a recent probe — engine-status.ts) skips BOTH the
 * probe and the POST and goes straight to the outbox, making the common
 * engine-down quit INSTANT even against a hanging port.
 */
export async function deliverTerminalNote(
        note: OutboxNote,
        opts: { assumeDown?: boolean } = {},
): Promise<{ delivered: boolean; via: "engine" | "outbox"; detail?: string }> {
        const attempt = (async () => {
                if (opts.assumeDown) {
                        void spawnEngineDetached(); // gated: backoff / gave-up / kill switch apply
                        // The durable write this branch promises ("queued"): without it
                        // the note was silently DROPPED — the race below only writes the
                        // outbox on the budget-timeout detail string (M6 test-suite find).
                        writeOutboxNote(note);
                        return { delivered: false, via: "outbox" as const, detail: "engine known down — queued" };
                }
                // M3 auto-start (docs/detached-engine-architecture.md rule 5): when the
                // engine is unreachable, spawn it detached — fire-and-forget. The note
                // itself STILL lands in the outbox (the durable path); the engine's boot
                // syncNoteOutbox drains it once the spawn comes up. Never awaited here:
                // session shutdown must not pay the boot latency.
                let spawnedEngine = false;
                try {
                        await fetch(`${ENGINE_URL}/api/overview`, { signal: AbortSignal.timeout(1200) });
                } catch {
                        try {
                                void spawnEngineDetached();
                                spawnedEngine = true;
                        } catch {
                                /* spawn is best-effort — the outbox is the guarantee */
                        }
                }
                try {
                        const res = await fetch(`${ENGINE_URL}/api/notes`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ content: note.content, project_path: note.projectPath }),
                                signal: AbortSignal.timeout(4000),
                        });
                        if (res.ok) return { delivered: true, via: "engine" as const };
                        const detail = `engine responded ${res.status}`;
                        writeOutboxNote(note);
                        return { delivered: false, via: "outbox" as const, detail };
                } catch (err: any) {
                        const detail = err?.message ?? String(err);
                        writeOutboxNote(note);
                        return {
                                delivered: false,
                                via: "outbox" as const,
                                detail: spawnedEngine ? `${detail} (engine spawn kicked)` : detail,
                        };
                }
        })();
        // The budget never swallows the note: whichever side of the race wins,
        // the outbox write inside `attempt` still happens — but a fetch that
        // IGNORES its abort signal could keep the promise pending past the
        // budget, so on timeout we write the outbox ourselves and resolve.
        const budget = new Promise<{ delivered: false; via: "outbox"; detail: string }>((resolve) => {
                setTimeout(() => resolve({ delivered: false, via: "outbox", detail: "delivery budget exceeded — queued" }), NOTE_DELIVERY_BUDGET_MS).unref?.();
        });
        const result = await Promise.race([attempt, budget]);
        if (!result.delivered && result.detail === "delivery budget exceeded — queued") writeOutboxNote(note);
        return result;
}

/** Read + parse every pending outbox file (engine side). */
export function readOutboxNotes(): Array<{ file: string; note: OutboxNote }> {
        mkdirSync(UNOWN_OUTBOX_DIR, { recursive: true });
        const out: Array<{ file: string; note: OutboxNote }> = [];
        for (const name of readdirSync(UNOWN_OUTBOX_DIR).sort()) {
                if (!name.endsWith(".md")) continue;
                const file = join(UNOWN_OUTBOX_DIR, name);
                try {
                        const raw = readFileSync(file, "utf8");
                        const match = raw.match(/^---\nproject: (.+)\nts: (\d+)\n---\n([\s\S]*)$/);
                        if (!match) continue;
                        out.push({ file, note: { projectPath: match[1], ts: Number(match[2]), content: match[3].trim() } });
                } catch {
                        /* unreadable — skip */
                }
        }
        return out;
}

/** Move an ingested outbox file to the archive dir. */
export function archiveOutboxNote(file: string) {
        mkdirSync(UNOWN_NOTES_DONE_DIR, { recursive: true });
        try {
                renameSync(file, join(UNOWN_NOTES_DONE_DIR, basename(file)));
        } catch {
                /* best effort */
        }
}
