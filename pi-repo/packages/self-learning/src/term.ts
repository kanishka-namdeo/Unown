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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const UNOWN_HOME = process.env.UNOWN_HOME ?? join(homedir(), ".unown");
export const UNOWN_AGENT_DIR = join(UNOWN_HOME, "agent");
export const UNOWN_MEMORY_DIR = join(UNOWN_HOME, "memory");
export const UNOWN_NOTES_DIR = join(UNOWN_HOME, "notes");
export const UNOWN_OUTBOX_DIR = join(UNOWN_NOTES_DIR, "outbox");
export const UNOWN_NOTES_DONE_DIR = join(UNOWN_NOTES_DIR, "done");
export const ENGINE_URL = (process.env.UNOWN_ENGINE_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, "");
export const STRICT_HOOKS = /^(1|true|yes)$/i.test(process.env.UNOWN_STRICT_HOOKS ?? "");

// ---------------------------------------------------------------------------
// Agent dir (models.json etc.) — mirrors runner.ts ensureAgentDir but for the
// terminal agent dir. Users can hand-edit ~/.unown/agent/models.json to point
// at any OpenAI-compatible endpoint.
// ---------------------------------------------------------------------------
export function writeModelsJson(agentDir: string) {
        mkdirSync(agentDir, { recursive: true });
        const modelsPath = join(agentDir, "models.json");
        if (existsSync(modelsPath)) return modelsPath; // never clobber user edits
        const provider = process.env.PI_PROVIDER ?? "zai-bridge";
        const modelId = process.env.PI_MODEL_ID ?? "glm-4-plus";
        const baseUrl = (process.env.PI_BRIDGE_URL ?? "http://127.0.0.1:3031").replace(/\/+$/, "");
        writeFileSync(
                modelsPath,
                JSON.stringify(
                        {
                                providers: {
                                        [provider]: {
                                                baseUrl: `${baseUrl}/v1`,
                                                api: "openai-completions",
                                                apiKey: "bridge-local",
                                                models: [
                                                        {
                                                                id: modelId,
                                                                name: `${modelId} (via unown)`,
                                                                contextWindow: 60000,
                                                                maxTokens: 4096,
                                                                input: ["text"],
                                                        },
                                                ],
                                        },
                                },
                        },
                        null,
                        2,
                ),
                "utf8",
        );
        return modelsPath;
}

/** Ensure ~/.unown/agent is ready: models.json, auth.json, settings.json, sessions dir. */
export function ensureUnownAgentDir(): string {
        writeModelsJson(UNOWN_AGENT_DIR);
        const authPath = join(UNOWN_AGENT_DIR, "auth.json");
        if (!existsSync(authPath)) writeFileSync(authPath, "{}", "utf8");
        const settingsPath = join(UNOWN_AGENT_DIR, "settings.json");
        if (!existsSync(settingsPath)) writeFileSync(settingsPath, "{}", "utf8"); // prevents first-run setup dialog
        mkdirSync(join(UNOWN_AGENT_DIR, "sessions"), { recursive: true });
        return UNOWN_AGENT_DIR;
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
        content: string;
        tier: string;
}

export function projectMemoryPath(projectDir: string): string {
        return join(projectDir, ".unown", "memory", "project.md");
}

/** Resolve the full 4-tier memory stack for a terminal session in projectDir. */
export function resolveTerminalMemory(projectDir: string): TerminalMemoryFile[] {
        initProjectMemory(projectDir);
        const files: TerminalMemoryFile[] = [];

        // Tier 0 — policy (global, optional override)
        const policyPath = join(UNOWN_MEMORY_DIR, "policy.md");
        files.push({
                path: "memory/tier0-policy.md (enterprise policy — highest authority)",
                content: existsSync(policyPath) ? readFileSync(policyPath, "utf8") : POLICY_SEED,
                tier: "policy",
        });

        // Tier 1 — project (per-project, AutoDream-maintained)
        files.push({
                path: ".unown/memory/project.md (project memory — maintained by AutoDream & you)",
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
                content: userContent,
                tier: "user",
        });

        // Tier 3 — local overrides (per-project, gitignored)
        const localPath = join(projectDir, ".unown", "memory", "local.md");
        files.push({
                path: ".unown/memory/local.md (local overrides — highest precedence)",
                content: existsSync(localPath) ? readFileSync(localPath, "utf8") : LOCAL_SEED,
                tier: "local",
        });

        return files;
}

// ---------------------------------------------------------------------------
// Note delivery: outbox files + direct POST to the engine
// ---------------------------------------------------------------------------
export function slugifyPath(projectDir: string): string {
        const base = basename(projectDir) || "project";
        return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "project";
}

export interface OutboxNote {
        content: string;
        projectPath: string;
        ts: number;
}

/** Persist a note as an outbox file (delivered to the engine by the sync job). */
export function writeOutboxNote(note: OutboxNote): string {
        mkdirSync(UNOWN_OUTBOX_DIR, { recursive: true });
        const name = `${Date.now()}-${slugifyPath(note.projectPath)}.md`;
        const body = `---\nproject: ${note.projectPath}\nts: ${note.ts}\n---\n${note.content}\n`;
        const p = join(UNOWN_OUTBOX_DIR, name);
        writeFileSync(p, body, "utf8");
        return p;
}

/** Deliver a terminal note: POST to the engine, fall back to the outbox file. */
export async function deliverTerminalNote(note: OutboxNote): Promise<{ delivered: boolean; via: "engine" | "outbox"; detail?: string }> {
        try {
                const res = await fetch(`${ENGINE_URL}/api/notes`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ content: note.content, project_path: note.projectPath }),
                        signal: AbortSignal.timeout(4000),
                });
                if (res.ok) return { delivered: true, via: "engine" };
                const detail = `engine responded ${res.status}`;
                writeOutboxNote(note);
                return { delivered: false, via: "outbox", detail };
        } catch (err: any) {
                const detail = err?.message ?? String(err);
                writeOutboxNote(note);
                return { delivered: false, via: "outbox", detail };
        }
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
