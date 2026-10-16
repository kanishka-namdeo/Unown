"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { GLYPHS, MARKS, METRICS, WEIGHT, type GlyphId, type GlyphWeight } from "./glyphs";

/* ------------------------------------------------------------------ */
/* the eye                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every Unown carries one eye, always at the centre of the letter. Ours does
 * the same: a lens-shaped void punched through the letter, with a bright
 * vertical slit. Sized against the stroke weight so it reads as a hole in the
 * body at 36px and as an eye at 320px.
 */
function Eye({ r, slit }: { r: number; slit: number }) {
  return (
    <g>
      <path
        d={`M${-r} 0 C${-r * 0.42} ${-r * 1.16} ${r * 0.42} ${-r * 1.16} ${r} 0 C${r * 0.42} ${r * 1.16} ${-r * 0.42} ${r * 1.16} ${-r} 0 Z`}
        fill="var(--unown-eye, #0c0b0a)"
        stroke="var(--unown-eye-rim, #34d399)"
        strokeWidth={Math.max(r * 0.17, 1.1)}
      />
      <rect
        x={-slit / 2}
        y={-r * 0.88}
        width={slit}
        height={r * 1.76}
        rx={slit / 2}
        fill="var(--unown-eye-lit, #d1fae5)"
      />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* glyph                                                               */
/* ------------------------------------------------------------------ */

export type GlyphProps = {
  /** Which form to draw. `null` renders nothing (used for scramble states). */
  id: GlyphId | null;
  /** `heavy` = Unown's silhouette, `script` = the letterform. */
  weight?: GlyphWeight;
  /** Draw the eye in the middle of the counter. Default: only at heavy weight. */
  eye?: boolean;
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
  const r = sw > 12 ? sw * 0.66 : sw * 0.9;
  const slit = Math.max(sw * 0.24, 1.8);

  return (
    <svg
      viewBox={METRICS.viewBox}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
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
        <g transform={`translate(${METRICS.eye.x} ${METRICS.eye.y})`}>
          <Eye r={r} slit={slit} />
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

/**
 * A word spelled in the script. `UNOWN` is the only one the project needs, but
 * this is generic so the quickstart copy and the footer can be lettered too.
 */
export function GlyphWord({
  text,
  weight = "heavy",
  eye = false,
  className,
  label,
}: {
  text: string;
  weight?: GlyphWeight;
  eye?: boolean;
  className?: string;
  label?: string;
}) {
  const letters = React.useMemo(
    () =>
      text
        .toUpperCase()
        .split("")
        .filter((c) => /[A-Z!?]/.test(c)) as GlyphId[],
    [text],
  );

  return (
    <span
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="inline-flex items-center">
        {letters.map((l, i) => (
          <Glyph
            key={`${l}-${i}`}
            id={l}
            weight={weight}
            eye={eye}
            className="h-full w-auto shrink-0"
          />
        ))}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* animated wrapper                                                    */
/* ------------------------------------------------------------------ */

/**
 * Draws a glyph on when it scrolls into view. Respects `prefers-reduced-motion`
 * by painting the finished glyph immediately.
 */
export function DrawingGlyph({
  id,
  weight = "heavy",
  eye,
  className,
  delay = 0,
  duration = 0.9,
  label,
}: {
  id: GlyphId;
  weight?: GlyphWeight;
  eye?: boolean;
  className?: string;
  delay?: number;
  duration?: number;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = React.useState(reduced ?? false);

  return (
    <motion.span
      className={className}
      initial={false}
      onViewportEnter={() => setShown(true)}
      viewport={{ once: true, margin: "-40px" }}
    >
      <Glyph
        id={shown ? id : null}
        weight={weight}
        eye={eye}
        reveal={reduced ? 1 : undefined}
        label={label}
      />
    </motion.span>
  );
}

/**
 * The seal: one glyph at hero scale with the eye lit and a soft halo. Used as
 * the wordmark's anchor and in the alphabet's callout.
 */
export function GlyphSeal({
  id,
  className,
  label,
  lit = true,
}: {
  id: GlyphId;
  className?: string;
  label?: string;
  lit?: boolean;
}) {
  return (
    <span
      className={`relative inline-grid place-items-center ${className ?? ""}`}
      style={
        {
          "--unown-eye": lit ? "#05070a" : "#0b0f14",
          "--unown-eye-rim": lit ? "#6ee7b7" : "#3f3f46",
          "--unown-eye-lit": lit ? "#d1fae5" : "#52525b",
        } as React.CSSProperties
      }
    >
      {lit ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-emerald-400/12 blur-2xl"
        />
      ) : null}
      <Glyph id={id} weight="heavy" className="relative h-full w-full text-zinc-100" label={label} />
    </span>
  );
}