/**
 * dream-review.ts — the pending-dream lane: AutoDream's review inbox
 * (the Settings Evolution round's marquee trust feature).
 *
 * In review mode (~/.unown/agent/settings-hub.json → learningReviewMode)
 * a PROJECT dream that passed every gate (cap, no-change, guard) does NOT
 * ship: it parks its rendered diff here as a pending file and consumes the
 * notes. The user then approves (the dream commits exactly what was
 * previewed) or discards (the platform events revert — the cap-gate
 * pattern — and nothing ships).
 *
 * While a pending dream exists for a project, that project's dreams are
 * skipped: a later render must never ship the parked memories around the
 * review. The engine tiers (canary-guarded) are NOT gated by review mode —
 * they surface in the inbox with their rollback instead.
 *
 * Pending files live at <project>/.unown/memory/pending-dreams/<id>.json —
 * project-local, gitignored with the rest of .unown runtime state, and
 * self-contained (they carry the mem0 events so discard can revert).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The subset of mem0 events needed to revert a parked dream on discard. */
export interface PendingEvent {
        kind: string;
        id?: string;
        previousText?: string;
        text?: string;
        [arg: string]: unknown;
}

export interface PendingDream {
        id: string;
        slug: string;
        projectPath: string;
        createdAt: number;
        notesIn: number;
        /** The rendered memory exactly as the dream would have shipped it. */
        toWrite: string;
        /** The file content BEFORE the dream (the diff base). */
        current: string;
        /** Platform events the dream applied — reverted on discard. */
        events: PendingEvent[];
        /** added / merged / pruned / quarantined + guard verdict. */
        summary: string;
        /** The version-row note the dream would have written. */
        note: string;
}

export function pendingDreamsDir(projectPath: string): string {
        return join(projectPath, ".unown", "memory", "pending-dreams");
}

function pendingPath(projectPath: string, id: string): string {
        return join(pendingDreamsDir(projectPath), `${id}.json`);
}

export function parkPendingDream(pending: PendingDream): void {
        const dir = pendingDreamsDir(pending.projectPath);
        mkdirSync(dir, { recursive: true });
        const path = pendingPath(pending.projectPath, pending.id);
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${JSON.stringify(pending, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
}

export function listPendingDreams(projectPath: string): PendingDream[] {
        const dir = pendingDreamsDir(projectPath);
        if (!existsSync(dir)) return [];
        const out: PendingDream[] = [];
        for (const file of readdirSync(dir)) {
                if (!file.endsWith(".json")) continue;
                try {
                        const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as PendingDream;
                        if (typeof parsed?.id === "string" && typeof parsed?.toWrite === "string" && typeof parsed?.projectPath === "string") {
                                out.push(parsed);
                        }
                } catch {
                        /* unreadable pending file — skip, never crash the inbox */
                }
        }
        return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function hasPendingDream(projectPath: string): boolean {
        return listPendingDreams(projectPath).length > 0;
}

export function getPendingDream(projectPath: string, id: string): PendingDream | undefined {
        return listPendingDreams(projectPath).find((p) => p.id === id);
}

export function removePendingDream(projectPath: string, id: string): void {
        rmSync(pendingPath(projectPath, id), { force: true });
}

/** A simple unified diff line stream (no external dep, insert/delete/kept markers). */
export function renderPendingDiff(pending: PendingDream, maxLines = 60): string {
        const before = pending.current.split("\n");
        const after = pending.toWrite.split("\n");
        const lines: string[] = [];
        // LCS is overkill for a preview; walk both sides with a cheap anchor scan
        // that keeps identical runs and marks the transitions.
        let i = 0;
        let j = 0;
        let shown = 0;
        const push = (prefix: string, text: string) => {
                if (shown++ < maxLines) lines.push(`${prefix}${text}`);
        };
        while (i < before.length || j < after.length) {
                if (i < before.length && j < after.length && before[i] === after[j]) {
                        push("  ", before[i]);
                        i++;
                        j++;
                } else if (j < after.length && !before.includes(after[j])) {
                        push("+ ", after[j]);
                        j++;
                } else if (i < before.length && !after.includes(before[i])) {
                        push("- ", before[i]);
                        i++;
                } else {
                        // a changed line pair (moved/edited) — show as -/+
                        if (i < before.length) push("- ", before[i]);
                        if (j < after.length) push("+ ", after[j]);
                        i++;
                        j++;
                }
        }
        if (shown >= maxLines) lines.push(`… (${before.length + after.length} lines total, preview capped)`);
        return lines.join("\n");
}
