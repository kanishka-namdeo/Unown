import * as React from "react";

/**
 * The feature creatures.
 *
 * One original 2D "monster companion" render per agent feature. Since
 * 2026-10-20 their one canonical home is the capability dex (`dex.tsx`,
 * fed by `dex-data.ts`): the hero's old session-party strip and the loop
 * bento's tile badges retired when the dex arrived, so every sprite and
 * every capability line lives in one catalog. They are AI-generated
 * original artwork, never Pokémon assets and never a named species (the
 * non-affiliation wall, landing AGENTS.md). The pipeline
 * (`scripts/creature_sprites.mjs`) GBA-ifies every render: 64px logical
 * grid, 1-bit alpha, and every pixel snapped to the page's own palette
 * tokens — so a creature can no more leave the page's world than a glyph
 * can. Sprites ship at 4× (256px) and display at integer multiples of the
 * logical size via the `.creature` class (image-rendering: pixelated) —
 * h-16 is 1:1, the dex detail's h-32 is 2× — which keeps every logical
 * pixel a hard square. A non-integer height resamples the grid and is a
 * defect.
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
] as const;

export type CreatureId = (typeof CREATURE_IDS)[number];

/** Intrinsic dims at ship scale (4× the 64px logical grid), so the browser
 *  reserves layout before load. The pipeline prints the logical dims; a
 *  regeneration that changes them updates this table in the same change. */
const DIMS: Record<CreatureId, { w: number; h: number }> = {
  websearch: { w: 228, h: 256 },
  mcp: { w: 256, h: 252 },
  task: { w: 220, h: 256 },
  lsp: { w: 252, h: 256 },
  memory: { w: 228, h: 256 },
  harness: { w: 240, h: 256 },
  router: { w: 220, h: 256 },
  dream: { w: 244, h: 256 },
  hooks: { w: 184, h: 256 },
  sdlc: { w: 180, h: 256 },
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
