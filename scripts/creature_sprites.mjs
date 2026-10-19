#!/usr/bin/env node
/**
 * creature_sprites.mjs — the feature-creature asset pipeline.
 *
 * Generates the landing page's "monster companion" sprites: one original
 * 2D creature per agent feature (web search, MCP, subagents, memory, …).
 *
 * Two stages:
 *
 *   1. GENERATE (AI) — a text-to-image pass with a locked style template.
 *      The model provides composition only; style consistency across the
 *      set is inherited from the template, never from the model's rendering.
 *
 *   2. GBA-IFY (deterministic) — the render is transformed into an authentic
 *      GBA-era pixel sprite: box-average downscale to a 64px logical grid,
 *      1-bit alpha (GBA OBJ color 0 is transparent, no semi-transparency),
 *      then every pixel snapped to the nearest color of the SITE'S OWN
 *      palette (the landing tokens from globals.css — so a sprite can no
 *      more leave the page's world than a glyph can), shipped at 4× via
 *      nearest-neighbor and displayed 1:1 with image-rendering: pixelated.
 *      Practitioner consensus (Pixel Art XL et al.): the model draws, the
 *      pipeline owns palette and grid — that is the only way ten sprites
 *      match each other AND the page.
 *
 * IP safety is a hard contract (see the landing AGENTS.md): prompts use
 * generic creature-collector vocabulary only — never a Pokémon species
 * name, never ball/capture iconography. The VLM review pass double-checks
 * none drifted toward a specific recognizable character, and a signifier
 * audit arbitrates any flag (VLM is an aid, not a gate).
 *
 * Usage:
 *   node scripts/creature_sprites.mjs               # generate all + gba-ify + sheet
 *   node scripts/creature_sprites.mjs --id mcp      # regenerate one creature
 *   node scripts/creature_sprites.mjs --process     # skip generation, re-process only
 *   node scripts/creature_sprites.mjs --dither      # + 2x2 Bayer on gradients (Gen-3-style)
 *   node scripts/creature_sprites.mjs --review      # VLM critique of the contact sheet
 *
 * Env: the generator needs the z-ai-web-dev-sdk in node_modules and its
 *      credentials in the environment; the review pass needs the bridge
 *      (VLM_BRIDGE, default http://127.0.0.1:3031/v1/chat/completions,
 *       VLM_MODEL, default agnes-3.0-flash) — see scripts/agnes_review.mjs.
 *
 * Outputs:
 *   download/creatures/raw/<id>.png            1024×1024 raws (gitignored)
 *   public/landing/creatures/<id>.png          256px pixel sprites (committed)
 *   download/creatures/sheet.png               labeled contact sheet for review
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import ZAI from "z-ai-web-dev-sdk";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW_DIR = path.join(ROOT, "download/creatures/raw");
const OUT_DIR = path.join(ROOT, "public/landing/creatures");
const SHEET = path.join(ROOT, "download/creatures/sheet.png");
const LOGICAL = 64; // GBA OBJ sprites top out at 64×64 (GBATEK)
const SHIP_SCALE = 4; // 256px ship; displayed 1:1 logical with pixelated
const GEN_SIZE = "1024x1024";

/* ------------------------------------------------------------------ */
/* the style contract — the only vocabulary allowed to drift is the    */
/* per-feature CONCEPT line; everything else is locked so the set      */
/* reads as one bestiary.                                              */
/* ------------------------------------------------------------------ */

const STYLE =
  "flat 2D game sprite, original chibi monster companion creature, oversized head, " +
  "expressive simple eyes, stubby rounded body, thick deep-indigo outline of uniform weight, " +
  "limited 6-color palette of deep indigo navy, warm gold, cream, soft aqua blue, coral red " +
  "and leaf green, cel shading with hard color breaks, retro handheld game bestiary art, " +
  "front view, full body, standing pose, centered composition, sticker style, " +
  "plain solid white background, no gradients, no text, no watermark";

/**
 * One creature per feature. `concept` names the silhouette + the one prop
 * that encodes the feature; anything more and the sprite stops reading at
 * 64px. Ids are feature slugs (the landing labels them with feature names,
 * never species names — species fiction is not lore, it is noise).
 */
const CREATURES = [
  // IP note: never steer a round creature toward warm-gold/yellow — the
  // generator collapses that combination (round + yellow + pointed ears)
  // into a Pikachu derivative (verified by signifier audit, 2026-10-20).
  // Steer body color to aqua/teal/coral and the silhouette to bird/blob.
  { id: "websearch", concept: "a round aqua-blue bird-like explorer creature with satellite-dish ears, holding a small magnifying glass beside its face, curious wide eyes" },
  { id: "mcp", concept: "a friendly four-armed utility creature holding up three large simple tools: a wrench, a gear and a key, bold shapes, whole body well inside the frame with wide margins" },
  { id: "task", concept: "a round friendly creature juggling three small glowing orbs, one orb above each hand, bold simple shapes, whole body well inside the frame with wide margins" },
  { id: "lsp", concept: "a one-eyed scholarly creature wearing a monocle, holding an open book with code symbols on its pages" },
  { id: "memory", concept: "a plump archivist creature with a huge head and a filing-cabinet belly, hugging a neat stack of index cards" },
  { id: "harness", concept: "a stocky coral-red coach creature with a referee whistle around its neck, holding up a big gold stopwatch, bold simple shapes, whole body well inside the frame with wide margins" },
  { id: "router", concept: "a small aqua-blue courier creature with a wind-up clock face on its round belly, carrying a small satchel of envelopes, whole body well inside the frame with wide margins" },
  { id: "dream", concept: "a round sleeping creature with closed happy eyes, drifting on a small cloud, three tiny stars floating nearby" },
  { id: "hooks", concept: "a stout coral-red guardian creature with a friendly round face, holding a small navy shield in one hand, wearing a small gold helmet, calm smile, whole body well inside the frame with wide margins" },
  // (A `skills` scroll-bearer sprite was cut from the set 2026-10-20: the
  // dream+skills pair it served read as clutter beside the single-sprite
  // tiles, and an unplaced sprite ships dead weight. Tile 04 argues the
  // skills half of its story in prose.)
  { id: "sdlc", concept: "a small cream-bodied badger-like creature standing upright in a compact pose, wearing a small indigo vest with gold badges, cheerful smile, whole body well inside the frame with wide margins" },
];

/* ------------------------------------------------------------------ */
/* the GBA palette — the landing tokens themselves (globals.css @theme, */
/* dark scheme). A mirror, not a reference: if the page palette moves,  */
/* this moves with it in the same change. All values on the 5-bit grid. */
/*                                                                      */
/* Ramps: navy (canvas→panel→panel-2→line→line-bright→faint→aqua is a   */
/* 7-step blue ramp), creams (ink, dim), warm (gold, gold-soft, amber,  */
/* poke, magma + field darks), leaf, psychic. Sprites inherit the       */
/* page's world by construction.                                        */
/* ------------------------------------------------------------------ */

const PALETTE = [
  "#102039", // canvas — near-black, the outline
  "#182952", // panel
  "#29315a", // panel-2
  "#414a6a", // line
  "#62627b", // line-bright
  "#dee6ee", // ink — white/cream highlight
  "#bdcde6", // dim
  "#9cb4de", // faint
  "#ffc55a", // gold
  "#eee6a4", // gold-soft
  "#ffbd83", // amber
  "#ff7362", // poke
  "#ff8b41", // magma
  "#62acee", // aqua
  "#83c562", // leaf
  "#f67b9c", // psychic
  "#292010", // gold-field — cel-shadow for warm parts
  "#102939", // aqua-field
  "#291020", // magma-field
  "#102918", // leaf-field
  "#291029", // psychic-field
];

/* OKLab (Bottosson): RGB Euclidean mis-snaps saturated hues; Lab does not. */
const srgb = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const oklab = (r, g, b) => {
  const l = Math.cbrt(0.4122214708 * srgb(r) + 0.5363325363 * srgb(g) + 0.0514459929 * srgb(b));
  const m = Math.cbrt(0.2119034982 * srgb(r) + 0.6806995452 * srgb(g) + 0.1073969566 * srgb(b));
  const s = Math.cbrt(0.0883024619 * srgb(r) + 0.2817188376 * srgb(g) + 0.6299787005 * srgb(b));
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
};
const PAL_RGB = PALETTE.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const PAL_LAB = PAL_RGB.map(([r, g, b]) => oklab(r, g, b));

/* The dark half of the palette. A sprite whose BODY snaps mostly here reads
 * as a smudge on the light (cream) scheme — the page paints tokens, but a
 * sprite's pixels are fixed, so a dark-bodied creature only works on navy.
 * Bodies want the bright half; the outline (index 0) is the sanctioned dark. */
const DARK_SET = new Set([0, 1, 2, 3, 16, 17, 18, 19, 20]);

function snapIndex(r, g, b) {
  const c = oklab(r, g, b);
  let bi = 0, bd = Infinity;
  for (let i = 0; i < PAL_LAB.length; i++) {
    const p = PAL_LAB[i];
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

/* 2×2 Bayer at 1/5 strength — Gen-3 sprites dither gradients sparsely;
 * Floyd–Steinberg reads as noise at 64px, so ordered it is. */
const BAYER = [[0, 2], [3, 1]];
const bayerOffset = (x, y) => (BAYER[y & 1][x & 1] / 4 - 0.375) * 0.2;

/* ------------------------------------------------------------------ */
/* generation                                                          */
/* ------------------------------------------------------------------ */

async function generate(list) {
  const zai = await ZAI.create();
  fs.mkdirSync(RAW_DIR, { recursive: true });
  for (const c of list) {
    const out = path.join(RAW_DIR, `${c.id}.png`);
    if (fs.existsSync(out)) {
      console.log(`· ${c.id}: raw exists, skipping (delete to regenerate)`);
      continue;
    }
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const t0 = Date.now();
        const res = await zai.images.generations.create({ prompt: `${c.concept}. ${STYLE}`, size: GEN_SIZE });
        const b64 = res?.data?.[0]?.base64;
        if (!b64) throw new Error("empty response");
        fs.writeFileSync(out, Buffer.from(b64, "base64"));
        console.log(`✓ ${c.id}: generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        done = true;
      } catch (e) {
        console.error(`✗ ${c.id}: attempt ${attempt} failed — ${e.message}`);
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* cutout: white → transparent, defringe, trim — at natural size        */
/*                                                                     */
/* Flood fill from the border (not a global chroma key) so cream/white  */
/* *fills inside the sprite* survive; halo passes then eat the soft     */
/* shadow rings generators bake in.                                    */
/* ------------------------------------------------------------------ */

const near = (r, g, b, target, tol) =>
  Math.abs(r - target[0]) + Math.abs(g - target[1]) + Math.abs(b - target[2]) <= tol;

async function cutout(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  if (channels !== 4) throw new Error(`${file}: expected RGBA, got ${channels} channels`);
  const px = (x, y) => (y * w + x) * 4;

  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
    const i = px(x, y);
    return [data[i], data[i + 1], data[i + 2]];
  });
  const avg = corners.reduce((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]);
  const isWhite = avg[0] >= 232 && avg[1] >= 232 && avg[2] >= 232;
  // Flood generously in white mode so soft drop-shadow rings under sticker
  // sprites clear too; erode narrowly so cream fills inside the outline
  // survive the defringe pass.
  const tol = isWhite ? 60 : 26;
  const erode = 20;

  const clear = new Uint8Array(w * h); // 1 = background
  const queue = [];
  const seed = (x, y) => {
    const i = px(x, y);
    if (!clear[y * w + x] && near(data[i], data[i + 1], data[i + 2], avg, tol)) {
      clear[y * w + x] = 1;
      queue.push(x, y);
    }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (queue.length) {
    const y = queue.pop(), x = queue.pop();
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }

  // Halo pass: pale, desaturated pixels adjacent to the cleared region are
  // halo, not sprite — the saturated outline stops the leak.
  const lum = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const chroma = (i) => Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
  for (let pass = 0; pass < 3; pass++) {
    const next = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = px(x, y), c = y * w + x;
        if (clear[c] || data[i + 3] === 0) continue;
        const touches = clear[c - 1] || clear[c + 1] || clear[c - w] || clear[c + w];
        if (touches && lum(i) > 180 && chroma(i) < 45) next.push(c);
      }
    }
    if (!next.length) break;
    for (const c of next) clear[c] = 1;
  }
  for (let i = 0; i < w * h; i++) if (clear[i]) data[i * 4 + 3] = 0;

  // White-fringe erosion: an opaque pixel that touches the cutout and is
  // itself near-background gets dropped. Two narrow passes beat one wide
  // one: wide eats cream fills, narrow eats fringes.
  for (let pass = 0; pass < 2; pass++) {
    const drop = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = px(x, y);
        if (data[i + 3] === 0 || !clear[y * w + x - 1] && !clear[y * w + x + 1] && !clear[(y - 1) * w + x] && !clear[(y + 1) * w + x]) continue;
        if (near(data[i], data[i + 1], data[i + 2], avg, erode)) drop.push(i);
      }
    }
    if (!drop.length) break;
    for (const i of drop) data[i + 3] = 0;
  }

  // Trim to the content box (alpha).
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[px(x, y) + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error(`${file}: nothing left after cutout`);
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const trimmed = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const src = ((y0 + y) * w + x0) * 4;
    trimmed.set(data.subarray(src, src + tw * 4), y * tw * 4);
  }
  return { data: trimmed, width: tw, height: th, cut: ((w * h) - (tw * th)) / (w * h) * 100 };
}

/* ------------------------------------------------------------------ */
/* gba-ify: 64px logical grid, 1-bit alpha, site-palette snap          */
/*                                                                     */
/* Box-average (not nearest) on the way down: it smooths the cel        */
/* shading into flat regions and never rings the outline. Premultiplied */
/* average so edge pixels lean outline, not background.                 */
/* ------------------------------------------------------------------ */

/** Snap to the nearest color among a SUBSET of palette indices (the prune
 *  pass) — same OKLab distance, restricted candidates. */
function snapIndexWithin(r, g, b, allow) {
  const c = oklab(r, g, b);
  let bi = allow[0], bd = Infinity;
  for (const i of allow) {
    const p = PAL_LAB[i];
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

async function gbaify({ data, width: w, height: h }, dither, maxColors = 8) {
  const scale = Math.min(LOGICAL / w, LOGICAL / h, 1);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  // Box-average once into flat arrays (premultiplied so edge pixels lean
  // outline, not background) + 1-bit alpha.
  const rgb = new Float32Array(tw * th * 3);
  const opaque = new Uint8Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = Math.floor((tx * w) / tw), sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * w) / tw));
      const sy0 = Math.floor((ty * h) / th), sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * h) / th));
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, n = 0;
      for (let y = sy0; y < sy1 && y < h; y++) {
        for (let x = sx0; x < sx1 && x < w; x++) {
          const i = (y * w + x) * 4;
          const a = data[i + 3] / 255;
          rSum += data[i] * a;
          gSum += data[i + 1] * a;
          bSum += data[i + 2] * a;
          aSum += a;
          n++;
        }
      }
      const p = ty * tw + tx;
      if (aSum / n < 0.5 || aSum === 0) { opaque[p] = 0; continue; }
      let [r, g, b] = [rSum / aSum, gSum / aSum, bSum / aSum];
      if (dither) {
        const off = bayerOffset(tx, ty) * 255;
        r = Math.min(255, Math.max(0, r + off));
        g = Math.min(255, Math.max(0, g + off));
        b = Math.min(255, Math.max(0, b + off));
      }
      rgb[p * 3] = r; rgb[p * 3 + 1] = g; rgb[p * 3 + 2] = b;
      opaque[p] = 1;
    }
  }

  // Pass 1: snap to the full palette, tally which entries carry weight.
  const counts = new Array(PALETTE.length).fill(0);
  const snap1 = new Int16Array(tw * th);
  for (let p = 0; p < tw * th; p++) {
    if (!opaque[p]) continue;
    const i = snapIndex(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
    snap1[p] = i;
    counts[i]++;
  }

  // Prune to the heaviest entries — Gen-3 sprites carried 16 colors and
  // chunky two-tone shading; a sprite using 20 ramp steps reads as smooth
  // modern flat art, which is the exact complaint this stage exists to fix.
  // The outline (index 0) is force-kept: dropping it would dissolve edges.
  let keep = [];
  for (let i = 0; i < PALETTE.length; i++) if (counts[i] > 0) keep.push(i);
  keep.sort((a, b) => counts[b] - counts[a]);
  keep = keep.slice(0, maxColors);
  if (counts[0] > 0 && !keep.includes(0)) keep[keep.length - 1] = 0;

  // Pass 2: re-snap every pixel within the survivors.
  const out = Buffer.alloc(tw * th * 4);
  const used = new Set();
  let dark = 0, lit = 0;
  for (let p = 0; p < tw * th; p++) {
    const o = p * 4;
    if (!opaque[p]) continue;
    const i = keep.includes(snap1[p]) ? snap1[p] : snapIndexWithin(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], keep);
    used.add(i);
    if (DARK_SET.has(i)) dark++; else lit++;
    out[o] = PAL_RGB[i][0];
    out[o + 1] = PAL_RGB[i][1];
    out[o + 2] = PAL_RGB[i][2];
    out[o + 3] = 255;
  }
  return { data: out, width: tw, height: th, colors: used.size, darkRatio: dark / (dark + lit) };
}

/* ------------------------------------------------------------------ */
/* edge-clip gate (on the RAW — a trimmed sprite always touches its     */
/* own bounding box, so checking the shipped PNG false-positives)       */
/* ------------------------------------------------------------------ */

async function edgeClipped(rawFile) {
  const { data, info } = await sharp(rawFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const avg = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)]
    .reduce((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]);
  const off = (r, g, b) => Math.abs(r - avg[0]) + Math.abs(g - avg[1]) + Math.abs(b - avg[2]) > 60;
  const RING = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= RING && x < w - RING && y >= RING && y < h - RING) continue;
      const [r, g, b] = at(x, y);
      if (off(r, g, b)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */

async function postProcess(dither) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rows = [];
  for (const c of CREATURES) {
    const raw = path.join(RAW_DIR, `${c.id}.png`);
    if (!fs.existsSync(raw)) { console.error(`· ${c.id}: no raw, skipping`); continue; }
    const cut = await cutout(raw);
    const gba = await gbaify(cut, dither);
    const buf = await sharp(gba.data, { raw: { width: gba.width, height: gba.height, channels: 4 } })
      .resize({ width: gba.width * SHIP_SCALE, height: gba.height * SHIP_SCALE, kernel: "nearest" })
      .png({ palette: true, compressionLevel: 9, effort: 8 })
      .toBuffer();
    const out = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(out, buf);
    rows.push([
      c.id, `${gba.width}×${gba.height}`, (buf.length / 1024).toFixed(1),
      String(gba.colors), `${(gba.darkRatio * 100).toFixed(0)}%d`,
      (await edgeClipped(raw)) ? "EDGE-CLIPPED!" : "",
    ]);
  }
  console.log("\ncreature        logical   kb  cols  dark  flags");
  for (const [id, dims, kb, colors, dark, flag] of rows) {
    console.log(`${id.padEnd(14)} ${dims.padEnd(8)} ${kb.padStart(5)}  ${colors.padStart(4)}  ${dark.padStart(4)}  ${flag}`);
  }
  const clipped = rows.filter((r) => r[5]);
  if (clipped.length) {
    console.error(`\n✗ edge-clipped sprites (regenerate with a tighter pose): ${clipped.map((r) => r[0]).join(", ")}`);
    process.exitCode = 1;
  }
  // A dark-heavy sprite fails the light scheme (measured on the cream bento
  // tiles, 2026-10-20: >45% dark pixels read as a smudge). 30% warns.
  const smudgy = rows.filter((r) => parseInt(r[4]) > 30);
  if (smudgy.length) {
    console.warn(`⚠ dark-heavy sprites (will smudge on the light scheme — regenerate with a bright body): ${smudgy.map((r) => `${r[0]}(${r[4]})`).join(", ")}`);
  }
  const fat = rows.filter((r) => Number(r[3]) > 16);
  if (fat.length) {
    // Gen-3 sprites carry 16 colors; more still reads fine, but say so.
    console.warn(`⚠ over 16 palette entries: ${fat.map((r) => `${r[0]}(${r[3]})`).join(", ")}`);
  }
}

/* ------------------------------------------------------------------ */
/* contact sheet (SVG → PNG, labeled, checkerboard to expose alpha)    */
/* ------------------------------------------------------------------ */

async function contactSheet() {
  const CELL = 512, PAD = 24, COLS = 4;
  const rows = Math.ceil(CREATURES.length / COLS);
  const W = COLS * (CELL + PAD) + PAD, H = rows * (CELL + PAD + 40) + PAD;
  let defs = "", body = "";
  for (let i = 0; i < CREATURES.length; i++) {
    const c = CREATURES[i];
    const file = path.join(OUT_DIR, `${c.id}.png`);
    if (!fs.existsSync(file)) continue;
    // Upscale the pixel sprite with nearest so the sheet shows true pixels.
    const b64 = (await sharp(file).resize(CELL - 64, CELL - 64, { fit: "inside", kernel: "nearest" }).png().toBuffer()).toString("base64");
    const x = PAD + (i % COLS) * (CELL + PAD), y = PAD + Math.floor(i / COLS) * (CELL + PAD + 40);
    defs += `<pattern id="chk${i}" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#7a7a7a"/><rect width="16" height="16" fill="#6a6a6a"/><rect x="16" y="16" width="16" height="16" fill="#6a6a6a"/></pattern>`;
    body += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="url(#chk${i})" stroke="#444" stroke-width="2"/>` +
      `<image x="${x}" y="${y}" width="${CELL}" height="${CELL}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${b64}"/>` +
      `<text x="${x + CELL / 2}" y="${y + CELL + 26}" font-family="monospace" font-size="30" font-weight="bold" fill="#111" text-anchor="middle">${c.id}</text>`;
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
            "IP-SAFETY: does any sprite closely resemble a specific named Pokémon or official game art? (must be none)\n" +
            "READABILITY: at this size, which sprites' key features (props, faces) stop reading? name ids\n" +
            "CONSISTENCY: do all sprites read as one style family (pixel density, outline, proportions)? name outliers\n" +
            "No preamble.",
        },
        { type: "image_url", image_url: { url: `data:image/png;base64,${buf.toString("base64")}` } },
      ],
    }],
    max_tokens: 600,
  };
  const resp = await fetch(BRIDGE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json();
  console.log(json.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 300));
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
if (args.includes("--review")) {
  await review();
} else {
  const idIdx = args.indexOf("--id");
  const only = idIdx !== -1 ? CREATURES.filter((c) => c.id === args[idIdx + 1]) : null;
  if (idIdx !== -1 && only?.length === 0) {
    console.error(`unknown id "${args[idIdx + 1]}" — ids: ${CREATURES.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  if (!args.includes("--process")) await generate(only ?? CREATURES);
  await postProcess(args.includes("--dither"));
  await contactSheet();
}
