import * as React from "react";

/**
 * The feature creatures.
 *
 * One original 2D "monster companion" render per agent feature. Since
 * 2026-10-20 their one canonical home is the capability dex (`dex.tsx`,
 * fed by `dex-data.ts`): the hero's old session-party strip and the loop
 * bento's tile badges retired when the dex arrived, so every sprite and
 * every capability line lives in one catalog. They are AUTHORED pixel
 * art — drawn pixel-by-pixel in code (`scripts/creature_sprites.mjs` +
 * `creature_kit.mjs` + `creature_atlas.mjs`), never Pokémon assets and
 * never a named species (the non-affiliation wall, landing AGENTS.md).
 * Two same-day redraws: the atlas round replaced the first AI-generated
 * set (a generated illustration averaged onto a 64px grid reads as mush,
 * while authored pixels read as a sprite — the pipeline gates that
 * difference), and the variety round gave every creature its own body
 * plan — crawler, golem, serpent, bookwyrm, turtle, roo, signpost,
 * sheep, crab, badger — because a set that shares one silhouette reads
 * as reskins no matter how good each sprite is (the landing AGENTS.md
 * carries the one-body-plan doctrine). The pipeline gates that difference
 * (edge-outline integrity, orphan clusters, the 5-bit GBA grid, ≤ 15
 * colours, dark-ratio ≤ 30%, shared baseline). Sprites ship at 4× (a
 * uniform 256×256) and display at integer multiples of the 64px logical
 * grid via the `.creature` class (image-rendering: pixelated) — h-16 is
 * 1:1, the dex detail's h-48 is 3× — which keeps every logical pixel a
 * hard square. A non-integer height resamples the grid and is a defect.
 *
 * A creature is decoration with a text label beside it (WAI tutorial: images
 * whose meaning is given by surrounding text are decorative) — the default
 * render is alt="" + aria-hidden. `label` exists for the day a creature is
 * the sole content of a meaningful control; so far none is.
 */
export const CREATURE_IDS = [
  "websearch",
  "mcp",
  "task",
  "lsp",
  "memory",
  "harness",
  "router",
  "dream",
  "hooks",
  "sdlc",
  "browser",
] as const;

export type CreatureId = (typeof CREATURE_IDS)[number];

/** Intrinsic dims at ship scale — the atlas ships every sprite on the full
 *  64px logical canvas (uniform margins, shared baseline), so every entry is
 *  256×256 at 4×. A composition that changes that updates this table in the
 *  same change (the pipeline prints the logical dims). */
const DIMS: Record<CreatureId, { w: number; h: number }> = {
  websearch: { w: 256, h: 256 },
  mcp: { w: 256, h: 256 },
  task: { w: 256, h: 256 },
  lsp: { w: 256, h: 256 },
  memory: { w: 256, h: 256 },
  harness: { w: 256, h: 256 },
  router: { w: 256, h: 256 },
  dream: { w: 256, h: 256 },
  hooks: { w: 256, h: 256 },
  sdlc: { w: 256, h: 256 },
  browser: { w: 256, h: 256 },
};

export function Creature({
  id,
  className = "h-16 w-auto",
  label,
}: {
  id: CreatureId;
  /** Height-locked at a 64px logical multiple (h-16 = 1:1) so the pixel
   *  grid never resamples; `w-auto` keeps each sprite's natural aspect. */
  className?: string;
  label?: string;
}) {
  const d = DIMS[id];
  return (
    <img
      src={`/landing/creatures/${id}.png`}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      width={d.w}
      height={d.h}
      loading="lazy"
      decoding="async"
      className={`creature ${className}`}
    />
  );
}
