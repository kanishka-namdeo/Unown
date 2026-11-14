/**
 * memory-interchange.ts — memory export/import (the Memory Divertimento
 * round's CP6, 2026-11-15).
 *
 * THE CONTRACT (the round's pre-registered design): `unown memory export`
 * writes a schema-v1 JSON file carrying the memories (text, type, SRO,
 * confirmedAt, provenance, supersede links, dormancy) + metadata;
 * `unown memory import` is TRUST-GATED — structural quarantine per rule,
 * char caps, schema-version refusal — and imports land in the REVIEW QUEUE
 * by default (the human gate, the memU pitch and this round's own CP1
 * law: model-adjacent content never writes tiers unreviewed);
 * `--apply` writes directly, source tagged `import`.
 *
 * Why a human gate at all: an import file is the HIGHEST-leverage write
 * surface in the system — a user-tier memory injects into EVERY future
 * project. The research round graded the field's interchange story (memU's
 * store-verifies/agent-distills split; MIRIX's 2026-11-09 security review
 * fixing deleted-memories-still-searchable among 11 defect classes; ChatGPT
 * memories' 96%-unilateral-creation anti-pattern) and the law is unanimous:
 * imported content is UNTRUSTED until a human says otherwise. The export is
 * lossless-enough to round-trip the fields the engine actually consumes
 * (kind, sro, provenance, supersede links, dormancy); the ids ride as
 * PROVENANCE ONLY — an import mints fresh platform rows, never resurrects
 * foreign ids (the MIRIX deleted-rows-still-searchable class is impossible
 * by construction when the id space is not imported).
 *
 * Pure module (the sessions.ts export pattern): the builders take plain
 * data, the classifier takes the guard's pure scan, and the two APpliers
 * take injectable sinks so tests never touch the live engine. The CLI and
 * the engine API (server.ts) are thin wrappers.
 */

import { scanMemoryCandidate, type GuardFlag } from "./guard.ts";
import { type PlatformMemory, parseSro } from "./memzero.ts";
import { memoryConfirmedAt, memoryInvalidAt, supersededById } from "./memory-stamps.ts";

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export const MEMORY_INTERCHANGE_VERSION = 1;

/** Per-record text cap. The hoist lane's own rule cap is 260 chars (user-tier
 *  rules render in EVERY project's injection — brevity is the budget); an
 *  import record may carry a fact with a little more room but must stay
 *  bounded: the render's per-bullet char ceiling is enforced downstream
 *  anyway, and an unbounded record is an injection-budget attack vector. */
export const IMPORT_MAX_TEXT_CHARS = 600;

/** Whole-file cap: 5k records is far past any real project's memory and
 *  bounds a hostile file's park/write amplification. */
export const IMPORT_MAX_RECORDS = 5000;

/** One exported memory — the fields the engine consumes, nothing else. */
export interface MemoryInterchangeRecord {
        /** The platform scope the memory lived in: "engine" or "project:<slug>". */
        scope: string;
        /** The ORIGINAL platform id — provenance only; imports never reuse it. */
        id: string;
        text: string;
        /** metadata.kind: "" (fact) | episode | procedure | preference | harness | seed. */
        kind: string;
        /** The [subject, relation, object] triple when the memory carries one. */
        sro: [string, string, string] | null;
        createdAt: string | null;
        updatedAt: string | null;
        /** The freshness clock (memory-stamps' memoryConfirmedAt, ms). */
        confirmedAt: number | null;
        /** Supersede links (bi-temporal audit; the loser keeps its stamps). */
        supersededBy: string | null;
        invalidAt: number | null;
        /** Dormancy is a side record per scope — exported per memory. */
        dormant: boolean;
        /** metadata.provenance when present (the dream/run that minted it). */
        provenance: Record<string, unknown> | null;
}

/** The whole export file. */
export interface MemoryInterchangeFile {
        version: number;
        generator: string;
        exportedAt: string;
        records: MemoryInterchangeRecord[];
        meta: { total: number; live: number; superseded: number; dormant: number; scopes: string[] };
}

// ---------------------------------------------------------------------------
// Export side — the builders (pure)
// ---------------------------------------------------------------------------

/** Build one record from a platform memory + its scope's dormant set. */
export function buildMemoryInterchangeRecord(
        scope: string,
        m: PlatformMemory,
        dormantIds: ReadonlySet<string>,
): MemoryInterchangeRecord {
        const t = parseSro(m);
        const sro: [string, string, string] | null = t ? [t.s, t.r, t.o] : null;
        const meta = (m?.metadata ?? {}) as Record<string, any>;
        return {
                scope,
                id: String(m.id ?? ""),
                text: String(m.text ?? ""),
                kind: String(meta.kind ?? ""),
                sro,
                createdAt: m.createdAt ?? null,
                updatedAt: m.updatedAt ?? null,
                confirmedAt: memoryConfirmedAt(m),
                supersededBy: supersededById(m),
                invalidAt: memoryInvalidAt(m),
                dormant: dormantIds.has(String(m.id ?? "")),
                provenance: (meta.provenance as Record<string, unknown> | undefined) ?? null,
        };
}

/** Build the export file from per-scope memory lists (+ each scope's
 *  dormant-id set). Pure: `exportedAt` is injectable so tests are
 *  deterministic. */
export function buildMemoryInterchangeFile(
        scopes: Array<{ scope: string; memories: PlatformMemory[]; dormantIds: ReadonlySet<string> }>,
        exportedAt: string = new Date().toISOString(),
): MemoryInterchangeFile {
        const records: MemoryInterchangeRecord[] = [];
        for (const s of scopes) {
                for (const m of s.memories) records.push(buildMemoryInterchangeRecord(s.scope, m, s.dormantIds));
        }
        return {
                version: MEMORY_INTERCHANGE_VERSION,
                generator: "unown",
                exportedAt,
                records,
                meta: {
                        total: records.length,
                        live: records.filter((r) => !r.supersededBy).length,
                        superseded: records.filter((r) => r.supersededBy).length,
                        dormant: records.filter((r) => r.dormant).length,
                        scopes: [...new Set(records.map((r) => r.scope))].sort(),
                },
        };
}

// ---------------------------------------------------------------------------
// Import side — the parse + the trust gate
// ---------------------------------------------------------------------------

export type InterchangeParseResult =
        | { ok: true; file: MemoryInterchangeFile }
        | { ok: false; error: string; hint?: string };

/** Parse + structurally validate an interchange file. REFUSES, never
 *  repairs: a schema-version it does not know is a hard error with the
 *  remedy in the message (the "refuse, never guess" law — a v2 file's
 *  unknown fields might carry semantics we would silently drop). */
export function parseMemoryInterchangeFile(raw: unknown): InterchangeParseResult {
        let data: any;
        if (typeof raw === "string") {
                try {
                        data = JSON.parse(raw);
                } catch {
                        return { ok: false, error: "not valid JSON" };
                }
        } else {
                data = raw;
        }
        if (data === null || typeof data !== "object" || Array.isArray(data)) {
                return { ok: false, error: "not a memory export file (expected a JSON object)" };
        }
        const version = Number(data.version);
        if (!Number.isFinite(version) || version !== MEMORY_INTERCHANGE_VERSION) {
                return {
                        ok: false,
                        error: `unsupported schema version ${String(data.version)} (this unown understands version ${MEMORY_INTERCHANGE_VERSION} only)`,
                        hint: "re-export from the unown that produced the file, or upgrade unown",
                };
        }
        if (!Array.isArray(data.records)) {
                return { ok: false, error: "missing records[] — not a memory export file" };
        }
        if (data.records.length > IMPORT_MAX_RECORDS) {
                return {
                        ok: false,
                        error: `${data.records.length} records exceeds the ${IMPORT_MAX_RECORDS}-record import cap`,
                        hint: "split the export (scope-by-scope) and import the parts",
                };
        }
        const records: MemoryInterchangeRecord[] = [];
        for (const r of data.records) {
                if (r === null || typeof r !== "object") {
                        return { ok: false, error: "records[] contains a non-object entry" };
                }
                const rec = r as Record<string, unknown>;
                const text = typeof rec.text === "string" ? rec.text : "";
                const scope = typeof rec.scope === "string" ? rec.scope : "";
                if (scope === "") {
                        return { ok: false, error: `record with text "${text.slice(0, 40)}…" is missing its scope` };
                }
                records.push({
                        scope,
                        id: typeof rec.id === "string" ? rec.id : "",
                        text,
                        kind: typeof rec.kind === "string" ? rec.kind : "",
                        sro: Array.isArray(rec.sro) && rec.sro.length === 3
                                ? [String(rec.sro[0]), String(rec.sro[1]), String(rec.sro[2])]
                                : null,
                        createdAt: typeof rec.createdAt === "string" ? rec.createdAt : null,
                        updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : null,
                        confirmedAt: typeof rec.confirmedAt === "number" && Number.isFinite(rec.confirmedAt) ? rec.confirmedAt : null,
                        supersededBy: typeof rec.supersededBy === "string" ? rec.supersededBy : null,
                        invalidAt: typeof rec.invalidAt === "number" && Number.isFinite(rec.invalidAt) ? rec.invalidAt : null,
                        dormant: rec.dormant === true,
                        provenance: rec.provenance !== null && typeof rec.provenance === "object" && !Array.isArray(rec.provenance)
                                ? (rec.provenance as Record<string, unknown>)
                                : null,
                });
        }
        return {
                ok: true,
                file: {
                        version: MEMORY_INTERCHANGE_VERSION,
                        generator: typeof data.generator === "string" ? data.generator : "unknown",
                        exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
                        records,
                        meta: {
                                total: records.length,
                                live: records.filter((r) => !r.supersededBy).length,
                                superseded: records.filter((r) => r.supersededBy).length,
                                dormant: records.filter((r) => r.dormant).length,
                                scopes: [...new Set(records.map((r) => r.scope))].sort(),
                        },
                },
        };
}

/** A record that survived the trust gate, normalized for its destination. */
export interface AcceptedImportRecord {
        scope: string;
        text: string;
        kind: string;
        sro: [string, string, string] | null;
        provenance: Record<string, unknown> | null;
}

export interface QuarantinedImportRecord {
        record: MemoryInterchangeRecord;
        reasons: string[];
}

export interface ImportClassification {
        accepted: AcceptedImportRecord[];
        quarantined: QuarantinedImportRecord[];
}

const SCOPE_RE = /^(engine|project:[a-z0-9][a-z0-9._-]{0,63})$/i;

/** The trust gate, per record:
 *   - the scope must be a known shape (engine or project:<slug>) — a foreign
 *     scope is quarantined, never silently rerouted;
 *   - the text must be non-empty and within IMPORT_MAX_TEXT_CHARS;
 *   - a SUPERSEDED record never re-imports (it was retired on its home
 *     store; resurrecting it would reintroduce a contradiction the source
 *     already resolved);
 *   - the deterministic guard (scanMemoryCandidate) must come back clean —
 *     a flagged line is quarantined WITH its flags, never trimmed (an
 *     imported runner-directive must be refused loudly, the F4B law).
 *  Dormancy bookkeeping is NOT imported: dormancy is usage-conditioned
 *  (this store's render budget decides), and a foreign store's exclusion
 *  counts say nothing about this one. */
export function classifyImportRecords(records: MemoryInterchangeRecord[]): ImportClassification {
        const accepted: AcceptedImportRecord[] = [];
        const quarantined: QuarantinedImportRecord[] = [];
        for (const r of records) {
                const reasons: string[] = [];
                if (!SCOPE_RE.test(r.scope)) reasons.push(`unknown scope "${r.scope}" (expected engine or project:<slug>)`);
                const text = r.text.trim();
                if (!text) reasons.push("empty text");
                if (text.length > IMPORT_MAX_TEXT_CHARS) {
                        reasons.push(`text is ${text.length} chars (cap ${IMPORT_MAX_TEXT_CHARS})`);
                }
                if (r.supersededBy) reasons.push(`superseded on its home store (by ${r.supersededBy}) — retired rows never re-import`);
                const flags: GuardFlag[] = scanMemoryCandidate(text);
                if (flags.length > 0) reasons.push(`guard: ${[...new Set(flags.map((f) => f.rule))].join(", ")}`);
                if (reasons.length > 0) {
                        quarantined.push({ record: r, reasons });
                        continue;
                }
                accepted.push({
                        scope: r.scope,
                        text,
                        kind: r.kind,
                        sro: r.sro,
                        provenance: r.provenance,
                });
        }
        return { accepted, quarantined };
}

// ---------------------------------------------------------------------------
// Import side — the appliers (injectable sinks, engine/CLI-agnostic)
// ---------------------------------------------------------------------------

/** What one parked/ written record landed as. */
export interface ImportApplyOutcome {
        parked: number;
        written: number;
        failed: { text: string; error: string }[];
}

/** Park every accepted record into the MEMORY REVIEW QUEUE (the default
 *  import path — the human gate). `park` is injectable (the engine passes
 *  memory-review.ts's parkMemoryReviewCandidate; tests pass a recorder).
 *  The evidence line names the file's origin so the human sees WHERE a
 *  candidate came from; the type rides through (the queue carries it since
 *  CP1); the scope rides in the evidence (the queue is user-level by
 *  design — one inbox, every project). */
export function parkImportedRecords(
        accepted: AcceptedImportRecord[],
        origin: string,
        park: (cand: { rule: string; type?: string; projects: string[]; evidence: string; source: string }) => string,
): ImportApplyOutcome {
        const out: ImportApplyOutcome = { parked: 0, written: 0, failed: [] };
        for (const r of accepted) {
                try {
                        park({
                                rule: r.text,
                                type: r.kind || undefined,
                                projects: [],
                                evidence: `imported from ${origin} (source scope: ${r.scope})`,
                                source: "import",
                        });
                        out.parked++;
                } catch (err: any) {
                        out.failed.push({ text: r.text, error: err instanceof Error ? err.message : String(err) });
                }
        }
        return out;
}

/** Write every accepted record DIRECTLY (the `--apply` path — the operator's
 *  explicit trust). `write` is injectable (the engine passes the platform's
 *  add with infer:false — the text IS the memory, no LLM extraction runs on
 *  import; tests pass a recorder). The metadata stamps the row `import`
 *  with the origin, so later audits can tell imported rows from dreamed
 *  ones. */
export function writeImportedRecords(
        accepted: AcceptedImportRecord[],
        origin: string,
        write: (r: AcceptedImportRecord, metadata: Record<string, any>) => unknown | Promise<unknown>,
): Promise<ImportApplyOutcome> {
        return (async () => {
                const out: ImportApplyOutcome = { parked: 0, written: 0, failed: [] };
                const importedAt = new Date().toISOString();
                for (const r of accepted) {
                        const metadata: Record<string, any> = { source: "import", importedAt, importOrigin: origin };
                        if (r.kind) metadata.kind = r.kind;
                        if (r.sro) metadata.sro = r.sro;
                        if (r.provenance) metadata.provenance = r.provenance;
                        try {
                                await write(r, metadata);
                                out.written++;
                        } catch (err: any) {
                                out.failed.push({ text: r.text, error: err instanceof Error ? err.message : String(err) });
                        }
                }
                return out;
        })();
}
