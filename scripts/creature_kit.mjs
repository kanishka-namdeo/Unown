/**
 * creature_kit.mjs — the drawing kit for the feature-creature atlas.
 *
 * Everything a composition needs to draw one GBA-style sprite: the atlas
 * palette, region predicates, cel-band shading, the 1px outline pass, the
 * shared face template, feet, arms and the standing chibi. Pure and
 * deterministic — no I/O, no API, same canvas every run. See
 * scripts/creature_sprites.mjs for the pipeline contract and
 * docs/agentic-asset-workflow.md for the workflow this belongs to.
 */

export const N = 64;
export const BASELINE = 52;

/* ------------------------------------------------------------------ */
/* the atlas palette — every key on the GBA 5-bit channel grid, gated  */
/* downstream. Hue-shifted ramps (shadows toward blue/violet, lights   */
/* toward yellow/white — the pret palettes do the same); hues are the  */
/* page's own families, so sprites inherit the page's world by hue.    */
/* ------------------------------------------------------------------ */
export const COLORS = {
  O: "#102039", // outline, pupils, mouths — the page canvas navy (near-black, not #000)
  W: "#ffffff", // glints and sparkles — on-grid white
  // plate: the face/belly cream-blue family (the page's ink ramp)
  P1: "#9cb4de", P2: "#bdcde6", P3: "#dee6ee", P4: "#eef6ff",
  // aqua ramp (websearch)
  A0: "#18418b", A1: "#2973c5", A2: "#62acee", A3: "#a4d5f6", A4: "#e6f6ff",
  // magma ramp (harness, hooks)
  M0: "#8b3908", M1: "#c55a20", M2: "#ff8b41", M3: "#ffc59c", M4: "#ffe6d5",
  // gold ramp (router's body, accents: stopwatch, badges, stars, handles)
  G1: "#d58b20", G2: "#ffc55a", G3: "#ffe6a4", G4: "#ffffee",
  // amber ramp (lsp, the scholar)
  B1: "#c5834a", B2: "#ffbd83", B3: "#ffe6c5",
  // cream ramp (memory, sdlc, task bodies; dream's cloud)
  C1: "#d5c57b", C2: "#eee6a4", C3: "#f6ffee",
  // leaf ramp (mcp, the living toolkit)
  L1: "#4a8b39", L2: "#83c562", L3: "#c5e6a4", L4: "#eef6e6",
  // psychic ramp (dream, task's orb)
  K1: "#c54a73", K2: "#f67b9c", K3: "#ffb4c5", K4: "#ffdee6",
  // navy props — the page's panel ramp (sockets, vest, shield field, hands)
  N1: "#182952", N2: "#29315a", N3: "#414a6a", N4: "#62627b",
};

export const hexRgb = (h) => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];
export const RGB = Object.fromEntries(Object.entries(COLORS).map(([k, h]) => [k, hexRgb(h)]));

/* ------------------------------------------------------------------ */
/* canvas + regions                                                    */
/* ------------------------------------------------------------------ */

export const make = () => Array.from({ length: N }, () => Array(N).fill(null));
export const px = (c, x, y, k) => { if (x >= 0 && x < N && y >= 0 && y < N) c[y][x] = k; };
export const at = (c, x, y) => (x >= 0 && x < N && y >= 0 && y < N ? c[y][x] : null);

/** Region predicates — pure (x,y) => bool, composed with union/minus. */
export const inEllipse = (cx, cy, rx, ry) => (x, y) =>
  ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) <= 1;
export const inRoundRect = (cx, cy, w, h, r) => (x, y) => {
  if (Math.abs(x - cx) > w / 2 || Math.abs(y - cy) > h / 2) return false;
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  return dx <= 0 || dy <= 0 || dx * dx + dy * dy <= r * r;
};
export const inTri = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const s = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  const t = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const u = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
};
export const union = (...fns) => (x, y) => fns.some((f) => f(x, y));
export const minus = (a, b) => (x, y) => a(x, y) && !b(x, y);

/** Paint a region with one key. */
export const paint = (c, region, k) => {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (region(x, y)) px(c, x, y, k);
};

/** rim(f, dx, dy): pixels of f that fall out of f shifted by (dx,dy) — a
 * directional boundary band. rim(f, 2, 2) is the top-left band (light),
 * rim(f, -2, -2) the bottom-right band (shadow). Cel bands, not blends. */
export const rim = (f, dx, dy) => (x, y) => f(x, y) && !f(x - dx, y - dy);

/** Base + light band + shadow band under the one top-left light. */
export function shade(c, region, ramp) {
  const { base, light, shadow, lightD = [2, 2], shadowD = [-2, -2] } = ramp;
  paint(c, region, base);
  if (light) paint(c, rim(region, lightD[0], lightD[1]), light);
  if (shadow) paint(c, rim(region, shadowD[0], shadowD[1]), shadow);
}

/** A 2×1 head glint — the one deliberate sparkle per creature. */
export const glint = (c, x, y, k) => { px(c, x, y, k); px(c, x + 1, y, k); };

/** Paste an ASCII stamp. `legend` maps chars to keys; '.' leaves the canvas. */
export function stamp(c, x0, y0, rows, legend) {
  rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch === ".") return;
      const k = legend[ch];
      if (!k) throw new Error(`stamp char "${ch}" not in legend`);
      px(c, x0 + dx, y0 + dy, k);
    });
  });
}

/** THE outline: every opaque pixel that touches transparency becomes the
 *  outline key. 1px by construction, follows every silhouette and island. */
export function outlinePass(c) {
  const out = c.map((r) => [...r]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (at(c, x, y) === null) continue;
      const touches =
        at(c, x - 1, y) === null || at(c, x + 1, y) === null ||
        at(c, x, y - 1) === null || at(c, x, y + 1) === null;
      if (touches) out[y][x] = "O";
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the shared face — what makes ten drawings one bestiary              */
/* ------------------------------------------------------------------ */

/** Low-set 3×4 eyes with a top-left glint, cheeks, mouth. Mirrored column
 *  math keeps the face symmetric; `closed` draws sleeping arcs instead. */
export function face(c, o = {}) {
  const eyeY = o.eyeY ?? 23, dx = o.eyeGap ?? 9, w = o.eyeW ?? 3, h = o.eyeH ?? 4;
  const l = Math.round(31.5 - dx / 2 - w / 2), r = 63 - l - w + 1;
  for (const ex of [l, r]) {
    if (o.closed) {
      px(c, ex, eyeY + 1, "O"); px(c, ex + 1, eyeY, "O"); px(c, ex + 2, eyeY + 1, "O");
    } else {
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) px(c, ex + xx, eyeY + yy, "O");
      px(c, ex, eyeY, "W"); px(c, ex, eyeY + 1, "W");
    }
  }
  if (o.cheek) {
    const cy = eyeY + (o.cheekDy ?? 4);
    px(c, l - 3, cy, o.cheek); px(c, l - 2, cy, o.cheek);          // left cheek
    px(c, 63 - (l - 2), cy, o.cheek); px(c, 63 - (l - 3), cy, o.cheek); // mirrored right
  }
  const mY = eyeY + (o.mouthDy ?? 6);
  if (o.mouth === "open") {
    px(c, 31, mY, "O"); px(c, 32, mY, "O"); px(c, 31, mY + 1, "O"); px(c, 32, mY + 1, "O");
  } else if (o.mouth === "smile") {
    const half = Math.floor((o.mouthW ?? 3) / 2);
    for (let i = -half; i <= half; i++) px(c, Math.round(31.5 + i), mY, "O");
    if ((o.mouthW ?? 3) >= 5) { px(c, 31 - half - 1, mY - 1, "O"); px(c, 32 + half + 1, mY - 1, "O"); }
  }
  return { eyeCols: [l, r] };
}

/** Stubby feet on the shared baseline; they blend into the body bottom the
 *  way Gen-3 sprites do — the gap between them is what reads as feet. */
export function feet(c, ramp, o = {}) {
  const fw = o.w ?? 8, fh = o.h ?? 6, gap = o.gap ?? 8, top = (o.baseline ?? BASELINE) - fh + 1;
  for (const side of [-1, 1]) {
    const cx = 31.5 + side * (gap / 2 + fw / 2);
    shade(c, inRoundRect(cx, top + fh / 2 - 0.5, fw, fh, 2), {
      base: ramp.base, shadow: ramp.shadow, shadowD: [-1, -2],
    });
  }
}

/** Little side nubs (arms/wings), shaded like the body. */
export function arms(c, ramp, kind, o = {}) {
  if (kind === "side") {
    for (const side of [-1, 1]) {
      shade(c, inRoundRect(31.5 + side * (o.reach ?? 14.5), o.y ?? 37, o.w ?? 5, o.h ?? 8, 2), {
        base: ramp.base, shadow: ramp.shadow, shadowD: [-1, -2],
      });
    }
  } else if (kind === "raise") {
    // arms up beside the head, hands open — for the overhead prop poses
    for (const side of [-1, 1]) {
      const cx = 31.5 + side * (o.reach ?? 10.5);
      shade(c, inRoundRect(cx, o.y ?? 18, o.w ?? 3, o.h ?? 15, 1), {
        base: ramp.base, shadow: ramp.shadow, shadowD: [-1, -1],
      });
    }
  }
}

/** The standing chibi: head ellipse over body roundrect, shaded, plated,
 *  faced, footed. Ears/crests join the silhouette via `extra`; everything
 *  else — props, overrides — is composed by the caller after this call. */
export function chibi(c, o) {
  const head = inEllipse(o.hx ?? 31.5, o.hy, o.hrx, o.hry);
  const body = inRoundRect(o.bx ?? 31.5, o.by, o.bw, o.bh, o.br ?? 6);
  const region = o.extra ? union(head, body, o.extra) : union(head, body);
  shade(c, region, o.ramp);
  if (o.plate !== false) {
    const p = inEllipse(31.5, o.plateY ?? 21, o.plateRx ?? 11, o.plateRy ?? 8);
    paint(c, p, "P3");
    paint(c, rim(p, 0, -2), "P2"); // the plate's own under-shadow
    paint(c, rim(p, 1, 2), "P4");  // and its top-light
  }
  const eyes = face(c, o.face ?? {});
  feet(c, o.ramp, o.feet ?? {});
  return { region, eyes };
}

/* ------------------------------------------------------------------ */
/* shared stamps — hand-drawn, small, one idea each                    */
/* ------------------------------------------------------------------ */

/** A 5×5 sparkle star — connected arms, white-hot center. */
export const STAR = ["..g..", ".ggg.", "ggWgg", ".ggg.", "..g.."];

/** The z-z-z of sleep — gold, biggest nearest the sleeper, sized to read
 *  at 1× (the first round's z's were sub-pixel at display size). */
export const Z_BIG = ["zzzzz", "....z", "..z..", "z....", "zzzzz"];
export const Z_MID = ["zzzz", "...z", ".z..", "z...", "zzzz"];
export const Z_SML = ["zzz", "..z", "z..", "zzz"];

/** The magnifier (websearch): gold ring, navy lens, aqua glint, handle. */
export const MAGNIFIER = [
  "..gggg..",
  ".gnnnng.",
  "gnannnng",
  "gnnannng",
  "gnnnnnng",
  ".gnnnng.",
  "..gggg..",
  "....gg..",
  "....gg..",
];

/** The stopwatch (harness): gold ring and crown, cream face, navy hands. */
export const STOPWATCH = [
  "....g....",
  "...ggg...",
  ".ggggggg.",
  ".gpppppg.",
  "hgppoppg.",
  "hgppoppg.",
  ".gppooog.",
  ".gpppppg.",
  ".ggggggg.",
];
