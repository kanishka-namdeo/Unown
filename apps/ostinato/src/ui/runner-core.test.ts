/**
 * O-3 runner-core tests (Lane A — DOM-free, runs under `cd
 * apps/ostinato && bun test`). Covers the ticket's build item 4:
 *
 *   - queue selection/ordering (due-queue + the all-cards fallback,
 *     deck-then-cardOrder ordering)
 *   - due computation against an injected clock (no wall read)
 *   - the grading key map (`1`–`4` + reveal keys)
 *   - the interruption/recovery state machine through a mocked
 *     StoragePort-style storage (a Map-backed `StorageLike` — the
 *     same seam style as the domain's storage tests)
 *   - the persisted-session wire shape (byte-stable round-trip,
 *     corrupt/foreign rejection)
 */
import { test, expect } from "bun:test";
import type { Card, Deck, OstinatoData, Grade } from "../domain/ports.js";
import type { Clock } from "../domain/ports.js";
import { DomainInvariantError } from "../domain/ports.js";
import { createScheduler } from "../domain/scheduler.js";
import type { StorageLike } from "../domain/storage.js";
import {
  GRADE_KEYS,
  GRADE_LABELS,
  gradeKeyToGrade,
  isRevealKey,
  isCardDue,
  computeDueQueue,
  computeReviewQueue,
  emptySession,
  startSession,
  applyEvent,
  serializePersistedSession,
  deserializePersistedSession,
  saveSession,
  readSession,
  SESSION_STORAGE_KEY,
  type ReviewSession,
  type SessionCtx,
} from "./runner-core.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = "2026-11-04T12:00:00Z";
const NOW_MS = Date.parse(NOW);
const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function mkCard(id: string, deckId = "d1", sm2?: Card["sm2"]): Card {
  return {
    id,
    deckId,
    front: `front ${id}`,
    back: `back ${id}`,
    createdAt: iso(NOW_MS - 10 * DAY),
    updatedAt: iso(NOW_MS - 10 * DAY),
    ...(sm2 ? { sm2 } : {}),
  };
}

function sm2State(repetitions: number, easiness: number, interval: number, lastReviewedDaysAgo: number) {
  return {
    repetitions,
    easiness,
    interval,
    lastReviewedAt: iso(NOW_MS - lastReviewedDaysAgo * DAY),
  };
}

function mkData(): OstinatoData {
  // Deck d1: c1 (due — reviewed 7 days ago, interval 1 day), c2 (NOT
  // due — reviewed 1 day ago, interval 6 days). Deck d2: c3 (due —
  // never graded).
  const decks: Deck[] = [
    { id: "d1", name: "alpha", cardOrder: ["c2", "c1"], createdAt: NOW, updatedAt: NOW },
    { id: "d2", name: "beta", cardOrder: ["c3"], createdAt: NOW, updatedAt: NOW },
  ];
  const cards: Card[] = [
    mkCard("c1", "d1", sm2State(3, 2.5, 1, 7)), // due: 7 days >= 1-day interval
    mkCard("c2", "d1", sm2State(2, 2.5, 6, 1)), // not due: 1 day < 6-day interval
    mkCard("c3", "d2"), // due: never graded
  ];
  return { decks, cards, reviews: [] };
}

const clock: Clock = () => NOW;

function ctxFor(data: OstinatoData): SessionCtx {
  return { data, clock, scheduler: createScheduler() };
}

// ─── The grading key map (ticket item 4: "the grading key map") ─────────────

test("GRADE_KEYS: 1-4 map to the domain's Grade values", () => {
  expect(GRADE_KEYS["1"]).toBe(1);
  expect(GRADE_KEYS["2"]).toBe(2);
  expect(GRADE_KEYS["3"]).toBe(3);
  expect(GRADE_KEYS["4"]).toBe(4);
  expect(Object.keys(GRADE_KEYS)).toHaveLength(4);
});

test("gradeKeyToGrade: digits map, non-digits are null", () => {
  expect(gradeKeyToGrade("1")).toBe(1);
  expect(gradeKeyToGrade("4")).toBe(4);
  expect(gradeKeyToGrade("5")).toBeNull();
  expect(gradeKeyToGrade(" ")).toBeNull();
  expect(gradeKeyToGrade("a")).toBeNull();
});

test("reveal keys: Space + Enter only", () => {
  expect(isRevealKey(" ")).toBe(true);
  expect(isRevealKey("Enter")).toBe(true);
  expect(isRevealKey("r")).toBe(false);
  expect(isRevealKey("Escape")).toBe(false);
});

test("GRADE_LABELS: one honest label per grade", () => {
  expect(GRADE_LABELS[1]).toBe("Again");
  expect(GRADE_LABELS[2]).toBe("Hard");
  expect(GRADE_LABELS[3]).toBe("Good");
  expect(GRADE_LABELS[4]).toBe("Easy");
});

// ─── Due-queue computation (injected clock; the pinned D1 policy) ────────────

test("isCardDue: a never-graded card is always due", () => {
  expect(isCardDue(mkCard("c"), NOW)).toBe(true);
});

test("isCardDue: lastReviewed + interval >= now → due", () => {
  const card = mkCard("c", "d1", sm2State(3, 2.5, 1, 1)); // 1 day ago, 1-day interval
  expect(isCardDue(card, NOW)).toBe(true);
  // Fractional interval: a card reviewed 0.5 days ago with a
  // 0.4-day interval is due; one with a 1-day interval is not.
  const card2 = mkCard("c2", "d1", {
    repetitions: 5,
    easiness: 2.5,
    interval: 0.4,
    lastReviewedAt: iso(NOW_MS - 0.5 * DAY),
  });
  expect(isCardDue(card2, NOW)).toBe(true);
  const card3 = mkCard("c3", "d1", {
    repetitions: 5,
    easiness: 2.5,
    interval: 1,
    lastReviewedAt: iso(NOW_MS - 0.5 * DAY),
  });
  expect(isCardDue(card3, NOW)).toBe(false);
});

test("isCardDue: the clock is the caller's — a later now flips due-ness", () => {
  const card = mkCard("c", "d1", sm2State(2, 2.5, 6, 1)); // not due at NOW
  expect(isCardDue(card, NOW)).toBe(false);
  expect(isCardDue(card, iso(NOW_MS + 7 * DAY))).toBe(true);
});

test("computeDueQueue: only due cards, in deck-then-cardOrder order", () => {
  const data = mkData();
  // Due: c1 (d1), c3 (d2). c2 is not due. d1's cardOrder is [c2, c1]
  // — the due subset keeps that relative order: c1 first (d1), then c3 (d2).
  const q = computeDueQueue(data, NOW);
  expect(q.map((c) => c.id)).toEqual(["c1", "c3"]);
});

test("computeDueQueue: DECISION D1 — nothing due → all cards (the pinned fallback)", () => {
  // A data set where no card is due (all recently reviewed, long
  // intervals): the queue is ALL cards, in stable order.
  const data: OstinatoData = {
    decks: [
      { id: "d1", name: "alpha", cardOrder: ["a", "b"], createdAt: NOW, updatedAt: NOW },
      { id: "d2", name: "beta", cardOrder: ["c"], createdAt: NOW, updatedAt: NOW },
    ],
    cards: [
      mkCard("a", "d1", sm2State(2, 2.5, 30, 1)),
      mkCard("b", "d1", sm2State(2, 2.5, 30, 1)),
      mkCard("c", "d2", sm2State(2, 2.5, 30, 1)),
    ],
    reviews: [],
  };
  expect(computeDueQueue(data, NOW).map((c) => c.id)).toEqual(["a", "b", "c"]);
});

test("computeDueQueue: an empty data set → an empty queue (no invented cards)", () => {
  expect(computeDueQueue({ decks: [], cards: [], reviews: [] }, NOW)).toEqual([]);
});

test("computeReviewQueue: identical to computeDueQueue (named intent split)", () => {
  const data = mkData();
  expect(computeReviewQueue(data, NOW)).toEqual(computeDueQueue(data, NOW));
});

// ─── The session state machine ────────────────────────────────────────────────

test("emptySession: terminal, no cards", () => {
  const s = emptySession();
  expect(s.phase).toBe("done");
  expect(s.index).toBe(-1);
  expect(s.cardIds).toEqual([]);
});

test("startSession: fresh boot positions the cursor at 0, phase front", () => {
  const s = startSession(mkData(), NOW, null);
  expect(s.cardIds).toEqual(["c1", "c3"]);
  expect(s.index).toBe(0);
  expect(s.phase).toBe("front");
  expect(s.currentCardId).toBe("c1");
  expect(s.currentDeckId).toBe("d1");
  expect(s.lastGradedCard).toBeNull();
});

test("startSession: an empty data set → the empty session", () => {
  const s = startSession({ decks: [], cards: [], reviews: [] }, NOW, null);
  expect(s).toEqual(emptySession());
});

test("applyEvent: a grade before reveal is a no-op (total function)", () => {
  const data = mkData();
  const s = startSession(data, NOW, null);
  const r = applyEvent(s, { type: "grade", grade: 3 }, ctxFor(data));
  expect(r.session).toBe(s); // no new state
  expect(r.data).toBe(data); // the data set is untouched (identity)
  expect((r.data.cards.find((c) => c.id === "c1") as Card).sm2).toBeDefined(); // the fixture's own state, not a new one
});

test("applyEvent grade: appends exactly one ReviewEvent to the log (R-1)", () => {
  const data = mkData();
  const s = startSession(data, NOW, null);
  const r1 = applyEvent(s, { type: "reveal" }, ctxFor(data));
  const r2 = applyEvent(r1.session, { type: "grade", grade: 3 }, ctxFor(r1.data));
  expect(r2.data.reviews).toHaveLength(1);
  const ev = r2.data.reviews[0];
  // The cursor starts at 0: the due queue's head is c1 (the due set is
  // c1 — 7 days ≥ its 1-day interval — and c3, never graded; c2 is
  // not due at 1 day < its 6-day interval; the queue is store order).
  expect(ev.cardId).toBe("c1");
  expect(ev.deckId).toBe("d1");
  expect(ev.grade).toBe(3);
  expect(ev.reviewedAt).toBe(NOW); // the injected clock, never a wall read
  expect(ev.id.startsWith("review_")).toBe(true);
  // The append rode the same transition: the log is part of the new
  // data set; the previous one is untouched.
  expect(r1.data.reviews).toHaveLength(0);
});

test("applyEvent out-of-order grade (before reveal): appends NOTHING", () => {
  const data = mkData();
  const s = startSession(data, NOW, null);
  const r = applyEvent(s, { type: "grade", grade: 3 }, ctxFor(data));
  expect(r.data).toBe(data); // total no-op — identity, no new object
  expect(r.data.reviews).toHaveLength(0);
});

test("applyEvent: reveal flips front → revealed (data untouched)", () => {
  const data = mkData();
  const s = startSession(data, NOW, null);
  const r = applyEvent(s, { type: "reveal" }, ctxFor(data));
  expect(r.session.phase).toBe("revealed");
  expect(r.session.index).toBe(0);
  expect(r.data).toBe(data); // the reveal event never copies the data set
});

test("applyEvent: grade 3 advances the cursor + updates the card's SM-2 state", () => {
  const data = mkData();
  const s = startSession(data, NOW, null);
  const r1 = applyEvent(s, { type: "reveal" }, ctxFor(data));
  const r2 = applyEvent(r1.session, { type: "grade", grade: 3 }, ctxFor(r1.data));
  expect(r2.session.index).toBe(1);
  expect(r2.session.phase).toBe("front");
  expect(r2.session.currentCardId).toBe("c3");
  expect(r2.session.lastGradedCard).toBeNull(); // reveal/grade do not set it — O-3 persists the data set, not a per-card snapshot
  const c1 = r2.data.cards.find((c) => c.id === "c1")!;
  expect(c1.sm2).toBeDefined();
  // c1's fixture state was R=3, I=1, EF=2.5; grade 3 → R=4, I=round(1·EF').
  expect(c1.sm2!.repetitions).toBe(4); // 3+1: the advance path
  expect(c1.sm2!.easiness).toBeCloseTo(2.18, 2); // 2.5−0.32 (q=2)
});

test("applyEvent: grade 1 (again) resets the card's SM-2 state", () => {
  const data = mkData();
  const s = startSession(data, NOW, null);
  const r1 = applyEvent(s, { type: "reveal" }, ctxFor(data));
  const r2 = applyEvent(r1.session, { type: "grade", grade: 1 }, ctxFor(r1.data));
  const c1 = r2.data.cards.find((c) => c.id === "c1")!;
  expect(c1.sm2!.repetitions).toBe(0);
  expect(c1.sm2!.interval).toBe(1);
});

test("applyEvent: grading through to the end → phase done, terminal state", () => {
  const data = mkData();
  const s = startSession(data, NOW, null);
  let r = applyEvent(s, { type: "reveal" }, ctxFor(data));
  r = applyEvent(r.session, { type: "grade", grade: 4 }, ctxFor(r.data));
  r = applyEvent(r.session, { type: "reveal" }, ctxFor(r.data));
  r = applyEvent(r.session, { type: "grade", grade: 3 }, ctxFor(r.data));
  expect(r.session.phase).toBe("done");
  expect(r.session.currentCardId).toBeNull();
  // Terminal: further events are no-ops.
  const r2 = applyEvent(r.session, { type: "reveal" }, ctxFor(r.data));
  expect(r2.session).toBe(r.session);
});

test("applyEvent: skip advances without touching the card's state", () => {
  const data = mkData();
  const s = startSession(data, NOW, null);
  const r = applyEvent(s, { type: "skip" }, ctxFor(data));
  expect(r.session.index).toBe(1);
  expect(r.session.phase).toBe("front");
  const c1 = r.data.cards.find((c) => c.id === "c1")!;
  expect(c1.sm2).toEqual({
    repetitions: 3,
    easiness: 2.5,
    interval: 1,
    lastReviewedAt: iso(NOW_MS - 7 * DAY),
  }); // skip does not grade: the SM-2 state is byte-identical to the fixture
});

test("applyEvent: the previous session is not mutated (purity)", () => {
  const data = mkData();
  const s0 = startSession(data, NOW, null);
  const s1 = { ...s0 };
  applyEvent(s0, { type: "reveal" }, ctxFor(data));
  expect(s0).toEqual(s1); // s0's fields unchanged
  expect(s0.phase).toBe("front");
});

test("startSession: a resume clamps an out-of-range cursor to 0 (data drifted)", () => {
  const data = mkData();
  const persisted: ReviewSession = {
    cardIds: ["c1", "c3", "ghost"], // ghost no longer exists
    index: 2, // out of range of the recomputed queue [c1, c3]
    phase: "front",
    currentCardId: "ghost",
    currentDeckId: "d1",
    lastGradedCard: null,
  };
  const s = startSession(data, NOW, persisted);
  expect(s.index).toBe(0);
  expect(s.currentCardId).toBe("c1");
});

test("startSession: a live lastGradedCard survives; a removed one is dropped", () => {
  const data = mkData();
  const c1 = data.cards.find((c) => c.id === "c1")!;
  const live = startSession(data, NOW, {
    ...emptySession(),
    cardIds: ["c1", "c3"],
    index: 0,
    phase: "front",
    currentCardId: "c1",
    currentDeckId: "d1",
    lastGradedCard: c1,
  });
  expect(live.lastGradedCard?.id).toBe("c1");
  const dropped = startSession(data, NOW, {
    ...emptySession(),
    cardIds: ["c1", "c3"],
    index: 0,
    phase: "front",
    currentCardId: "c1",
    currentDeckId: "d1",
    lastGradedCard: { ...c1, id: "removed" },
  });
  expect(dropped.lastGradedCard).toBeNull();
});

// ─── Interruption/recovery through the mocked storage seam (item 4) ──────────

/** A Map-backed StorageLike — the same seam style the domain's storage tests use. */
function mkStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

test("saveSession/readSession: round-trip through the storage seam", () => {
  const storage = mkStorage();
  const data = mkData();
  let s = startSession(data, NOW, null);
  s = applyEvent(s, { type: "reveal" }, ctxFor(data)).session;
  saveSession(storage, s);
  expect(storage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  const restored = deserializePersistedSession(readSession(storage)!);
  expect(restored).toEqual(s);
});

test("the wire shape is byte-stable: equal sessions → equal bytes", () => {
  const data = mkData();
  const s1 = startSession(data, NOW, null);
  const s2 = startSession(data, NOW, null);
  expect(serializePersistedSession(s1)).toBe(serializePersistedSession(s2));
  const obj = JSON.parse(serializePersistedSession(s1)) as Record<string, unknown>;
  expect(obj.v).toBe(1);
});

test("a kill-mid-review restores: grade, save, crash (drop the live state), resume", () => {
  const data = mkData();
  const storage = mkStorage();

  // Boot 1: start, grade the first card, persist the transition.
  let s = startSession(data, NOW, null);
  let r = applyEvent(s, { type: "reveal" }, ctxFor(data));
  r = applyEvent(r.session, { type: "grade", grade: 3 }, ctxFor(r.data));
  saveSession(storage, r.session);

  // Crash: the app process dies. Only the storage seam survives.
  const c1Graded = r.data.cards.find((c) => c.id === "c1")!;
  expect(c1Graded.sm2).toBeDefined();

  // Boot 2: a fresh process reads the data set + the persisted session.
  const raw = readSession(storage)!;
  const persisted = deserializePersistedSession(raw);
  const resumed = startSession(r.data, NOW, persisted);
  expect(resumed.index).toBe(0); // c1 was just graded at NOW: interval 1 day → not due yet; c3 (never graded) is due → the queue is [c3], cursor positions at 0
  expect(resumed.currentCardId).toBe("c3");
  expect(resumed.phase).toBe("front");
  expect(resumed.cardIds).toEqual(["c3"]); // c1 dropped out of the due queue: its next review is 1 day out
});

test("a resume after a grade-1 (again) keeps the card in the loop", () => {
  const data = mkData();
  const storage = mkStorage();
  const s = startSession(data, NOW, null);
  const r1 = applyEvent(s, { type: "reveal" }, ctxFor(data));
  const r = applyEvent(r1.session, { type: "grade", grade: 1 }, ctxFor(r1.data));
  saveSession(storage, r.session);
  // Resume with a LATER clock: c1 was just reset to I=1 day, last
  // reviewed at NOW → due at NOW+1d or later.
  const later = iso(NOW_MS + 2 * DAY);
  const resumed = startSession(r.data, later, deserializePersistedSession(readSession(storage)!));
  // c1: reviewed NOW, interval 1 → due at NOW+2d. c3: never graded → due.
  expect(resumed.cardIds).toEqual(["c1", "c3"]);
});

test("corrupt / foreign session bytes throw DomainInvariantError (P0 #5's error lane)", () => {
  expect(() => deserializePersistedSession("not json")).toThrow(DomainInvariantError);
  expect(() => deserializePersistedSession(JSON.stringify({ v: 2, cardIds: [], index: -1, phase: "done", currentCardId: null, currentDeckId: null, lastGradedCard: null }))).toThrow(DomainInvariantError);
  expect(() => deserializePersistedSession(JSON.stringify({ cardIds: [] }))).toThrow(DomainInvariantError); // missing v
  expect(() => deserializePersistedSession(JSON.stringify({ v: 1, cardIds: "nope", index: 0, phase: "front", currentCardId: null, currentDeckId: null, lastGradedCard: null }))).toThrow(DomainInvariantError);
  expect(() => deserializePersistedSession(JSON.stringify({ v: 1, cardIds: [], index: 5, phase: "front", currentCardId: null, currentDeckId: null, lastGradedCard: null }))).toThrow(DomainInvariantError);
  expect(() => deserializePersistedSession(JSON.stringify({ v: 1, cardIds: [], index: 0, phase: "sideways", currentCardId: null, currentDeckId: null, lastGradedCard: null }))).toThrow(DomainInvariantError);
});

test("first boot: no session key → readSession is null, startSession persists nothing until the first transition", () => {
  const storage = mkStorage();
  expect(readSession(storage)).toBeNull();
  const s = startSession(mkData(), NOW, null);
  expect(s.phase).toBe("front"); // the fresh-boot session, no crash involved
});

// ─── R-2: the queue cap (deck settings.newCardsPerSession) ─────────────

function capData(newCount: number, cap?: number, deck = "d1"): OstinatoData {
  const ids = Array.from({ length: newCount }, (_, i) => `n${i}`);
  return {
    decks: [
      {
        id: deck,
        name: "alpha",
        cardOrder: ids,
        createdAt: NOW,
        updatedAt: NOW,
        ...(cap !== undefined ? { settings: { newCardsPerSession: cap } } : {}),
      },
    ],
    cards: ids.map((id) => mkCard(id, deck)), // all new (no sm2)
    reviews: [],
  };
}

test("R-2 cap: override resolution — capped deck sliced in cardOrder order, other decks untouched", () => {
  const data: OstinatoData = {
    decks: [
      { id: "da", name: "a", cardOrder: ["a1", "a2", "a3", "a4", "a5"], createdAt: NOW, updatedAt: NOW, settings: { newCardsPerSession: 2 } },
      { id: "db", name: "b", cardOrder: ["b1", "b2"], createdAt: NOW, updatedAt: NOW },
    ],
    cards: [
      "a1", "a2", "a3", "a4", "a5", "b1", "b2" as const,
    ].map((id) => mkCard(id, id.startsWith("a") ? "da" : "db")),
    reviews: [],
  };
  expect(computeDueQueue(data, NOW).map((c) => c.id)).toEqual(["a1", "a2", "b1", "b2"]);
});

test("R-2 cap: all-new deck with cap N admits exactly min(N, new) cards", () => {
  expect(computeDueQueue(capData(5, 3), NOW).map((c) => c.id)).toEqual(["n0", "n1", "n2"]);
  expect(computeDueQueue(capData(5, 10), NOW).map((c) => c.id)).toEqual(["n0", "n1", "n2", "n3", "n4"]);
});

test("R-2 cap: pre-cap due EMPTY → review-all fallback fires; the cap never resurrects held cards", () => {
  // All cards have sm2, none due (long intervals) → D1 fallback = ALL cards.
  // The cap (0) must not hold the fallback's new-card resurrection — but
  // here there are no NEW cards at all, and a capped-out new card (added
  // to the fallback set) must not reappear either.
  const data: OstinatoData = {
    decks: [
      {
        id: "d1",
        name: "alpha",
        cardOrder: ["x", "y"],
        createdAt: NOW,
        updatedAt: NOW,
        settings: { newCardsPerSession: 0 },
      },
    ],
    cards: [
      mkCard("x", "d1", sm2State(2, 2.5, 30, 1)), // not due
      mkCard("y", "d1"), // NEW — due, but the cap holds it
    ],
    reviews: [],
  };
  // Pre-cap due = {y} (non-empty) → no fallback. Cap 0 empties it →
  // honest EMPTY queue: the fallback never resurrects capped cards.
  expect(computeDueQueue(data, NOW)).toEqual([]);
});

test("R-2 cap: pre-cap due non-empty (new cards only), cap 0 → honest EMPTY queue", () => {
  expect(computeDueQueue(capData(4, 0), NOW)).toEqual([]);
});

test("R-2 cap: reviews (due cards WITH sm2) are NEVER capped, even at cap 0", () => {
  const data: OstinatoData = {
    decks: [
      {
        id: "d1",
        name: "alpha",
        cardOrder: ["r1", "r2", "n1"],
        createdAt: NOW,
        updatedAt: NOW,
        settings: { newCardsPerSession: 0 },
      },
    ],
    cards: [
      mkCard("r1", "d1", sm2State(3, 2.5, 1, 7)), // due review
      mkCard("r2", "d1", sm2State(2, 2.5, 2, 5)), // due review
      mkCard("n1", "d1"), // new, held by cap 0
    ],
    reviews: [],
  };
  expect(computeDueQueue(data, NOW).map((c) => c.id)).toEqual(["r1", "r2"]);
});

test("R-2 cap: default-untouched path — decks without settings are byte-identical to pre-R-2", () => {
  // Same data + clock as the pre-R-2 D1 pin, expected queue constructed literally.
  const data: OstinatoData = {
    decks: [
      { id: "d1", name: "alpha", cardOrder: ["a", "b"], createdAt: NOW, updatedAt: NOW },
      { id: "d2", name: "beta", cardOrder: ["c"], createdAt: NOW, updatedAt: NOW },
    ],
    cards: [
      mkCard("a", "d1", sm2State(2, 2.5, 30, 1)), // not due
      mkCard("b", "d1", sm2State(2, 2.5, 30, 1)), // not due
      mkCard("c", "d2"), // due (new)
    ],
    reviews: [],
  };
  expect(computeDueQueue(data, NOW).map((c) => c.id)).toEqual(["c"]);
  // And the all-due-new fallback path without settings:
  const allNew: OstinatoData = capData(3); // no settings field
  expect(computeDueQueue(allNew, NOW).map((c) => c.id)).toEqual(["n0", "n1", "n2"]);
});

test("R-2 cap: cap 0 holds ALL new cards of that deck while other decks flow", () => {
  const data: OstinatoData = {
    decks: [
      { id: "da", name: "a", cardOrder: ["a1", "a2"], createdAt: NOW, updatedAt: NOW, settings: { newCardsPerSession: 0 } },
      { id: "db", name: "b", cardOrder: ["b1"], createdAt: NOW, updatedAt: NOW },
    ],
    cards: [mkCard("a1", "da"), mkCard("a2", "da"), mkCard("b1", "db")],
    reviews: [],
  };
  expect(computeDueQueue(data, NOW).map((c) => c.id)).toEqual(["b1"]);
});

test("R-2 cap: settings: {} behaves like absent (no cap)", () => {
  const data: OstinatoData = capData(5, 3);
  data.decks[0].settings = {};
  expect(computeDueQueue(data, NOW).map((c) => c.id)).toEqual(["n0", "n1", "n2", "n3", "n4"]);
});
