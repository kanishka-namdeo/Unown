/**
 * Ostinato domain core — DOM-free invariant checks (P0 #1).
 *
 * The skeleton's only executable domain code: a small `assertData`
 * guard that validates the shape invariants of an `OstinatoData` (the
 * cardOrder set-match, no orphan cards, id uniqueness). O-2 adds the
 * scheduler; O-3 adds the repository + atomic persistence. Kept
 * deliberately tiny at O-1 so the Lane A test boot has a real
 * assertion target without touching SM-2 logic (non-overlap: O-2).
 */
import type { OstinatoData } from "./types.js";
import { DomainInvariantError } from "./types.js";

/**
 * Assert `data` satisfies OstinatoData's invariants:
 *  - no duplicate deck ids / card ids
 *  - every card's `deckId` references an existing deck
 *  - every deck's `cardOrder` set-matches its cards exactly
 *     (the Coda Board.taskOrder invariant, per-deck)
 *  - card front/back are strings (markdown source, may be empty —
 *    an empty-front card is a user's choice, not an invariant breach)
 *
 * @throws {DomainInvariantError} on the first breach
 */
export function assertData(data: OstinatoData): void {
  const deckIds = new Set<string>();
  for (const deck of data.decks) {
    if (deckIds.has(deck.id)) throw new DomainInvariantError(`duplicate deck id: ${deck.id}`);
    deckIds.add(deck.id);
  }

  const cardIds = new Set<string>();
  const cardsByDeck = new Map<string, Set<string>>();
  for (const card of data.cards) {
    if (cardIds.has(card.id)) throw new DomainInvariantError(`duplicate card id: ${card.id}`);
    cardIds.add(card.id);
    if (!deckIds.has(card.deckId)) throw new DomainInvariantError(`orphan card ${card.id}: unknown deck ${card.deckId}`);
    if (typeof card.front !== "string" || typeof card.back !== "string") {
      throw new DomainInvariantError(`card ${card.id}: front/back must be strings`);
    }
    let bucket = cardsByDeck.get(card.deckId);
    if (!bucket) {
      bucket = new Set();
      cardsByDeck.set(card.deckId, bucket);
    }
    bucket.add(card.id);
  }

  for (const deck of data.decks) {
    const seenInOrder = new Set(deck.cardOrder);
    if (seenInOrder.size !== deck.cardOrder.length) {
      throw new DomainInvariantError(`deck ${deck.id}: duplicate cardOrder entry`);
    }
    const owned = cardsByDeck.get(deck.id) ?? new Set<string>();
    for (const id of owned) {
      if (!seenInOrder.has(id)) throw new DomainInvariantError(`deck ${deck.id}: card ${id} missing from cardOrder`);
    }
    for (const id of seenInOrder) {
      if (!owned.has(id)) throw new DomainInvariantError(`deck ${deck.id}: cardOrder lists unknown card ${id}`);
    }
  }
}
