/**
 * dream.ts — Auto Dreaming (pattern 4/5).
 *
 * An AutoDream sub-agent that periodically consumes accumulated session notes
 * from multiple runs, merges duplicates, resolves contradictions, prunes stale
 * entries, reorganizes by topic, and writes a consolidated project-memory
 * file — so the next session starts where the last one left off.
 *
 * Two consolidation paths:
 *   - benchmark notes -> the engine's own project memory (with a canary gate:
 *     the new memory must not break the last-passing task, else auto-rollback)
 *   - terminal notes   -> each real project's .unown/memory/project.md
 *     (versioned in the engine DB as tier "project:<slug>")
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import { emit } from "./bus.ts";
import { chatJson } from "./llm.ts";
import { currentVersion, maxTierChars, readTier, rollback, writeTier } from "./memory.ts";
import { markDreamed, pendingTerminalNotesByProject, undreamedNotes } from "./notes.ts";
import { mintSkillsForProject } from "./skills.ts";
import { store } from "./store.ts";
import { initProjectMemory, projectMemoryPath, slugifyPath } from "./term.ts";

export interface DreamResult {
        id: string;
        status: "done" | "no-notes" | "error" | "gated";
        notesIn: number;
        merged: number;
        pruned: number;
        added: number;
        output: string;
        note?: string;
        error?: string;
}

const SYSTEM = `You are AutoDream, the memory-consolidation sub-agent of a self-learning coding agent.
You receive the CURRENT project memory file and a set of SESSION NOTES from recent runs.
Your job: write the NEXT version of the project memory file.

Rules:
1. Merge duplicate notes into single, precise rules.
2. Resolve contradictions: prefer the rule backed by the most recent evidence; drop the loser.
3. Prune stale or one-off observations that will not help future runs.
4. Reorganize into clear topic sections (## Workflow, ## Known pitfalls, ## Task playbooks, ...).
5. PRESERVE rules that were hard-won (they reference fixed failures / harness improvements) — never delete them, only tighten wording.
6. New durable lessons become short imperative bullets under the fitting topic.
7. Keep the whole file under 120 lines. Markdown only. No prose paragraphs — bullets.
Return STRICT JSON: {"projectMd": "<full new file content>", "stats": {"merged": <int>, "pruned": <int>, "added": <int>, "topics": ["..."]}}`;

// ---------------------------------------------------------------------------
// Benchmark dream (engine's own project memory) — now with a canary gate
// ---------------------------------------------------------------------------
export async function runDream(): Promise<DreamResult> {
        const id = randomUUID();
        const notes = undreamedNotes(24, "benchmark");

        if (notes.length === 0) {
                store.run(`INSERT INTO dreams (id, started_at, ended_at, status, notes_in) VALUES (?, ?, ?, 'no-notes', 0)`, [
                        id,
                        Date.now(),
                        Date.now(),
                ]);
                emit("dream:finished", { id, status: "no-notes" });
                return { id, status: "no-notes", notesIn: 0, merged: 0, pruned: 0, added: 0, output: "" };
        }

        store.run(`INSERT INTO dreams (id, started_at, status, notes_in) VALUES (?, ?, 'running', ?)`, [
                id,
                Date.now(),
                notes.length,
        ]);
        emit("dream:started", { id, notesIn: notes.length });

        try {
                const currentMemory = readTier("project");
                const notesText = notes
                        .map(
                                (n: any) =>
                                        `--- note (${new Date(n.created_at).toISOString()}) run=${String(n.run_id ?? "").slice(0, 8)} ---\n${n.content}`,
                        )
                        .join("\n\n");

                const result = await chatJson<{
                        projectMd: string;
                        stats: { merged: number; pruned: number; added: number; topics?: string[] };
                }>(
                        [
                                { role: "system", content: SYSTEM },
                                {
                                        role: "user",
                                        content: `CURRENT PROJECT MEMORY (version ${currentVersion("project")}):\n\n${currentMemory}\n\nSESSION NOTES SINCE LAST DREAM (${notes.length}):\n\n${notesText}`,
                                },
                        ],
                        { maxTokens: 3000 },
                );

                const next = String(result.projectMd ?? "").trim();
                if (!next || next.length < 60) throw new Error("dream produced empty memory");
                const stats = result.stats ?? { merged: 0, pruned: 0, added: 0 };

                const version = writeTier(
                        "project",
                        `${next}\n`,
                        "autodream",
                        `consolidated ${notes.length} notes (merged ${stats.merged}, pruned ${stats.pruned}, added ${stats.added})`,
                );

                // ---- Canary gate: the new memory must not break the last-passing task.
                const gate = await canaryCheck(version);
                if (gate.rolledBack) {
                        markDreamed(
                                notes.map((n: any) => n.id),
                                id,
                        );
                        store.run(
                                `UPDATE dreams SET ended_at = ?, status = 'gated', entries_merged = ?, entries_pruned = ?, entries_added = ?, output = ?, note = ? WHERE id = ?`,
                                [
                                        Date.now(),
                                        stats.merged ?? 0,
                                        stats.pruned ?? 0,
                                        stats.added ?? 0,
                                        next,
                                        `rolled back to v${version - 1}: canary task failed under the new memory (${gate.reason ?? "unknown"})`,
                                        id,
                                ],
                        );
                        emit("dream:finished", {
                                id,
                                status: "gated",
                                notesIn: notes.length,
                                version: version - 1,
                                reason: gate.reason,
                        });
                        return {
                                id,
                                status: "gated",
                                notesIn: notes.length,
                                merged: stats.merged ?? 0,
                                pruned: stats.pruned ?? 0,
                                added: stats.added ?? 0,
                                output: next,
                                note: "canary gate rolled the dream back",
                        };
                }

                markDreamed(
                        notes.map((n: any) => n.id),
                        id,
                );

                store.run(
                        `UPDATE dreams SET ended_at = ?, status = 'done', entries_merged = ?, entries_pruned = ?, entries_added = ?, output = ?, note = ? WHERE id = ?`,
                        [
                                Date.now(),
                                stats.merged ?? 0,
                                stats.pruned ?? 0,
                                stats.added ?? 0,
                                next,
                                `project memory -> v${version}${gate.skipped ? ` (canary unavailable: ${gate.reason})` : " (canary passed)"}`,
                                id,
                        ],
                );
                emit("dream:finished", { id, status: "done", notesIn: notes.length, stats, version });
                return {
                        id,
                        status: "done",
                        notesIn: notes.length,
                        merged: stats.merged ?? 0,
                        pruned: stats.pruned ?? 0,
                        added: stats.added ?? 0,
                        output: next,
                };
        } catch (err: any) {
                const msg = err?.message ?? String(err);
                store.run(`UPDATE dreams SET ended_at = ?, status = 'error', note = ? WHERE id = ?`, [Date.now(), msg, id]);
                emit("dream:finished", { id, status: "error", error: msg });
                return { id, status: "error", notesIn: notes.length, merged: 0, pruned: 0, added: 0, output: "", error: msg };
        }
}

/**
 * Canary gate for dreams: re-run the most recently PASSED task under the new
 * memory. A FAILED canary rolls the dream back (the consolidation introduced a
 * regression); an infrastructure ERROR keeps the dream but records that the
 * canary could not run. Returns { skipped } when no canary task is available.
 */
async function canaryCheck(newVersion: number): Promise<{ rolledBack: boolean; skipped?: boolean; reason?: string }> {
        const lastPass = store.get<{ task_id: string }>(
                `SELECT task_id FROM runs WHERE status = 'passed' AND kind IN ('baseline','candidate') AND task_id IS NOT NULL ORDER BY ended_at DESC LIMIT 1`,
        );
        if (!lastPass) return { rolledBack: false, skipped: true, reason: "no previously-passing task" };
        if (process.env.PI_DREAM_GATE === "0") return { rolledBack: false, skipped: true, reason: "gate disabled" };
        try {
                const { runAgent } = await import("./runner.ts");
                const { getTask } = await import("./tasks.ts");
                const task = getTask(lastPass.task_id);
                if (!task) return { rolledBack: false, skipped: true, reason: "canary task missing" };
                const result = await runAgent({
                        taskId: task.id,
                        kind: "regression",
                        prompt: task.prompt,
                        files: task.files,
                        verify: task.verify,
                        label: `dream-canary-${task.id}`,
                });
                if (result.status === "failed") {
                        rollback("project", newVersion - 1, `dream canary failed on ${task.id} — consolidation rolled back`);
                        return { rolledBack: true, reason: `canary ${task.id} failed under new memory v${newVersion}` };
                }
                if (result.status === "error")
                        return { rolledBack: false, skipped: true, reason: "canary hit infrastructure failure" };
                return { rolledBack: false };
        } catch (err: any) {
                return { rolledBack: false, skipped: true, reason: err?.message ?? String(err) };
        }
}

// ---------------------------------------------------------------------------
// Project dream — terminal notes consolidated into each project's own memory
// ---------------------------------------------------------------------------
export interface ProjectDreamResult {
        slug: string;
        projectPath: string;
        notesIn: number;
        status: "done" | "no-change" | "error";
        version?: number;
        note?: string;
        error?: string;
        skills?: Array<{ name: string; description: string }>;
}

export async function runProjectDream(): Promise<ProjectDreamResult[]> {
        const groups = pendingTerminalNotesByProject(40);
        const results: ProjectDreamResult[] = [];

        for (const group of groups) {
                const notes = group.notes;
                let current = "";
                try {
                        initProjectMemory(group.projectPath);
                        current = readFileSync(projectMemoryPath(group.projectPath), "utf8");
                } catch (err: any) {
                        results.push({
                                slug: group.slug,
                                projectPath: group.projectPath,
                                notesIn: notes.length,
                                status: "error",
                                error: `cannot read project memory: ${err?.message ?? err}`,
                        });
                        continue;
                }

                const notesText = notes
                        .map((n: any) => `--- note (${new Date(n.created_at).toISOString()}) terminal session ---\n${n.content}`)
                        .join("\n\n");

                try {
                        const result = await chatJson<{
                                projectMd: string;
                                stats?: { merged: number; pruned: number; added: number };
                        }>(
                                [
                                        { role: "system", content: SYSTEM },
                                        {
                                                role: "user",
                                                content: `This is the PROJECT MEMORY of a real user project the agent works on in the terminal (project directory: ${group.projectPath}).\n\nCURRENT PROJECT MEMORY:\n\n${current}\n\nTERMINAL SESSION NOTES (${notes.length}):\n\n${notesText}`,
                                        },
                                ],
                                { maxTokens: 3000 },
                        );
                        const next = String(result.projectMd ?? "").trim();
                        if (!next || next.length < 60) throw new Error("project dream produced empty memory");
                        const cap = maxTierChars();
                        if (next.length > cap)
                                throw new Error(`project dream output (${next.length} chars) exceeds cap ${cap} — project memory preserved`);

                        // Write the project's memory file atomically (tmp+fsync+rename):
                        // a crash mid-dream never leaves a truncated .unown/memory/project.md
                        // in the user's repo (the terminal agent reads this next session).
                        const memPath = projectMemoryPath(group.projectPath);
                        atomicWriteFileSync(memPath, `${next}\n`);

                        // Version it in the engine DB under a synthetic tier so history/rollback works.
                        const tierKey = `project:${group.slug}`;
                        const versionRow = store.get<{ version: number }>(
                                `SELECT MAX(version) AS version FROM memory_versions WHERE tier = ?`,
                                [tierKey],
                        );
                        const version = (versionRow?.version ?? 0) + 1;
                        store.run(
                                `INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, ?, 'autodream', ?, ?)`,
                                [
                                        tierKey,
                                        version,
                                        `${next}\n`,
                                        `consolidated ${notes.length} terminal notes for ${group.slug}`,
                                        Date.now(),
                                ],
                        );

                        // All terminal notes for this project are consumed by this dream.
                        const dreamId = `project-${randomUUID()}`;
                        store.run(
                                `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, output, note) VALUES (?, ?, ?, 'done', ?, ?, ?)`,
                                [
                                        dreamId,
                                        Date.now(),
                                        Date.now(),
                                        notes.length,
                                        next,
                                        `project dream: ${group.slug} memory -> v${version} (${group.projectPath})`,
                                ],
                        );
                        markDreamed(
                                notes.map((n: any) => n.id),
                                dreamId,
                        );
                        emit("dream:finished", { id: dreamId, status: "done", notesIn: notes.length, project: group.slug, version });

                        // ---- Skill acquisition: recurring procedures become Agent Skills ----
                        const skills = await mintSkillsForProject({
                                projectPath: group.projectPath,
                                slug: group.slug,
                                consolidatedMemory: next,
                                notesText,
                                dreamId,
                        });

                        results.push({
                                slug: group.slug,
                                projectPath: group.projectPath,
                                notesIn: notes.length,
                                status: "done",
                                version,
                                note: `memory -> v${version}${skills.length > 0 ? ` · minted ${skills.length} skill(s): ${skills.map((sk) => sk.name).join(", ")}` : ""}`,
                                skills: skills.map((sk) => ({ name: sk.name, description: sk.description })),
                        });
                } catch (err: any) {
                        const msg = err?.message ?? String(err);
                        const dreamId = `project-${randomUUID()}`;
                        store.run(
                                `INSERT INTO dreams (id, started_at, ended_at, status, notes_in, note) VALUES (?, ?, ?, 'error', ?, ?)`,
                                [dreamId, Date.now(), Date.now(), notes.length, `project dream error (${group.slug}): ${msg}`],
                        );
                        emit("dream:finished", { id: dreamId, status: "error", project: group.slug, error: msg });
                        results.push({
                                slug: group.slug,
                                projectPath: group.projectPath,
                                notesIn: notes.length,
                                status: "error",
                                error: msg,
                        });
                }
        }
        return results;
}

export function listDreams(limit = 30) {
        return store.query<any>(`SELECT * FROM dreams ORDER BY started_at DESC LIMIT ?`, [limit]);
}

export function dreamNotes(dreamId: string) {
        return store.query<any>(`SELECT * FROM notes WHERE dream_id = ? ORDER BY created_at`, [dreamId]);
}

export { slugifyPath };
