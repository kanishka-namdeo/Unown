import { describe, expect, test } from "bun:test";
import {
  activeRotationWindow,
  currentSeat,
  nextHandoff,
  onCallDisplay,
  whoIsOnCall,
} from "./rotation";
import type { NocturneOverride, NocturneRotation, NocturneUser } from "./types";
import { rotationContiguity } from "./validation";

const WEEK = 7 * 86_400_000;
const DAY = 86_400_000;
const AS_OF = "2026-10-28T12:00:00Z";

function rot(seats: Array<{ seatIndex: number; userId: string; start: string }>): NocturneRotation {
  return {
    id: "rot-x",
    tenantId: "tn-lumen",
    name: "Weekly",
    seats,
    shiftLengthMs: WEEK,
    boundaryDow: 0,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/** A weekly 4-seat rotation anchored at `week0` (seat i starts week i). */
function weekly(week0: string, users: [string, string, string, string]): NocturneRotation {
  return rot(
    users.map((u, i) => ({
      seatIndex: i,
      userId: u,
      start: new Date(new Date(week0).getTime() + i * WEEK).toISOString().replace(".000Z", "Z"),
    })),
  );
}

function ovr(id: string, over: Partial<NocturneOverride>): NocturneOverride {
  return {
    id,
    tenantId: "tn-lumen",
    rotationId: "rot-x",
    forUserId: "u-theo",
    userId: "u-ada",
    startsAt: "2026-10-25T00:00:00Z",
    endsAt: "2026-11-01T00:00:00Z",
    reason: "cover",
    createdAt: "2026-10-20T00:00:00Z",
    ...over,
  };
}

describe("whoIsOnCall — correct seat for every now in the cycle", () => {
  // anchor the rotation at 2026-10-25 so the 9-week seed span
  // (2026-08-31 … 2026-10-25) plus AS_OF (Wed 2026-10-28) all fall
  // inside the rotation's own cycle.
  const r = weekly("2026-10-25T00:00:00Z", ["u-theo", "u-ada", "u-sam", "u-mira"]);

  test("the current week's slot resolves to seat 0 (Theo)", () => {
    // 2026-10-28 is a Wednesday inside the week of Sun 2026-10-25
    expect(whoIsOnCall(r, [], "2026-10-28T12:00:00Z")).toBe("u-theo");
  });

  test("a Thursday in the current week", () => {
    expect(whoIsOnCall(r, [], "2026-10-29T09:00:00Z")).toBe("u-theo");
  });

  test("the handoff instant is inclusive of the new seat", () => {
    // Sat 2026-10-31 23:59:59Z is still seat 0
    expect(whoIsOnCall(r, [], "2026-10-31T23:59:59Z")).toBe("u-theo");
    // Sun 2026-11-01 00:00:00Z is seat 1
    expect(whoIsOnCall(r, [], "2026-11-01T00:00:00Z")).toBe("u-ada");
  });

  test("every week of the seed's 9-week span lands on the right seat", () => {
    // seed rotations store a single 4-week period anchored at 2026-10-25:
    // weeks of Aug 31…Oct 25 wrap modulo the 4-week period:
    //   Oct 25 = anchor = seat 0; Oct 19 = seat 3; Oct 12 = seat 2; …
    const weeks = [
      "2026-08-31T00:00:00Z",
      "2026-09-07T00:00:00Z",
      "2026-09-14T00:00:00Z",
      "2026-09-21T00:00:00Z",
      "2026-09-28T00:00:00Z",
      "2026-10-05T00:00:00Z",
      "2026-10-12T00:00:00Z",
      "2026-10-19T00:00:00Z",
      "2026-10-25T00:00:00Z",
    ];
    // week w (0-based from Aug 31) → seat w mod 4 (Aug 31 is a wrap
    // back into seat 0 of the anchored period)
    const map = [
      "u-theo", // week 0 (Aug 31) → seat 0
      "u-ada", // week 1 → seat 1
      "u-sam", // week 2 → seat 2
      "u-mira", // week 3 → seat 3
      "u-theo", // week 4 → seat 0
      "u-ada", // week 5 → seat 1
      "u-sam", // week 6 → seat 2
      "u-mira", // week 7 → seat 3
      "u-theo", // week 8 (Oct 25, anchor) → seat 0
    ];
    for (let w = 0; w < 9; w++) {
      expect(whoIsOnCall(r, [], weeks[w]), `week ${w} (${weeks[w]})`).toBe(map[w]);
    }
  });

  test("a rotation anchored earlier (2026-08-31) maps the same span onto its cycle", () => {
    const r2 = weekly("2026-08-31T00:00:00Z", ["u-a", "u-b", "u-c", "u-d"]);
    expect(whoIsOnCall(r2, [], "2026-08-31T00:00:00Z")).toBe("u-a"); // week 0 = seat 0
    expect(whoIsOnCall(r2, [], "2026-09-07T00:00:00Z")).toBe("u-b"); // week 1
    expect(whoIsOnCall(r2, [], "2026-09-14T00:00:00Z")).toBe("u-c"); // week 2
    expect(whoIsOnCall(r2, [], "2026-09-21T00:00:00Z")).toBe("u-d"); // week 3
    expect(whoIsOnCall(r2, [], "2026-09-28T00:00:00Z")).toBe("u-a"); // the cycle wraps
    // AS_OF (Wed 2026-10-28) → week 8 of the cycle → seat 0
    expect(whoIsOnCall(r2, [], "2026-10-28T12:00:00Z")).toBe("u-a");
  });

  test("an empty rotation returns null (never a crash)", () => {
    expect(whoIsOnCall(rot([]), [], AS_OF)).toBe(null);
  });

  test("an empty rotation has no current seat / handoff / window", () => {
    const empty = rot([]);
    expect(currentSeat(empty, AS_OF)).toBe(null);
    expect(nextHandoff(empty, AS_OF)).toBe(null);
    expect(activeRotationWindow(empty, AS_OF)).toBe(null);
  });

  test("the AS_OF weekday pin: 2026-10-28 is a Wednesday", () => {
    expect(new Date("2026-10-28T00:00:00Z").getUTCDay()).toBe(3); // 3 = Wednesday
  });
});

describe("override precedence (the latest-wins pin)", () => {
  const r = weekly("2026-10-25T00:00:00Z", ["u-theo", "u-ada", "u-sam", "u-mira"]);

  test("an override covering now replaces the seat's user", () => {
    const o = ovr("o1", {}); // covers u-theo for 2026-10-25..11-01
    expect(whoIsOnCall(r, [o], "2026-10-28T12:00:00Z")).toBe("u-ada");
  });

  test("outside the window the seat's user returns", () => {
    const o = ovr("o1", {});
    // 2026-10-24 is BEFORE the override's start → seat 3's user (u-mira)
    // since week 2026-10-19 = seat index 3 (the wrap from the anchor)
    expect(whoIsOnCall(r, [o], "2026-10-24T12:00:00Z")).toBe("u-mira");
  });

  test("an override for a DIFFERENT user has no effect here", () => {
    const o = ovr("o1", { forUserId: "u-ada" });
    expect(whoIsOnCall(r, [o], "2026-10-28T12:00:00Z")).toBe("u-theo");
  });

  test("the LATEST override (by startsAt) wins when two cover now", () => {
    const older = ovr("o1", { userId: "u-sam", startsAt: "2026-10-25T00:00:00Z" });
    const newer = ovr("o2", { userId: "u-mira", startsAt: "2026-10-26T00:00:00Z", forUserId: "u-theo" });
    expect(whoIsOnCall(r, [older, newer], "2026-10-28T12:00:00Z")).toBe("u-mira");
  });

  test("a LATEST override that has already ENDED is skipped (the window matters)", () => {
    const older = ovr("o1", { userId: "u-sam", startsAt: "2026-10-20T00:00:00Z", endsAt: "2026-10-22T00:00:00Z" });
    const newer = ovr("o2", { userId: "u-mira", startsAt: "2026-10-25T00:00:00Z", forUserId: "u-theo" });
    // 2026-10-28: o1 has ended, o2 is live → u-mira (the latest LIVE one)
    expect(whoIsOnCall(r, [older, newer], "2026-10-28T12:00:00Z")).toBe("u-mira");
    // 2026-10-21: week 7 (Oct 19..Oct 25) → seat 3 = u-mira; the
    // overrides target u-theo (the seat-0 user), so NONE apply →
    // the seat's own user
    expect(whoIsOnCall(r, [older, newer], "2026-10-21T12:00:00Z")).toBe("u-mira");
    // and on u-theo's week (Oct 25..31), only the live o2 applies:
    expect(whoIsOnCall(r, [older], "2026-10-28T12:00:00Z")).toBe("u-theo");
  });

  test("start is inclusive, end exclusive (the window semantics)", () => {
    const o = ovr("o1", { startsAt: "2026-10-25T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" });
    expect(whoIsOnCall(r, [o], "2026-10-25T00:00:00Z")).toBe("u-ada"); // inclusive start
    // end-exclusive: an override ending exactly at now no longer covers now
    const o2 = ovr("o2", { startsAt: "2026-10-24T00:00:00Z", endsAt: "2026-10-28T00:00:00Z" });
    expect(whoIsOnCall(r, [o2], "2026-10-28T00:00:00Z")).toBe("u-theo");
  });

  test("an override scoped to another tenant never applies", () => {
    const o = ovr("o1", { tenantId: "tn-northwind" });
    expect(whoIsOnCall(r, [o], "2026-10-28T12:00:00Z")).toBe("u-theo");
  });
});

describe("currentSeat / nextHandoff / activeRotationWindow", () => {
  const r = weekly("2026-10-25T00:00:00Z", ["u-theo", "u-ada", "u-sam", "u-mira"]);

  test("currentSeat returns the seat object for now", () => {
    expect(currentSeat(r, "2026-10-28T12:00:00Z")!.userId).toBe("u-theo");
    expect(currentSeat(r, "2026-11-01T00:00:00Z")!.userId).toBe("u-ada");
  });

  test("nextHandoff is the start of the next seat", () => {
    // at 2026-10-28 (seat 0), the next handoff is seat 1's start, 2026-11-01.
    expect(nextHandoff(r, "2026-10-28T12:00:00Z")).toBe("2026-11-01T00:00:00Z");
    // at 2026-11-03 (seat 1), the next handoff is seat 2's start
    expect(nextHandoff(r, "2026-11-03T00:00:00Z")).toBe("2026-11-08T00:00:00Z");
    // at the LAST seat (index 3, week of 2026-11-15), the handoff wraps
    // to the next seat in cycle order = seat 0 of the same period's
    // repeated cycle: the period containing Nov 17 started Nov 15;
    // the wrap handoff is Nov 15 + 4 weeks = 2026-11-22… the engine
    // computes currentSlotStart + shift = Nov 15 + 1 week = Nov 22.
    expect(nextHandoff(r, "2026-11-17T12:00:00Z")).toBe("2026-11-22T00:00:00Z");
  });

  test("the active window's handoffAt is the CURRENT slot's end", () => {
    const w = activeRotationWindow(r, "2026-10-28T12:00:00Z")!;
    expect(w.seat.userId).toBe("u-theo");
    expect(w.handoffAt).toBe("2026-11-01T00:00:00Z");
  });
});

describe("contiguity (the PBT invariant's structural check)", () => {
  test("the seed's weekly shape satisfies rotationContiguity", () => {
    const r = weekly("2026-10-25T00:00:00Z", ["u-a", "u-b", "u-c", "u-d"]);
    expect(rotationContiguity(r.seats, WEEK)).toBe(true);
  });

  test("a gap is rejected", () => {
    const seats = [
      { seatIndex: 0, userId: "u-a", start: "2026-10-25T00:00:00Z" },
      { seatIndex: 1, userId: "u-b", start: new Date(new Date("2026-10-25T00:00:00Z").getTime() + 2 * WEEK).toISOString() },
    ];
    expect(rotationContiguity(seats, WEEK)).toBe(false);
  });

  test("an overlap is rejected", () => {
    const seats = [
      { seatIndex: 0, userId: "u-a", start: "2026-10-25T00:00:00Z" },
      { seatIndex: 1, userId: "u-b", start: new Date(new Date("2026-10-25T00:00:00Z").getTime() + WEEK / 2).toISOString() },
    ];
    expect(rotationContiguity(seats, WEEK)).toBe(false);
  });

  test("a non-integer cycle closure is rejected", () => {
    const seats = [
      { seatIndex: 0, userId: "u-a", start: "2026-10-25T00:00:00Z" },
      { seatIndex: 1, userId: "u-b", start: new Date(new Date("2026-10-25T00:00:00Z").getTime() + WEEK).toISOString() },
      { seatIndex: 2, userId: "u-c", start: new Date(new Date("2026-10-25T00:00:00Z").getTime() + 3 * WEEK + WEEK * 0.5).toISOString() },
    ];
    expect(rotationContiguity(seats, WEEK)).toBe(false);
  });

  test("a duplicate start instant is rejected", () => {
    const seats = [
      { seatIndex: 0, userId: "u-a", start: "2026-10-25T00:00:00Z" },
      { seatIndex: 1, userId: "u-b", start: "2026-10-25T00:00:00Z" },
    ];
    expect(rotationContiguity(seats, WEEK)).toBe(false);
  });

  test("a daily 2-seat rotation tiles (the other shift shape)", () => {
    const seats = [
      { seatIndex: 0, userId: "u-a", start: "2026-10-25T00:00:00Z" },
      { seatIndex: 1, userId: "u-b", start: "2026-10-26T00:00:00Z" },
    ];
    expect(rotationContiguity(seats, DAY)).toBe(true);
    const rr: NocturneRotation = { ...rot(seats), shiftLengthMs: DAY };
    expect(whoIsOnCall(rr, [], "2026-10-25T12:00:00Z")).toBe("u-a");
    expect(whoIsOnCall(rr, [], "2026-10-26T00:00:00Z")).toBe("u-b");
    expect(whoIsOnCall(rr, [], "2026-10-27T00:00:00Z")).toBe("u-a"); // the cycle repeats
  });

  test("shiftLengthMs <= 0 is rejected", () => {
    expect(rotationContiguity([{ seatIndex: 0, userId: "u", start: "2026-10-25T00:00:00Z" }], 0)).toBe(false);
    expect(rotationContiguity([{ seatIndex: 0, userId: "u", start: "2026-10-25T00:00:00Z" }], -1)).toBe(false);
  });

  test("an empty seat list is rejected", () => {
    expect(rotationContiguity([], WEEK)).toBe(false);
  });
});

describe("onCallDisplay", () => {
  const users: NocturneUser[] = [
    {
      id: "u-ada",
      email: "ada@lumen.test",
      name: "Ada Okafor",
      passwordHash: "",
      salt: "s",
      createdAt: "2026-01-01T00:00:00Z",
      timezone: "UTC",
    },
  ];

  test("joins the user's name", () => {
    expect(onCallDisplay("u-ada", users)).toEqual({ userId: "u-ada", name: "Ada Okafor" });
  });

  test("an unknown user degrades to the raw id (no crash)", () => {
    expect(onCallDisplay("u-ghost", users)).toEqual({ userId: "u-ghost", name: "u-ghost" });
  });

  test("null resolves to null (the secondary-seat shape)", () => {
    expect(onCallDisplay(null, users)).toBe(null);
  });
});
