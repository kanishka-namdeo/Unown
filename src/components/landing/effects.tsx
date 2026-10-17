"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { GLYPH_IDS } from "./glyphs";

/* ------------------------------------------------------------------ */
/* landing stylesheet                                                  */
/* ------------------------------------------------------------------ */

/**
 * Landing-page-only CSS, injected once and hoisted by React 19. Kept here
 * instead of `globals.css` because nothing on `/dashboard` should pay for it.
 *
 * The reduced-motion block is the important part: every decorative animation
 * this page ships is opt-out in one place, so honouring the OS setting never
 * depends on remembering to check at each call site.
 */
const CSS = `
@keyframes unown-drop {
  0%   { transform: translate3d(0,-12vh,0) rotate(var(--rot)); opacity: 0; }
  8%   { opacity: 1; }
  82%  { opacity: 1; }
  100% { transform: translate3d(var(--drift),112vh,0) rotate(var(--rot)); opacity: 0; }
}
@keyframes unown-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
@keyframes unown-breathe {
  0%, 100% { opacity: .55; transform: scale(1) }
  50%      { opacity: .95; transform: scale(1.035) }
}
@keyframes unown-sweep {
  0%   { transform: translateY(-120%) }
  100% { transform: translateY(120%) }
}
@keyframes unown-glyph-flicker {
  0%, 100% { opacity: .06 }
  50%      { opacity: .13 }
}

.unown-cursor { animation: unown-blink 1.1s step-end infinite; }
.unown-drop {
  position: absolute; top: 0; will-change: transform, opacity;
  animation: unown-drop var(--dur) linear var(--delay) forwards;
}
.unown-breathe { animation: unown-breathe 5.5s ease-in-out infinite; }
.unown-sweep { animation: unown-sweep 7s linear infinite; }
.unown-flicker { animation: unown-glyph-flicker 6s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .unown-cursor { animation: none; opacity: 1; }
  .unown-breathe, .unown-sweep, .unown-flicker { animation: none; }
  .unown-drop { display: none; }
  html { scroll-behavior: auto !important; }
}
`;

/**
 * The no-scripting safety net. Without it the page fails its own rule: 56
 * elements ship with framer-motion's `opacity:0` pre-hydration state inline,
 * so with JavaScript disabled every reveal would be invisible. With scripting
 * on this block is inert and the reveals animate exactly as before.
 */
const NOSCRIPT = `
/* No scripting: undo the inline pre-hydration state so the content is simply
   there. Framer Motion writes opacity:0 plus a transform for every reveal,
   and nothing on this page uses an inline hidden-state transform for any
   other reason, so this is precise rather than a blanket [style] override. */
[style*="opacity:0"][style*="transform"] {
  opacity: 1 !important;
  transform: none !important;
}
`;

export function LandingStyles() {
  return (
    <>
      <style href="unown-landing" precedence="medium">{CSS}</style>
      <noscript>
        <style href="unown-landing-noscript" precedence="medium">
          {NOSCRIPT}
        </style>
      </noscript>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* letter rain                                                         */
/* ------------------------------------------------------------------ */

type Drop = {
  key: number;
  batch: number;
  letter: string;
  left: number;
  dur: number;
  delay: number;
  drift: number;
  rot: number;
  size: number;
  opacity: number;
};

type LetterRainApi = {
  /** Drop `letter` down the viewport. A no-op under reduced motion. */
  rain: (letter: string, count?: number) => void;
};

const RainContext = React.createContext<LetterRainApi | null>(null);

/**
 * The letter-rain easter egg. In the games, letters fall through the sky when
 * a Unown is defeated; here, clicking a glyph in the alphabet rains that
 * letter down the page. Cheaper than a canvas and it never touches layout.
 */
export function LetterRainProvider({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [drops, setDrops] = React.useState<Drop[]>([]);
  const batchRef = React.useRef(0);
  const keyRef = React.useRef(0);
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);

  React.useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const rain = React.useCallback(
    (letter: string, count = 16) => {
      if (reduced) return;
      const batch = (batchRef.current += 1);
      const next: Drop[] = Array.from({ length: count }, (_, i) => {
        const key = (keyRef.current += 1);
        // Deterministic-ish scatter: cheap, and avoids Math.random churn in
        // render for anyone running this under Strict Mode double-render.
        const r = (k: number) => ((key * 9301 + k * 49297) % 233280) / 233280;
        return {
          key,
          batch,
          letter,
          left: r(1) * 100,
          dur: 1.6 + r(2) * 1.9,
          delay: r(3) * 0.85,
          drift: (r(4) - 0.5) * 90,
          rot: (r(5) - 0.5) * 220,
          size: 14 + r(6) * 40,
          opacity: 0.18 + r(7) * 0.5,
        };
      });
      setDrops((d) => [...d, ...next]);
      timers.current.push(
        setTimeout(
          () => setDrops((d) => d.filter((x) => x.batch !== batch)),
          3600,
        ),
      );
    },
    [reduced],
  );

  const value = React.useMemo(() => ({ rain }), [rain]);

  return (
    <RainContext.Provider value={value}>
      {children}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
      >
        {drops.map((d) => (
          <span
            key={d.key}
            className="unown-drop select-none font-pixel text-glow"
            style={
              {
                left: `${d.left}%`,
                fontSize: `${d.size}px`,
                opacity: d.opacity,
                "--dur": `${d.dur}s`,
                "--delay": `${d.delay}s`,
                "--drift": `${d.drift}px`,
                "--rot": `${d.rot}deg`,
              } as React.CSSProperties
            }
          >
            {d.letter}
          </span>
        ))}
      </div>
    </RainContext.Provider>
  );
}

/** Falls back to a no-op outside the provider so sections stay portable. */
export function useLetterRain(): LetterRainApi {
  return React.useContext(RainContext) ?? { rain: () => {} };
}

/* ------------------------------------------------------------------ */
/* the alphabet wakes                                                  */
/* ------------------------------------------------------------------ */

type WakeApi = {
  /** True for a few seconds after the Konami sequence lands. */
  woke: boolean;
  wake: () => void;
};

const WakeContext = React.createContext<WakeApi>({ woke: false, wake: () => {} });

/**
 * The one easter egg worth shipping. The Konami code fires here; the payoff is
 * the whole alphabet falling down the page, because anyone who knows the
 * sequence is telling you they know the reference and nobody else will ever
 * find it. Nests inside `LetterRainProvider` so the flourish costs nothing extra.
 */
export function AlphabetWakeProvider({ children }: { children: React.ReactNode }) {
  const [woke, setWoke] = React.useState(false);
  const { rain } = useLetterRain();
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);

  React.useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const wake = React.useCallback(() => {
    setWoke(true);
    // Stagger by form index so the alphabet falls in order, not as a mush.
    GLYPH_IDS.forEach((id, i) => {
      timers.current.push(setTimeout(() => rain(id, 2), i * 55));
    });
    timers.current.push(setTimeout(() => setWoke(false), 7000));
  }, [rain]);

  const value = React.useMemo(() => ({ woke, wake }), [woke, wake]);

  return <WakeContext.Provider value={value}>{children}</WakeContext.Provider>;
}

export function useAlphabetWake(): WakeApi {
  return React.useContext(WakeContext);
}

/* ------------------------------------------------------------------ */
/* konami                                                              */
/* ------------------------------------------------------------------ */

const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
] as const;

/**
 * Fires `onUnlock` on ↑↑↓↓←→←→BA. Wired to the "the alphabet wakes" flourish —
 * the one easter egg worth having, because anyone who knows it is telling you
 * they know the reference, and nobody else will ever find it.
 */
export function useKonami(onUnlock: () => void) {
  const handler = React.useRef(onUnlock);

  // Keep the callback fresh without resubscribing the listener, and without
  // touching the ref during render.
  React.useEffect(() => {
    handler.current = onUnlock;
  }, [onUnlock]);

  React.useEffect(() => {
    let at = 0;
    const onKey = (e: KeyboardEvent) => {
      const want = KONAMI[at];
      const got = e.key;
      if (got === want || got.toLowerCase() === want.toLowerCase()) {
        at += 1;
        if (at === KONAMI.length) {
          at = 0;
          handler.current();
        }
      } else {
        // Restart from a 1-length prefix so partial attempts don't dead-end.
        at = got === KONAMI[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
