// Landing rail generator: CHANGELOG.md -> src/components/landing/changelog-data.ts.
//
//   node scripts/landing_changelog.mjs           write the data file
//   node scripts/landing_changelog.mjs --check   CI gate: fail if it no longer matches
//
// Why generated instead of authored: the landing page's contract is that every
// factual claim is a real artifact, and a shipping rail authored in the
// component is a claim with no source. The only source of dates here is
// CHANGELOG.md's own `## [2.1.0] - 2026-10-18` headings, so the page cannot
// invent a cadence, and the CI step cannot pass while the rail and the changelog
// disagree. Feature work already has to land in CHANGELOG.md, so re-running this
// script is the entire update.
//
// Rules it encodes, in one place so the component stays dumb:
//   - a stop is a `## [label] - YYYY-MM-DD` heading; `[Unreleased]` is the
//     in-flight stop and MUST stay undated (a dated promise about the future is
//     the one thing this page cannot check).
//   - bucket headings normalise to the six Keep a Changelog categories, plus
//     `Behavior` for `### Agent Behavior`. A heading may carry a parenthetical
//     suffix (### Added (Agent Behavior), ### Agent Behavior (Milestone 4 —
//     2026-10-19)); the first word still picks the KAC bucket, and "Agent
//     Behavior…" is still the Behavior bucket. Same-category headings merge
//     (the file has shipped two `### Fixed` blocks inside one stop), and an
//     unrecognised heading fails the run instead of being silently dropped.
//   - a bullet's title is its authored `**bold**` lead when it has one;
//     otherwise the clause before the first ` — ` or `: `. Backticks and link
//     targets are stripped, no title may end inside an unclosed bracket, and
//     anything past TITLE_MAX is clipped at a separator. `TITLES` is the escape
//     hatch for a bullet that rule mangles; an unused entry is reported.
//
// Dependency-free node builtins only, split on /\r?\n/ (this checkout is CRLF
// under core.autocrlf while the blobs are LF), and the comparison is
// EOL-normalised so the gate cannot fail purely over line endings.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "CHANGELOG.md");
const TARGET = join(ROOT, "src/components/landing/changelog-data.ts");

const TITLE_MAX = 112;
const KAC_BUCKETS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
const BUCKETS = [...KAC_BUCKETS, "Behavior"];

/** Curated titles, keyed by `stop|bucket|first three words of the bullet`. */
const TITLES = {};

/** Thrown, not exited: the failure modes are the point of the unit test. */
class ChangelogError extends Error {}
const fail = (msg) => {
  throw new ChangelogError(`landing_changelog: ${msg}`);
};

/* ------------------------------------------------------------------ */
/* title extraction                                                    */
/* ------------------------------------------------------------------ */

const unwrapLinks = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
const tidy = (s) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");

/**
 * No title may end inside a bracket that never closes. Counting, not
 * indexOf-vs-lastIndexOf: the usual failure is ONE unclosed paren, and a
 * first-last comparison cannot see it.
 */
function balanceCuts(s) {
  let out = s;
  for (;;) {
    const open = (c) => [...out].filter((x) => x === c).length;
    const unbalanced = open("(") > open(")") ? " (" : open("[") > open("]") ? " [" : null;
    if (!unbalanced) break;
    const cut = out.lastIndexOf(unbalanced);
    if (cut < 0) break;
    out = out.slice(0, cut);
  }
  return tidy(out);
}

function clip(s) {
  if (s.length <= TITLE_MAX) return s;
  const window = s.slice(0, TITLE_MAX);
  const comma = window.lastIndexOf(", ");
  const cut = comma > 24 ? comma : window.lastIndexOf(" ");
  // Never `TITLE_MAX` itself: the ellipsis would push the result over the cap.
  return `${window.slice(0, cut > 0 ? cut : TITLE_MAX - 1).replace(/[,;:]$/, "")}…`;
}

/** The clause up to whichever of ` — `/`: `/`; `/`, `/`. ` comes first. */
function firstClause(s) {
  const marks = [" — ", ": ", "; ", ", ", ". "]
    .map((m) => s.indexOf(m))
    .filter((i) => i > 0);
  if (!marks.length) return s;
  const at = Math.min(...marks);
  const head = s.slice(0, at);
  // A one-word prefix like `CI:` or `README:` is a label, not a title: take the
  // clause it introduces too, then let balanceCuts/clip trim it.
  if (head.length < 12) return `${head}: ${firstClause(s.slice(at + 2))}`;
  return head;
}

function titleOf(body) {
  // Markdown never reaches the page: link targets become their text, code spans
  // lose their backticks, and emphasis markers are stripped by `tidy` — which
  // every title path passes through, and which must NOT run before the bold
  // detection below or there is nothing left to detect.
  const text = unwrapLinks(body).replace(/`/g, "");
  const bold = text.match(/^\*\*(.+?)\*\*\s*(.*)$/s);
  if (!bold) return { title: clip(balanceCuts(tidy(firstClause(text)))), behavior: false };

  let lead = bold[1].trim();
  let behavior = false;
  const agent = lead.match(/^Agent Behavior\s*[:—-]?\s*(.*)$/i);
  if (agent) {
    behavior = true;
    // `**Agent Behavior** — real title …` puts the title in what follows the bold.
    lead = agent[1].trim() || tidy(firstClause(bold[2].replace(/^[\s:—-]+/, "")));
  }
  return { title: clip(balanceCuts(tidy(lead))), behavior };
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

function parseChangelog(raw, { reportUnused = false } = {}) {
  const lines = raw.split(/\r?\n/);
  const stops = [];
  const used = new Set();
  let stop = null;
  let bucket = null;
  // Per-heading, never per-bucket: `[Unreleased]` has `### Added (Agent
  // Behavior)` and a plain `### Added` one after the other, and a bucket-level
  // flag would tag the second block's entry as a behavior change while its own
  // text says it is not one.
  let headingBehavior = false;

  for (const line of lines) {
    const head = line.match(/^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/);
    if (head) {
      stop = { label: head[1].trim(), date: head[2] ?? null, groups: new Map() };
      stops.push(stop);
      bucket = null;
      continue;
    }
    if (!stop) continue;

    const sub = line.match(/^### (.+?)\s*$/);
    if (sub) {
      const name = sub[1];
      const first = name.split(/[\s(]/)[0];
      // "Agent Behavior" — exact, or with a parenthesised milestone suffix
      // like "Agent Behavior (Milestone 4 — 2026-10-19)" — both map to the
      // "Behavior" bucket so per-milestone buckets don't fragment the count.
      if (/^Agent Behavior(\s|$)/i.test(name)) bucket = "Behavior";
      else if (KAC_BUCKETS.includes(first)) bucket = first;
      else fail(`unknown bucket heading "### ${name}" in [${stop.label}] — extend BUCKETS, do not drop it`);
      headingBehavior = /Agent Behavior/i.test(name);
      if (!stop.groups.has(bucket)) stop.groups.set(bucket, { items: [] });
      continue;
    }

    if (!/^- \S/.test(line)) continue; // indented sub-bullets are detail, not entries
    const body = line.slice(2);
    if (!bucket) fail(`bullet in [${stop.label}] before any ### heading: ${body.slice(0, 48)}`);

    const group = stop.groups.get(bucket);
    const key = `${stop.label}|${bucket}|${body.split(/\s+/).slice(0, 3).join(" ")}`;
    const derived = titleOf(body);
    if (TITLES[key]) {
      derived.title = TITLES[key];
      used.add(key);
    }
    if (!derived.title) fail(`empty title for bullet in [${stop.label}]: ${body.slice(0, 48)}`);
    group.items.push({
      title: derived.title,
      behavior: derived.behavior || bucket === "Behavior" || headingBehavior,
    });
  }

  // Only meaningful against the real changelog: a fixture parse cannot use
  // every curated key, so reporting there is a false alarm that trains people
  // to ignore the one warning that matters.
  if (reportUnused) {
    for (const key of Object.keys(TITLES)) {
      if (!used.has(key)) console.warn(`landing_changelog: TITLES entry is unused, the bullet moved: ${key}`);
    }
  }
  return stops;
}

function build(stops) {
  const totals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  const rendered = stops.map((stop) => {
    const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    const groups = [];
    for (const [bucket, group] of stop.groups) {
      if (!group.items.length) continue;
      counts[bucket] = group.items.length;
      totals[bucket] += group.items.length;
      groups.push({ bucket, items: group.items });
    }
    return {
      label: stop.label,
      date: stop.date,
      total: groups.reduce((n, g) => n + g.items.length, 0),
      counts,
      groups,
    };
  });

  if (!rendered.filter((s) => s.date).length)
    fail("no dated release stop parsed from CHANGELOG.md — the rail would be all promise");
  if (!rendered.length || rendered.some((s) => !s.total)) fail("a parsed stop carries no entries");
  if (rendered.some((s) => s.label === "Unreleased" && s.date)) fail("[Unreleased] must not have a date");
  const total = rendered.reduce((n, s) => n + s.total, 0);
  if (total < 10) fail(`only ${total} entries parsed — the extraction broke, not the changelog`);
  return { stops: rendered, totals, total };
}

/* ------------------------------------------------------------------ */
/* emitting                                                            */
/* ------------------------------------------------------------------ */

const emit = (data) => `// GENERATED by scripts/landing_changelog.mjs from CHANGELOG.md — do not hand-edit.
// Regenerate after any CHANGELOG.md edit:  bun scripts/landing_changelog.mjs
// CI gate (also \`bun run check:changelog\`): bun scripts/landing_changelog.mjs --check
//
// The landing page's shipping rail renders this file. Dates come only from
// CHANGELOG.md release headings, so the page cannot claim a cadence the repo
// does not have, and [Unreleased] stays undated because it has not been cut.

export type ChangelogBucket = ${BUCKETS.map((b) => `"${b}"`).join(" | ")};

export interface ChangelogItem {
  /** The entry's title, extracted from its CHANGELOG.md bullet. */
  title: string;
  /** True when the entry changes agent behavior (docs/BEHAVIOR.md policy). */
  behavior: boolean;
}

export interface ChangelogGroup {
  bucket: ChangelogBucket;
  items: ChangelogItem[];
}

export interface ChangelogStop {
  /** \`2.1.0\` for a cut release, \`Unreleased\` for the in-flight section. */
  label: string;
  /** ISO date from the release heading; null until the stop has been cut. */
  date: string | null;
  total: number;
  counts: Record<ChangelogBucket, number>;
  groups: ChangelogGroup[];
}

export const CHANGELOG_TOTAL_ENTRIES = ${data.total};

export const CHANGELOG_TOTALS: Record<ChangelogBucket, number> = ${JSON.stringify(data.totals, null, 2)};

export const CHANGELOG_STOPS: ChangelogStop[] = ${JSON.stringify(data.stops, null, 2)};
`;

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

function run(check) {
  const data = build(parseChangelog(readFileSync(SOURCE, "utf8"), { reportUnused: true }));
  const out = emit(data);

  if (check) {
    let current;
    try {
      current = readFileSync(TARGET, "utf8");
    } catch {
      fail(`${TARGET.replace(ROOT + "/", "")} is missing — run \`bun scripts/landing_changelog.mjs\``);
    }
    const norm = (s) => s.replace(/\r\n/g, "\n");
    if (norm(current) !== norm(out)) {
      fail(
        "the landing rail no longer matches CHANGELOG.md.\n" +
          "                 CHANGELOG.md changed (or this script did) without the rail being\n" +
          "                 regenerated. Run: bun scripts/landing_changelog.mjs",
      );
    }
    console.log(
      `ok  rail matches CHANGELOG.md: ${data.stops.length} stops, ${data.total} entries, ` +
        `${data.stops.filter((s) => s.date).length} dated`,
    );
    return data;
  }

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, out);
  console.log(
    `wrote ${TARGET.replace(ROOT + "/", "")}: ${data.stops.length} stops, ${data.total} entries ` +
      `(${data.stops.map((s) => `${s.label}${s.date ? ` ${s.date}` : " undated"}`).join(", ")})`,
  );
  return data;
}

export { parseChangelog, build, emit, titleOf, firstClause, balanceCuts, clip, run, TITLE_MAX };

// Importable so its extraction rules can be pinned by
// scripts/landing_changelog.test.mjs; a gate that re-derives its own output
// cannot catch a parser that quietly mislabels an entry.
//
// The comparison is separator- and case-insensitive because this runs on all
// three OS. That matters more than it looks: a guard that never matches turns
// `--check` into a command that does nothing and exits 0, which is precisely
// how a gate becomes decorative. The test spawns the CLI and asserts it spoke.
const self = fileURLToPath(import.meta.url).replace(/\\/g, "/").toLowerCase();
const invoked = process.argv[1] ? resolve(process.argv[1]).replace(/\\/g, "/").toLowerCase() : "";
if (invoked === self) {
  try {
    run(process.argv.includes("--check"));
  } catch (err) {
    console.error(err instanceof ChangelogError ? err.message : err);
    process.exit(1);
  }
}
