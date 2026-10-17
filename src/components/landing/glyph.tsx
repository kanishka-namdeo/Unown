import type { CSSProperties } from "react";
import {
  GLYPHS,
  EYES,
  MARKS,
  METRICS,
  WEIGHT,
  type GlyphId,
  type GlyphWeight,
} from "./glyphs";

/* ------------------------------------------------------------------ */
/* the eye                                                             */
/* ------------------------------------------------------------------ */

/**
 * The eye: a dark disc punched through the letter with a bright vertical slit.
 *
 * Deliberately circular rather than lens-shaped. An almond two-and-a-half units
 * taller than it is wide reads as a keyhole the moment it overlaps a stroke,
 * and on the closed forms (`B`, `D`, `P`, `T`, `H`) it always overlaps
 * something. A disc survives that contact and still reads as an eye, which is
 * exactly the trick the games use.
 *
 * `tone` is the only difference between the two states, and it is all CSS vars:
 * a `dim` eye is a void with a faint rim that disappears into the page, a `lit`
 * eye is unmistakably awake. Quiet by default so a wall of twenty-eight tiles
 * does not strobe; lit only where one glyph is the subject.
 */
function Eye({ r, slit, tone }: { r: number; slit: number; tone: "dim" | "lit" }) {
  const rim = tone === "lit" ? r * 0.13 : r * 0.1;
  return (
    <g>
      <circle
        r={r}
        fill="var(--unown-eye)"
        stroke="var(--unown-eye-rim)"
        strokeWidth={rim}
      />
      <rect
        x={-slit / 2}
        y={-r * 0.6}
        width={slit}
        height={r * 1.2}
        rx={slit / 2}
        fill="var(--unown-eye-lit)"
      />
    </g>
  );
}

/**
 * Colour pairs for the two eye states, set as inline vars on the svg.
 *
 * DMG shades, not emeralds: `dim` is a void in the darkest screen green with
 * a `line-bright` rim, `lit` steps to `glow`/`glow-soft`. Deliberately no
 * colour brighter than shade 4 — the whole point of the palette is that
 * nothing on this page could be lit by a Game Boy that a Game Boy could not
 * already produce.
 */
export const EYE_TONES: Record<"dim" | "lit", CSSProperties> = {
  dim: {
    "--unown-eye": "#0a140a",
    "--unown-eye-rim": "#2f5a2f",
    "--unown-eye-lit": "#5f7f4a",
  } as CSSProperties,
  lit: {
    "--unown-eye": "#04100a",
    "--unown-eye-rim": "#9bbc0f",
    "--unown-eye-lit": "#c3e06a",
  } as CSSProperties,
};

/* ------------------------------------------------------------------ */
/* glyph                                                               */
/* ------------------------------------------------------------------ */

export type GlyphProps = {
  /** Which form to draw. `null` renders nothing (used for scramble states). */
  id: GlyphId | null;
  /** `heavy` = Unown's silhouette, `script` = the letterform. */
  weight?: GlyphWeight;
  /** Draw the eye in the letter's counter. Default: only at heavy weight. */
  eye?: boolean;
  /** `dim` (default) reads as a void; `lit` reads as awake. */
  tone?: "dim" | "lit";
  /** 0–1 stroke reveal, for draw-on animations. Omit for a finished glyph. */
  reveal?: number;
  /** Per-subpath delay in seconds, applied on top of the reveal. */
  drawStagger?: number;
  /** Accessible name. Omit for decoration (the glyph is then aria-hidden). */
  label?: string;
  className?: string;
};

export function Glyph({
  id,
  weight = "heavy",
  eye,
  tone = "dim",
  reveal,
  drawStagger = 0.09,
  label,
  className,
}: GlyphProps) {
  if (!id) return null;

  const sw = WEIGHT[weight];
  const subpaths = GLYPHS[id];
  const withEye = eye ?? weight === "heavy";
  const animated = typeof reveal === "number" && reveal < 1;
  // Eye radii are authored against WEIGHT.heavy, so scale with the stroke.
  const place = EYES[id];
  const r = (place.r * sw) / WEIGHT.heavy;
  const slit = Math.max(sw * 0.22, 1.7);

  return (
    <svg
      viewBox={METRICS.viewBox}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
      style={withEye ? EYE_TONES[tone] : undefined}
    >
      <g
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {subpaths.map((d, i) => (
          <path
            key={`${id}-${i}`}
            d={d}
            pathLength={animated ? 1 : undefined}
            strokeDasharray={animated ? 1 : undefined}
            strokeDashoffset={animated ? 1 - Math.min(1, Math.max(0, reveal - i * drawStagger)) : undefined}
          />
        ))}
      </g>
      {withEye ? (
        <g transform={`translate(${place.x} ${place.y})`}>
          <Eye r={r} slit={slit} tone={tone} />
        </g>
      ) : null}
    </svg>
  );
}

/** A decorative non-letter mark from `MARKS`. */
export function Mark({
  id,
  weight = "script",
  className,
}: {
  id: keyof typeof MARKS;
  weight?: GlyphWeight;
  className?: string;
}) {
  return (
    <svg
      viewBox={METRICS.viewBox}
      className={className}
      aria-hidden="true"
      fill="none"
    >
      <g stroke="currentColor" strokeWidth={WEIGHT[weight]} strokeLinecap="round">
        {MARKS[id].map((d, i) => (
          <path key={`${id}-${i}`} d={d} />
        ))}
      </g>
    </svg>
  );
}
