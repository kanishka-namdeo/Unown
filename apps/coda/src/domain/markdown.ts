/**
 * Coda markdown round-trip — a Note serialized to `.md` text with a
 * frontmatter-style header, and back, LOSSLESS.
 *
 * Format (one note = one file):
 *
 *     ---
 *     id: n1
 *     createdAt: 2026-01-01T00:00:00.000Z
 *     updatedAt: 2026-01-02T00:00:00.000Z
 *     tags: ["alpha","beta"]
 *     ---
 *     # <title>          ← ALWAYS emitted (even when title is empty → "# ")
 *
 *     <body, verbatim>
 *
 * Grammar choices that make the round-trip total (every note maps to
 * exactly one .md text and back):
 *
 *  1. The header block is delimited by `---` lines. The parser looks for
 *     the FIRST closing `---` after line 0. Anything after that — even
 *     further `---` lines — is part of the body.
 *  2. The title line is ALWAYS present, always starts with `# `, and is
 *     the first non-blank line after the closing `---`. An empty title
 *     renders as the literal `# ` (a heading with a trailing space), so
 *     a body that starts with `# ...` can never be mistaken for the
 *     title line — we always consume exactly one such line.
 *  3. The body is written VERBATIM after a single blank line following
 *     the title. Any body content (including `---`, code fences, blank
 *     lines at the start or end) survives byte-for-byte.
 *  4. `tags` is a JSON array of strings, so any character in a tag
 *     survives (quotes, brackets, unicode, etc.).
 */

import type { Note } from "./types";

export class MarkdownParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownParseError";
  }
}

export function noteToMarkdown(note: Note): string {
  const tags = note.tags.length === 0 ? "[]" : JSON.stringify(note.tags);
  const head = [
    "---",
    `id: ${note.id}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    `tags: ${tags}`,
    "---",
    `# ${note.title}`,
  ].join("\n");
  return head + "\n" + note.body;
}

export function markdownToNote(text: string): Note {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    throw new MarkdownParseError("missing opening --- delimiter");
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new MarkdownParseError("missing closing --- delimiter");
  }

  const header = lines.slice(1, end);
  const fields: Record<string, string> = {};
  for (const line of header) {
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!m) {
      throw new MarkdownParseError(`malformed header line: ${JSON.stringify(line)}`);
    }
    fields[m[1]] = m[2];
  }
  for (const req of ["id", "createdAt", "updatedAt"] as const) {
    if (fields[req] === undefined) {
      throw new MarkdownParseError(`missing header field: ${req}`);
    }
  }

  let tags: string[] = [];
  if (fields.tags !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fields.tags);
    } catch {
      throw new MarkdownParseError(`tags field is not valid JSON: ${fields.tags}`);
    }
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string")) {
      throw new MarkdownParseError("tags field is not a JSON array of strings");
    }
    tags = parsed as string[];
  }

  // Layout after the closing --- (see noteToMarkdown):
  //   lines[end+1] = "# <title>"            ALWAYS exactly one line
  //   lines[end+2..] = body lines, VERBATIM to EOF
  // noteToMarkdown writes `head + "\n" + body`, so the title line and
  // the first body line are separated by exactly that one "\n" and the
  // body keeps every line it had — including leading blank lines.
  const afterHeader = lines.slice(end + 1);
  const titleLine = afterHeader[0];
  if (typeof titleLine !== "string" || !titleLine.startsWith("# ")) {
    throw new MarkdownParseError("expected a '# ' title line after the header");
  }
  const title = titleLine.slice(2);
  const body = afterHeader.slice(1).join("\n");

  return {
    id: fields.id,
    title,
    body,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
    tags,
  };
}