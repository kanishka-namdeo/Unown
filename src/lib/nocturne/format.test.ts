import { describe, expect, it } from "bun:test";
import {
  dayKeyOf,
  formatCountdown,
  formatDurationMs,
  formatLongDate,
  monthShort,
  todayKey,
  weekdayShort,
} from "./format";

describe("weekdayShort", () => {
  it("resolves day keys via UTC weekday", () => {
    // 2026-07-14 is a Tuesday
    expect(weekdayShort("2026-07-14")).toBe("Tue");
    // 2026-07-12 is a Sunday
    expect(weekdayShort("2026-07-12")).toBe("Sun");
    // 2026-07-19 is a Sunday
    expect(weekdayShort("2026-07-19")).toBe("Sun");
  });

  it("resolves Date inputs via getUTCDay", () => {
    expect(weekdayShort(new Date("2026-07-14T08:30:00Z"))).toBe("Tue");
  });
});

describe("monthShort", () => {
  it("resolves day keys via UTC month", () => {
    expect(monthShort("2026-07-14")).toBe("Jul");
    expect(monthShort("2026-01-05")).toBe("Jan");
    expect(monthShort("2026-12-31")).toBe("Dec");
  });

  it("resolves Date inputs via getUTCMonth", () => {
    expect(monthShort(new Date("2026-07-14T00:00:00Z"))).toBe("Jul");
  });
});

describe("todayKey", () => {
  it("formats the zone-offset day of the instant as a YYYY-MM-DD day key", () => {
    // todayKey uses local (zone) getters, so pin it with the same local-
    // day semantics: build the local date from explicit y/m/d components.
    const local = new Date(2026, 6, 14, 9, 0, 0);
    expect(todayKey(local)).toBe("2026-07-14");
    // A later local day gives a later key.
    const next = new Date(2026, 6, 15, 9, 0, 0);
    expect(todayKey(next)).toBe("2026-07-15");
    // And a December date pads month and day correctly.
    const xmas = new Date(2026, 11, 8, 12, 0, 0);
    expect(todayKey(xmas)).toBe("2026-12-08");
    // UTC midnight maps to the local day of the test env's zone (in a
    // -08:00 zone that is 2026-07-13; in a UTC-based env 2026-07-14).
    // Pin determinism instead of the zone-dependent value: two calls on
    // the same instant must agree within one zone.
    const a = todayKey(new Date("2026-07-14T00:00:00Z"));
    expect(a).toBe(todayKey(new Date("2026-07-14T00:00:00Z")));
    // And it is a 10-char YYYY-MM-DD day key.
    expect(a).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatLongDate", () => {
  it("renders the compact long-form header", () => {
    expect(formatLongDate("2026-07-14")).toBe("Tue, Jul 14");
  });

  it("accepts a Date", () => {
    expect(formatLongDate(new Date("2026-07-14T00:00:00Z"))).toBe("Tue, Jul 14");
  });
});

describe("dayKeyOf", () => {
  it("passes day keys through unchanged", () => {
    expect(dayKeyOf("2026-07-14")).toBe("2026-07-14");
  });

  it("converts a Date to its UTC day key", () => {
    expect(dayKeyOf(new Date("2026-07-14T23:59:00Z"))).toBe("2026-07-14");
    expect(dayKeyOf(new Date("2026-07-15T00:01:00Z"))).toBe("2026-07-15");
  });
});

describe("formatCountdown", () => {
  it("clamps non-positive deltas to 0m", () => {
    expect(formatCountdown(0)).toBe("0m");
    expect(formatCountdown(-1000)).toBe("0m");
  });

  it("renders sub-hour deltas as bare minutes", () => {
    expect(formatCountdown(45 * 60_000)).toBe("45m");
    expect(formatCountdown(59 * 60_000 + 59_000)).toBe("59m");
  });

  it("renders multi-hour deltas as h m", () => {
    expect(formatCountdown(8_040_000)).toBe("2h 14m");
    expect(formatCountdown(5 * 3_600_000)).toBe("5h 0m");
  });
});

describe("formatDurationMs", () => {
  it("shares the countdown shape for non-negative durations", () => {
    expect(formatDurationMs(0)).toBe("0m");
    expect(formatDurationMs(45 * 60_000)).toBe("45m");
    expect(formatDurationMs(8_040_000)).toBe("2h 14m");
    expect(formatDurationMs(3_600_000)).toBe("1h 0m");
  });
});
