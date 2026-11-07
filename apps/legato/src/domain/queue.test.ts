/**
 * queue.test.ts — the L-6 domain pins (PLAN §3 L-6, §4.4 Q-1..Q-3,
 * PRD V-6). Pure, DOM-free (Lane A enforces; boundary.test.ts pins
 * the import graph).
 *
 * Pins (one group per deliverable):
 *   - transition table: every on-table move succeeds; every
 *     off-table move throws QueueTransitionError
 *   - concurrent-flip guard: a drifted expected-prior → typed
 *     ConflictError (Q-1); no silent last-write-wins ever
 *   - queue order: reading first, then unread; done/archived out
 *     of the default view; createdAt-desc + id-asc tiebreak
 *   - empty-state discrimination: the three Q-3 panels
 */
import { test, expect } from "bun:test";
import type { Clip, LegatoData, ClipState } from "./types.js";
import {
  flipState,
  orderQueue,
  activeClips,
  allClips,
  markReading,
  markDone,
  archiveClip,
  restoreClip,
  isLegalTransition,
  queueEmptyKind,
  filteredEmptyKind,
  QueueTransitionError,
  ConflictError,
} from "./queue.js";

const NOW = "2026-11-07T00:00:00.000Z";

function mkClip(
  id: number,
  state: ClipState,
  createdAt = "2026-01-01T00:00:00Z",
): Clip {
  return {
    id,
    url: "https://example.com/" + id,
    title: "Clip " + id,
    text: "body " + id,
    tags: [],
    state,
    highlights: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function mkData(clips: Clip[]): LegatoData {
  const tags = new Set<string>();
  for (const c of clips) for (const t of c.tags) tags.add(t);
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips,
    tags: [...tags].sort(),
    queue: clips.map((c) => c.id),
  };
}

// --- transition table pins ----------------------------------------

test("flipState: every on-table transition succeeds", () => {
  const cases: Array<[ClipState, ClipState]> = [
    ["unread", "reading"],
    ["unread", "done"],
    ["unread", "archived"],
    ["reading", "done"],
    ["reading", "unread"],
    ["reading", "archived"],
    ["done", "unread"],
    ["done", "reading"],
    ["done", "archived"],
    ["archived", "unread"],
  ];
  for (const [from, to] of cases) {
    const data = mkData([mkClip(1, from)]);
    const clip = flipState(data, 1, to, from, NOW);
    expect(clip.state).toBe(to);
    expect(clip.updatedAt).toBe(NOW);
  }
});

test("flipState: same-state is a no-op (not an error)", () => {
  for (const s of ["unread", "reading", "done", "archived"] as ClipState[]) {
    const data = mkData([mkClip(1, s)]);
    const clip = flipState(data, 1, s, s, NOW);
    expect(clip.state).toBe(s);
    expect(clip.updatedAt).toBe(NOW);
  }
});

test("flipState: every off-table transition throws QueueTransitionError", () => {
  // The full 4×4 matrix minus the 10 on-table + 4 no-op = 8 off-table
  const states: ClipState[] = ["unread", "reading", "done", "archived"];
  const onTable = new Set<string>([
    "unread>reading", "unread>done", "unread>archived",
    "reading>done", "reading>unread", "reading>archived",
    "done>unread", "done>reading", "done>archived",
    "archived>unread",
  ]);
  for (const from of states) {
    for (const to of states) {
      if (from === to) continue; // no-op, allowed
      if (onTable.has(from + ">" + to)) continue; // legal
      const data = mkData([mkClip(1, from)]);
      let thrown: unknown = null;
      try {
        flipState(data, 1, to, from, NOW);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `expected rejection for ${from} → ${to}`).toBeInstanceOf(QueueTransitionError);
      const err = thrown as QueueTransitionError;
      expect(err.from).toBe(from);
      expect(err.to).toBe(to);
      // the clip is UNCHANGED — a rejected move must not mutate
      expect(data.clips[0].state).toBe(from);
    }
  }
});

test("flipState: unknown clip → ConflictError (the reload lane)", () => {
  const data = mkData([mkClip(1, "unread")]);
  let thrown: unknown = null;
  try {
    flipState(data, 99, "reading", "unread", NOW);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ConflictError);
  expect((thrown as ConflictError).clipId).toBe(99);
});

test("isLegalTransition mirrors the table (the pure decision)", () => {
  expect(isLegalTransition("unread", "reading")).toBe(true);
  expect(isLegalTransition("archived", "reading")).toBe(false);
  expect(isLegalTransition("archived", "done")).toBe(false);
  expect(isLegalTransition("reading", "reading")).toBe(true); // no-op
});

// --- concurrent-flip guard (Q-1) ----------------------------------

test("flipState: drifted expected-prior → ConflictError, clip untouched", () => {
  // The caller saw "unread" but the stored state is "reading"
  // (another tab flipped it). The guard rejects.
  const data = mkData([mkClip(1, "reading")]);
  let thrown: unknown = null;
  try {
    flipState(data, 1, "done", "unread", NOW);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ConflictError);
  const err = thrown as ConflictError;
  expect(err.clipId).toBe(1);
  expect(err.expected).toBe("unread");
  expect(err.actual).toBe("reading");
  // NEVER a silent last-write-wins: the state is still "reading"
  expect(data.clips[0].state).toBe("reading");
});

test("the Q-1 reload lane: recompute from the CURRENT stored state and retry", () => {
  // Two tabs both start from "unread". Tab A flips to "reading"
  // first. Tab B (still holding expectedPrior=unread) attempts
  // unread→done: CONFLICT. Tab B reloads: sees "reading". The
  // legal move from "reading" to "done" is on-table, so it retries
  // with expectedPrior=reading and SUCCEEDS.
  const data = mkData([mkClip(1, "unread")]);
  // Tab A: unread → reading (legal)
  flipState(data, 1, "reading", "unread", NOW);
  // Tab B's stale attempt: expectedPrior=unread, wants "done"
  // ("unread>done" IS legal, so this specific pair would have
  // succeeded without the drift — the drift is what catches it).
  let conflict: unknown = null;
  try {
    flipState(data, 1, "done", "unread", NOW);
  } catch (e) {
    conflict = e;
  }
  expect(conflict).toBeInstanceOf(ConflictError);
  // Tab B reloads → the stored state is "reading"; retry from there.
  const clip = flipState(data, 1, "done", "reading", NOW);
  expect(clip.state).toBe("done");
});

test("markReading / markDone / archiveClip / restoreClip delegate to the guard", () => {
  const d1 = mkData([mkClip(1, "unread")]);
  expect(markReading(d1, 1, "unread", NOW).state).toBe("reading");
  const d2 = mkData([mkClip(2, "reading")]);
  expect(markDone(d2, 2, "reading", NOW).state).toBe("done");
  const d3 = mkData([mkClip(3, "done")]);
  expect(archiveClip(d3, 3, "done", NOW).state).toBe("archived");
  const d4 = mkData([mkClip(4, "archived")]);
  expect(restoreClip(d4, 4, "archived", NOW).state).toBe("unread");

  // Each one throws ConflictError on a drifted prior:
  const d5 = mkData([mkClip(5, "reading")]);
  expect(() => markReading(d5, 5, "unread", NOW)).toThrow(ConflictError);
  const d6 = mkData([mkClip(6, "done")]);
  expect(() => markDone(d6, 6, "unread", NOW)).toThrow(ConflictError);
  const d7 = mkData([mkClip(7, "archived")]);
  expect(() => archiveClip(d7, 7, "unread", NOW)).toThrow(ConflictError);
  const d8 = mkData([mkClip(8, "unread")]);
  expect(() => restoreClip(d8, 8, "archived", NOW)).toThrow(ConflictError);
});

// --- queue order pins --------------------------------------------

test("orderQueue: reading first, then unread; done/archived excluded", () => {
  const clips = [
    mkClip(1, "unread", "2026-01-01T00:00:00Z"),
    mkClip(2, "reading", "2026-01-02T00:00:00Z"),
    mkClip(3, "done", "2026-01-03T00:00:00Z"),
    mkClip(4, "archived", "2026-01-04T00:00:00Z"),
    mkClip(5, "unread", "2026-01-05T00:00:00Z"),
    mkClip(6, "reading", "2026-01-06T00:00:00Z"),
  ];
  const data = mkData(clips);
  // reading lane: 6 (01-06) then 2 (01-02) — createdAt DESC
  // unread lane: 5 (01-05) then 1 (01-01)
  expect(orderQueue(data)).toEqual([6, 2, 5, 1]);
});

test("orderQueue: the tiebreak is createdAt desc, then id asc", () => {
  // Same createdAt across clips: id ascending within the lane.
  const clips = [
    mkClip(3, "unread", "2026-02-01T00:00:00Z"),
    mkClip(1, "unread", "2026-02-01T00:00:00Z"),
    mkClip(2, "reading", "2026-02-01T00:00:00Z"),
    mkClip(4, "reading", "2026-02-01T00:00:00Z"),
  ];
  const data = mkData(clips);
  expect(orderQueue(data)).toEqual([2, 4, 1, 3]);
});

test("orderQueue: an empty active view (all done/archived) → []", () => {
  const data = mkData([mkClip(1, "done"), mkClip(2, "archived")]);
  expect(orderQueue(data)).toEqual([]);
  expect(activeClips(data)).toEqual([]);
});

test("allClips: every clip, no state filter, createdAt desc + id asc", () => {
  const clips = [
    mkClip(1, "done", "2026-01-01T00:00:00Z"),
    mkClip(2, "archived", "2026-01-03T00:00:00Z"),
    mkClip(3, "unread", "2026-01-02T00:00:00Z"),
  ];
  const data = mkData(clips);
  expect(allClips(data).map((c) => c.id)).toEqual([2, 3, 1]);
});

test("flipState's mutation is the persisted change (updatedAt advances)", () => {
  const data = mkData([mkClip(1, "unread", "2026-01-01T00:00:00Z")]);
  expect(data.clips[0].updatedAt).toBe("2026-01-01T00:00:00Z");
  flipState(data, 1, "reading", "unread", NOW);
  expect(data.clips[0].updatedAt).toBe(NOW);
});

// --- empty-state discrimination (Q-3) ------------------------------

test("queueEmptyKind: no clips at all → 'no-clips'", () => {
  const data = mkData([]);
  expect(queueEmptyKind(data)).toBe("no-clips");
});

test("queueEmptyKind: clips exist but active view is empty → 'all-read'", () => {
  const data = mkData([mkClip(1, "done"), mkClip(2, "archived")]);
  expect(queueEmptyKind(data)).toBe("all-read");
});

test("queueEmptyKind: a non-empty active view → null (no panel)", () => {
  const data = mkData([mkClip(1, "unread")]);
  expect(queueEmptyKind(data)).toBeNull();
});

test("queueEmptyKind: 'all-read' is NOT shadowed when a filter is active — the filter lane owns that panel", () => {
  // filterActive=true + the active view is empty: the "all-read"
  // panel is superseded by the filter's "no-matches" lane (the UI
  // calls filteredEmptyKind for that case). queueEmptyKind still
  // reports the underlying condition honestly.
  const data = mkData([mkClip(1, "done")]);
  expect(queueEmptyKind(data)).toBe("all-read");
});

test("filteredEmptyKind: filter active + zero results → 'no-matches'", () => {
  const data = mkData([mkClip(1, "unread")]);
  expect(filteredEmptyKind([], true)).toBe("no-matches");
  // a non-empty filter result → no panel
  expect(filteredEmptyKind(data.clips, true)).toBeNull();
  // filter inactive → never the no-matches panel
  expect(filteredEmptyKind([], false)).toBeNull();
  void data;
});
