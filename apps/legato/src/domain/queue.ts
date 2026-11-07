/**
 * queue.ts — the reading queue + four-state machine (ticket L-6,
 * PLAN §3 L-6, §4.4 Q-1..Q-3, PRD V-6).
 *
 * Pure, DOM-free, Node-free (the Ostinato law; boundary.test.ts
 * pins the import graph): all functions are pure over `LegatoData`
 * and timestamps are INJECTED (ISO-8601 strings) — no `Date.now()`.
 *
 * ---------------------------------------------------------------------
 * The four-state machine
 * ---------------------------------------------------------------------
 *
 * The states (types.ts ClipState): unread, reading, done, archived.
 * Transitions are a CLOSED TABLE, not freeform:
 *
 * | from \ to     | unread   | reading  | done     | archived |
 * |---------------|----------|----------|----------|----------|
 * | **unread**     | —        | ✓        | ✓        | ✓        |
 * | **reading**    | ✓        | —        | ✓        | ✓        |
 * | **done**       | ✓        | ✓        | —        | ✓        |
 * | **archived**   | ✓        | ✗        | ✗        | —        |
 *
 * Documented rules:
 *   - unread → reading (start reading), unread → done (skim / skip
 *     straight to done), unread → archived (defer)
 *   - reading → done (finish), reading → unread (put back / resume
 *     later without losing "was reading"), reading → archived (drop
 *     into the archive)
 *   - done → unread (re-read), done → reading (reopen a finished
 *     clip), done → archived (clear it out)
 *   - archived → unread (RESTORE — the archive is reversible and
 *     lands the clip in the default queue view); archived CANNOT
 *     go directly to reading or done (a restored clip re-enters at
 *     unread and the user walks forward again — this is what keeps
 *     the "any state → archived" lane monotonic: you must exit
 *     the archive before advancing)
 *   - any state → itself is a NO-OP (the caller passes the same
 *     state; no error)
 *
 * `QueueTransitionError` is thrown for every off-table transition
 * (e.g. archived → reading, done → done-without-restore is a no-op
 * not an error). The error names the from→to pair.
 *
 * ---------------------------------------------------------------------
 * The concurrent-flip guard (Q-1)
 * ---------------------------------------------------------------------
 *
 * Two tabs / a re-entrant update can race a state flip. The guard
 * is EXPECTED-PRIOR-STATE: every `flipState` call carries the state
 * the caller last saw on the clip; if the stored state has drifted
 * (someone else flipped it first) the transition is REJECTED with
 * a typed `ConflictError` — never a silent last-write-wins. The
 * caller's responsibility on conflict: reload the data, recompute
 * the transition from the CURRENT stored state, and retry; if the
 * CURRENT state makes the transition legal it is applied, if not
 * the conflict stands and the UI surfaces it honestly.
 *
 * `last-write-wins` by `updatedAt` is the STORE LANE's behaviour
 * (the storage seam's byte-stable save); the DOMAIN lane's
 * behaviour is guard-and-reject: the caller decides. This is the
 * PLAN's "no illegal transition" ruling: a stale reader can never
 * apply an off-table move because the guard refuses the premise.
 *
 * ---------------------------------------------------------------------
 * The queue ORDER (PLAN §3 L-6 "queue ORDER")
 * ---------------------------------------------------------------------
 *
 * `orderQueue(data)` returns the clip ids in the DEFAULT VIEW order
 * (the "active queue" — what the user sees on boot):
 *
 *   1. **reading** clips (by `createdAt` descending — the most
 *      recently started clip leads, so the user resumes where they
 *      last picked up a read)
 *   2. **unread** clips (by `createdAt` descending — newest
 *      clipped first)
 *
 * `done` and `archived` are OUT OF the default view (the "all"
 * toggle in ui/queue.ts reveals them; that toggle is a UI concern,
 * not an ordering one — `orderQueue` is the active-only view).
 *
 * The tiebreak within one state lane is `createdAt` DESC, then
 * `id` ASC (deterministic, no clock read).
 */
import type { LegatoData, Clip, ClipState } from "./types.js";

/**
 * The typed rejection for an off-table transition (see the table
 * above). Carries the from/to pair so the UI can name it in the
 * notice lane (Q-2's honest-surface rule: "never silent").
 */
export class QueueTransitionError extends Error {
  readonly from: ClipState;
  readonly to: ClipState;
  constructor(from: ClipState, to: ClipState) {
    super(`illegal state transition: ${from} → ${to}`);
    this.name = "QueueTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * The typed rejection for a concurrent-flip conflict (Q-1). The
 * stored state drifted from the expected prior state between the
 * caller's last read and its flip attempt. Carries both so the UI
 * can surface "clip moved to X while you were editing" honestly.
 */
export class ConflictError extends Error {
  readonly clipId: number;
  readonly expected: ClipState;
  readonly actual: ClipState;
  constructor(clipId: number, expected: ClipState, actual: ClipState) {
    super(
      `concurrent-flip conflict on clip ${clipId}: expected ${expected}, found ${actual}`,
    );
    this.name = "ConflictError";
    this.clipId = clipId;
    this.expected = expected;
    this.actual = actual;
  }
}

/** The closed transition table (see module header for the full
 *  documentation). `null` = no transition (same-state is handled
 *  as a no-op before this table is consulted). */
const TRANSITIONS: ReadonlySet<string> = new Set([
  "unread>reading",
  "unread>done",
  "unread>archived",
  "reading>done",
  "reading>unread",
  "reading>archived",
  "done>unread",
  "done>reading",
  "done>archived",
  "archived>unread",
]);

export function isLegalTransition(from: ClipState, to: ClipState): boolean {
  if (from === to) return true; // no-op, always allowed
  return TRANSITIONS.has(from + ">" + to);
}

/**
 * Flip ONE clip's state in-place on `data`, applying the concurrent-
 * flip guard. Returns the updated `Clip` (same reference, mutated
 * for `state`/`updatedAt` — the caller owns the persistence lane).
 *
 * @throws {ConflictError} when `clip.state !== expectedPrior` (Q-1)
 * @throws {QueueTransitionError} when the transition is off-table
 */
export function flipState(
  data: LegatoData,
  clipId: number,
  to: ClipState,
  expectedPrior: ClipState,
  now: string,
): Clip {
  const clip = data.clips.find((c) => c.id === clipId);
  if (clip === undefined) {
    // Unknown clip: the storage seam's invariants would have caught
    // this, but the queue lane is honest and throws a ConflictError
    // (the "expected X, found nothing" flavour — the caller treats
    // it the same: reload + retry).
    throw new ConflictError(clipId, expectedPrior, to);
  }
  if (clip.state !== expectedPrior) {
    // THE Q-1 GUARD: stored state drifted from what the caller last
    // saw. REJECT — never silent last-write-wins. The caller reloads
    // and recomputes; the stored state is the truth.
    throw new ConflictError(clipId, expectedPrior, clip.state);
  }
  if (!isLegalTransition(clip.state, to)) {
    throw new QueueTransitionError(clip.state, to);
  }
  clip.state = to;
  clip.updatedAt = now;
  return clip;
}

/**
 * The queue ORDER (see module header for the full documentation).
 * Returns clip ids in the active-queue view: reading first, then
 * unread, both by `createdAt` desc, then `id` asc.
 */
export function orderQueue(data: LegatoData): number[] {
  const byState = (s: ClipState) => data.clips.filter((c) => c.state === s);
  const cmp = (a: Clip, b: Clip): number => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id - b.id;
  };
  const reading = byState("reading").slice().sort(cmp);
  const unread = byState("unread").slice().sort(cmp);
  return [...reading, ...unread].map((c) => c.id);
}

/**
 * The ACTIVE-QUEUE CLIPS in display order (the same ordering as
 * `orderQueue`, but as Clip objects — the UI's list lane wants
 * the object, not the id).
 */
export function activeClips(data: LegatoData): Clip[] {
  const ids = orderQueue(data);
  const byId = new Map(data.clips.map((c) => [c.id, c]));
  // Return in the same order that orderQueue established (not the
  // store's insertion order — the queue view's ordering IS state).
  return ids.map((id) => byId.get(id)!);
}

/**
 * The "ALL" view (the UI's queue toggle, Q-3): every clip, by
 * `createdAt` desc then `id` asc. No state filter.
 */
export function allClips(data: LegatoData): Clip[] {
  const cmp = (a: Clip, b: Clip): number => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id - b.id;
  };
  return data.clips.slice().sort(cmp);
}

/**
 * The four keyboard-flow actions (the brief's 'r'/'d'/'a'/'u'
 * bindings, as DOMAIN functions — the UI layer calls these with
 * the injected clock). Each returns the flipped Clip and throws
 * the typed errors on conflict / illegal move.
 */

/** 'r' — mark the clip as reading (unread→reading). */
export function markReading(
  data: LegatoData,
  clipId: number,
  expectedPrior: ClipState,
  now: string,
): Clip {
  return flipState(data, clipId, "reading", expectedPrior, now);
}

/** 'd' — mark the clip as done (any active state → done is legal;
 *  the guard still applies to the expected-prior check). */
export function markDone(
  data: LegatoData,
  clipId: number,
  expectedPrior: ClipState,
  now: string,
): Clip {
  return flipState(data, clipId, "done", expectedPrior, now);
}

/** 'a' — archive the clip (any state → archived, incl. from
 *  archived which is a no-op). */
export function archiveClip(
  data: LegatoData,
  clipId: number,
  expectedPrior: ClipState,
  now: string,
): Clip {
  return flipState(data, clipId, "archived", expectedPrior, now);
}

/** 'u' — RESTORE: move an archived clip back to unread (the only
 *  legal exit from the archive; a clip in any other state is a
 *  no-op for restore — it is already out of the archive). */
export function restoreClip(
  data: LegatoData,
  clipId: number,
  expectedPrior: ClipState,
  now: string,
): Clip {
  return flipState(data, clipId, "unread", expectedPrior, now);
}

/**
 * The empty-state discrimination (Q-3: "never a blank"). Three
 * distinct panels:
 *   - "no-clips" — zero clips at all (L-5's "Clip your first URL"
 *     affordance; the L-5 empty panel, not L-6's queue panel).
 *   - "all-read" — clips exist, the ACTIVE QUEUE is empty (every
 *     clip is done or archived; the archive affordance + "mark
 *     done" hint, distinct from the no-clips panel).
 *   - "no-matches" — a filter (search / tag) ran and nothing
 *     matched; the "clear filters" affordance.
 *
 * The UI's `renderQueue` picks the panel by calling this; the DOM
 * is built there (this function is the PURE decision).
 */
export type QueueEmptyKind = "no-clips" | "all-read" | "no-matches";

export function queueEmptyKind(
  data: LegatoData,
): QueueEmptyKind | null {
  if (data.clips.length === 0) return "no-clips";
  const active = orderQueue(data);
  if (active.length > 0) return null; // something is in the active view
  return "all-read";
}

/**
 * The FILTERED-empty discrimination (the "no-matches" panel):
 * called when the search/tag filter is active and the filtered
 * list came back empty. Returns "no-matches" (the panel kind);
 * `null` when the filtered list is non-empty (no panel).
 */
export function filteredEmptyKind(filtered: readonly Clip[], filterActive: boolean): QueueEmptyKind | null {
  if (!filterActive) return null;
  if (filtered.length > 0) return null;
  return "no-matches";
}
