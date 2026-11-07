/**
 * manual-notes-core.test.ts — the Manual-notes section logic's Lane A
 * pins (F-7 chunk 3, the ONE hand-edit lane). Drives the pure
 * extract / splice / cap-meter functions over in-memory strings
 * (temp-fixture semantics — NEVER the real .unown/memory/project.md):
 *
 *   - section extraction: heading present (mid-file, EOF) / heading
 *     absent (the honest empty), the engine renderer's boundary
 *     (/^##[ \t]+Manual notes[ \t]*$/; the section ends at the next
 *     heading or EOF, the heading line excluded).
 *   - the splice preservation law: EVERY line outside the section is
 *     byte-identical (pinned line-by-line); no heading -> append at
 *     EOF (heading + body); an empty body removes the span, not the
 *     heading.
 *   - the cap meter + the over-marker view model: under / at / over
 *     the 4096 cap, and — when over — the EXACT tail the renderer
 *     will drop (never a silent truncate: the marker + the tail are
 *     surfaced distinctly).
 *
 * The server edge (serve.mjs) reads and writes through these same
 * semantics; the fs I/O itself is exercised through temp files in
 * test/manual-notes-server.test.ts.
 */
import { describe, test, expect } from "bun:test";
import {
  extractManualNotes,
  spliceManualNotes,
  capMeter,
  MANUAL_NOTES_CAP,
  OVER_CAP_MARKER,
  MANUAL_NOTES_HEADING_RE,
} from "./manual-notes-core.js";

/** The three-section fixture: two known headings bracket the target
 *  section, so the splice-preservation pin is unambiguous. */
const FIXTURE = [
  "# Project Memory",
  "",
  "## Known pitfalls",
  "- pitfall one",
  "- pitfall two",
  "",
  "## Manual notes",
  "- bullet A",
  "- bullet B",
  "",
  "## Facts",
  "- fact one",
].join("\n");

describe("the heading boundary (the engine renderer's law)", () => {
  test("the heading regex matches the exact engine boundary", () => {
    expect(MANUAL_NOTES_HEADING_RE.test("## Manual notes")).toBe(true);
    expect(MANUAL_NOTES_HEADING_RE.test("##\tManual notes")).toBe(true); // tab
    expect(MANUAL_NOTES_HEADING_RE.test("## Manual notes  ")).toBe(true); // trailing spaces
    expect(MANUAL_NOTES_HEADING_RE.test("# Manual notes")).toBe(false); // H1
    expect(MANUAL_NOTES_HEADING_RE.test("### Manual notes")).toBe(false); // H3
    expect(MANUAL_NOTES_HEADING_RE.test("## Manual notes x")).toBe(false); // suffix
    expect(MANUAL_NOTES_HEADING_RE.test("## manual notes")).toBe(false); // case
  });
});

describe("section extraction", () => {
  test("heading present mid-file: the body between the heading and the next heading (heading excluded)", () => {
    const { section, found } = extractManualNotes(FIXTURE);
    expect(found).toBe("existing");
    expect(section).toBe("- bullet A\n- bullet B\n");
    expect(section).not.toContain("Manual notes");
    expect(section).not.toContain("fact one");
    expect(section).not.toContain("pitfall one");
  });

  test("heading at EOF (no next heading): the body runs to the end of the file", () => {
    const file = [
      "## Manual notes",
      "- last bullet",
      "",
      "## Facts",
      "- fact one",
    ].join("\n");
    const { section, found } = extractManualNotes(file);
    expect(found).toBe("existing");
    // The body between the heading and the next heading — the blank
    // separator line is part of the span, but an all-blank body
    // normalizes to "" (the meter's 0 — symmetric with absent).
    const { section: s2 } = extractManualNotes("## Manual notes\n\n## Facts");
    expect(s2).toBe("");
    expect(section.trim()).toBe("- last bullet");
  });

  test("heading absent: the honest empty section (the reader shows the empty state, the writer appends)", () => {
    const { section, found, chars } = extractManualNotes(FIXTURE.replace("## Manual notes", "## Other section"));
    expect(found).toBe("absent");
    expect(section).toBe("");
    expect(chars).toBe(0);
  });

  test("the chars count mirrors the section length", () => {
    const { section, chars } = extractManualNotes(FIXTURE);
    expect(chars).toBe(section.length);
  });
});

describe("the splice preservation law (byte-for-byte outside the section)", () => {
  test("replacing the section: every line OUTSIDE it is byte-identical", () => {
    const out = spliceManualNotes(FIXTURE, "- bullet C\n- bullet D");
    const lines = out.split("\n");
    // The sections BEFORE the Manual notes heading are untouched.
    expect(lines.slice(0, 6)).toEqual(FIXTURE.split("\n").slice(0, 6));
    // The heading line itself is preserved.
    expect(lines[6]).toBe("## Manual notes");
    // The new body lands exactly in the span.
    expect(lines[7]).toBe("- bullet C");
    expect(lines[8]).toBe("- bullet D");
    // The sections AFTER are untouched (the Facts section
    // byte-identical — the boundary blank between the body and the
    // next heading is part of the replaced span).
    expect(lines.slice(9)).toEqual(FIXTURE.split("\n").slice(10));
  });

  test("an empty body drops the span but KEEPS the heading (the renderer still owns the section)", () => {
    const out = spliceManualNotes(FIXTURE, "");
    const lines = out.split("\n");
    expect(lines[6]).toBe("## Manual notes");
    expect(lines[7]).toBe("## Facts"); // the heading is directly followed by the next section
    // Everything before the heading is byte-identical.
    expect(lines.slice(0, 6)).toEqual(FIXTURE.split("\n").slice(0, 6));
    // The Facts section is byte-identical, directly after the heading
    // (the span — body lines + boundary blank — was dropped whole).
    expect(lines.slice(7)).toEqual(FIXTURE.split("\n").slice(10));
  });

  test("no heading: the section appends at EOF (heading + body), the file body untouched", () => {
    const file = FIXTURE.replace("## Manual notes\n- bullet A\n- bullet B\n", "");
    const out = spliceManualNotes(file, "- appended");
    const lines = out.split("\n");
    // The original file (minus its removed section) is the prefix.
    expect(lines.slice(0, 6)).toEqual(file.split("\n").slice(0, 6));
    // The appended block: exactly one blank line before the heading.
    const headingIdx = lines.indexOf("## Manual notes");
    expect(lines[headingIdx - 1]).toBe("");
    expect(lines[headingIdx + 1]).toBe("- appended");
    // The Facts section survived byte-identical before the append.
    expect(lines).toContain("- fact one");
  });

  test("idempotence: an extract + splice cycle stabilizes after one pass (the PUT route's read-modify-write is stable)", () => {
    const out = spliceManualNotes(FIXTURE, "- new");
    const section = extractManualNotes(out).section;
    const re = spliceManualNotes(out, section);
    // A second cycle is byte-identical to the first — the cycle
    // stabilizes (a repeated save of the same draft never drifts).
    const re2 = spliceManualNotes(re, extractManualNotes(re).section);
    expect(re2).toBe(re);
  });

  test("the normalize-equality law: extract after splice is a stable round-trip", () => {
    const out = spliceManualNotes(FIXTURE, "");
    const { section } = extractManualNotes(out);
    expect(section).toBe(""); // the empty-body normalization is stable
  });
});

describe("the cap meter + the over-marker view model (never a silent truncate)", () => {
  test("under the cap: no marker, no dropped tail", () => {
    const m = capMeter("short body");
    expect(m.chars).toBe(10);
    expect(m.cap).toBe(MANUAL_NOTES_CAP);
    expect(m.overCap).toBe(false);
    expect(m.droppedTail).toBe("");
  });

  test("at the cap exactly: still under (the cap is inclusive)", () => {
    const body = "a".repeat(MANUAL_NOTES_CAP);
    const m = capMeter(body);
    expect(m.overCap).toBe(false);
    expect(m.droppedTail).toBe("");
  });

  test("one past the cap: the marker surfaces + the EXACT dropped tail", () => {
    const body = "a".repeat(MANUAL_NOTES_CAP) + "TAIL";
    const m = capMeter(body);
    expect(m.overCap).toBe(true);
    expect(m.droppedTail).toBe("TAIL");
    expect(m.chars).toBe(MANUAL_NOTES_CAP + 4);
    // The marker constant is the renderer's verbatim line — the UI
    // previews exactly what the renderer writes.
    expect(OVER_CAP_MARKER).toBe("<!-- unown: manual notes over cap -->");
  });

  test("a large over-cap body: the dropped tail is the slice past 4096", () => {
    const body = "x".repeat(4096) + "yyyy";
    const m = capMeter(body);
    expect(m.droppedTail).toBe("yyyy");
    expect(m.droppedTail).not.toContain("x");
  });
});
