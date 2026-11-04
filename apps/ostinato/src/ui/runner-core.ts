/**
 * Ostinato — the review runner's DOM-free core (ticket O-3, P0 #3).
 *
 * Lives OUTSIDE `src/domain/` (the domain boundary law keeps the
 * domain flat + frozen at O-1/O-2) but is DOM-free BY RULE: every
 * function here takes plain data + injected ports and returns plain
 * data; `runner-core.test.ts` proves it runs under a genuinely
 * DOM-free runtime (Lane A, no happy-dom preload).
 *
 * What this module owns (the ticket's build item 1):
 *
 * - **The due-queue computation** (`isCardDue`, `computeDueQueue`,
 *   `computeReviewQueue`) — "cards whose scheduling says due, or ALL
 *   cards when nothing is due" (the ticket's pinned choice,
 *   DECISION D1). Determinism: an injected `Clock`
 *   (`() => string`, ISO-8601 — the domain's ports export the type)
 *   supplies time; nothing here reads a wall clock. A card with no
 *   `sm2` state (never graded) is ALWAYS due.
 * - **The review state machine** (`startSession`, `applyEvent`) —
 *   the P0 #3 loop: front shown → reveal (back shown) → grade
 *   `1`–`4` → advance → done. Event function: `applyEvent(session,
 *   event, ctx)` returns NEW session + data; the inputs are not
 *   mutated (the Coda domain-purity convention applied to runner
 *   state).
 * - **The grading key map** (`GRADE_KEYS`, `gradeKeyToGrade`,
 *   `REVEAL_KEYS`) — `1` = Again, `2` = Hard, `3` = Good, `4` =
 *   Easy (the domain `Grade` type's q = g − 1 mapping); reveal =
 *   Space/Enter.
 * - **Interruption-safety BY DESIGN** (P0 #6 prep; O-4 proves it
 *   end-to-end, O-3 receipts the design here): the session object
 *   is the persisted state — `serializePersistedSession` /
 *   `deserializePersistedSession` round-trip it through JSON bytes.
 *   At boot the queue is RECOMPUTED from the data set (the data is
 *   the source of truth; the persisted card ids are used only to
 *   position the cursor), so a kill mid-review restores the queue +
 *   the cursor + the card's SM-2 state. `saveSession` /
 *   `loadSession` move those bytes through the localStorage seam
 *   (a `StorageLike` + key parameter — the same seam style the
 *   domain storage tests use; the session lives under its own key,
 *   `ostinato.session`, so the data set's byte-stable export
 *   (`ostinato.data`, matrix lane I-1) is never polluted).
 *
 * No DOM import, no `Date.now()` call (only `Date.parse` on caller-
 * supplied strings — a pure function of its inputs), no randomness.
 */
import type {
  Card,
  OstinatoData,
  Grade,
  Scheduler,
  Clock,
  ReviewEvent,
} from "../domain/ports.js";
import { DomainInvariantError } from "../domain/ports.js";
import type { StorageLike } from "../domain/storage.js";
import { createScheduler } from "../domain/scheduler.js";
import { newUniqueId } from "../domain/ids.js";

// ─── The grading key map ──────────────────────────────────────────────────────

/**
 * The keyboard grading keys (`1`–`4`, P0 #3). Each key is a `Grade`
 * value; the UI's key handler maps `e.key` through this table.
 *
 *   "1" → Grade 1  (Again / q=0 — reset: R=0, I=1)
 *   "2" → Grade 2  (Hard  / q=1 — reset: R=0, I=1)
 *   "3" → Grade 3  (Good  / q=2 — advance: R+=1, I per table)
 *   "4" → Grade 4  (Easy  / q=3 — advance: R+=1, I per table)
 */
export const GRADE_KEYS: Record<string, Grade> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

/** The label each grade key shows in the UI's grade row (honest copy, not color-only). */
export const GRADE_LABELS: Record<Grade, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

/**
 * The reveal keys (P0 #3: "Space/Enter reveals") — the single source
 * of truth shared by the UI handler and the test suite.
 */
export const REVEAL_KEYS = new Set([" ", "Enter"]);

/** Map a keyboard `e.key` value to a `Grade`, or `null` (not a grading key). */
export function gradeKeyToGrade(key: string): Grade | null {
  return GRADE_KEYS[key] ?? null;
}

/** Map a keyboard `e.key` value to `true` when it reveals. */
export function isRevealKey(key: string): boolean {
  return REVEAL_KEYS.has(key);
}

// ─── Due-queue computation ────────────────────────────────────────────────────

/**
 * A card is DUE when:
 *   - it has never been graded (no `sm2` field), OR
 *   - it was last reviewed `sm2.interval` days ago or more,
 *     measured against the injected `now`.
 *
 * Pure: `Date.parse` on caller-supplied ISO-8601 strings only — no
 * wall-clock read. An undecodable timestamp is treated as "no
 * record" → due (a lenient predicate; the boot-time data import
 * has already thrown on a shape-invalid data set).
 *
 * @param card the card under test
 * @param now  ISO-8601 instant (the injected Clock's output)
 */
export function isCardDue(card: Card, now: string): boolean {
  if (!card.sm2) return true; // new card — its first review is its introduction
  const lastMs = Date.parse(card.sm2.lastReviewedAt ?? card.updatedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) return true;
  const days = (nowMs - lastMs) / 86_400_000;
  return days >= card.sm2.interval;
}

/**
 * The DUE-queue — P0 #3 + the ticket's pinned choice (DECISION D1):
 *
 *   **Due cards, or ALL cards when nothing is due.** Rationale: a
 *   learner who opens the app with no cards due is not met with a
 *   dead panel — "review all your cards anyway" is the honest next
 *   action, and the UI's empty-due state can say so explicitly
 *   ("N cards ready · N more due — review all"). A truly empty data
 *   set (no cards at all) returns an EMPTY queue and the empty state
 *   says "create a card first" — the fallback only bridges
 *   non-empty → review-all, it never invents cards.
 *
 * Ordering: stable and deterministic — deck-by-deck in `data.decks`
 * order, within a deck the `cardOrder` order (the order the user
 * sees when browsing; no shuffle — the hardening-first lane pins
 * determinism).
 *
 * @param data the full data set
 * @param now  the injected clock's instant (ISO-8601)
 */
export function computeDueQueue(data: OstinatoData, now: string): Card[] {
  if (data.cards.length === 0) return [];
  const due = data.cards.filter((c) => isCardDue(c, now));
  // The pinned fallback: nothing due → review all.
  const chosen = due.length > 0 ? due : data.cards;
  const deckIndex = new Map<string, number>();
  data.decks.forEach((d, i) => deckIndex.set(d.id, i));
  const pos = new Map<string, number>();
  for (const d of data.decks) d.cardOrder.forEach((id, i) => pos.set(id, i));
  return [...chosen].sort((a, b) => {
    const da = deckIndex.get(a.deckId) ?? Number.MAX_SAFE_INTEGER;
    const db = deckIndex.get(b.deckId) ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0);
  });
}

/**
 * The RUNNING queue: what the review loop walks. Identical to
 * `computeDueQueue` (the all-cards fallback is baked in); the split
 * exists so callers name their intent — "due queue" = the predicate
 * view, "review queue" = the iteration.
 */
export function computeReviewQueue(data: OstinatoData, now: string): Card[] {
  return computeDueQueue(data, now);
}

// ─── The review session state machine ──────────────────────────────────────────

/** The UI phase of the current card in the review loop. */
export type ReviewPhase = "front" | "revealed" | "done";

/**
 * The session state — P0 #3's machine + P0 #6's persisted unit.
 *
 * Interruption-safe BY CONSTRUCTION:
 *   - `cardIds` is the queue the loop walks (recomputed at boot;
 *     persisted so the cursor survives a kill);
 *   - `index` positions the cursor;
 *   - `phase` is `front` / `revealed` / `done`;
 *   - `currentCardId` / `currentDeckId` are denormalized for the UI;
 *   - `lastGradedCard` carries the SM-2 state of the most recent
 *     grading so a resume restores the card's scheduling exactly.
 */
export type ReviewSession = {
  cardIds: string[];
  index: number;
  phase: ReviewPhase;
  currentCardId: string | null;
  currentDeckId: string | null;
  lastGradedCard: Card | null;
};

/** The event vocabulary (P0 #3: the reveal step + grading 1–4 + advance). */
export type SessionEvent =
  | { type: "reveal" }
  | { type: "grade"; grade: Grade }
  | { type: "skip" };

/** The context a transition needs from the surrounding app. */
export type SessionCtx = {
  data: OstinatoData;
  /** The injected clock (ISO-8601 string; no wall read inside the machine). */
  clock: Clock;
  /** The Scheduler port (default: the domain's `createScheduler()`). */
  scheduler?: Scheduler;
};

function defaultScheduler(): Scheduler {
  return createScheduler();
}

/** The fresh-boot session: no cards, terminal `done` phase. */
export function emptySession(): ReviewSession {
  return {
    cardIds: [],
    index: -1,
    phase: "done",
    currentCardId: null,
    currentDeckId: null,
    lastGradedCard: null,
  };
}

/**
 * Start (or resume) a session from a data set + persisted state.
 *
 * **The recomputation rule (P0 #6):** the card queue is recomputed
 * from `data` — the persisted ids position the cursor on the
 * recomputed queue. A crash between any two transitions leaves the
 * data set unchanged, so recomputation yields the same queue; only
 * the cursor + phase are not derivable, and they are persisted at
 * every transition.
 *
 * A persisted cursor that falls out of range of the recomputed
 * queue (data changed between crash and resume — a card removed, a
 * new deck added) is clamped to `0`, not an error: resume means
 * "keep reviewing", never "refuse to boot".
 *
 * @param data      the data set (source of truth)
 * @param now       the injected clock's instant
 * @param persisted the persisted session, or `null` (fresh boot)
 */
export function startSession(
  data: OstinatoData,
  now: string,
  persisted: ReviewSession | null,
): ReviewSession {
  const queue = computeReviewQueue(data, now);
  if (queue.length === 0) return emptySession();
  if (!persisted) {
    return {
      ...emptySession(),
      cardIds: queue.map((c) => c.id),
      index: 0,
      phase: "front",
      currentCardId: queue[0].id,
      currentDeckId: queue[0].deckId,
    };
  }
  const nextIndex =
    persisted.index >= 0 && persisted.index < queue.length
      ? persisted.index
      : 0;
  const current = queue[nextIndex];
  const live = persisted.lastGradedCard
    ? data.cards.some((c) => c.id === persisted.lastGradedCard!.id)
      ? persisted.lastGradedCard
      : null
    : null;
  return {
    cardIds: queue.map((c) => c.id),
    index: nextIndex,
    phase: nextIndex >= queue.length ? "done" : persisted.phase === "done" ? "done" : persisted.phase,
    currentCardId: current.id,
    currentDeckId: current.deckId,
    lastGradedCard: live,
  };
}

/** A transition result: the new session + the (possibly) new data set. */
export type TransitionResult = {
  session: ReviewSession;
  data: OstinatoData;
};

/**
 * Apply one event. Pure: returns a NEW session (+ data on grade);
 * the inputs are not mutated.
 *
 * **The P0 #6 persistence rule (receipted here, O-4 proves it):**
 * a grading transition rewrites the card's SM-2 state in the data
 * set in the SAME step that advances the cursor. The UI persists
 * both artifacts — the data set through the data-key StoragePort
 * lane, the session through the session-key lane — on EVERY
 * transition (the helper `saveSession` below + the data save in
 * `src/ui/app.ts`). A kill between the two leaves either "data
 * graded + cursor pre-advance" (the card gets graded once more — a
 * harmless idempotent path in SM-2) or "cursor advanced + data
 * saved" (nothing lost). Either way the invariants hold.
 */
export function applyEvent(
  session: ReviewSession,
  event: SessionEvent,
  ctx: SessionCtx,
): TransitionResult {
  if (session.phase === "done") return { session, data: ctx.data };
  const current = session.currentCardId
    ? ctx.data.cards.find((c) => c.id === session.currentCardId) ?? null
    : null;
  if (!current) return { session: advanceIndex(session, ctx.data), data: ctx.data };

  switch (event.type) {
    case "reveal":
      // front → revealed: the back is shown, awaiting a grade.
      return { session: { ...session, phase: "revealed" }, data: ctx.data };

    case "grade": {
      if (session.phase !== "revealed") {
        // Out-of-order grade (before reveal): total function, no-op.
        return { session, data: ctx.data };
      }
      const scheduler = ctx.scheduler ?? defaultScheduler();
      const now = ctx.clock();
      const gradedCard = scheduler.grade(current, event.grade, now);
      // R-1: the review-log append rides the SAME transition as the
      // grade (the every-transition persistence law). The operator gate
      // caught the chunk-3 tree threading reviews WITHOUT appending —
      // the exact B-3 class; this construction is the cure.
      const taken = new Set<string>([
        ...ctx.data.reviews.map((r) => r.id),
        ...ctx.data.cards.map((c) => c.id),
        ...ctx.data.decks.map((d) => d.id),
      ]);
      const reviewEvent: ReviewEvent = {
        id: newUniqueId("review", taken),
        cardId: current.id,
        deckId: current.deckId,
        grade: event.grade,
        reviewedAt: now,
      };
      const data: OstinatoData = {
        decks: ctx.data.decks,
        cards: ctx.data.cards.map((c) => (c.id === gradedCard.id ? gradedCard : c)),
        reviews: [...ctx.data.reviews, reviewEvent],
      };
      return { session: advanceIndex(session, data), data };
    }

    case "skip":
      // Advance without grading (the card's state is unchanged; it
      // returns to the next queue pass).
      return { session: advanceIndex(session, ctx.data), data: ctx.data };

    default:
      return { session, data: ctx.data };
  }
}

/** Move the cursor to the next card (or terminal `done`). */
function advanceIndex(session: ReviewSession, data: OstinatoData): ReviewSession {
  let nextIndex = session.index + 1;
  // Walk past ids that vanished from the data set (a removed card).
  while (nextIndex < session.cardIds.length) {
    if (data.cards.some((c) => c.id === session.cardIds[nextIndex])) break;
    nextIndex += 1;
  }
  if (nextIndex >= session.cardIds.length) {
    return {
      ...session,
      index: nextIndex,
      phase: "done",
      currentCardId: null,
      currentDeckId: null,
    };
  }
  const current = data.cards.find((c) => c.id === session.cardIds[nextIndex])!;
  return {
    ...session,
    index: nextIndex,
    phase: "front",
    currentCardId: current.id,
    currentDeckId: current.deckId,
  };
}

// ─── Serialize / deserialize (the byte-stable wire format) ───────────────────

/**
 * The persisted shape on disk. `v` is the version tag — the O-3 wire
 * shape is `v = 1`; a document whose `v` differs is foreign/corrupt
 * and `deserializePersistedSession` throws (the error-state lane,
 * P0 #5: the UI surfaces it, never a blank panel).
 */
export type PersistedSession = {
  v: 1;
  cardIds: string[];
  index: number;
  phase: ReviewPhase;
  currentCardId: string | null;
  currentDeckId: string | null;
  lastGradedCard: Card | null;
};

/**
 * Serialize a session to its persisted bytes (P0 #6 + matrix lane
 * I-1 discipline: plain JSON at every level, fixed key order —
 * two sessions with equal fields serialize to equal bytes).
 */
export function serializePersistedSession(session: ReviewSession): string {
  const obj: PersistedSession = {
    v: 1,
    cardIds: session.cardIds,
    index: session.index,
    phase: session.phase,
    currentCardId: session.currentCardId,
    currentDeckId: session.currentDeckId,
    lastGradedCard: session.lastGradedCard,
  };
  return JSON.stringify(obj);
}

/**
 * Parse + validate persisted session bytes.
 * @throws {DomainInvariantError} on a corrupt / foreign document.
 */
export function deserializePersistedSession(json: string): ReviewSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DomainInvariantError("session: not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DomainInvariantError("session: root must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== 1) {
    throw new DomainInvariantError(`session: unsupported version '${String(obj.v)}'`);
  }
  if (!Array.isArray(obj.cardIds) || obj.cardIds.some((x) => typeof x !== "string")) {
    throw new DomainInvariantError("session: cardIds must be an array of strings");
  }
  if (typeof obj.index !== "number" || obj.index < -1 || obj.index > obj.cardIds.length) {
    throw new DomainInvariantError("session: index out of range");
  }
  if (obj.phase !== "front" && obj.phase !== "revealed" && obj.phase !== "done") {
    throw new DomainInvariantError(`session: unknown phase '${String(obj.phase)}'`);
  }
  const lastGradedCard = obj.lastGradedCard;
  if (lastGradedCard !== null && (typeof lastGradedCard !== "object" || lastGradedCard === null)) {
    throw new DomainInvariantError("session: lastGradedCard must be null or an object");
  }
  return {
    cardIds: obj.cardIds as string[],
    index: obj.index,
    phase: obj.phase,
    currentCardId: typeof obj.currentCardId === "string" ? obj.currentCardId : null,
    currentDeckId: typeof obj.currentDeckId === "string" ? obj.currentDeckId : null,
    lastGradedCard: lastGradedCard as Card | null,
  };
}

// ─── The storage seam (P0 #6: every transition persists through it) ─────────

/**
 * The session key (its own namespace — the data set's byte-stable
 * export lane, `ostinato.data`, is never polluted with runner state).
 */
export const SESSION_STORAGE_KEY = "ostinato.session";

/**
 * Persist a session under its own key, through the host storage
 * seam (`StorageLike` — the same seam style the domain's storage
 * tests use; `window.localStorage` at the browser edge, a Map-backed
 * stub in unit tests).
 *
 * Atomicity: one `setItem` (the session is a single document, not a
 * two-key protocol — a torn write cannot split it mid-stream the way
 * the data set's temp-key swap guards against; the committed bytes
 * are either the old session or the new one, and either is a valid
 * resume point).
 */
export function saveSession(storage: StorageLike, session: ReviewSession): void {
  storage.setItem(SESSION_STORAGE_KEY, serializePersistedSession(session));
}

/**
 * Read the persisted session bytes (or `null` on first boot / a
 * cleared store). The caller validates with
 * `deserializePersistedSession` (a corrupt document throws — the
 * error-state lane, P0 #5).
 */
export function readSession(storage: StorageLike): string | null {
  return storage.getItem(SESSION_STORAGE_KEY);
}
