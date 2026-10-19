// Landing claims: the engine's JOB_DEFS -> src/components/landing/engine-data.ts,
// plus the gate that keeps the page's quoted artifacts honest.
//
//   node scripts/landing_claims.mjs           write engine-data.ts, then run the gates
//   node scripts/landing_claims.mjs --check   verify the committed file, run the gates, write nothing
//
// Same wiring as scripts/landing_changelog.mjs, applied to engine code instead
// of prose, because src/components/landing/ hand-copies engine facts twice
// over and the audit found several copies had already silently diverged:
//
//   - origin.tsx's job list and mechanisms.tsx's "five on a timer, two on
//     events" restate `export const JOB_DEFS` in
//     pi-repo/packages/self-learning/src/router.ts. That data is generated,
//     not authored: engine-data.ts is this script's output, never hand-edited,
//     and --check fails when the committed file no longer matches JOB_DEFS.
//   - integrity.tsx's LOG rows, loop.tsx's BEATS bodies and hero.tsx's
//     COMMANDS list and slash-command sentence quote literals the engine
//     writes. The gate re-reads both sides and fails on any quoted literal
//     that no longer resolves in the source it claims: hook/log strings
//     against hooks.ts + termhooks.ts + harness.ts (harness calls hooks.ts's
//     logHook with its own lines), command names against the HELP block in
//     cli.ts.
//
// The two matching rules the gate lives or dies on:
//
//   - INTERPOLATED LITERALS. hooks.ts logs `session started (memory
//     v${ctx.memoryVersion})` and the page pins one instance ("v6"). Exact
//     whole-string equality would cry wolf, so a literal passes when it starts
//     with the template's prefix before the first `${`, or shares a long
//     contiguous window with one of the template's fixed segments (the page
//     also hard-wraps entries: a wrap tail is re-checked joined with the line
//     above before it may FAIL). Typographic curly quotes are folded to
//     straight ones — they are display, not claim.
//   - ONE-DIRECTIONAL. HELP is a superset: the page deliberately omits
//     commands. The gate asserts page -> source, never source -> page; a
//     completeness check here would fail every commit and get the gate
//     ignored, which is worse than no gate.
//
// Parsing is deliberate. The JOB_DEFS extractor walks the array's braces
// instead of importing engine TS from a node script, and a run that extracts
// zero jobs, a job without an id, or an interval job without a schedule is a
// HARD failure, not an empty success — a regex so permissive that a malformed
// file yields nothing would turn the generator into a silent liar.
//
// Dependency-free node builtins; split on /\r?\n/ (this checkout is CRLF under
// core.autocrlf while the blobs are LF); comparisons are EOL- and
// whitespace-normalised so the gate cannot fail over formatting alone.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = "pi-repo/packages/self-learning/src";
const ROUTER = `${ENGINE}/router.ts`;
const TARGET = join(ROOT, "src/components/landing/engine-data.ts");
const TARGET_REL = "src/components/landing/engine-data.ts";

/** Page files the gate reads, keyed for the routes below. The commands and
 *  slash chips live in hero.tsx since the 2026-10-20 merge (the quickstart
 *  section folded into the hero's collapsed expanders). */
const PAGES = {
  integrity: "src/components/landing/integrity.tsx",
  loop: "src/components/landing/loop.tsx",
  hero: "src/components/landing/hero.tsx",
};

/** Engine sources, by the name a FAIL line prints. */
const SOURCES = {
  hooks: { rel: `${ENGINE}/hooks.ts`, name: `${ENGINE}/hooks.ts` },
  termhooks: { rel: `${ENGINE}/termhooks.ts`, name: `${ENGINE}/termhooks.ts` },
  harness: { rel: `${ENGINE}/harness.ts`, name: `${ENGINE}/harness.ts` },
  help: { rel: `${ENGINE}/cli.ts`, name: `${ENGINE}/cli.ts (HELP)` },
  /**
   * The loop section's "dream" beat quotes this repository's own project memory
   * and calls the lines verbatim. AutoDream rewrites that file on a schedule, so
   * the claim is exactly the kind that goes stale on its own — it is gated here
   * rather than exempted.
   */
  memory: { rel: ".unown/memory/project.md", name: ".unown/memory/project.md" },
};

/**
 * Minimum length for a template prefix or middle segment to count as a match.
 * Below this a prefix like "candidate" would let a paraphrased log line pass,
 * and the gate exists to catch exactly that class of quiet lie.
 */
const MIN_LITERAL = 12;

/** Thrown, not exited: the failure modes are the point of the unit test. */
class ClaimsError extends Error {}
const fail = (msg) => {
  throw new ClaimsError(`landing_claims: ${msg}`);
};

const read = (rel) => {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch {
    return fail(`cannot read ${rel}`);
  }
};

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */

const collapse = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Fold typographic quotes to the straight ones the source uses: the page sets
 * quotations the way a designer would, and curly-vs-straight is display, not
 * claim. Em-dashes are deliberately NOT folded: a page that quotes " - " where
 * the engine logs " — " has changed the artifact, and that is a finding.
 */
const fold = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

/* ------------------------------------------------------------------ */
/* generator: router.ts JOB_DEFS -> engine-data.ts                     */
/* ------------------------------------------------------------------ */

/** The balanced `[...]` array literal that JOB_DEFS is assigned to. */
function jobDefsArray(src) {
  const marker = src.match(/export const JOB_DEFS\s*(?::[^=]*)?=\s*\[/);
  if (!marker) {
    fail("no `export const JOB_DEFS` in router.ts — this extractor broke, the engine did not");
  }
  const open = marker.index + marker[0].length - 1; // the `[` itself
  let depth = 0;
  let q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  fail("the JOB_DEFS array literal never closes in router.ts");
}

/** The top-level `{...}` object chunks inside the array text. String-aware so
 *  a brace in a description cannot split a job in half. */
function objectChunks(arrayText) {
  const body = arrayText.slice(1, arrayText.lastIndexOf("]"));
  const out = [];
  let depth = 0;
  let q = null;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/** `10 * 60_000` and friends — only integer factors, the forms the engine
 *  actually writes. Anything else fails loudly rather than guesses. */
function scheduleMs(chunk, id) {
  const m = chunk.match(/(?:^|\n)\s*scheduleMs:\s*([^,\n]+)/);
  if (!m) fail(`interval job "${id}" declares no scheduleMs — its page interval would be invented`);
  const expr = m[1].trim();
  if (!/^[\d_]+(?:\s*\*\s*[\d_]+)*$/.test(expr)) {
    fail(`interval job "${id}" has a scheduleMs this extractor cannot read: ${expr}`);
  }
  return expr.split(/\s*\*\s*/).reduce((n, part) => n * Number(part.replace(/_/g, "")), 1);
}

/** Human interval as the page renders it: 600000 -> "10m". */
function humanizeMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) fail(`schedule expression evaluated to ${ms}`);
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

/** The line-anchored field getter: `\bid:` inside a description must not pass
 *  for the id field, so fields are only read where TypeScript puts them. */
function field(chunk, name) {
  return chunk.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*"([^"]*)"`));
}

function parseJob(chunk, index) {
  const idM = field(chunk, "id");
  if (!idM) {
    fail(`JOB_DEFS entry #${index + 1} has no id — a job the page cannot name is a job that moved silently`);
  }
  const id = idM[1];
  const kindM = field(chunk, "kind");
  const kind = kindM && (kindM[1] === "interval" || kindM[1] === "event") ? kindM[1] : null;
  if (!kind) fail(`job "${id}" declares no kind "interval"/"event"`);
  const eventM = field(chunk, "event");
  if (kind === "event" && !eventM) fail(`event job "${id}" declares no event name`);
  return {
    id,
    kind,
    interval: kind === "interval" ? humanizeMs(scheduleMs(chunk, id)) : null,
    event: eventM ? eventM[1] : null,
  };
}

/** JOB_DEFS text -> the job list. Zero jobs is a hard failure, never a pass. */
function parseJobDefs(src) {
  const chunks = objectChunks(jobDefsArray(src));
  if (!chunks.length) {
    fail("JOB_DEFS extracted ZERO jobs — an empty job list is the extractor breaking, not a fact about the engine");
  }
  const jobs = chunks.map(parseJob);
  if (new Set(jobs.map((j) => j.id)).size !== jobs.length) fail("JOB_DEFS declares duplicate job ids");
  return jobs;
}

function buildJobsData(jobs) {
  const counts = {
    total: jobs.length,
    interval: jobs.filter((j) => j.kind === "interval").length,
    event: jobs.filter((j) => j.kind === "event").length,
  };
  if (!counts.interval) fail("no interval jobs in JOB_DEFS — the page's on-a-timer claim would be a lie");
  return { jobs, counts };
}

/* ------------------------------------------------------------------ */
/* emitting                                                            */
/* ------------------------------------------------------------------ */

const emitData = (data) => `// GENERATED by scripts/landing_claims.mjs from the engine's JOB_DEFS — do not hand-edit.
// Regenerate after any router.ts JOB_DEFS edit:  bun scripts/landing_claims.mjs
// CI gate:                                      bun scripts/landing_claims.mjs --check
//
// The landing page's background-jobs claims (origin.tsx's job list,
// mechanisms.tsx's on-timer/on-event tallies) are facts about JOB_DEFS in
// pi-repo/packages/self-learning/src/router.ts, so they are read from it here
// instead of retyped in a component. The counts are derived, never authored:
// the page cannot claim a job the engine does not run.

export interface EngineJob {
  /** The JOB_DEFS id, verbatim. */
  id: string;
  /** Human interval ("10m") for an interval job; null for an event job. */
  interval: string | null;
  /** Event name ("improvement:shipped") for an event job; null otherwise. */
  event: string | null;
  kind: "interval" | "event";
}

export const ENGINE_JOBS: EngineJob[] = ${JSON.stringify(data.jobs, null, 2)};

export const ENGINE_JOB_COUNTS: { total: number; interval: number; event: number } = ${JSON.stringify(data.counts, null, 2)};
`;

/* ------------------------------------------------------------------ */
/* page extraction: the claim literals, with their line in the page    */
/* ------------------------------------------------------------------ */

/** integrity.tsx LOG rows: [hook, decision, literal] triples. Entries are
 *  bracket-parsed over the whole section, not line-matched: prettier splits a
 *  long entry across lines, and a line-based parser would silently drop it —
 *  a dropped row is a claim the gate stopped checking, which is how the gate
 *  becomes decorative. Reported line is the entry's opening line. */
function parseHookLog(text) {
  const start = text.search(/const LOG\s*=\s*\[/);
  if (start < 0) fail(`${PAGES.integrity}: no \`const LOG = [\` block to gate against`);
  const end = text.indexOf("] as const", start);
  if (end < 0) fail(`${PAGES.integrity}: the LOG array never closes with \`] as const\``);
  const section = text.slice(start, end);
  const baseLine = text.slice(0, start).split(/\r?\n/).length;
  const rows = [];
  const entry = /\[\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\s*,?\s*\]/g;
  for (let m = entry.exec(section); m; m = entry.exec(section)) {
    const line = baseLine + (section.slice(0, m.index).match(/\n/g) ?? []).length;
    rows.push({ line, hook: m[1], literal: m[3] });
  }
  if (!rows.length) fail(`${PAGES.integrity}: the LOG array did not parse — the rows moved or the quoting changed`);
  return rows;
}

/** loop.tsx: the authored lines of one beat's `body: [...]` block. Blank
 *  lines and bare `...` pacing markers are layout, not claims, and are
 *  skipped; everything else the beat prints is held to the source. */
function parseBeats(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`key:\\s*"${key}"`).test(l));
  if (start < 0) fail(`${PAGES.loop}: no BEATS entry with key "${key}"`);
  const out = [];
  let inBody = false;
  for (let i = start; i < lines.length; i++) {
    if (!inBody) {
      if (/body:\s*\[/.test(lines[i])) inBody = true;
      continue;
    }
    if (/\.join\(/.test(lines[i])) break;
    const m = lines[i].match(/^\s*"((?:[^"\\]|\\.)*)",?\s*$/);
    if (!m) continue;
    const literal = m[1].replace(/\\"/g, '"');
    const t = literal.trim();
    if (!t || /^\.+…?$/.test(t)) continue;
    out.push({ line: i + 1, literal });
  }
  if (!out.length) fail(`${PAGES.loop}: the "${key}" beat carries no parsable body lines`);
  return out;
}

/** hero.tsx COMMANDS rows: the command string each row shows. */
function parseCommands(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    if (!inside) {
      if (/const COMMANDS/.test(lines[i])) inside = true;
      continue;
    }
    if (/^\s*\];/.test(lines[i])) break;
    const m = lines[i].match(/^\s*\[(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*,/);
    if (m) out.push({ line: i + 1, cmd: m[2] });
  }
  if (!out.length) fail(`${PAGES.hero}: the COMMANDS array did not parse`);
  return out;
}

/** hero.tsx's slash-command sentence: every `<code>/name</code>` chip. */
function parseSlashCommands(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/<code[^>]*>(\/[a-z][a-z0-9-]*)\s*<\/code>/g)) {
      out.push({ line: i + 1, cmd: m[1] });
    }
  }
  if (!out.length) fail(`${PAGES.hero}: no slash-command <code> chips found — the sentence moved`);
  return out;
}

/** The HELP template body in cli.ts — the superset the page quotes from. */
function helpBody(cliText) {
  const m = cliText.match(/const HELP = `([\s\S]*?)`;/);
  if (!m) fail(`${SOURCES.help.rel}: no \`const HELP = \`…\`\` block to gate against`);
  return m[1];
}

/**
 * The command NAME a page row claims: the first two words outside quotes
 * ("unown setup", "unown -p", "unown mcp"; the server args after `mcp` are
 * arguments, not part of the name). Only the name is gated against HELP.
 */
function commandClaim(cmd) {
  const words = [];
  for (const w of cmd.split(/\s+/)) {
    if (/^["'`]/.test(w) || words.length === 2) break;
    words.push(w);
  }
  return words.join(" ");
}

/* ------------------------------------------------------------------ */
/* matching: page literal -> engine source                               */
/* ------------------------------------------------------------------ */

/**
 * A tiny TS-aware walker. It skips comments, single/double-quoted strings and
 * `${…}` nesting, and returns only REAL template literals, each as the list of
 * its fixed segments — the text outside every `${…}`. Segment 0 is the
 * template PREFIX the page's pinned instance must start with. This must be a
 * walker, not a backtick-pair scan: these files carry odd numbers of backticks
 * (doc comments quote `session_start` and friends), which derails pair-scanning
 * and makes every template-dependent claim fail — the gate crying wolf is the
 * documented failure mode this exists to avoid. Known shortcut: a regex
 * literal containing unbalanced braces or backticks inside an interpolation
 * would confuse the depth walk; that costs a segment match (visible as a FAIL
 * to fix), never a false pass.
 */
function extractTemplates(text) {
  return scanCode(text, 0, 0).templates;
}

/** Scan code text; `depth` > 0 means we are inside a `${…}` with that many
 *  open braces and stop when it closes. */
function scanCode(text, i, depth) {
  const templates = [];
  while (i < text.length) {
    const c = text[i];
    if (depth > 0 && c === "}") {
      depth--;
      if (depth === 0) return { templates, next: i + 1 };
      i++;
      continue;
    }
    if (depth > 0 && c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const e = text.indexOf("\n", i);
      i = e < 0 ? text.length : e;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      i = e < 0 ? text.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === c || text[i] === "\n") break;
        else i++;
      }
      i++;
      continue;
    }
    if (c === "`") {
      const r = readTemplate(text, i + 1);
      templates.push(...r.templates);
      i = r.next;
      continue;
    }
    i++;
  }
  return { templates, next: i };
}

/** Read one template literal starting just after its opening backtick. */
function readTemplate(text, i) {
  const own = [];
  const nested = [];
  let cur = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      cur += text[i + 1] ?? "\\";
      i += 2;
      continue;
    }
    if (c === "`") {
      own.push(collapse(fold(cur)));
      const segs = own.filter((s) => s.length);
      return { templates: segs.length ? [segs, ...nested] : nested, next: i + 1 };
    }
    if (c === "$" && text[i + 1] === "{") {
      own.push(collapse(fold(cur)));
      cur = "";
      const r = scanCode(text, i + 2, 1);
      nested.push(...r.templates); // nested templates are their own claim sets
      i = r.next;
      continue;
    }
    cur += c;
    i++;
  }
  own.push(collapse(fold(cur))); // unterminated template: report nothing extra;
  const segs = own.filter((s) => s.length);
  return { templates: segs.length ? [segs, ...nested] : nested, next: i };
}

/** A source bundle pre-computed for matching: name for FAIL lines, collapsed
 *  folded full text for verbatim runs, templates for interpolated ones. */
function buildSource(name, text) {
  return { name, text, compact: fold(collapse(text)), templates: extractTemplates(text) };
}

/**
 * Does a page literal resolve in any of these sources?
 *   1. verbatim: the literal (whitespace-collapsed) is a contiguous run of the
 *      source — this is what lets a page that hard-wraps a long engine string
 *      match one authored line of it;
 *   2. template prefix: the literal STARTS WITH a template's text before the
 *      first `${` — the page pins one instance ("v6") of a rendered line, and
 *      matching the whole rendered string would cry wolf;
 *   3. shared window: the literal and one of the template's fixed segments
 *      share MIN_LITERAL contiguous characters — the page may pin an instance
 *      AND wrap the entry, so the overlap can sit mid-segment at either end.
 *      An instance-shaped paraphrase ("candidate passed") shares no 12-char
 *      window with the real line and still fails, which is the point.
 */
function matchLiteral(literal, bundles) {
  const L = fold(collapse(literal));
  if (!L) return bundles[0] ?? null;
  for (const b of bundles) {
    if (b.compact.includes(L)) return b;
    for (const segs of b.templates) {
      if (segs[0] && segs[0].length >= MIN_LITERAL && L.startsWith(segs[0])) return b;
      for (const seg of segs) {
        if (seg.length >= MIN_LITERAL && sharedWindow(L, seg)) return b;
      }
    }
  }
  return null;
}

/** Any window(L) of MIN_LITERAL chars present inside the segment. */
function sharedWindow(L, seg) {
  for (let i = 0; i + MIN_LITERAL <= L.length; i++) {
    if (seg.includes(L.slice(i, i + MIN_LITERAL))) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* the gate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Check a beat's authored lines in reading order. The page hard-wraps long
 * engine log entries to display width, so a wrap tail is not a claim on its
 * own — it is re-checked joined with the line above before it may FAIL. Only
 * the BEATS routes chain: command rows and LOG rows are complete artifacts
 * each, and chaining those could mask a stale command behind its neighbour.
 */
function matchRows(rows, bundles) {
  const failures = [];
  let prev = null;
  for (const row of rows) {
    const literal = row.match ?? row.literal ?? row.cmd;
    const ok =
      matchLiteral(literal, bundles) !== null ||
      (prev !== null && matchLiteral(`${prev} ${literal}`, bundles) !== null);
    if (!ok) failures.push({ line: row.line, literal });
    prev = literal;
  }
  return failures;
}

/**
 * Assert every claim literal the current page text quotes, in the direction
 * page -> source and nothing back. `pages` and `sources` are name -> text
 * maps so the fixtures can feed fake files; the routes below are the claim
 * map from the landing page's quoted artifacts to the engine sources that
 * write them. The loop's "dream" beat is gated too, against
 * .unown/memory/project.md: AutoDream rewrites that file on purpose, which is
 * the reason to check the quote rather than the reason to skip it.
 */
function gate(pages, sources) {
  for (const key of Object.values(PAGES)) {
    if (pages[key] === undefined) fail(`gate: no page text for ${key}`);
  }
  const routes = [
    // Hook-log rows: the reason strings hooks.ts and termhooks.ts write, plus
    // the ones harness.ts passes through hooks.ts's logHook — the page says
    // "taken from `hooks.ts` or `harness.ts` with the ids filled in", and the
    // gate checks exactly the sources the page claims.
    { page: PAGES.integrity, rows: parseHookLog(pages[PAGES.integrity]), bundles: [sources.hooks, sources.termhooks, sources.harness] },
    { page: PAGES.loop, rows: parseBeats(pages[PAGES.loop], "work"), bundles: [sources.termhooks], chained: true },
    { page: PAGES.loop, rows: parseBeats(pages[PAGES.loop], "learn"), bundles: [sources.harness], chained: true },
    // The dream beat quotes this repository's own project memory and calls the
    // lines verbatim. AutoDream rewrites that file on a schedule, which is
    // precisely why it is gated rather than exempted: each line must appear as
    // written, so no chaining and no prefix leniency.
    { page: PAGES.loop, rows: parseBeats(pages[PAGES.loop], "dream"), bundles: [sources.memory] },
    {
      page: PAGES.hero,
      rows: parseCommands(pages[PAGES.hero]).map((r) => ({ ...r, match: commandClaim(r.cmd) })),
      bundles: [sources.help],
    },
    { page: PAGES.hero, rows: parseSlashCommands(pages[PAGES.hero]), bundles: [sources.help] },
  ];
  const failures = [];
  let checked = 0;
  for (const route of routes) {
    checked += route.rows.length;
    const literalOf = (row) => row.match ?? row.literal ?? row.cmd;
    const bad = route.chained
      ? matchRows(route.rows, route.bundles)
      : route.rows
          .filter((row) => !matchLiteral(literalOf(row), route.bundles))
          .map((row) => ({ line: row.line, literal: literalOf(row) }));
    for (const f of bad) {
      failures.push({ page: route.page, line: f.line, literal: f.literal, sources: route.bundles.map((b) => b.name) });
    }
  }
  return { failures, checked };
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One line per failure, the shape CI output is read for:
 *  FAIL  <file>:<line>  "<the literal the page shows>"  not found in <source file> */
const renderFailure = (f) =>
  `FAIL  ${f.page}:${f.line}  "${clip(collapse(f.literal), 72)}"  not found in ${f.sources.join(" or ")}`;

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

function run(check) {
  const data = buildJobsData(parseJobDefs(read(ROUTER)));
  const out = emitData(data);
  const jobLine = `${data.counts.total} jobs (${data.counts.interval} interval, ${data.counts.event} event)`;
  let exit = 0;

  const norm = (s) => s.replace(/\r\n/g, "\n");
  if (check) {
    let current = null;
    try {
      current = readFileSync(TARGET, "utf8");
    } catch {
      /* missing is the failure below, not a crash */
    }
    if (current === null) {
      console.log(`FAIL  ${TARGET_REL}  generated file is missing  run: node scripts/landing_claims.mjs`);
      exit = 1;
    } else if (norm(current) !== norm(out)) {
      console.log(
        `FAIL  ${TARGET_REL}  the committed jobs data no longer matches JOB_DEFS  regenerate: node scripts/landing_claims.mjs`,
      );
      exit = 1;
    } else {
      console.log(`ok  engine-data matches JOB_DEFS: ${jobLine}`);
    }
  } else {
    mkdirSync(dirname(TARGET), { recursive: true });
    writeFileSync(TARGET, out);
    console.log(`wrote ${TARGET_REL}: ${jobLine}`);
  }

  const pages = Object.fromEntries(Object.entries(PAGES).map(([k, p]) => [p, read(p)]));
  const helpText = helpBody(read(SOURCES.help.rel));
  const srcBundles = {
    hooks: buildSource(SOURCES.hooks.name, read(SOURCES.hooks.rel)),
    termhooks: buildSource(SOURCES.termhooks.name, read(SOURCES.termhooks.rel)),
    harness: buildSource(SOURCES.harness.name, read(SOURCES.harness.rel)),
    help: buildSource(SOURCES.help.name, helpText),
    memory: buildSource(SOURCES.memory.name, read(SOURCES.memory.rel)),
  };
  const g = gate(pages, srcBundles);
  for (const f of g.failures) console.log(renderFailure(f));
  if (g.failures.length) {
    console.log(`FAIL  ${g.failures.length} of ${g.checked} page literals no longer resolve in the engine sources`);
    exit = 1;
  } else {
    console.log(`ok  gates: ${g.checked} page literals resolve in the engine sources`);
  }
  return exit;
}

export {
  ClaimsError,
  MIN_LITERAL,
  PAGES,
  SOURCES,
  parseJobDefs,
  jobDefsArray,
  objectChunks,
  parseJob,
  scheduleMs,
  humanizeMs,
  buildJobsData,
  emitData,
  parseHookLog,
  parseBeats,
  parseCommands,
  parseSlashCommands,
  helpBody,
  commandClaim,
  extractTemplates,
  buildSource,
  matchLiteral,
  sharedWindow,
  matchRows,
  gate,
  renderFailure,
  collapse,
  fold,
  run,
};

// Importable so its extraction and matching rules can be pinned by
// scripts/landing_claims.test.mjs: `--check` cannot see a parser bug of its
// own, and the one-directional rule only holds if a test proves the gate does
// NOT fail on a source the page never quotes.
//
// The self-invocation guard is separator- and case-insensitive because this
// runs on all three OS. A guard that never matches would make the CLI print
// nothing and exit 0 — precisely how a gate becomes decorative. The test
// spawns it and asserts it spoke.
const self = fileURLToPath(import.meta.url).replace(/\\/g, "/").toLowerCase();
const invoked = process.argv[1] ? resolve(process.argv[1]).replace(/\\/g, "/").toLowerCase() : "";
if (invoked === self) {
  try {
    process.exit(run(process.argv.includes("--check")));
  } catch (err) {
    console.error(err instanceof ClaimsError ? err.message : err);
    process.exit(1);
  }
}
