/**
 * Deck/card construction + edit helpers (P0 #1, the finished model
 * layer).
 *
 * Every helper returns a NEW `OstinatoData` (the Coda domain-purity
 * convention — no in-place mutation of caller state) and re-runs
 * `assertData` on the result, so no mutation path can leave the store
 * in a breach state. Id generation is injected (`newUniqueId`'s
 * signature keeps the clock/randomness at the edge, so unit tests can
 * pin exact ids).
 *
 * Timestamps: `now` is an ISO-8601 string injected by the caller — the
 * domain never calls `Date.now()` on these paths (determinism is the
 * P0 #2 contract; a construction-time `now` is the one accepted
 * exception: the caller is the edge).
 */
import type { Card, Deck, DeckSettings, OstinatoData, Grade, ReviewEvent } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";
import { newUniqueId } from "./ids.js";
import { createScheduler } from "./scheduler.js";

function takenDeckIds(data: OstinatoData): Set<string> {
  const s = new Set<string>();
  for (const d of data.decks) s.add(d.id);
  return s;
}

function takenCardIds(data: OstinatoData): Set<string> {
  const s = new Set<string>();
  for (const c of data.cards) s.add(c.id);
  return s;
}

function takenReviewIds(data: OstinatoData): Set<string> {
  const s = new Set<string>();
  for (const r of data.reviews) s.add(r.id);
  return s;
}

/** Create a new deck. Returns the updated data set. */
export function createDeck(
  data: OstinatoData,
  name: string,
  now: string,
  id?: string,
): OstinatoData {
  const deckId = id ?? newUniqueId("deck", takenDeckIds(data));
  if (!id && takenDeckIds(data).has(deckId)) {
    throw new DomainInvariantError(`duplicate deck id: ${deckId}`);
  }
  if (!name || typeof name !== "string") {
    throw new DomainInvariantError("deck name must be a non-empty string");
  }
  const deck: Deck = {
    id: deckId,
    name,
    cardOrder: [],
    createdAt: now,
    updatedAt: now,
  };
  const next: OstinatoData = {
    decks: [...data.decks, deck],
    cards: data.cards,
    reviews: data.reviews,
  };
  assertData(next);
  return next;
}

/**
 * Add a card to an existing deck. `front`/`back` are markdown source
 * (may be empty — a user's choice, not a breach). Returns the updated
 * data set; the new card's id is exposed as `card.id`.
 */
export function addCard(
  data: OstinatoData,
  deckId: string,
  front: string,
  back: string,
  now: string,
  cardId?: string,
): { data: OstinatoData; card: Card } {
  const deck = data.decks.find((d) => d.id === deckId);
  if (!deck) throw new DomainInvariantError(`unknown deck: ${deckId}`);
  const cid = cardId ?? newUniqueId("card", takenCardIds(data));
  if (takenCardIds(data).has(cid)) {
    throw new DomainInvariantError(`duplicate card id: ${cid}`);
  }
  const card: Card = {
    id: cid,
    deckId,
    front,
    back,
    createdAt: now,
    updatedAt: now,
  };
  const next: OstinatoData = {
    decks: data.decks.map((d) =>
      d.id === deckId
        ? { ...d, cardOrder: [...d.cardOrder, cid], updatedAt: now }
        : d,
    ),
    cards: [...data.cards, card],
    reviews: data.reviews,
  };
  assertData(next);
  return { data: next, card };
}

/** Edit a card's front/back. Returns the updated data set. */
export function updateCard(
  data: OstinatoData,
  cardId: string,
  patch: Partial<Pick<Card, "front" | "back">>,
  now: string,
): OstinatoData {
  let found = false;
  const cards = data.cards.map((c) => {
    if (c.id !== cardId) return c;
    found = true;
    return {
      ...c,
      front: patch.front !== undefined ? patch.front : c.front,
      back: patch.back !== undefined ? patch.back : c.back,
      updatedAt: now,
    };
  });
  if (!found) throw new DomainInvariantError(`unknown card: ${cardId}`);
  const next: OstinatoData = { decks: data.decks, cards, reviews: data.reviews };
  assertData(next);
  return next;
}

/** Remove a card (and its SM-2 state) from its deck. Returns the updated data set. */
export function removeCard(data: OstinatoData, cardId: string, now: string): OstinatoData {
  const card = data.cards.find((c) => c.id === cardId);
  if (!card) throw new DomainInvariantError(`unknown card: ${cardId}`);
  const next: OstinatoData = {
    decks: data.decks.map((d) =>
      d.id === card.deckId
        ? {
            ...d,
            cardOrder: d.cardOrder.filter((id) => id !== cardId),
            updatedAt: now,
          }
        : d,
    ),
    cards: data.cards.filter((c) => c.id !== cardId),
    reviews: data.reviews,
  };
  assertData(next);
  return next;
}

/** Remove a deck and all its cards. Returns the updated data set. */
export function removeDeck(data: OstinatoData, deckId: string, now: string): OstinatoData {
  const next: OstinatoData = {
    decks: data.decks.filter((d) => d.id !== deckId),
    cards: data.cards.filter((c) => c.deckId !== deckId),
    reviews: data.reviews,
  };
  assertData(next);
  return next;
}

/**
 * Reorder a deck's cards. `order` must be the deck's current card set
 * (a permutation) — any missing or extra id throws before the mutation
 * is applied.
 */
export function reorderDeck(data: OstinatoData, deckId: string, order: string[], now: string): OstinatoData {
  const deck = data.decks.find((d) => d.id === deckId);
  if (!deck) throw new DomainInvariantError(`unknown deck: ${deckId}`);
  const current = new Set(deck.cardOrder);
  const next = new Set(order);
  if (current.size !== next.size) {
    throw new DomainInvariantError(`reorderDeck: order length ${next.size} != card set size ${current.size}`);
  }
  for (const id of order) {
    if (!current.has(id)) {
      throw new DomainInvariantError(`reorderDeck: unknown card ${id} in deck ${deckId}`);
    }
  }
  const out: OstinatoData = {
    decks: data.decks.map((d) =>
      d.id === deckId ? { ...d, cardOrder: [...order], updatedAt: now } : d,
    ),
    cards: data.cards,
    reviews: data.reviews,
  };
  assertData(out);
  return out;
}

/**
 * Apply a grade to a card via the SM-2 scheduler. Returns the updated
 * data set with the card's `sm2` state advanced AND a `ReviewEvent`
 * appended to the review log (R-1). The append rides the same
 * transition — every-transition persistence: a session killed here
 * restores the log by construction. This is the single entry point
 * from the review runner (O-3) into the scheduler.
 */
export function gradeCard(
  data: OstinatoData,
  cardId: string,
  grade: Grade,
  now: string,
): OstinatoData {
  const scheduler = createScheduler();
  let found = false;
  const cards = data.cards.map((c) => {
    if (c.id !== cardId) return c;
    found = true;
    const graded = scheduler.grade(c, grade, now);
    return graded;
  });
  if (!found) throw new DomainInvariantError(`unknown card: ${cardId}`);
  const gradedCard = data.cards.find((c) => c.id === cardId)!;
  const taken = new Set<string>([...takenReviewIds(data), ...takenCardIds(data), ...takenDeckIds(data)]);
  const event: ReviewEvent = {
    id: newUniqueId("review", taken),
    cardId: gradedCard.id,
    deckId: gradedCard.deckId,
    grade,
    reviewedAt: now,
  };
  const next: OstinatoData = { decks: data.decks, cards, reviews: [...data.reviews, event] };
  assertData(next);
  return next;
}

/**
 * Set or clear a deck's R-2 settings. `settings` is a full replacement
 * of the deck's `settings` field: pass `null` to DELETE the field
 * (the byte-stability law — a capped→uncapped deck exports pre-R-2
 * bytes, `settings` absent; `{}` is legal and also means no cap but
 * does round-trip, so the honest "uncap" write is `null`). Returns
 * the updated data set; `updatedAt` advances like every other
 * deck mutation.
 */
export function setDeckSettings(
  data: OstinatoData,
  deckId: string,
  settings: DeckSettings | null,
  now: string,
): OstinatoData {
  let found = false;
  const decks = data.decks.map((d) => {
    if (d.id !== deckId) return d;
    found = true;
    const next: Deck = { ...d, updatedAt: now };
    if (settings === null) {
      delete next.settings;
    } else {
      next.settings = settings;
    }
    return next;
  });
  if (!found) throw new DomainInvariantError(`unknown deck: ${deckId}`);
  const out: OstinatoData = { decks, cards: data.cards, reviews: data.reviews };
  assertData(out);
  return out;
}

/** Empty data set — the starting point for a new install. */
export function emptyData(): OstinatoData {
  return { decks: [], cards: [], reviews: [] };
}
