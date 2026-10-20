#!/usr/bin/env node
/**
 * creature_sprites.mjs — the feature-creature atlas, v2: AUTHORED, not averaged.
 *
 * WHY THE REWRITE (2026-10-20): v1 generated 1024px AI illustrations and
 * GBA-ified them by box-average downscale + snap-to-page-tokens. The result
 * read as mush: AI illustrations are smooth art, and averaging smooth art
 * onto a 64px grid produces soft outlines, dissolved props and patchy
 * "shading" that is really quantization noise (the Agnes review of the v1
 * sheet flagged soft outlines, unreadable props and consistency outliers;
 * docs/landing-research.md Part 16 has the evidence). Pixel art is not a
 * resolution — it is pixels placed on purpose.
 *
 * v2 therefore draws every creature IN THIS FILE with a small deterministic
 * drawing kit, the way a pixel artist works: silhouettes from primitive
 * regions, shading as deliberate cel bands under one top-left light,
 * 1px outlines generated from the silhouette boundary (never hand-wobbled),
 * faces from one shared template, and props as hand-drawn stamps. Ten
 * compositions share the kit, so the set matches by CONSTRUCTION, not luck.
 * Regeneration needs no API, no credentials and no network: the script is
 * the art, and the art is checkable.
 *
 * THE PALETTE: per-family hue-shifted ramps (shadows toward blue/violet,
 * lights toward yellow/white — the pret/pokeemerald palettes do exactly
 * this), all values on the GBA 5-bit channel grid (floor(255·v/31), GBATEK),
 * hues taken from the page's own families (aqua/magma/gold/leaf/psychic/
 * cream/navy — the landing tokens' world). Sprites inherit the page's world
 * by hue family and carry the ramps a text palette cannot offer; the page
 * keeps its "every colour is a legal GBA colour" claim, now true of the
 * sprites pixel-for-pixel, and gated.
 *
 * CONSTRUCTION SYSTEM (measured against 16 Emerald front sprites, Part 16):
 * 64×64 canvas, content ~28-44px wide/tall inside ~10px margins, standing
 * baseline at row 52 (pret average bottom margin ≈ 12 — the platform renders
 * below), head ≈ half the sprite, eyes low-set 3×4 near the midline, stubby
 * feet, one prop per creature, ≤ 15 visible colors (GBA OBJ: 16 slots, slot
 * 0 transparent), no orphan clusters except deliberate glints.
 *
 * Usage:
 *   node scripts/creature_sprites.mjs               # draw all + gates + ship + sheet
 *   node scripts/creature_sprites.mjs --id mcp      # one creature
 *   node scripts/creature_sprites.mjs --review      # VLM critique of the sheet
 *
 * Env: --review needs the bridge (VLM_BRIDGE, default
 *      http://127.0.0.1:3031/v1/chat/completions, VLM_MODEL agnes-3.0-flash).
 *
 * Outputs:
 *   public/landing/creatures/<id>.png   256×256 (4× nearest), committed
 *   download/creatures/sheet.png        labeled contact sheet for review
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "public/landing/creatures");
const SHEET = path.join(ROOT, "download/creatures/sheet.png");
const SHIP_SCALE = 4; // 256px ship; displayed at integer multiples (h-16 = 1:1)

/* The drawing kit and palette live in creature_kit.mjs; the ten
 * compositions live in creature_atlas.mjs. This file is the pipeline:
 * draw → outline → gates → ship → sheet (+ VLM review as an aid). */
import { N, BASELINE, COLORS, RGB, hexRgb, at, make, outlinePass } from "./creature_kit.mjs";

/* ------------------------------------------------------------------ */
/* gates — the invariants that make it GBA art, not pixels that merely */
/* happen to be 64×64. Hard gates fail the run; the VLM pass is an aid.*/
/* ------------------------------------------------------------------ */

const GRID5 = new Set(Array.from({ length: 32 }, (_, v) => Math.floor((255 * v) / 31)));
const DARK_LUM = 0.3; // below this WCAG relative luminance a key counts as dark
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const IS_DARK = Object.fromEntries(Object.entries(RGB).map(([k, v]) => [k, lum(v) < DARK_LUM]));

/** Validate the atlas palette itself — every key a legal GBA colour. */
function gatePalette() {
  const bad = Object.entries(COLORS).filter(([, h]) =>
    hexRgb(h).some((v) => !GRID5.has(v)));
  if (bad.length) throw new Error(`palette off the 5-bit grid: ${bad.map(([k, h]) => `${k} ${h}`).join(", ")}`);
}

/** All per-sprite gates. Returns { rows, failures } — failures are hard. */
function gateSprite(s) {
  const c = s.canvas, meta = s.meta ?? {};
  const fails = [], warns = [];
  const rows = [];

  // bbox / margins / baseline
  let x0 = N, y0 = N, x1 = -1, y1 = -1, opaque = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (c[y][x] !== null) {
      opaque++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) fails.push("empty canvas");
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  rows.push(`${w}×${h}`, `r${y0}-${y1}`);
  if (x0 < 4 || y0 < 4 || x1 > N - 5 || y1 > N - 5) fails.push(`content touches the frame margin (bbox ${x0},${y0}-${x1},${y1})`);
  if (meta.standing && (y1 < BASELINE - 2 || y1 > BASELINE + 2)) fails.push(`standing baseline row ${y1} not within ${BASELINE}±2`);

  // colors used, dark ratio
  const used = new Map();
  let dark = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = c[y][x];
    if (k === null) continue;
    used.set(k, (used.get(k) ?? 0) + 1);
    if (IS_DARK[k]) dark++;
  }
  const colors = used.size;
  rows.push(`${colors}c`);
  if (colors > 15) fails.push(`${colors} visible colors — GBA OBJ allows 15 (+ transparent)`);
  const darkPct = Math.round((dark / opaque) * 100);
  rows.push(`${darkPct}%d`);
  if (darkPct > 30) fails.push(`dark ratio ${darkPct}% — smudges on the light scheme`);
  else if (darkPct > 26) warns.push(`dark-heavy ${darkPct}%`);

  // edge-outline integrity: opaque touching transparency must be the outline
  let bare = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = c[y][x];
    if (k === null) continue;
    const t = at(c, x - 1, y) === null || at(c, x + 1, y) === null ||
      at(c, x, y - 1) === null || at(c, x, y + 1) === null;
    if (t && k !== "O") bare++;
  }
  rows.push(bare ? `${bare}bare` : "edge✓");
  if (bare > 0) fails.push(`${bare} edge pixels are not the outline — the crispness invariant`);

  // orphan clusters: a pixel with NO same-colour neighbour in the full
  // 8-neighbourhood — the classic orphan definition. Diagonal staircase
  // lines are legitimate pixel-art (that is how 1px outlines step); noise
  // is a pixel surrounded by different colours entirely. Deliberate
  // accents (W glints, sparkles) are exempt.
  let orphans = 0, orphanKeys = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = c[y][x];
    if (k === null || k === "W") continue;
    let same = false;
    for (let dy = -1; dy <= 1 && !same; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (at(c, x + dx, y + dy) === k) { same = true; break; }
      }
    if (!same) { orphans++; orphanKeys.push(k); }
  }
  rows.push(orphans ? `${orphans}orph` : "orph✓");
  if (orphans > 0) fails.push(`orphan pixels: ${orphanKeys.join(",")}`);

  // mask symmetry where the composition claims it (front-facing symmetry)
  if (meta.symmetric) {
    let asym = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < 32; x++) {
      if ((c[y][x] === null) !== (c[y][63 - x] === null)) asym++;
    }
    if (asym > 0) fails.push(`mask not X-symmetric (${asym} cells)`);
  }
  return { rows, fails, warns, colors, darkPct };
}

/* ------------------------------------------------------------------ */
/* render: canvas of keys → RGBA → 4× nearest PNG                       */
/* ------------------------------------------------------------------ */

async function render(s) {
  const buf = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = s.canvas[y][x], o = (y * N + x) * 4;
    if (k === null) { buf[o + 3] = 0; continue; }
    const [r, g, b] = RGB[k];
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
  }
  const png = await sharp(buf, { raw: { width: N, height: N, channels: 4 } })
    .resize(N * SHIP_SCALE, N * SHIP_SCALE, { kernel: "nearest" })
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, `${s.id}.png`), png);
}

/* ------------------------------------------------------------------ */
/* contact sheet — SVG → PNG, labeled, checkerboard to expose alpha    */
/* ------------------------------------------------------------------ */

async function contactSheet(sprites) {
  const CELL = 512, PAD = 24, COLS = 4;
  const rows = Math.ceil(sprites.length / COLS);
  const W = COLS * (CELL + PAD) + PAD, H = rows * (CELL + PAD + 40) + PAD;
  let defs = "", body = "";
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i];
    const b64 = (await sharp(path.join(OUT_DIR, `${s.id}.png`))
      .resize(CELL - 64, CELL - 64, { fit: "inside", kernel: "nearest" }).png().toBuffer()).toString("base64");
    const x = PAD + (i % COLS) * (CELL + PAD), y = PAD + Math.floor(i / COLS) * (CELL + PAD + 40);
    defs += `<pattern id="chk${i}" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#7a7a7a"/><rect width="16" height="16" fill="#6a6a6a"/><rect x="16" y="16" width="16" height="16" fill="#6a6a6a"/></pattern>`;
    body += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="url(#chk${i})" stroke="#444" stroke-width="2"/>` +
      `<image x="${x}" y="${y}" width="${CELL}" height="${CELL}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${b64}"/>` +
      `<text x="${x + CELL / 2}" y="${y + CELL + 26}" font-family="monospace" font-size="30" font-weight="bold" fill="#111" text-anchor="middle">${s.id}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}</defs>${body}</svg>`;
  fs.mkdirSync(path.dirname(SHEET), { recursive: true });
  fs.writeFileSync(SHEET, await sharp(Buffer.from(svg)).png().toBuffer());
  console.log(`\ncontact sheet → ${path.relative(ROOT, SHEET)}`);
}

/* ------------------------------------------------------------------ */
/* VLM review (Agnes lane — reviewer's aid, not a gate)                */
/* ------------------------------------------------------------------ */

async function review() {
  const BRIDGE = process.env.VLM_BRIDGE ?? "http://127.0.0.1:3031/v1/chat/completions";
  const MODEL = process.env.VLM_MODEL ?? "agnes-3.0-flash";
  const buf = await sharp(SHEET).resize({ width: 1600, withoutEnlargement: true, kernel: "nearest" }).png({ compressionLevel: 9 }).toBuffer();
  const body = {
    model: MODEL,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text:
            "You are reviewing a labeled contact sheet of original pixel sprites for a developer-tool landing page styled after a retro handheld console (Game Boy Advance era: 64px sprites, limited palette of navy/gold/cream/aqua/coral/leaf, 1-bit alpha, hard pixels). Checkerboard = transparency. Answer in this exact format:\n" +
            "VERDICT: PASS or FIX\n" +
            "GBA-STYLE: do the sprites read as authentic retro-handheld pixel sprites (visible pixel grid, flat regions, limited palette) rather than smooth modern flat illustration? name outliers\n" +
            "CRAFT: rate outline cleanliness, cel shading, cluster discipline per sprite; name the 3 weakest sprites and why\n" +
            "IP-SAFETY: does any sprite closely resemble a specific named Pokémon or official game art? (must be none)\n" +
            "READABILITY: at this size, which sprites' key features (props, faces) stop reading? name ids\n" +
            "CONSISTENCY: do all sprites read as one style family (pixel density, outline, proportions)? name outliers\n" +
            "No preamble.",
        },
        { type: "image_url", image_url: { url: `data:image/png;base64,${buf.toString("base64")}` } },
      ],
    }],
    max_tokens: 700,
  };
  const resp = await fetch(BRIDGE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json();
  console.log(json.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 300));
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

/** Cleanup: merge accidental orphan pixels (band pinch points) into their
 *  most common 8-neighbour — the deterministic version of what a pixel
 *  artist does by hand after shading. Deliberate accents (W) are untouched,
 *  and every merge is counted so a noisy composition gets visible. */
function deOrphan(c) {
  let merged = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = c[y][x];
    if (k === null || k === "W") continue;
    const counts = new Map();
    let same = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = at(c, x + dx, y + dy);
      if (n === null) continue;
      if (n === k) { same = true; break; }
      if (n !== "W") counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    if (same) continue;
    let best = null, bestN = 0;
    for (const [key, n] of counts) if (n > bestN) { best = key; bestN = n; }
    if (best) { c[y][x] = best; merged++; }
  }
  return merged;
}

const args = process.argv.slice(2);
const idIdx = args.indexOf("--id");
const wanted = idIdx !== -1 ? args[idIdx + 1] : null;
const { SPRITES } = await import("./creature_atlas.mjs");

gatePalette();
fs.mkdirSync(OUT_DIR, { recursive: true });
const picked = wanted ? SPRITES.filter((s) => s.id === wanted) : SPRITES;
if (!picked.length) { console.error(`unknown id "${wanted}" — ids: ${SPRITES.map((s) => s.id).join(", ")}`); process.exit(1); }

let hardFails = 0;
console.log("creature   bbox      rows     colors  dark   edge  orphans");
for (const s of picked) {
  s.canvas = outlinePass(s.draw(make()));
  const merged = deOrphan(s.canvas);
  const g = gateSprite(s);
  await render(s);
  hardFails += g.fails.length;
  console.log(
    `${s.id.padEnd(10)} ${g.rows[0].padEnd(8)} ${g.rows[1].padEnd(8)} ${g.rows[2].padStart(6)}  ${g.rows[3].padStart(4)}  ${g.rows[4].padStart(5)}  ${g.rows[5]}${merged ? `  (${merged} merged)` : ""}`,
  );
  for (const wmsg of g.warns) console.warn(`  ⚠ ${s.id}: ${wmsg}`);
  for (const fmsg of g.fails) console.error(`  ✗ ${s.id}: ${fmsg}`);
}
await contactSheet(picked);
if (args.includes("--review")) await review();
if (hardFails) { console.error(`\n✗ ${hardFails} hard gate failure(s)`); process.exit(1); }
console.log(`\n✓ ${picked.length} sprite(s) shipped — ${N}px logical, ${N * SHIP_SCALE}px, all gates green`);
