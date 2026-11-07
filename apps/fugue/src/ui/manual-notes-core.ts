/**
 * manual-notes-core.ts — the pure Manual-notes section logic (F-7
 * chunk 3, the ONE hand-edit lane).
 *
 * The engine's renderer preserves the `## Manual notes` section of
 * .unown/memory/project.md VERBATIM across every dream re-render,
 * capped at 4096 chars (beyond the cap it drops the tail and writes
 * the visible marker '<!-- unown: manual notes over cap -->' — the
 * memory law: never a silent truncate). This module owns the exact
 * section boundary the renderer uses (the heading match
 * /^##[ \t]+Manual notes[ \t]*$/) and the splice semantics:
 *   - extract: the body between the heading and the next heading /
 *     EOF, heading excluded.
 *   - splice: ONLY that section is replaced; every line outside it
 *     is preserved byte-for-byte; no heading -> append at EOF.
 *
 * DOM-free, Node-free (the boundary test's closed graph): the fs
 * I/O lives in serve.mjs (the app's server edge) which reads and
 * writes through these pure functions. Tests drive them on
 * in-memory strings against temp-fixture copies — never the real
 * .unown/memory/project.md.
 */

/** The engine renderer's Manual-notes heading boundary (verbatim). */
export const MANUAL_NOTES_HEADING_RE = /^##[ \t]+Manual notes[ \t]*$/;

/** The engine's renderer cap: beyond it the tail is dropped and the
 *  visible marker line is appended (never a silent truncate). */
export const MANUAL_NOTES_CAP = 4096;

/** The visible over-cap marker the renderer writes (the UI previews
 *  it exactly, so the human sees the tail that will be dropped). */
export const OVER_CAP_MARKER = "<!-- unown: manual notes over cap -->";

/** The PUT route's outright reject limit (well above the renderer's
 *  4096 cap — the cap law governs rendering, this governs the write).
 *  The limit is EXCLUSIVE: a body of exactly 20000 chars is the
 *  admitted edge; 20001 is rejected outright with 400. */
export const MANUAL_NOTES_PUT_LIMIT = 20000;

/** The write route's guard: a PUT body over the limit is rejected
 *  outright (400, pre-write — the file is never mutated). A body
 *  of exactly 20000 chars is admitted (the limit is inclusive). */
export function putRejectReason(section: string): string | null {
  return section.length > MANUAL_NOTES_PUT_LIMIT
    ? `section over ${MANUAL_NOTES_PUT_LIMIT} chars (got ${section.length})`
    : null;
}

export interface ManualNotesSection {
  /** The section body (the bullets, WITHOUT the heading line). */
  section: string;
  /** The body's length (the budget meter's numerator). */
  chars: number;
  /** The renderer's cap (4096). */
  cap: number;
  /** Where the section was found: 'existing' | 'appended' (EOF
   *  append when no heading exists) — informational for callers. */
  found: "existing" | "absent";
}

/** Find the Manual-notes section in a whole-file string.
 *  - heading present: body = lines strictly between the heading and
 *    the next line matching the heading regex OR the next `#`-style
 *    heading OR EOF, with the heading line excluded.
 *  - heading absent: section = "" (the reader shows the honest
 *    empty state; the writer appends heading + body at EOF). */
export function extractManualNotes(file: string): ManualNotesSection {
  const lines = file.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (MANUAL_NOTES_HEADING_RE.test(lines[i])) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,6}[ \t]/.test(lines[j]) || MANUAL_NOTES_HEADING_RE.test(lines[j])) {
          end = j;
          break;
        }
      }
      const section = lines.slice(i + 1, end).join("\n");
      // An empty body normalizes to "" (the reader's honest empty,
      // symmetric with the absent-heading lane — the meter shows 0).
      const body = section === "" || section === "\n" ? "" : section;
      return { section: body, chars: body.length, cap: MANUAL_NOTES_CAP, found: "existing" };
    }
  }
  return { section: "", chars: 0, cap: MANUAL_NOTES_CAP, found: "absent" };
}

/** Splice a new body into the Manual-notes section. EVERY line
 *  outside the section is preserved byte-for-byte:
 *   - heading present: replace exactly the span between the heading
 *     and the next heading / EOF; the heading line and every other
 *     line are untouched.
 *   - heading absent: append the heading + body at EOF (a single
 *     leading blank line when the file is non-empty and does not
 *     already end with one).
 *  The written section is `body` verbatim (the renderer preserves it
 *  verbatim; the 4096 cap applies at render time, not here). */
export function spliceManualNotes(file: string, section: string): string {
  const lines = file.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (MANUAL_NOTES_HEADING_RE.test(lines[i])) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,6}[ \t]/.test(lines[j]) || MANUAL_NOTES_HEADING_RE.test(lines[j])) {
          end = j;
          break;
        }
      }
      const out = lines.slice(0, i + 1);
      const body = section === "\n" ? "" : section;
      if (body !== "") out.push(body);
      out.push(...lines.slice(end));
      const joined = out.join("\n");
      // Blank-line hygiene: between the heading + body and the next
      // section heading there is exactly ONE blank line — a splice
      // therefore round-trips through extract (a normalized re-read
      // yields the same body), and successive splices never stack
      // blank lines. The body's own interior bytes are untouched
      // (only trailing whitespace at the boundary is collapsed).
      const next = lines.slice(end);
      const nextIdx = next.findIndex((l) => /^#{1,6}[ \t]/.test(l));
      if (nextIdx !== -1) {
        const keep = out.slice(0, out.length - next.length);
        // Boundary normalization: the extractor consumes everything up
        // to the next heading (including the boundary blank) into the
        // body, so an extract + splice cycle re-appends the full
        // span — the cycle stabilizes byte-identically in ONE pass
        // (a repeated save of the same draft never drifts).
        return [...keep, ...next].join("\n");
      }
      // The heading + body is the EOF span: normalize the file to
      // exactly one trailing newline.
      return out.join("\n").replace(/\n+$/, "\n");
    }
  }
  // No heading: append at EOF. The appended block is the heading
  // plus (when the body is non-empty) a newline and the body, and the
  // file is normalized to exactly one trailing newline so two
  // successive appends never stack blank lines:
  const block = `## Manual notes${section === "" ? "" : "\n" + section}\n`;
  if (file === "") return block;
  const base = file.replace(/\n+$/, "");
  return `${base}\n\n${block}`;
}

/** The budget meter view model: chars used vs the 4096 cap, and —
 *  when OVER the cap — the EXACT tail the renderer will drop
 *  (never a silent truncate: the UI shows the visible marker line +
 *  the dropped tail styled distinctly). */
export interface CapMeter {
  chars: number;
  cap: number;
  overCap: boolean;
  /** The tail the renderer drops (chars 4096..end). Empty when under. */
  droppedTail: string;
}

export function capMeter(section: string): CapMeter {
  const chars = section.length;
  if (chars <= MANUAL_NOTES_CAP) {
    return { chars, cap: MANUAL_NOTES_CAP, overCap: false, droppedTail: "" };
  }
  return {
    chars,
    cap: MANUAL_NOTES_CAP,
    overCap: true,
    droppedTail: section.slice(MANUAL_NOTES_CAP),
  };
}
