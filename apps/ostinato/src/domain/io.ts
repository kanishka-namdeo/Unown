/**
 * Import/Export port — P0 #7 (JSON round-trip lossless, byte-stable).
 *
 * The implementation is pinned at O-2 by `io.test.ts` (the Lane A
 * suite). Matrix lane I-1: same data, two sequential boots →
 * identical export bytes. The contract:
 *
 * - `exportData`: canonical JSON — key-sorted objects, stable array
 *   order (the deck's `cardOrder` is the array-of-card-ids order,
 *   not re-sorted), no trailing newline. Byte-stable across boots.
 * - `importData`: parse → `assertData` → throw `DomainInvariantError`
 *   on ANY invariant breach (orphan card, cardOrder mismatch, unknown
 *   top-level fields, duplicate ids, …). A corrupted or foreign JSON
 *   document must NEVER pass through silently.
 */
import type { OstinatoData, ImportExportPort, ReviewEvent, DeckSettings } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";

/** Top-level keys that are ALLOWED in an import document. */
const ALLOWED_TOP = new Set(["decks", "cards", "reviews"]);

/**
 * Deep-clone a plain-JSON value (the data set is plain JSON at every
 * level — no class instances — so `JSON.parse(JSON.stringify(v))` is
 * the identity map, and no key-sorting is needed to clone).
 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Recursively sort object keys (depth-first) and produce a
 * deterministic key order. Arrays keep their index order (the
 * deck's cardOrder is the semantic array order — it must NOT be
 * sorted, only its contents are canonically ordered by the domain).
 *
 * This is the "byte-stable" requirement: two identical data sets
 * always serialize to the same bytes, regardless of key insertion
 * order (which `JSON.parse` from a user document does not
 * guarantee).
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
 * Serialize to canonical JSON: sorted object keys, compact separators
 * (no whitespace — the wire format is machine-readable, not
 * human-pretty; the UI shell's export UI can pretty-print at the
 * edge without affecting byte-stability of the data layer).
 */
export function toCanonicalJson(data: OstinatoData): string {
  const sorted = sortKeysDeep(clone(data));
  return JSON.stringify(sorted);
}

/**
 * The ImportExportPort implementation.
 *
 * `exportData` is a pure function of the data set — byte-stable
 * across boots. `importData` validates every invariant before
 * returning the data.
 */
export function createImportExport(): ImportExportPort {
  return {
    /**
     * Serialize to canonical, byte-stable JSON.
     * Same data set → same bytes, every boot.
     */
    exportData(data: OstinatoData): string {
      return toCanonicalJson(data);
    },

    /**
     * Parse + validate a JSON document.
     *
     * @throws {DomainInvariantError} on:
     *  - not valid JSON
     *  - root is not a plain object
     *  - unknown top-level keys (ALLOWED_TOP only: `decks`, `cards`, `reviews`)
     *  - `decks` or `cards` not an array
     *  - `reviews` present but not an array (a pre-log document omits it and imports clean as `reviews: []`)
     *  - any `assertData` invariant breach
     *  - duplicate card or deck or review ids (assertData catches this)
     *  - orphan card (assertData catches this)
     *  - cardOrder set-mismatch (assertData catches this)
     *  - review log entries with unknown card/deck ids or grade outside 1..4 (assertData catches this)
     */
    importData(json: string): OstinatoData {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new DomainInvariantError("import: not valid JSON");
      }

      // Root must be a plain object.
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new DomainInvariantError(
          "import: root must be a plain object with 'decks' and 'cards'",
        );
      }

      const root = parsed as Record<string, unknown>;

      // Unknown top-level keys are rejected (a future field added by a
      // newer app version is NOT silently swallowed — it must be
      // explicitly handled in importData, not just appear in the data).
      for (const key of Object.keys(root)) {
        if (!ALLOWED_TOP.has(key)) {
          throw new DomainInvariantError(`import: unknown top-level key: '${key}'`);
        }
      }

      // Both keys must be present.
      if (!Array.isArray(root.decks)) {
        throw new DomainInvariantError("import: 'decks' must be an array");
      }
      if (!Array.isArray(root.cards)) {
        throw new DomainInvariantError("import: 'cards' must be an array");
      }

      // Backward compat (R-1): pre-log documents import clean — the
      // absent key becomes an empty review log, never an error.
      if (root.reviews !== undefined && !Array.isArray(root.reviews)) {
        throw new DomainInvariantError("import: 'reviews' must be an array");
      }

      const data = {
        ...parsed,
        reviews: Array.isArray(root.reviews) ? (root.reviews as ReviewEvent[]) : [],
      } as OstinatoData;

      // Per-card field checks: front/back must be strings.
      for (const card of data.cards) {
        if (typeof card !== "object" || card === null) {
          throw new DomainInvariantError("import: card entry must be an object");
        }
        if (typeof card.id !== "string") {
          throw new DomainInvariantError(`import: card.id must be a string (got ${typeof card.id})`);
        }
        if (typeof card.deckId !== "string") {
          throw new DomainInvariantError(`import: card.deckId must be a string`);
        }
        if (typeof card.front !== "string") {
          throw new DomainInvariantError(`import: card ${card.id}: front must be a string`);
        }
        if (typeof card.back !== "string") {
          throw new DomainInvariantError(`import: card ${card.id}: back must be a string`);
        }
        // sm2 is optional; if present, shape-check it.
        if (card.sm2 !== undefined && card.sm2 !== null) {
          const sm2 = card.sm2;
          if (typeof sm2.repetitions !== "number" || sm2.repetitions < 0) {
            throw new DomainInvariantError(`import: card ${card.id}: sm2.repetitions must be a non-negative number`);
          }
          if (typeof sm2.easiness !== "number" || sm2.easiness < 1.3) {
            throw new DomainInvariantError(`import: card ${card.id}: sm2.easiness must be a number >= 1.3`);
          }
          if (typeof sm2.interval !== "number" || sm2.interval <= 0) {
            throw new DomainInvariantError(`import: card ${card.id}: sm2.interval must be a positive number`);
          }
        }
      }

      // Per-deck field checks.
      for (const deck of data.decks) {
        if (typeof deck !== "object" || deck === null) {
          throw new DomainInvariantError("import: deck entry must be an object");
        }
        if (typeof deck.id !== "string") {
          throw new DomainInvariantError(`import: deck.id must be a string (got ${typeof deck.id})`);
        }
        if (typeof deck.name !== "string" || deck.name.length === 0) {
          throw new DomainInvariantError(`import: deck ${deck.id}: name must be a non-empty string`);
        }
        if (!Array.isArray(deck.cardOrder)) {
          throw new DomainInvariantError(`import: deck ${deck.id}: cardOrder must be an array`);
        }
        for (const id of deck.cardOrder) {
          if (typeof id !== "string") {
            throw new DomainInvariantError(`import: deck ${deck.id}: cardOrder entries must be strings`);
          }
        }
        // R-2 deck settings: absent = clean (backward compat), `{}` = clean,
        // a present field must be an integer >= 0.
        if (deck.settings !== undefined && deck.settings !== null) {
          const s = deck.settings as unknown as DeckSettings;
          if (typeof s !== "object" || Array.isArray(s)) {
            throw new DomainInvariantError(`import: deck ${deck.id}: settings must be an object`);
          }
          const n = s.newCardsPerSession;
          if (n !== undefined) {
            if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
              throw new DomainInvariantError(`import: deck ${deck.id}: settings.newCardsPerSession must be an integer >= 0`);
            }
          }
        }
      }

      // Per-review field checks (R-1 review log entries).
      for (const review of data.reviews) {
        if (typeof review !== "object" || review === null) {
          throw new DomainInvariantError("import: review entry must be an object");
        }
        if (typeof review.id !== "string") {
          throw new DomainInvariantError(`import: review.id must be a string (got ${typeof review.id})`);
        }
        if (typeof review.cardId !== "string") {
          throw new DomainInvariantError(`import: review ${review.id}: cardId must be a string`);
        }
        if (typeof review.deckId !== "string") {
          throw new DomainInvariantError(`import: review ${review.id}: deckId must be a string`);
        }
        if (review.grade !== 1 && review.grade !== 2 && review.grade !== 3 && review.grade !== 4) {
          throw new DomainInvariantError(`import: review ${review.id}: grade must be 1..4`);
        }
        if (typeof review.reviewedAt !== "string") {
          throw new DomainInvariantError(`import: review ${review.id}: reviewedAt must be a string`);
        }
      }

      // Full shape invariants (orphan cards, cardOrder set-match,
      // duplicate ids, review log refs, …).
      assertData(data);

      return data;
    },
  };
}

/** Convenience: the singleton port (the app uses one instance). */
export const importExport: ImportExportPort = createImportExport();
