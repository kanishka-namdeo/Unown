#!/usr/bin/env node
/**
 * gba_palette_check.mjs — the landing palette's static gate.
 *
 * The page claims "every colour on this page is a legal Game Boy Advance
 * colour". A claim nobody can falsify is not a claim, so this checks it against
 * the hardware and against WCAG, read out of the CSS itself rather than out of
 * the prose that describes it. No browser and no server, which is why it can
 * run in CI where the contrast audit cannot.
 *
 * Six rules:
 *  1. GRID. Every `--color-*` literal in the landing palette is one of the 32
 *     values a 5-bit GBA channel can take. The disassembly palettes
 *     (pret/pokeruby `.pal`, published on Lospec) render channel value v as
 *     floor(255*v/31), so #18/#29/#52 are legal and #f8 is not — which also
 *     means #ffffff is a GBA colour and #f8f8f8 is not.
 *  2. MIRRORS. The light scheme is declared twice (`prefers-color-scheme` for
 *     the no-JS default, `[data-theme="light"]` for the toggle). The two blocks
 *     must carry identical declarations, or the toggle and the OS default
 *     disagree and the cascade bug goes unseen.
 *  3. ROLES. The tokens the page's own contract names still exist, and every
 *     hue a section declares is a hue the CSS actually implements.
 *  4. CONTRAST. Every text token clears AA 4.5:1 against every surface it can
 *     land on, and every hue field keeps its own accent plus ink/dim/faint
 *     legible on it — in BOTH schemes. This recomputes the table quoted in
 *     `globals.css` and the landing `AGENTS.md`, so prose cannot drift from CSS.
 *  5. NO STALE NAMES. The DMG / Super-Game-Boy vocabulary this replaced is gone
 *     from the CSS, the markup and the other gates.
 *  6. NO HAND-PICKED HEXES. Landing components take tokens, not colours —
 *     otherwise rule 1 has a hole in it.
 *
 * Usage: bun scripts/gba_palette_check.mjs
 * Exits non-zero on any failed rule.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const GLOBALS = "src/app/globals.css";
const LANDING_CSS = "src/app/landing.css";
const SHELL = "src/components/landing/shell.tsx";
const LANDING_DIR = "src/components/landing";

/* ---------- the 5-bit grid ---------- */

/** The 32 values one GBA channel can hold, rendered the way the ROMs are. */
const GRID = new Set(Array.from({ length: 32 }, (_, v) => Math.floor((255 * v) / 31)));
const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
const onGrid = (hex) =>
  /^#[0-9a-f]{6}$/i.test(hex) && [1, 3, 5].every((i) => GRID.has(ch(hex, i)));

/* ---------- WCAG ---------- */

const lum = (h) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(ch(h, 1)) + 0.7152 * f(ch(h, 3)) + 0.0722 * f(ch(h, 5));
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/* ---------- parse the palette out of globals.css ---------- */

const css = read(GLOBALS);
const failures = [];
const fail = (rule, msg) => failures.push(`[${rule}] ${msg}`);

function decls(body, label) {
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  if (!Object.keys(out).length) fail("PARSE", `${label} produced no declarations`);
  return out;
}

// Located by content, not by brace counting from the top: globals.css also
// carries an `@theme inline` shadcn block and a `:root` zinc block that must
// NOT be read as landing palette.
const themeStart = css.search(/^@theme \{$/m);
if (themeStart < 0) fail("PARSE", "no `@theme {` block in globals.css");
const themeBody =
  themeStart < 0 ? "" : css.slice(themeStart, css.indexOf("\n}", themeStart));
const DARK = decls(themeBody, "@theme");

const LIGHT_SELECTORS = [
  ':root:not([data-theme])',
  ':root[data-theme="light"]',
];
const lightBlocks = {};
for (const sel of LIGHT_SELECTORS) {
  const at = css.indexOf(`${sel} {`);
  if (at < 0) {
    fail("PARSE", `no \`${sel}\` block in globals.css`);
    continue;
  }
  lightBlocks[sel] = decls(css.slice(at, css.indexOf("\n}", at)), sel);
}
const LIGHT = lightBlocks[LIGHT_SELECTORS[0]] ?? {};

/* ---------- rule 1: the grid ---------- */

const paletteTokens = (s) => Object.entries(s).filter(([k]) => k.startsWith("--color-"));
for (const [name, scheme] of [["DARK", DARK], ["LIGHT", LIGHT]]) {
  for (const [token, value] of paletteTokens(scheme)) {
    if (!value.startsWith("#")) {
      fail("GRID", `${name} ${token} is "${value}" — the landing palette ships literal hex so the cascade can repaint it`);
    } else if (!onGrid(value)) {
      const off = [1, 3, 5]
        .map((i) => value.slice(i, i + 2))
        .filter((pair) => !GRID.has(parseInt(pair, 16)));
      fail("GRID", `${name} ${token} ${value} is not a GBA colour: channel(s) ${off.join(", ")} are off the 5-bit grid`);
    }
  }
  // Not a --color- token, but the HP-bar well is still a colour on screen.
  const well = scheme["--gb-hp-well"];
  if (well?.startsWith("#") && !onGrid(well)) fail("GRID", `${name} --gb-hp-well ${well} is off the grid`);
}

/* ---------- rule 2: the two light blocks agree ---------- */

if (Object.keys(lightBlocks).length === 2) {
  const [a, b] = LIGHT_SELECTORS.map((s) => lightBlocks[s]);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] !== b[k]) {
      fail("MIRROR", `${k} differs: media-query block has ${a[k] ?? "(absent)"}, [data-theme] block has ${b[k] ?? "(absent)"}`);
    }
  }
}

/* ---------- rule 3: roles, and hues that actually exist ---------- */

const REQUIRED = [
  "--color-canvas", "--color-panel", "--color-panel-2", "--color-line",
  "--color-line-bright", "--color-ink", "--color-dim", "--color-faint",
  "--color-gold", "--color-gold-soft", "--color-amber", "--color-poke",
  "--color-gold-field", "--color-aqua", "--color-aqua-field",
  "--color-magma", "--color-magma-field", "--color-leaf", "--color-leaf-field",
  "--color-psychic", "--color-psychic-field",
];
for (const [name, scheme] of [["DARK", DARK], ["LIGHT", LIGHT]]) {
  for (const token of REQUIRED) if (!scheme[token]) fail("ROLES", `${name} is missing ${token}`);
}

const HUES = ["gold", "aqua", "magma", "leaf", "psychic"];
const shellTypes = read(SHELL);
const declared = [...shellTypes.matchAll(/export type Hue = ([^;]+);/gs)][0]?.[1] ?? "";
const hueNames = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (hueNames.join() !== HUES.join()) {
  fail("ROLES", `shell.tsx declares Hue [${hueNames.join(", ")}] but the gate expects [${HUES.join(", ")}]`);
}
const landingCss = read(LANDING_CSS);
for (const h of hueNames) {
  if (!landingCss.includes(`[data-hue="${h}"]`)) fail("ROLES", `landing.css has no [data-hue="${h}"] rule`);
  if (!landingCss.includes(`[data-tone="${h}"]`)) fail("ROLES", `landing.css has no [data-tone="${h}"] rule`);
}

/* ---------- rule 4: contrast, both schemes ---------- */

/* ---------- rule 4: contrast, both schemes, every surface ---------- */

const TEXT = ["ink", "dim", "faint", "gold", "gold-soft", "amber", "poke", ...HUES.filter((h) => h !== "gold")];
const NEUTRALS = ["canvas", "panel", "panel-2"];
const AA = 4.5;
const table = {};

/** `#rrggbb` of `fg` painted at alpha `a` over `bg` — how a `/10` chip lands. */
const composite = (fg, bg, a) =>
  "#" +
  [1, 3, 5]
    .map((i) => Math.round(ch(fg, i) * a + ch(bg, i) * (1 - a)).toString(16).padStart(2, "0"))
    .join("");

for (const [name, S] of [["DARK", DARK], ["LIGHT", LIGHT]]) {
  const hex = (t) => S[`--color-${t}`];

  // A text token is not only read on the three neutral surfaces. It is read on
  // every SECTION FIELD, and on a `/10` tint chip sitting over each of those —
  // which is the combination that first shipped a 4.49:1 failure here, because
  // `text-gold` inside a magma section was never checked against magma's field.
  const surfaces = NEUTRALS.map((s) => [s, hex(s)]);
  for (const h of HUES) {
    const field = hex(`${h}-field`);
    if (!field) continue;
    surfaces.push([`${h} section field`, field]);
    for (const chip of [...HUES, "poke", "amber"]) {
      if (!hex(chip)) continue;
      surfaces.push([`bg-${chip}/10 chip on the ${h} field`, composite(hex(chip), field, 0.1)]);
    }
  }

  const row = [];
  for (const t of TEXT) {
    if (!hex(t)) continue;
    let worst = Infinity;
    let worstOn = "";
    for (const [label, surface] of surfaces) {
      const r = ratio(hex(t), surface);
      if (r < worst) [worst, worstOn] = [r, label];
    }
    row.push(`${t} ${worst.toFixed(2)}`);
    if (worst < AA) {
      fail("AA", `${name} text-${t} ${hex(t)} is ${worst.toFixed(2)}:1 on the ${worstOn} (needs ${AA})`);
    }
  }

  // A hue used as a dialogue-box fill carries the canvas colour as its text.
  for (const h of HUES) {
    const asFill = ratio(hex("canvas"), hex(h));
    if (asFill < AA) fail("AA", `${name} text-canvas on a ${h}-filled .gb-box is ${asFill.toFixed(2)}:1`);
  }
  table[name] = row;
}

/* ---------- rules 5 + 6: stale names, and hexes in components ---------- */

const STALE = [
  "--color-glow", "--color-sgb-", "text-glow", "bg-glow", "ring-glow",
  "--gb-scanline", "--gb-vignette", ".crt", "sgb-cream", "sgb-amber",
  "sgb-brick", "sgb-purple",
];
/** Strip comments so the sweeps below read code, not prose about the old names. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

for (const [file, src] of [[GLOBALS, css], [LANDING_CSS, landingCss], [SHELL, shellTypes]]) {
  const code = stripComments(src);
  for (const s of STALE) if (code.includes(s)) fail("STALE", `${file} still contains ${s}`);
}

const landingSources = {
  "src/app/page.tsx": read("src/app/page.tsx"),
  ...Object.fromEntries(
    readdirSync(join(ROOT, LANDING_DIR))
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f) => [`${LANDING_DIR}/${f}`, read(`${LANDING_DIR}/${f}`)]),
  ),
};
for (const [file, src] of Object.entries(landingSources)) {
  const code = stripComments(src);
  for (const m of code.matchAll(/(?:text|bg|border|ring|fill|stroke|from|to|decoration|outline)-(?:sgb|glow)[\w/-]*/g)) {
    fail("STALE", `${file} still uses the ${m[0]} utility`);
  }
  // A colour literal is a whole string that is a hex — `"#0a140a"`. Matching
  // bare `#123` would light up on `&#123;` and on `href="#quickstart"`.
  for (const m of code.matchAll(/(["'`])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\1/g)) {
    fail("HEX", `${file} hardcodes ${m[0]} — take a --color-* token instead`);
  }
  for (const m of code.matchAll(/data-hue="([^"]+)"/g)) {
    if (!hueNames.includes(m[1])) fail("ROLES", `${file} declares unknown data-hue="${m[1]}"`);
  }
  for (const m of code.matchAll(/data-tone="([^"]+)"/g)) {
    if (m[1] === "mid" || m[1] === "low") continue; // the HP-bar step system
    if (!hueNames.includes(m[1])) fail("ROLES", `${file} declares unknown data-tone="${m[1]}"`);
  }
}

/* ---------- report ---------- */

console.log("gba_palette_check — the landing palette vs the hardware and vs WCAG\n");
for (const [name, row] of Object.entries(table)) {
  console.log(`  ${name} worst-case AA per text token (worst over neutrals + all 5 section fields + every tint-chip composite):`);
  console.log(`    ${row.join(" · ")}`);
}

if (failures.length) {
  console.log(`\nFAIL  ${failures.length} problem(s):\n`);
  for (const f of failures) console.log(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log(
    `\nPASS  ${paletteTokens(DARK).length} dark + ${paletteTokens(LIGHT).length} light tokens: all on the 5-bit GBA grid, all AA in both schemes, no stale DMG/SGB vocabulary`,
  );
}
