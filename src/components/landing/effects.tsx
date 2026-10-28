"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { GLYPH_IDS } from "./glyphs";

/* ------------------------------------------------------------------ */
/* landing stylesheet                                                  */
/* ------------------------------------------------------------------ */

/**
 * Landing-page-only CSS, injected once and hoisted by React 19. Kept here
 * instead of `globals.css` because nothing outside the landing page should pay
 * for it.
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
@keyframes unown-glyph-flicker {
  0%, 100% { opacity: .06 }
  50%      { opacity: .13 }
}

.unown-cursor { animation: unown-blink 1.1s step-end infinite; }
.unown-drop {
  position: absolute; top: 0; will-change: transform, opacity;
  animation: unown-drop var(--dur) linear var(--delay) forwards;
}
.unown-flicker { animation: unown-glyph-flicker 6s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .unown-cursor { animation: none; opacity: 1; }
  .unown-flicker { animation: none; }
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
/* the decode wave                                                     */
/* ------------------------------------------------------------------ */

/**
 * The decoy alphabet the decode wave cycles through: the five letters of the
 * product's own name. Every scrambling position shows one of them, so the
 * "encoded" text is always spelling UNOWN at the reader — the brand story
 * (unknown → known) carried by the scramble itself, not just by its motion.
 */
const DECODE_ALPHABET = ["U", "N", "O", "W", "N"] as const;

/** One decode tick. 45ms ≈ two Game Boy frames at 60fps — the wave advances
 *  in frames, like everything else on this page. */
const DECODE_TICK_MS = 45;
/** A character stays in its scramble window for this many ticks before it
 *  locks (~180ms — long enough to read as decoding, short enough that the
 *  word is never illegible for a full fixation). */
const DECODE_WINDOW_TICKS = 4;

/**
 * Pure scheduling: the tick at which character `i` locks into its final
 * glyph. Letters lock left to right; the wave starts after a short beat so
 * the headline's word-settle (a sibling effect, CSS-only) lands first.
 *
 * Exported for the unit suite: the wave's shape is a contract (left to
 * right, bounded window, spaces never scramble), and pinning it as a pure
 * function is cheaper than driving timers in happy-dom.
 */
export function decodeLockTick(index: number, total: number): number {
  // The wave spans ~1s regardless of length: the stagger is FRACTIONAL
  // (floor(i · spread / span)) so a 41-character kicker still resolves in
  // ~18 ticks — several characters lock per tick on a long line, which is
  // how the wave stays one gesture instead of a crawl.
  const spread = Math.max(1, Math.floor(1000 / DECODE_TICK_MS) - DECODE_WINDOW_TICKS);
  const span = Math.max(1, total - 1);
  const base = Math.floor(240 / DECODE_TICK_MS);
  return base + Math.floor((index * spread) / span) + DECODE_WINDOW_TICKS;
}

/** Total ticks a decode runs for (the last character's lock, plus one). */
export function decodeTotalTicks(total: number): number {
  return decodeLockTick(Math.max(0, total - 1), total) + 1;
}

/**
 * Pure renderer: what character `i` shows at `tick`. `null` tick means "not
 * running" (before mount, after finishing, reduced motion) and always shows
 * the final character. Spaces and non-letters never scramble — only [a-z]
 * gets a decoy, so punctuation and the interpunct keep the line's rhythm
 * legible while the letters resolve.
 */
export function decodeCharAt(
  ch: string,
  index: number,
  tick: number | null,
  total: number,
): string {
  if (tick === null) return ch;
  const lock = decodeLockTick(index, total);
  if (tick >= lock) return ch;
  if (tick < lock - DECODE_WINDOW_TICKS) return ch;
  if (!/[a-z]/i.test(ch)) return ch;
  return DECODE_ALPHABET[(tick + index) % DECODE_ALPHABET.length];
}

/**
 * The decode wave — a one-shot scramble that resolves left to right across
 * a line of PIXEL TYPE.
 *
 * Contract (the reason it only ships inside `gb-label`, Press Start 2P):
 * the font is monospaced, so a decoy glyph occupies exactly the final
 * glyph's cell and the wave cannot shift layout by a subpixel — zero CLS,
 * the same guarantee a transform-only animation gets for free. Run it over
 * a proportional face and the line jitters; that is a defect, not a style.
 *
 * The base state is the finished state: SSR ships the final text, reduced
 * motion never starts the timer, and the timer self-clears when the last
 * character locks. The wave is decorative — it never gates a word.
 */
export function DecodeText({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  const [tick, setTick] = React.useState<number | null>(null);
  const chars = React.useMemo(() => Array.from(text), [text]);
  const totalTicks = React.useMemo(() => decodeTotalTicks(chars.length), [chars.length]);

  React.useEffect(() => {
    // Effects run after mount, so the first client paint and the server
    // render agree: the finished text. Only then does the wave start.
    if (reduced) return;
    let t = 0;
    const iv = setInterval(() => {
      t += 1;
      if (t >= totalTicks) {
        clearInterval(iv);
        setTick(null);
        return;
      }
      setTick(t);
    }, DECODE_TICK_MS);
    return () => clearInterval(iv);
  }, [reduced, totalTicks]);

  return (
    <span className={className}>
      {chars.map((ch, i) => {
        const shown = decodeCharAt(ch, i, tick, chars.length);
        const scrambling = shown !== ch;
        return (
          <span key={i} className={scrambling ? "text-ink" : undefined}>
            {shown}
          </span>
        );
      })}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* the spotlight                                                       */
/* ------------------------------------------------------------------ */

/**
 * Writes the pointer's position (relative to the card) into scoped CSS
 * custom properties. Pure and exported for the unit suite.
 *
 * The vars are scoped to the element itself — never inherited, never global.
 * That is the difference between the Clerk-grade spotlight and the
 * "inheritance bomb" the motion.dev performance tier list ranks as the worst
 * animation pattern on the platform: one global var repaints the page, a
 * var on the hovered card repaints the card.
 */
export function writeSpotlightVars(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${Math.round(clientX - r.left)}px`);
  el.style.setProperty("--my", `${Math.round(clientY - r.top)}px`);
}

/**
 * One document-level pointer listener that lights any `[data-spotlight]`
 * card under the cursor. Sections opt in by adding the attribute — no
 * per-card hook, no per-card listener, and nothing for a server component
 * to become a client component over.
 *
 * The listener is passive and does one `closest()` plus (when over a
 * spotlight card) one rect read and two style writes per move — bounded by
 * the card, invisible everywhere else. The glow itself is CSS
 * (`landing.css`), hover-gated, off-card by default so the un-hovered page
 * and the contrast audits never see it.
 */
export function SpotlightProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const el = target?.closest?.("[data-spotlight]") as HTMLElement | null;
      if (el) writeSpotlightVars(el, e.clientX, e.clientY);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);
  return <>{children}</>;
}

/* ------------------------------------------------------------------ */
/* the scrollspy                                                       */
/* ------------------------------------------------------------------ */

/**
 * Picks the current section from the set intersecting the viewport's middle
 * band: the LAST one in document order, because when two short sections
 * straddle the band the reader is leaving the first and entering the second.
 * Exported pure for the unit suite.
 */
export function pickCurrentSection(ids: readonly string[], visible: ReadonlySet<string>): string | null {
  const hit = ids.filter((id) => visible.has(id));
  return hit.length ? hit[hit.length - 1] : null;
}

/**
 * Names the band the visitor is reading: an `IntersectionObserver` over the
 * page's section anchors, with a middle-band root margin, feeding
 * `aria-current="true"` on the matching nav link.
 *
 * This is a state marker, not motion — it ships identically under reduced
 * motion, costs one observer, and initial render is `null` on the server
 * and on the client's first paint alike (no hydration divergence). When the
 * band sits in the hero or the finale — the two bands with no nav entry —
 * nothing is marked, which is the honest answer.
 */
export function useScrollSpy(ids: readonly string[]): string | null {
  const [current, setCurrent] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        setCurrent(pickCurrentSection(ids, visible));
      },
      // The middle 5% of the viewport: a section is current while it crosses
      // the reader's eyeline, not while any part of it is on screen.
      { rootMargin: "-47.5% 0px -47.5% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // `ids` is a module constant at every call site; the identity is stable.
  }, [ids]);
  return current;
}

/* ------------------------------------------------------------------ */
/* the count-up                                                        */
/* ------------------------------------------------------------------ */

/** Formats a count-up frame: sign, integer part, fixed decimals. Pure,
 *  exported for the unit suite (the final frame must equal the receipt
 *  figure exactly — that equality is the honesty rule here). */
export function formatCount(value: number, decimals = 0): string {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  return sign + abs.toFixed(decimals);
}

/**
 * A receipt figure that counts to its final value once, on first view.
 *
 * The DOM ships the FINAL figure (SSR, no-JS, crawlers, the landing gates);
 * the count is a ~600ms one-shot after the figure enters the viewport,
 * skipped entirely under reduced motion. Intermediate frames are animation
 * artifacts, not claims — the only value that ever stays in the DOM is the
 * measured one, which is what keeps `landing_benchmarks.mjs --check` and
 * the honesty rules whole.
 *
 * `tabular-nums` at the call site keeps every frame the same width.
 */
export function CountUp({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
  ms = 600,
}: {
  /** The final, receipt-backed figure. May be negative (a delta). */
  value: number;
  prefix?: string;
  suffix?: string;
  /** Fixed decimals in the final figure (1 for 98.1%). */
  decimals?: number;
  className?: string;
  /** Animation length. Keep ≤ 700ms — the drag threshold is 500ms and a
   *  figure is not the letter rain. */
  ms?: number;
}) {
  const reduced = useReducedMotion();
  const final = `${prefix}${formatCount(value, decimals)}${suffix}`;
  const [shown, setShown] = React.useState<string>(final);
  const frame = React.useRef(0);
  const frameHost = React.useRef<HTMLSpanElement | null>(null);

  React.useEffect(() => {
    // Reset if the figure itself changes (it does not today, but the
    // component is shared and a stale frame would be a stale number).
    setShown(final);
    if (reduced) return;
    if (typeof IntersectionObserver === "undefined") return;
    const host = frameHost.current;
    if (!host) return;
    let started = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || started) return;
        started = true;
        io.disconnect();
        const t0 = performance.now();
        const step = (now: number) => {
          const p = Math.min(1, (now - t0) / ms);
          // easeOut: fast to slow, so the figure "lands" rather than ticks.
          const eased = 1 - Math.pow(1 - p, 3);
          setShown(`${prefix}${formatCount(value * eased, decimals)}${suffix}`);
          if (p < 1) frame.current = requestAnimationFrame(step);
          else setShown(final);
        };
        frame.current = requestAnimationFrame(step);
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(host);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [reduced, value, prefix, suffix, decimals, ms, final]);

  return (
    <span ref={frameHost} className={className}>
      {shown}
    </span>
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
            className="unown-drop select-none font-pixel text-gold"
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
 * The Konami code. Nests inside `LetterRainProvider` so the flourish costs
 * nothing extra; the receipt renders in the finale.
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
 * Fires `onUnlock` on ↑↑↓↓←→←→BA.
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
