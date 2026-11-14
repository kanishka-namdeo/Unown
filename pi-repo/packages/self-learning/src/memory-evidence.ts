/**
 * memory-evidence.ts — the evidence lane: the provenance chain from a
 * distilled memory back to the session notes that produced it.
 *
 * THE GAP THIS CLOSES (the 2026-11-15 research round, teardown of eight
 * systems Mastra / Letta-2026 / MemoryMesh / mcp-memory-service /
 * Basic Memory / Mnemos / oh-my-pi / LangGraph-Store): every
 * validated-strong memory system links distilled knowledge back to its
 * raw evidence — WikiTrace (arXiv 2611.14320) measured that a
 * lesson → summary → raw-trajectory chain REDUCES memory-induced
 * degradation across five benchmarks; MAPE (2611.17068) found retaining
 * raw conversations as retrievable evidence is one of two
 * program-evolved patterns behind +12% accuracy at 35% cost;
 * Task-Conditioned Utility (2611.03930) measured raw memories beating
 * task-blind summaries on answer-bearing pairs (+0.33 paired reward);
 * Zep's episodes ARE raw-data provenance ("every derived fact traces
 * back to its source"); Letta's provenance discipline keeps the evidence
 * OUT of the rendered line (render budgets) and IN the commit record;
 * Mnemos distills a fading experience into a lesson that outlives the
 * details. Unown had the raw material all along — notes are archived
 * (the engine DB keeps them, markDreamed ties them to their dream) —
 * but nothing let a user or the agent descend from a RULE to the note
 * that produced it.
 *
 * THE HONEST UNIT: AutoDream runs ONE extraction call for the whole
 * note batch (cost parity is a pinned design decision), so the platform
 * cannot attribute a memory to a single note — the BATCH is the honest
 * attribution unit. Every memory born in a dream links to that dream's
 * note set (id + timestamp + first-line excerpt); a batch of one note
 * degrades to exact attribution for free.
 *
 * THE PLACEMENT LAW (Letta's maintaining-core-memory rule, validated
 * here): the rendered bullet carries ZERO provenance — dates and
 * excerpts live in this side record, never in the tier file, so render
 * budgets stay untaxed and `renderFooterMatches` idempotence holds.
 * Like the dormancy record, this file is deliberately NOT platform
 * metadata: writing it must never refresh `updatedAt` (which would
 * falsely refresh freshness stamps and flip the deterministic SRO
 * winner order).
 *
 * Pure module: the record builders take plain data; IO goes through
 * injectable dirs so tests never touch the live engine.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./store.ts";

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** One source note's pointer — id, ts and a first-line excerpt. The excerpt
 *  is PROVENANCE (what the note was about), never content re-injection:
 *  it is capped hard and rendered only in audit surfaces. */
export interface EvidenceNote {
        /** The note's id in the engine DB (the archive's key). */
        id: string;
        /** The note's creation ts (epoch ms). */
        at: number;
        /** First non-empty line, capped at EVIDENCE_EXCERPT_CHARS. */
        excerpt: string;
}

/** One memory's evidence: the dream that extracted it + the batch's notes. */
export interface EvidenceEntry {
        /** The dream row that extracted the memory. */
        dreamId: number | string;
        /** The dream's ts (epoch ms). */
        at: number;
        /** The batch's notes (bounded by EVIDENCE_MAX_NOTES). */
        notes: EvidenceNote[];
}

/** The per-scope evidence record: memory id -> entry. */
export type EvidenceRecord = Record<string, EvidenceEntry>;

/** Per-scope entry cap — oldest-dream entries evict first. A scope's live
 *  store is bounded by the render budgets; the evidence record is bounded
 *  independently so a long-lived scope cannot grow it unboundedly. */
export const EVIDENCE_MAX_ENTRIES = 1000;

/** Notes per entry cap — the honest batch attribution unit, bounded so a
 *  pathological batch cannot amplify one entry into a transcript. */
export const EVIDENCE_MAX_NOTES = 12;

/** The excerpt's char cap — a pointer, not a re-injection. */
export const EVIDENCE_EXCERPT_CHARS = 96;

/** The import lane's excerpt cap — a foreign interchange file's evidence
 *  is untrusted input; its excerpts get a tighter bound than homegrown. */
export const IMPORT_EVIDENCE_EXCERPT_CHARS = 200;
export const IMPORT_EVIDENCE_MAX_NOTES = 8;

// ---------------------------------------------------------------------------
// Path + IO (the dormancy record's exact shape: atomic, corrupt = empty)
// ---------------------------------------------------------------------------

function evidenceDir(): string {
        return process.env.PI_MEM0_DIR ? (process.env.PI_MEM0_DIR as string) : join(DATA_DIR, "mem0");
}

/** The per-scope record path: evidence-<sanitized scope key>.json. */
export function evidenceRecordPath(scopeKey: string, dir?: string): string {
        const safe = String(scopeKey ?? "scope")
                .toLowerCase()
                .replace(/[^a-z0-9._-]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 80) || "scope";
        return join(dir ?? evidenceDir(), `evidence-${safe}.json`);
}

export function readEvidenceRecord(scopeKey: string, dir?: string): EvidenceRecord {
        try {
                const raw = JSON.parse(readFileSync(evidenceRecordPath(scopeKey, dir), "utf8")) as EvidenceRecord;
                return raw && typeof raw === "object" ? raw : {};
        } catch {
                return {}; // absent/corrupt = empty bookkeeping — the honest default
        }
}

export function writeEvidenceRecord(scopeKey: string, rec: EvidenceRecord, dir?: string): void {
        const path = evidenceRecordPath(scopeKey, dir);
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`, "utf8");
        renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Builders (pure — the excerpt and entry shapes every caller shares)
// ---------------------------------------------------------------------------

/** First non-empty line of a note's content, capped — the human-readable
 *  pointer. Session metadata lines are skipped (the same strip the dream
 *  path applies: they name tools, not topics). */
export function evidenceExcerpt(content: string, cap = EVIDENCE_EXCERPT_CHARS): string {
        const text = String(content ?? "");
        for (const line of text.split(/\r?\n/)) {
                const t = line.trim();
                if (!t) continue;
                if (/^session (metadata|meta):/i.test(t)) continue; // telemetry, not topic
                return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
        }
        return "";
}

/** Build one note pointer from the dream batch's note row. */
export function evidenceNote(
        note: { id: string | number; content: string; created_at?: number },
        cap = EVIDENCE_EXCERPT_CHARS,
): EvidenceNote {
        return {
                id: String(note.id),
                at: typeof note.created_at === "number" ? note.created_at : 0,
                excerpt: evidenceExcerpt(String(note.content ?? ""), cap),
        };
}

// ---------------------------------------------------------------------------
// The dream path's writer + the audit surfaces' readers
// ---------------------------------------------------------------------------

export interface RecordEvidenceOpts {
        scopeKey: string;
        dir?: string;
        now?: number;
}

/**
 * Record the batch evidence for the memory ids a dream just extracted (the
 * surviving ADD events). Overwrites a prior entry for the same id only when
 * a later dream re-extracted it (mem0 UPDATE keeps the id; a re-extraction
 * means the newer batch is the better pointer). Entries past
 * EVIDENCE_MAX_ENTRIES evict oldest-dream-first. Returns how many ids were
 * linked (the dream note's ", N evidence-linked" fragment).
 */
export function recordEvidenceFromBatch(
        memoryIds: Array<string | number>,
        notes: Array<{ id: string | number; content: string; created_at?: number }>,
        dreamId: number | string,
        opts: RecordEvidenceOpts,
): number {
        if (memoryIds.length === 0 || notes.length === 0) return 0;
        const now = opts.now ?? Date.now();
        const rec = readEvidenceRecord(opts.scopeKey, opts.dir);
        const pointers = notes.slice(0, EVIDENCE_MAX_NOTES).map((n) => evidenceNote(n));
        for (const id of memoryIds) {
                rec[String(id)] = { dreamId, at: now, notes: pointers };
        }
        // Bound the record: oldest-dream entries evict first.
        const ids = Object.keys(rec);
        if (ids.length > EVIDENCE_MAX_ENTRIES) {
                const byAge = ids.sort((a, b) => (rec[a].at ?? 0) - (rec[b].at ?? 0));
                for (const id of byAge.slice(0, ids.length - EVIDENCE_MAX_ENTRIES)) delete rec[id];
        }
        writeEvidenceRecord(opts.scopeKey, rec, opts.dir);
        return memoryIds.length;
}

/** One memory's evidence chain (null when the lane has no pointer —
 *  pre-lane memories and seeds legitimately carry none). */
export function evidenceFor(scopeKey: string, id: string | number, dir?: string): EvidenceEntry | null {
        return readEvidenceRecord(scopeKey, dir)[String(id)] ?? null;
}

/** Prune entries whose memory ids are no longer in the live set (deleted,
 *  rolled back, migrated) — the dormancy record's own hygiene rule.
 *  Returns how many entries were dropped. */
export function pruneEvidenceToLiveSet(scopeKey: string, liveIds: Array<string | number>, dir?: string): number {
        const rec = readEvidenceRecord(scopeKey, dir);
        const live = new Set(liveIds.map(String));
        let pruned = 0;
        for (const id of Object.keys(rec)) {
                if (!live.has(id)) {
                        delete rec[id];
                        pruned++;
                }
        }
        if (pruned > 0) writeEvidenceRecord(scopeKey, rec, dir);
        return pruned;
}

/** Coverage for one scope: how many of the LIVE memories carry an evidence
 *  link. Pre-lane memories and seeds count as unlinked — coverage grows by
 *  extraction, never retroactively (the honest denominator). */
export function evidenceCoverageFor(
        scopeKey: string,
        liveIds: Array<string | number>,
        dir?: string,
): { linked: number; unlinked: number } {
        const rec = readEvidenceRecord(scopeKey, dir);
        let linked = 0;
        for (const id of liveIds) if (rec[String(id)]) linked++;
        return { linked, unlinked: liveIds.length - linked };
}

/** The linked-entry count across EVERY scope's record (the health card's
 *  input — same shape as dormantCountAll). */
export function evidenceCountAll(dir?: string): number {
        const d = dir ?? evidenceDir();
        let names: string[] = [];
        try {
                names = readdirSync(d).filter((f) => f.startsWith("evidence-") && f.endsWith(".json"));
        } catch {
                return 0;
        }
        let n = 0;
        for (const f of names) {
                try {
                        const rec = JSON.parse(readFileSync(join(d, f), "utf8")) as EvidenceRecord;
                        n += Object.keys(rec ?? {}).length;
                } catch {
                        /* corrupt record — skip, never a thrown count */
                }
        }
        return n;
}

// ---------------------------------------------------------------------------
// The interchange lane's sanitizer (untrusted evidence from a foreign file)
// ---------------------------------------------------------------------------

/** Sanitize evidence carried in an interchange record: cap the note count
 *  and excerpt length, coerce ids/dates to honest shapes, drop garbage.
 *  Foreign evidence is PROVENANCE ONLY — it never re-enters the store as
 *  memory content; this shape only rides the review candidate's payload. */
export function sanitizeImportedEvidence(
        raw: unknown,
): Array<{ id: string; at: number; excerpt: string }> | null {
        if (!Array.isArray(raw) || raw.length === 0) return null;
        const out: Array<{ id: string; at: number; excerpt: string }> = [];
        for (const n of raw.slice(0, IMPORT_EVIDENCE_MAX_NOTES)) {
                if (!n || typeof n !== "object") continue;
                const note = n as Record<string, unknown>;
                const id = typeof note.id === "string" || typeof note.id === "number" ? String(note.id) : "";
                const excerpt = typeof note.excerpt === "string" ? note.excerpt : "";
                if (!id && !excerpt) continue;
                out.push({
                        id: id.slice(0, 64),
                        at: typeof note.at === "number" && Number.isFinite(note.at) ? note.at : 0,
                        excerpt: excerpt.slice(0, IMPORT_EVIDENCE_EXCERPT_CHARS),
                });
        }
        return out.length > 0 ? out : null;
}
