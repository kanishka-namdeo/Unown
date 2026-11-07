/**
 * io.ts — byte-stable import/export + Markdown export (ticket L-9,
 * PLAN §2 "The canonical-JSON rules (io.ts)" + §2 "The import gate
 * law", §6.2 "The 3 export goldens").
 *
 * DOM-free + Node-free (the Ostinato law): pure functions over
 * plain JSON; both unit lanes run it without a DOM, the IDB, or the
 * network.
 *
 * Lanes, documented per PLAN §2:
 *
 * - `exportData(data)` — the "legato.v1" schema wrapper serialized
 *   with sortKeysDeep + compact separators (`:` / `,`, no
 *   whitespace). Byte-stable across boots and key-insertion orders
 *   (the matrix lane I-1 law: same data set → same bytes, every
 *   boot). Arrays keep index order — `queue` order IS the reading
 *   order, `clips` order is insertion order; only object KEYS
 *   sort. Unicode-stable: raw UTF-8, no `\u`-escape drift — the 3
 *   goldens (§6.2) pin the bytes.
 *
 * - `importData(text)` — the import-gate law (PLAN §2): a doc whose
 *   `schema` is anything other than `"legato.v1"` (a foreign
 *   "fugue.v999", a FUTURE "legato.v2", a missing tag, or a
 *   non-object root) is refused with `ImportRefusalError` — the
 *   typed error carries the DRY-RUN report (what was examined, why
 *   refused) and the store is NEVER touched (no write of any kind
 *   reaches a StoragePort from this module; refusal is read-only).
 *   A same-schema doc that fails `assertData` is refused the same
 *   way, with `DomainInvariantError` carrying the breached
 *   invariant named.
 *
 *   THE LANE SPLIT, confirmed against migration.ts (L-2's concern
 *   #2): the import GATE keys on the document's `schema` TAG — the
 *   producer/consumer wire label, frozen at "legato.v1" — while
 *   `schemaVersion` is the IDB object-store schema version, the
 *   MIGRATION FRAME's lane (migration.ts `migrate(data,
 *   fromVersion)` + `SUPPORTED_VERSIONS`). The gate does NOT parse
 *   or version-check `schemaVersion`; that is the migration
 *   frame's job at load time, and an imported document only passes
 *   the gate when its `schema` tag matches exactly.
 *
 * - `exportMarkdown(data)` — one deterministic .md document: each
 *   clip as a `##` section (title, URL, created date, tags, body
 *   text, highlights as `>` blockquotes, notes as `>` + note
 *   lines). Same data → same bytes; the order is the clips'
 *   insertion order (array order is state, never re-sorted).
 *
 * The 3 goldens (§6.2) live at `test/goldens/*.json` and are
 * PINNED, not re-derived (the Chaconne §5 edge-9 law):
 * `io.test.ts` recomputes the canonical bytes and asserts
 * byte-equality against the committed files. Regenerating a
 * golden is a deliberate re-freeze (delete + re-run), never
 * implicit.
 */
import type { LegatoData, Clip } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";

/**
 * The document's schema tag — the import gate's law (PLAN §2).
 * Any other value (foreign, future, missing) is refused.
 */
export const LEGATO_SCHEMA = "legato.v1";

/**
 * The typed refusal of a foreign / future / malformed import
 * document. Carries the DRY-RUN report — what was examined and why
 * it was refused — so the calling UI can surface it honestly. The
 * store is never touched: refusal is read-only by construction
 * (nothing in this module writes to a StoragePort).
 */
export class ImportRefusalError extends Error {
  /**
   * The dry-run report: every examination step performed on the
   * document before refusal (what was parsed, what matched, why
   * it was refused). Non-empty by construction — the report
   * always names at least the refusal reason.
   */
  readonly report: string[];

  constructor(message: string, report: string[]) {
    super(message);
    this.name = "ImportRefusalError";
    this.report = report;
  }
}

// ─── Canonical JSON — the byte-stability core ─────────────────────

/**
 * Deep-clone a plain-JSON value. The data set is plain JSON at
 * every level (the Ostinato law, types.ts header), so
 * `JSON.parse(JSON.stringify(v))` is the identity map.
 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Recursively sort object keys (depth-first). Arrays keep their
 * index order — only OBJECT KEYS sort. This is the "byte-stable"
 * requirement: two identical data sets always serialize to the
 * same bytes, regardless of key insertion order (which
 * `JSON.parse` of a user document does not guarantee).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * Serialize to canonical JSON: sorted object keys, compact
 * separators (`":"` / `","`, no whitespace), raw UTF-8 (no `\u`
 * escapes — `JSON.stringify` leaves code points above `\u001F`
 * unescaped, so the bytes are implementation-stable across
 * runtimes). No trailing newline.
 */
export function toCanonicalJson(data: LegatoData): string {
  const sorted = sortKeysDeep(clone(data));
  return JSON.stringify(sorted);
}

/**
 * The "legato.v1" schema wrapper — the export's byte floor.
 * Exporting the empty store (the §6.2 golden 1) produces exactly
 * this document: the schema tag, the store version, zero clips,
 * zero tags, an empty queue.
 *
 * (The empty STORE itself — `LegatoData` with empty clips — is
 * constructed by callers; this constant documents what that
 * exports to.)
 */
export function emptyStore(): LegatoData {
  return {
    schema: LEGATO_SCHEMA,
    schemaVersion: 1,
    clips: [],
    tags: [],
    queue: [],
  };
}

// ─── Export lanes ──────────────────────────────────────────────────

/**
 * Serialize `data` to canonical, byte-stable JSON (the "legato.v1"
 * schema wrapper). Byte-stable across boots and key-insertion
 * orders (matrix lane I-1).
 *
 * @throws {DomainInvariantError} when `data` breaches a
 *  `assertData` invariant — exporting a torn data set would
 *  poison the next import, so the export side validates first
 *  (the symmetric half of the import gate).
 */
export function exportData(data: LegatoData): string {
  assertData(data);
  return toCanonicalJson(data);
}

/**
 * One deterministic Markdown document over `data` (the §6.2
 * golden-free Markdown lane).
 *
 * Shape: a `# Legato` header line, then one `## <title>` section
 * per clip, in the clips' INSERTION order (array order is state —
 * never re-sorted). Each section lists the URL, the created
 * date (the ISO string's date part), the tags (one comma-separated
 * line, `n/a` when empty), the body text (or the honest
 * "*(no readable body — title+URL fallback)*" line when the clip
 * is the empty-text fallback), and the highlights as `>`
 * blockquotes — the quote on its own line, the note (when
 * present) on a second `>` line.
 *
 * Deterministic: same data set → same bytes, every boot. The
 * only non-determinism source (key insertion order) is absent —
 * the output is built positionally from the data, not from any
 * map/record key order.
 */
export function exportMarkdown(data: LegatoData): string {
  assertData(data);
  const lines: string[] = ["# Legato", ""];
  for (const clip of data.clips) {
    lines.push(`## ${clip.title}`, "");
    lines.push(`- URL: ${clip.url}`);
    lines.push(`- Date: ${clip.createdAt.slice(0, 10)}`);
    const tagsLine = clip.tags.length > 0 ? clip.tags.join(", ") : "n/a";
    lines.push(`- Tags: ${tagsLine}`);
    lines.push("");
    if (clip.emptyText) {
      lines.push("*(no readable body — title+URL fallback)*", "");
    } else {
      lines.push(clip.text, "");
    }
    if (clip.highlights.length > 0) {
      for (const h of clip.highlights) {
        lines.push(`> ${h.quote}`);
        if (h.note !== undefined) {
          lines.push(`> ${h.note}`);
        }
      }
      lines.push("");
    }
    lines.push("---", "");
  }
  // The last clip's trailing `---` + blank line is dropped so the
  // document ends at the final section's content, not a dangling
  // separator. (Each section's `---` is its terminator; the last
  // one has nothing after it.)
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

// ─── The import gate (PLAN §2 "The import gate law") ──────────────

/**
 * Parse + gate + validate an import document.
 *
 * Refusal table (each produces a typed error; the store is NEVER
 * touched — this function is read-only over its input):
 *
 * | Input | Error thrown |
 * |---|---|
 * | not valid JSON | `ImportRefusalError` (report names the parse failure) |
 * | root not a plain object | `ImportRefusalError` (report names the root type) |
 * | `schema` missing | `ImportRefusalError` (report: no schema tag) |
 * | `schema !== "legato.v1"` (foreign "fugue.v999", future "legato.v2") | `ImportRefusalError` (report: the foreign tag, why it is refused) |
 * | any `assertData` invariant breach (same-schema doc) | `DomainInvariantError` (the breached invariant named) |
 *
 * A valid import returns the assertData-validated `LegatoData` —
 * a FRESH deep clone, never the caller's live object, never a
 * reference into the parsed tree.
 */
export function importData(text: string): LegatoData {
  const report: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    report.push("JSON parse: ok (root " + typeName(parsed) + ")");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report.push("JSON parse: FAILED — " + msg);
    throw new ImportRefusalError(
      `import refused: not valid JSON (${msg})`,
      report,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    report.push("root type: " + typeName(parsed) + " — must be a plain object");
    throw new ImportRefusalError(
      `import refused: root must be a plain object (got ${typeName(parsed)})`,
      report,
    );
  }

  const doc = parsed as Record<string, unknown>;
  report.push("examination: document with " + Object.keys(doc).length + " top-level key(s): " + Object.keys(doc).join(", "));

  // THE GATE: the schema tag (PLAN §2 — the lane split, see the
  // module header). A foreign or future tag, or a missing tag,
  // refuses the whole document. This is NOT the migration lane
  // (schemaVersion) — that is migration.ts's job at load time.
  if (doc.schema === undefined) {
    report.push("schema tag: ABSENT — a Legato import document must carry schema=\"legato.v1\"");
    throw new ImportRefusalError(
      "import refused: document carries no schema tag (expected \"legato.v1\")",
      report,
    );
  }
  if (doc.schema !== LEGATO_SCHEMA) {
    report.push(
      `schema tag: ${JSON.stringify(String(doc.schema))} — foreign or future; the gate accepts only "${LEGATO_SCHEMA}"`,
    );
    throw new ImportRefusalError(
      `import refused: schema ${JSON.stringify(String(doc.schema))} is not "${LEGATO_SCHEMA}" (foreign or future document; a newer Legato version's export must be down-converted before import)`,
      report,
    );
  }
  report.push(`schema tag: "${LEGATO_SCHEMA}" — gate passed`);

  // Structural pre-checks before assertData (the gate's shape
  // lane; assertData is the semantic lane and assumes shape).
  if (!Array.isArray(doc.clips)) {
    report.push("'clips' must be an array (gate shape lane)");
    throw new DomainInvariantError("import: 'clips' must be an array");
  }
  if (!Array.isArray(doc.tags)) {
    report.push("'tags' must be an array (gate shape lane)");
    throw new DomainInvariantError("import: 'tags' must be an array");
  }
  if (!Array.isArray(doc.queue)) {
    report.push("'queue' must be an array (gate shape lane)");
    throw new DomainInvariantError("import: 'queue' must be an array");
  }

  const data = clone(doc) as unknown as LegatoData;
  // The semantic lane: every invariant, the breach named.
  assertData(data);
  report.push("assertData: all invariants hold (" + data.clips.length + " clip(s), " + data.tags.length + " tag(s), queue of " + data.queue.length + ")");
  return data;
}

/**
 * The dry-run inspection WITHOUT the mutation risk — the caller
 * can check a document's admissibility (and harvest the report)
 * without a live store sitting in scope. This is the PLAN §2
 * "what would be rejected" half: it never writes, so the store
 * is trivially untouched. (There is no such thing as a partial
 * import in this module — `importData` either returns the full
 * validated data set or throws.)
 */
export function inspectImport(text: string): {
  /** true when the document passes the gate + invariants. */
  accepted: boolean;
  /** the dry-run report — always non-empty. */
  report: string[];
  /** the validated data set (absent when refused). */
  data?: LegatoData;
  /** the typed error when refused (absent when accepted). */
  error?: ImportRefusalError | DomainInvariantError;
} {
  try {
    const data = importData(text);
    return { accepted: true, report: ["gate + invariants: accepted"], data };
  } catch (e) {
    if (e instanceof ImportRefusalError) {
      return { accepted: false, report: e.report, error: e };
    }
    if (e instanceof DomainInvariantError) {
      return {
        accepted: false,
        report: ["gate passed; invariant breach: " + e.message],
        error: e,
      };
    }
    // Unreachable in practice — importData only throws the two
    // typed errors above.
    return { accepted: false, report: ["unknown refusal: " + String(e)], error: e as DomainInvariantError };
  }
}

/** The root's JS type name (for the refusal report). */
function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
