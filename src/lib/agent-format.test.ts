// Unit tests for src/lib/agent-format.ts (pure formatting helpers).
//
// Backlog reference: docs/testing-strategy.md §2 flags that `src/` has no unit
// tests and calls out `agent-format.ts` as untested pure logic; §4.1 asks for
// table-driven coverage of timeAgo / formatTokens / formatDuration /
// truncateMiddle / truncateEnd / humanizeInterval.
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
//
// A few assertions below pin down *quirks* rather than ideal behavior; each is
// marked with a `QUIRK`/`BUG` comment. They document current behavior so a
// future fix is a deliberate, visible change — the modules themselves are not
// modified here.

import { describe, expect, test } from "bun:test"

import {
  formatAbsolute,
  formatClock,
  formatDuration,
  formatTokens,
  humanizeInterval,
  timeAgo,
  truncateEnd,
  truncateMiddle,
} from "./agent-format"

// ---------------------------------------------------------------------------
// timeAgo
// ---------------------------------------------------------------------------

// Pin Date.now() so thresholds are deterministic (timeAgo calls it directly).
const FIXED_NOW = Date.UTC(2026, 9, 16, 12, 0, 0) // 2026-10-16T12:00:00Z
function withFixedNow<T>(fn: () => T): T {
  const real = Date.now
  Date.now = () => FIXED_NOW
  try {
    return fn()
  } finally {
    Date.now = real
  }
}

describe("timeAgo", () => {
  test("null/undefined/0 -> em-dash placeholder", () => {
    expect(timeAgo(null)).toBe("—")
    expect(timeAgo(undefined)).toBe("—")
    // QUIRK: 0 (epoch) is falsy, so it is treated as "no timestamp" rather
    // than "56 years ago".
    expect(timeAgo(0)).toBe("—")
  })

  test.each([
    [-60_000, "soon"], // future
    [-1, "soon"], // 1ms in the future
    [0, "just now"],
    [4_999, "just now"], // last instant of the "just now" bucket (floor(4.999s)=4)
    [5_000, "5s ago"], // first instant of the "Ns ago" bucket
    [5_999, "5s ago"],
    [6_000, "6s ago"],
    [59_999, "59s ago"],
    [60_000, "1m ago"],
    [119_999, "1m ago"],
    [120_000, "2m ago"],
    [3_599_000, "59m ago"],
    [3_600_000, "1h ago"],
    [3_660_000, "1h ago"], // 61m -> floor(61/60)=1h
    [86_399_000, "23h ago"],
    [86_400_000, "1d ago"],
    [2 * 86_400_000, "2d ago"],
    [29 * 86_400_000, "29d ago"],
  ])("age %sms -> %s", (ageMs, expected) => {
    expect(withFixedNow(() => timeAgo(FIXED_NOW - ageMs))).toBe(expected)
  })

  test("30 days and older falls back to a locale date string", () => {
    const ts = FIXED_NOW - 30 * 86_400_000
    const out = withFixedNow(() => timeAgo(ts))
    // Same expression the module uses — pins that the fallback branch is taken
    // (and that it is NOT the "Nd ago" format).
    expect(out).toBe(new Date(ts).toLocaleDateString())
    expect(out).not.toMatch(/ago$/)
    expect(out).not.toBe("—")
  })

  test("very old timestamps still hit the date fallback", () => {
    const ts = FIXED_NOW - 400 * 86_400_000
    const out = withFixedNow(() => timeAgo(ts))
    expect(out).toBe(new Date(ts).toLocaleDateString())
  })
})

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------

describe("formatTokens", () => {
  test("null/undefined -> em-dash placeholder", () => {
    expect(formatTokens(null)).toBe("—")
    expect(formatTokens(undefined)).toBe("—")
  })

  test.each([
    [0, "0"], // QUIRK: 0 is *not* treated as missing here (unlike timeAgo)
    [-5, "-5"], // negatives below 1k pass through unscaled
    [999, "999"],
    [1_000, "1k"], // 1.0 -> ".0" stripped
    [1_234, "1.2k"],
    [1_500, "1.5k"],
    [1_949, "1.9k"],
    // QUIRK: 1_999 rounds up through toFixed(1) -> "2.0" -> "2" -> "2k"
    [1_999, "2k"],
    [10_000, "10k"],
    // QUIRK: 99_999 -> (99.999).toFixed(1) === "100.0" -> ".0" stripped -> "100k"
    [99_999, "100k"],
    [100_000, "100k"], // >= 100 switches to Math.round
    [999_499, "999k"],
    // QUIRK: values just under 1M render as "1000k" instead of rolling over
    // to "1M" (Math.round(999.999) === 1000 on the k-branch).
    [999_999, "1000k"],
    [1_000_000, "1M"],
    [1_500_000, "1.5M"],
    [9_500_000, "9.5M"],
    [95_000_000, "95M"],
    [150_000_000, "150M"],
    // QUIRK: no "B" unit — a billion tokens renders as "1000M".
    [1_000_000_000, "1000M"],
  ])("%d -> %s", (n, expected) => {
    expect(formatTokens(n)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  test("null/undefined/negative -> em-dash placeholder", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(undefined)).toBe("—")
    expect(formatDuration(-1)).toBe("—")
  })

  test.each([
    [0, "0s"], // 0ms is a valid duration (contrast: timeAgo(0) -> "—")
    [999, "0s"],
    [1_000, "1s"],
    [59_999, "59s"],
    [60_000, "1m"], // no seconds part when remainder is 0
    [90_000, "1m 30s"],
    [121_000, "2m 1s"],
    [3_540_000, "59m"],
    [3_599_000, "59m 59s"],
    [3_600_000, "1h"], // no minutes part when remainder is 0
    [3_660_000, "1h 1m"],
    [7_200_000, "2h"],
    // QUIRK: no day unit — 30 days renders as "720h".
    [30 * 86_400_000, "720h"],
  ])("%dms -> %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// formatClock / formatAbsolute (locale-dependent: assertions are deliberately
// limited to properties the code guarantees — hour12: false means no AM/PM —
// rather than exact separator/label shapes)
// ---------------------------------------------------------------------------

describe("formatClock", () => {
  test("renders 24-hour time with no AM/PM marker", () => {
    const out = formatClock(new Date(2026, 0, 5, 23, 59, 59))
    expect(out).not.toMatch(/am|pm/i)
    // hour12:false forces the h23 cycle: hour 23 must appear as "23",
    // not "11 … PM".
    expect(out).toContain("23")
  })

  test("mirrors toLocaleTimeString(undefined, { hour12: false })", () => {
    const d = new Date(2026, 0, 5, 14, 5, 9)
    expect(formatClock(d)).toBe(d.toLocaleTimeString(undefined, { hour12: false }))
  })

  test("different times produce different strings", () => {
    expect(formatClock(new Date(2026, 0, 5, 1, 2, 3))).not.toBe(
      formatClock(new Date(2026, 0, 5, 4, 5, 6)),
    )
  })
})

describe("formatAbsolute", () => {
  test("null/undefined/0 -> em-dash placeholder", () => {
    expect(formatAbsolute(null)).toBe("—")
    expect(formatAbsolute(undefined)).toBe("—")
    // QUIRK: 0 (epoch) is falsy -> treated as missing (same as timeAgo).
    expect(formatAbsolute(0)).toBe("—")
  })

  test("renders 24-hour time with no AM/PM marker", () => {
    const out = formatAbsolute(new Date(2026, 0, 5, 23, 59, 59).getTime())
    expect(out).not.toMatch(/am|pm/i)
    expect(out).toContain("23")
  })

  test("includes the day-of-month", () => {
    const out = formatAbsolute(new Date(2026, 0, 5, 14, 5, 9).getTime())
    expect(out).toContain("5")
  })

  test("mirrors toLocaleString(undefined, {…}) with the module's options", () => {
    const ts = new Date(2026, 0, 5, 14, 5, 9).getTime()
    expect(formatAbsolute(ts)).toBe(
      new Date(ts).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// humanizeInterval
// ---------------------------------------------------------------------------

describe("humanizeInterval", () => {
  test("null/undefined/0 -> em-dash placeholder", () => {
    expect(humanizeInterval(null)).toBe("—")
    expect(humanizeInterval(undefined)).toBe("—")
    // QUIRK: a 0ms interval is treated as "not set" rather than "every 0s".
    expect(humanizeInterval(0)).toBe("—")
  })

  test.each([
    [3_600_000, "every 1h"],
    [7_200_000, "every 2h"],
    [86_400_000, "every 24h"],
    [60_000, "every 1m"],
    [25 * 60_000, "every 25m"],
    [45_000, "every 45s"],
    [90_000, "every 90s"], // 1.5m does not round to minutes; falls to seconds
    [1_000, "every 1s"],
    [1_234, "every 1s"], // Math.round(1.234)
    [1_500, "every 2s"], // Math.round rounds half up
    // QUIRK: 59_999ms is neither whole hours nor whole minutes, so it renders
    // as "every 60s" instead of "every 1m".
    [59_999, "every 60s"],
    // QUIRK: negative intervals are not rejected — "-1h" can be rendered.
    [-3_600_000, "every -1h"],
  ])("%dms -> %s", (ms, expected) => {
    expect(humanizeInterval(ms)).toBe(expected)
  })

  test("whole hours win over whole minutes", () => {
    // 24h is both a whole-hour and a whole-minute multiple; hours take priority.
    expect(humanizeInterval(24 * 3_600_000)).toBe("every 24h")
  })
})

// ---------------------------------------------------------------------------
// truncateMiddle
// ---------------------------------------------------------------------------

describe("truncateMiddle", () => {
  test("null/undefined/empty -> em-dash placeholder", () => {
    expect(truncateMiddle(null)).toBe("—")
    expect(truncateMiddle(undefined)).toBe("—")
    // QUIRK: "" is falsy -> placeholder rather than "".
    expect(truncateMiddle("")).toBe("—")
  })

  test("strings at or under the limit are returned unchanged", () => {
    expect(truncateMiddle("abc")).toBe("abc") // 3 < default 24
    expect(truncateMiddle("a".repeat(24))).toBe("a".repeat(24)) // exactly max
    expect(truncateMiddle("abc", 3)).toBe("abc")
  })

  test("default max=24 keeps head+tail around an ellipsis", () => {
    const out = truncateMiddle("abcdefghijklmnopqrstuvwxyz0123") // 30 chars
    expect(out).toBe("abcdefghijk…tuvwxyz0123")
    // QUIRK: with an even max (24), half = floor(23/2) = 11, so the output is
    // 23 chars — one shorter than the requested maximum.
    expect(out).toHaveLength(23)
  })

  test("odd max is respected exactly", () => {
    const out = truncateMiddle("abcdefghijklmnopqrstuvwxyz0123", 25)
    // half = floor(24/2) = 12 -> 12 head chars + ellipsis + 12 tail chars
    expect(out).toBe("abcdefghijkl…stuvwxyz0123")
    expect(out).toHaveLength(25)
  })

  test("custom small max", () => {
    expect(truncateMiddle("hello world", 5)).toBe("he…ld")
    expect(truncateMiddle("abcd", 3)).toBe("a…d")
  })

  test("BUG (documented, not fixed): max <= 2 returns a LONGER string", () => {
    // half = floor((max-1)/2) = 0 and s.slice(-0) === s (the whole string),
    // so an 8-char input "truncates" to a 9-char "…abcdefgh".
    expect(truncateMiddle("abcdefgh", 1)).toBe("…abcdefgh")
    expect(truncateMiddle("abcdefgh", 2)).toBe("…abcdefgh")
    expect(truncateMiddle("abcdefgh", 1)).toHaveLength(9)
  })

  test("truncates BMP unicode (CJK) by code unit without corruption", () => {
    const s = "日本語テキストがとても長い場合のテスト" // all BMP chars
    const out = truncateMiddle(s, 10) // half=4 -> 4 + … + 4
    expect(out).toBe("日本語テ…トのテスト".slice(0, 4) + "…" + s.slice(-4))
    expect(out).toHaveLength(9)
  })

  test("QUIRK: truncation is UTF-16 code-unit based and can split surrogate pairs", () => {
    const s = "😀".repeat(5) // 5 emoji = 10 UTF-16 code units
    const out = truncateMiddle(s, 7) // half=3: slices at 3 and -3 split pairs
    expect(out).toHaveLength(7)
    // Unit 2 (0-based) is the now-unpaired high surrogate of the 2nd emoji…
    expect(out.charCodeAt(2)).toBe(0xd83d)
    // …and unit 4 is the unpaired low surrogate of the 4th emoji.
    expect(out.charCodeAt(4)).toBe(0xde00)
  })

  test("very long strings: exactly one ellipsis, correct head and tail", () => {
    const head = "H".repeat(49)
    const tail = "T".repeat(49)
    const s = `${head}MIDDLE${tail}` // 105 chars, max 100 -> half=49
    const out = truncateMiddle(s, 100)
    expect(out).toBe(`${head}…${tail}`)
    expect(out).toHaveLength(99)
    expect(out.split("…")).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// truncateEnd
// ---------------------------------------------------------------------------

describe("truncateEnd", () => {
  test("null/undefined/empty -> em-dash placeholder", () => {
    expect(truncateEnd(null)).toBe("—")
    expect(truncateEnd(undefined)).toBe("—")
    expect(truncateEnd("")).toBe("—")
  })

  test("strings at or under the limit are returned unchanged", () => {
    expect(truncateEnd("abc")).toBe("abc") // 3 < default 90
    expect(truncateEnd("a".repeat(90))).toBe("a".repeat(90)) // exactly max
    expect(truncateEnd("abc", 3)).toBe("abc")
  })

  test("keeps the head and appends an ellipsis", () => {
    expect(truncateEnd("abcdefgh", 2)).toBe("ab…")
    expect(truncateEnd("hello world, this is long", 10)).toBe("hello worl…")
    // QUIRK: the output is max+1 chars — one longer than the requested max.
    expect(truncateEnd("abcdefgh", 2)).toHaveLength(3)
  })

  test("default max is 90", () => {
    const s = "x".repeat(91)
    expect(truncateEnd(s)).toBe(`${"x".repeat(90)}…`)
  })

  test("truncates unicode by code unit (CJK head survives intact)", () => {
    expect(truncateEnd("日本語の長いテキスト", 4)).toBe("日本語の…")
  })

  test("QUIRK: can split a surrogate pair at the cut point", () => {
    const s = "😀".repeat(3) // 6 code units
    const out = truncateEnd(s, 3) // slice(0,3) = 1 emoji + a lone high surrogate
    expect(out).toHaveLength(4)
    expect(out.charCodeAt(2)).toBe(0xd83d)
  })

  test("very long strings", () => {
    const s = `${"a".repeat(90)}bcdefghij`
    expect(truncateEnd(s, 50)).toBe(`${"a".repeat(50)}…`)
    expect(truncateEnd(s, 50)).toHaveLength(51)
  })
})
