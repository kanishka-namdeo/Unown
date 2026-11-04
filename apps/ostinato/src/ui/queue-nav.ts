/**
 * Ostinato — the queue-navigation DOM-free core (ticket O-3, P0 #4).
 *
 * The PRD's hardening row: "j/k wrap, g/G bounds; selection ring
 * visible; selection survives filtering". This module owns the
 * pure cursor math for the review-queue list surface (the j/k/g/G
 * commands) + the search-filter predicate (the `/` command's
 * query). `src/ui/app.ts` wires it to the DOM (the key handler
 * routes `e.key` through `COMMAND_KEY_DISPATCH`, which lands on
 * the four navigate command ids; `dispatchCommand` calls
 * `navigateQueue` there, which uses `selectQueuePosition`
 * (+ `selectQueuePositionWithFilter` when a search filter is
 * active), then re-renders).
 *
 * What this module owns:
 *   - **`selectQueuePosition(queueIds, index, cmd)`** — the j/k/g/G
 *     cursor transition for a `session.cardIds` queue. Returns a
 *     NEW index (never mutates the input). Wrap + bounds:
 *       - `next-card`  (`j`) — `i+1`, wrapping to 0 at the tail
 *       - `prev-card`  (`k`) — `i−1`, wrapping to the tail at the head
 *       - `first-card` (`g`) — 0
 *       - `last-card`  (`G`) — `n−1`
 *     The wrap is the hardening row's "j/k wrap" — the selection
 *     ring survives an over-scroll. Out-of-range `index` (a resume
 *     clamp that fell off) is re-clamped to 0 before the move.
 *   - **`selectQueuePositionWithFilter(queueIds, index, cmd, filter)`**
 *     — the same math on the FILTERED view (the P0 #4's "selection
 *     survives filtering"). `filter` is the current search query
 *     ("" → no filter = the plain selector). The caller passes
 *     the filtered index; the result is the filtered index the UI
 *     positions the ring on. Re-clamping on the filtered view
 *     means an over-scroll past the last FILTERED card wraps to
 *     the first FILTERED card, not the absolute first.
 *   - **`matchCardInFilter(query, card)`** — the single-card
 *     predicate for the filter. Case-insensitive substring over
 *     `card.front` + `card.back` + `card.id`. Empty/whitespace
 *     query matches every card (the unfiltered view). The test
 *     suite pins each branch.
 *   - **`filterQueue(cards, query)`** — the queue view itself
 *     (an array of card ids, or all of them when the query is
 *     empty). Ordering preserved (deck-then-cardOrder, inherited
 *     from `computeDueQueue`); no re-rank.
 *
 * No DOM, no `Date.now()`, no randomness. The input arrays are
 * read-only — every function returns a fresh value.
 */
import type { Card } from "../domain/ports.js";

/** The four navigate command ids (the COMMAND_KEY_DISPATCH target set). */
export type NavigateCmdId = "next-card" | "prev-card" | "first-card" | "last-card";

/**
 * Select the next queue position for `cmd`.
 *
 * @param queueIds the session's `cardIds` (the iteration the loop walks)
 * @param index    the current selection index (may be out of range — re-clamped)
 * @param cmd      one of the four navigate command ids
 * @returns        the new index (never out of range)
 *
 * **The wrap rule:** `next-card` at the last position returns to
 * the first; `prev-card` at the first returns to the last. A
 * one-element queue is a no-op for both (wrap-to-self). `g`/`G`
 * are absolute bounds — they never wrap, they just jump.
 *
 * An empty queue is a total function: returns 0 (the "no
 * selection" position the UI renders as the done state).
 */
export function selectQueuePosition(
  queueIds: string[],
  index: number,
  cmd: NavigateCmdId,
): number {
  const n = queueIds.length;
  if (n === 0) return 0;
  // Re-clamp a drifted index into range before moving.
  const cur = index < 0 ? 0 : index >= n ? n - 1 : index;
  switch (cmd) {
    case "next-card":
      return (cur + 1) % n; // wrap: the last wraps to the first
    case "prev-card":
      return (cur - 1 + n) % n; // wrap: the first wraps to the last
    case "first-card":
      return 0;
    case "last-card":
      return n - 1;
    default:
      return cur;
  }
}

/**
 * The filtered-queue variant: `filter` is the card predicate the
 * current search query applies to the queue. The move is relative
 * to the filtered view, so a wrap lands on the next FILTERED card,
 * not the next absolute card. When the filter is the identity
 * (empty query), this is identical to `selectQueuePosition`.
 *
 * @param queueIds the session's `cardIds` (full queue)
 * @param index    the CURRENT selection index (absolute position in `queueIds`)
 * @param cmd      the navigate command
 * @param filter   the predicate the UI's search input applies
 * @returns        the new absolute index (the UI positions the ring on
 *                 `queueIds[result]`; intermediate non-filtered cards are
 *                 SKIPPED, never visited — the selection survives the
 *                 filter per the hardening row)
 */
export function selectQueuePositionWithFilter(
  queueIds: string[],
  index: number,
  cmd: NavigateCmdId,
  filter: (id: string) => boolean,
): number {
  // Build the filtered view (absolute positions in queueIds).
  const filtered: number[] = [];
  for (let i = 0; i < queueIds.length; i++) {
    if (filter(queueIds[i])) filtered.push(i);
  }
  if (filtered.length === 0) return index < 0 ? 0 : Math.min(index, Math.max(queueIds.length - 1, 0));
  // Find the current position WITHIN the filtered view. The index
  // may point at a non-filtered card (a resume clamp that drifted
  // past the filter); snap to the next FILTERED card, or the first
  // if the current position is the tail.
  let posInFiltered = filtered.indexOf(index);
  if (posInFiltered === -1) {
    // Scan forward from the (clamped) index for the first filtered
    // card; fall back to the first filtered card if we overshoot.
    const clamp = index < 0 ? 0 : index >= queueIds.length ? queueIds.length - 1 : index;
    posInFiltered = filtered.findIndex((p) => p >= clamp);
    if (posInFiltered === -1) posInFiltered = 0; // wrapped to the head
  }
  // Move within the filtered view (wrap at both ends).
  const n = filtered.length;
  let nextPos: number;
  switch (cmd) {
    case "next-card":
      nextPos = (posInFiltered + 1) % n;
      break;
    case "prev-card":
      nextPos = (posInFiltered - 1 + n) % n;
      break;
    case "first-card":
      nextPos = 0;
      break;
    case "last-card":
      nextPos = n - 1;
      break;
    default:
      nextPos = posInFiltered;
  }
  return filtered[nextPos];
}

/**
 * Does `card` match the case-insensitive filter query? The
 * predicate the `/` lane pins: a card is visible when its
 * front, back, or id contains the trimmed lower-cased query.
 * An empty/whitespace query matches every card (the unfiltered
 * view — the list is always shown when no search is active).
 *
 * @param query the raw query (the UI's input value; trimmed + lower-cased here)
 * @param card  the card under test
 */
export function matchCardInFilter(query: string, card: Card): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    card.front.toLowerCase().includes(q) ||
    card.back.toLowerCase().includes(q) ||
    card.id.toLowerCase().includes(q)
  );
}

/**
 * The card list view for a filter query (the `/` lane's result).
 * Ordering inherited from `data.cards` (the data set's order,
 * which is the deck-then-cardOrder order after
 * `computeDueQueue`'s sort — the browse order the user already
 * sees). Empty/whitespace query → every card (the unfiltered view).
 */
export function filterCards(cards: Card[], query: string): Card[] {
  const q = query.trim();
  if (q === "") return cards;
  return cards.filter((c) => matchCardInFilter(query, c));
}
