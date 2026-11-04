/**
 * Ostinato domain types — pure, serializable, DOM-free.
 *
 * Single source of truth for the app's data model (the Coda `types.ts`
 * precedent). Every entity is plain JSON (no class instances, no
 * Date objects) so a store serializing to JSON is a lossless,
 * non-rewrite path to import/export (P0 #7: JSON round-trip lossless).
 */

/**
 * A flashcard. `front`/`back` are markdown source (P0 #1: markdown
 * front/back). SM-2 scheduling state is carried per-card; a card that
 * has never been reviewed carries no `sm2` field.
 */
export type Card = {
  id: string;
  /** the deck this card belongs to; must match a Deck.id present in the store */
  deckId: string;
  front: string;
  back: string;
  /**
   * SM-2 scheduling state (O-2 implements the scheduler; O-1 pins the
   * shape only). All timestamps ISO-8601; `interval` is in days
   * (floating point is not a defect — SM-2's 2^0/2^1/… ease curve
   * yields fractional intervals under `easiness` drift).
   */
  sm2?: {
    /** repetitions since last `again` (0-based) */
    repetitions: number;
    /** current ease factor, ≥ 1.3 in SM-2 */
    easiness: number;
    /** current interval in days */
    interval: number;
    /** last review, ISO-8601 */
    lastReviewedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type Deck = {
  id: string;
  name: string;
  /**
   * Order of card ids in this deck. Integrity rule (the Coda
   * Board.taskOrder invariant): the set of card ids for the deck must
   * EXACTLY equal `cardOrder` — no orphan cards, no missing entries.
   * Every domain mutation preserves this invariant.
   */
  cardOrder: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * The full Ostinato data set. Plain JSON at every level; this IS the
 * import/export wire shape (P0 #7) and the persistence shape (P0 #6).
 */
/**
 * One completed review of one card — the append-only activity log R-1
 * adds. Written by `gradeCard` on every grade transition; never
 * rewritten, never reordered in-store (export is canonical anyway).
 */
export type ReviewEvent = {
  /** unique id, minted via ids.ts with the "review" prefix */
  id: string;
  /** the reviewed card; must resolve to a Card.id in the store */
  cardId: string;
  /** the deck the card belonged to at review time; must resolve and match the card's own deckId */
  deckId: string;
  /** the grade given: 1 (again) … 4 (easy) */
  grade: Grade;
  /** ISO-8601 timestamp of the review */
  reviewedAt: string;
};

export type OstinatoData = {
  decks: Deck[];
  cards: Card[];
  /** append-only review log (R-1); old imports back-fill to [] */
  reviews: ReviewEvent[];
};

/**
 * SM-2 quality grades, keyed by the keyboard surface's digits (P0 #3:
 * `1`–`4` grade). O-2 implements the scheduler; O-1 pins the input
 * vocabulary only.
 */
export type Grade = 1 | 2 | 3 | 4;

/**
 * The Scheduler port (O-2 implements, O-1 pins the interface): a pure
 * function of (card, grade, clock) → updated scheduling state. Ostinato
 * keeps the clock as plain strings so scheduling is deterministic and
 * unit-pinnable (P0 #2); the port injects "now" rather than calling
 * `Date.now()` inside the domain.
 */
export type Scheduler = {
  /**
   * Advance one card's SM-2 state for `grade` at time `now` (ISO-8601).
   * Returns the updated card; throws `DomainInvariantError` on an
   * invalid grade.
   */
  grade(card: Card, grade: Grade, now: string): Card;
};

/**
 * The import/export port (P0 #7: JSON round-trip lossless). O-1 pins
 * the interface; O-2/O-4 implement it. `exportData` must be byte-stable
 * across boots (matrix lane I-1: same data, two sequential boots →
 * identical export bytes), so the implementation must key-sorts and
 * stable-stringifies.
 */
export type ImportExportPort = {
  /** Serialize the data set to canonical JSON (byte-stable). */
  exportData(data: OstinatoData): string;
  /**
   * Parse + validate a JSON document into an OstinatoData. Throws
   * `DomainInvariantError` on any invariant breach (orphan card,
   * cardOrder set mismatch, unknown top-level fields at the root, …).
   */
  importData(json: string): OstinatoData;
};

/** Result of a domain operation that failed a guard (Coda precedent). */
export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}
