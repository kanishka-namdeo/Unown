/**
 * The Unown script — a hand-authored 28-form alphabet (A–Z, plus `!` and `?`)
 * built for this landing page.
 *
 * DESIGN NOTES
 * ------------
 * Unown (the Pokémon this project is named after) has no canonical English
 * letterforms we could ship, and copying art out of the games would be both
 * legally messy and technically heavy. So this is an *homage script* drawn
 * from scratch: geometric, heavy-tailed, slightly alien. Every glyph is built
 * from the same skeleton, which is what makes the alphabet read as one system:
 *
 *   cap top     y = 22      ascender   y = 12
 *   baseline    y = 78      descender  y = 88
 *   left        x = 22      right      x = 78
 *   centre      x = 50      mid        y = 50
 *
 * Glyphs are stroke paths, never fills, which buys us two renderings from one
 * data set:
 *
 *   WEIGHT.heavy  (~20u) — the silhouette weight, used for the hero mark and
 *                         the alphabet wall, where the letter has to read as
 *                         a shape the way Unown's body reads as a shape.
 *   WEIGHT.script (~8u)  — the reading weight, used where the glyph is a
 *                         letterform rather than a silhouette.
 *
 * `dot` subpaths are zero-length segments (`M50 74 L50 74`); with
 * `stroke-linecap="round"` the SVG spec renders those as round dots, which is
 * how `!` and `?` get their periods without extra elements.
 */

export type GlyphId =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L"
  | "M" | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X"
  | "Y" | "Z" | "!" | "?";

/** The 28 forms, in the order Unown learns them. */
export const GLYPH_IDS: GlyphId[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "!", "?",
];

/** The 26 letters on their own, for alphabets and wordmarks. */
export const LETTERS: GlyphId[] = GLYPH_IDS.filter((g) => g !== "!" && g !== "?") as GlyphId[];

/** Stroke weights, in user units of the 100×100 grid. */
export const WEIGHT = {
  // Silhouette weight. Unown's body IS the letter, so this has to read as a
  // shape rather than as handwriting.
  heavy: 23,
  // Reading weight: legible as a letterform at small sizes.
  script: 8.5,
} as const;

export type GlyphWeight = keyof typeof WEIGHT;

/**
 * Each glyph is a list of subpaths. Every subpath starts at an absolute `M`
 * so subpaths can be animated independently later if we ever want to.
 */
export const GLYPHS: Record<GlyphId, string[]> = {
  A: ["M22 78 L50 22 L78 78", "M33 58 L67 58"],
  B: [
    "M24 22 L24 78",
    "M24 22 L56 22 Q76 22 76 35 Q76 48 56 48 L24 48",
    "M24 48 L60 48 Q78 48 78 63 Q78 78 60 78 L24 78",
  ],
  C: ["M74 33 Q64 22 50 22 Q24 22 24 50 Q24 78 50 78 Q64 78 74 67"],
  D: ["M26 22 L26 78", "M26 22 L48 22 Q76 22 76 50 Q76 78 48 78 L26 78"],
  E: ["M74 22 L24 22 L24 78 L74 78", "M24 50 L62 50"],
  F: ["M74 22 L24 22 L24 78", "M24 50 L60 50"],
  G: ["M74 33 Q64 22 50 22 Q24 22 24 50 Q24 78 50 78 Q74 78 74 60 L74 56 L56 56"],
  H: ["M24 22 L24 78", "M76 22 L76 78", "M24 50 L76 50"],
  I: ["M50 22 L50 78", "M35 22 L65 22", "M35 78 L65 78"],
  J: ["M66 22 L66 60 Q66 78 50 78 Q34 78 34 61", "M48 22 L72 22"],
  K: ["M26 22 L26 78", "M74 22 L28 52", "M46 39 L78 78"],
  L: ["M26 22 L26 78 L72 78"],
  M: ["M20 78 L20 22 L50 58 L80 22 L80 78"],
  N: ["M24 78 L24 22 L76 78 L76 22"],
  O: ["M50 50 m-28 0 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0"],
  P: ["M26 22 L26 78", "M26 22 L54 22 Q76 22 76 38 Q76 54 54 54 L26 54"],
  Q: ["M50 50 m-28 0 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0", "M57 61 L79 84"],
  R: [
    "M26 22 L26 78",
    "M26 22 L54 22 Q76 22 76 38 Q76 54 54 54 L26 54",
    "M48 54 L78 78",
  ],
  S: [
    "M74 32 Q64 22 50 22 Q28 22 28 37 Q28 51 50 51 Q73 51 73 65 Q73 78 50 78 Q33 78 25 68",
  ],
  T: ["M20 22 L80 22", "M50 22 L50 78"],
  U: ["M24 22 L24 58 Q24 78 50 78 Q76 78 76 58 L76 22"],
  V: ["M21 22 L50 78 L79 22"],
  W: ["M16 22 L31 78 L50 34 L69 78 L84 22"],
  X: ["M23 22 L77 78", "M77 22 L23 78"],
  Y: ["M23 22 L50 52 L77 22", "M50 52 L50 78"],
  Z: ["M22 22 L78 22 L22 78 L78 78"],
  "!" : ["M50 20 L50 58", "M50 74 L50 74"],
  "?": ["M28 33 Q34 22 50 22 Q68 22 68 35 Q68 47 55 53 Q50 56 50 62", "M50 74 L50 74"],
};

/**
 * Non-letter marks. In the games Unown's language is littered with symbols that
 * aren't letters; these give us texture for backgrounds and the letter-rain
 * without pretending to be readable.
 */
export const MARKS: Record<string, string[]> = {
  /** the crossed bar — reads as "gate" */
  bar: ["M18 50 L82 50", "M32 34 L68 66", "M68 34 L32 66"],
  /** the nested diamonds — reads as "sandbox" */
  nest: ["M50 16 L84 50 L50 84 L16 50 Z", "M50 34 L68 50 L50 66 L32 50 Z"],
  /** the open hook — reads as "dream" */
  hook: ["M78 26 Q50 14 30 34 Q10 54 30 74 Q50 90 74 76"],
  /** the barred triangle — reads as "guardrail" */
  wedge: ["M50 18 L82 74 L18 74 Z", "M50 40 L66 68 L34 68 Z"],
  /** the split circle — reads as "rollback" */
  split: ["M50 50 m-28 0 a28 28 0 1 0 56 0 a28 28 0 1 0 -56 0", "M50 22 L50 78"],
  /** the spiral — reads as "recursion" */
  coil: [
    "M50 50 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0",
    "M50 50 m-18 0 a18 18 0 1 0 36 0 a18 18 0 1 0 -36 0",
    "M50 50 m-30 0 a30 30 0 1 0 60 0 a30 30 0 1 0 -60 0",
  ],
};

export type MarkId = keyof typeof MARKS;

/** Metric constants the components rely on — keep in sync with the paths. */
export const METRICS = {
  viewBox: "0 0 100 100",
  capTop: 22,
  baseline: 78,
  midY: 50,
  /** where the eye sits on every glyph, in glyph units */
  eye: { x: 50, y: 50, r: 11 },
} as const;

/** Safe index into any glyph array — used for deterministic RNG-free scatter. */
export function markFor(seed: number): MarkId {
  const keys = Object.keys(MARKS) as MarkId[];
  return keys[Math.abs(seed) % keys.length];
}