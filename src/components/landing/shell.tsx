"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { Glyph } from "./glyph";
import { useAlphabetWake, useKonami } from "./effects";

export const GITHUB_URL = "https://github.com/kanishka-namdeo/Unown";
export const DOCS_URL = "https://github.com/kanishka-namdeo/Unown/tree/main/docs";
export const BENCH_URL = `${GITHUB_URL}/tree/main/benchmarks`;
export const SOURCE_URL = `${GITHUB_URL}/tree/main/pi-repo/packages/self-learning/src`;

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

/** lucide-react 1.x dropped brand icons, so inline the GitHub mark. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/** Fade-up on scroll; skips the y-offset when the user prefers reduced motion. */
export function FadeUp({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  /**
   * Element to render. Pass "li" whenever the parent is a list: an `<li>` must
   * be a direct child of its `<ul>`, and wrapping one in FadeUp's default
   * `<div>` is invalid list structure that screen readers announce badly.
   */
  as?: "div" | "li" | "article" | "section";
}) {
  const reduced = useReducedMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
    >
      {children}
    </Comp>
  );
}

/* ------------------------------------------------------------------ */
/* console furniture                                                   */
/* ------------------------------------------------------------------ */

/**
 * The battle-menu cursor: a stepped triangle, not a font glyph.
 *
 * `shapeRendering="crispEdges"` is what does the work — it switches off
 * antialiasing on the diagonal, so the browser staircases it for us and the
 * arrow lands on the pixel grid for free. Drawn as `▶` in text would fall
 * outside the `latin` subset the page's fonts are sliced to and silently
 * render in whatever face the OS picked.
 */
export function PixelCursor({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 7 10"
      aria-hidden="true"
      shapeRendering="crispEdges"
      className={className}
      fill="currentColor"
    >
      <polygon points="0,0 7,5 0,10" />
    </svg>
  );
}

/**
 * The blinking ▼ that sits bottom-right of every dialogue box in the games.
 * Purely decorative and always `aria-hidden`: a screen reader announcing
 * "black down-pointing triangle" at every box is worse than announcing
 * nothing. The blink is `.gb-cont`, 1s `step-end`, gated on reduced motion
 * in `landing.css`.
 */
export function ContinueArrow({ className }: { className?: string }) {
  return (
    <span className={`gb-cont inline-flex ${className ?? ""}`} aria-hidden="true">
      <svg viewBox="0 0 10 7" shapeRendering="crispEdges" fill="currentColor" className="size-[0.9em]">
        <polygon points="0,0 10,0 5,7" />
      </svg>
    </span>
  );
}

/**
 * A Gen 1 stat bar. Colour steps green → amber → red as the value drops,
 * exactly as a real HP bar does, but the colour is never the only signal:
 * the number sits next to it, so the bar survives colour blindness and
 * survives a reader who cannot see it at all.
 */
export function HpBar({
  value,
  label = "HP",
  caption,
}: {
  /** 0–100. Rendered as both the bar width and the printed figure. */
  value: number;
  /** Short pixel-font label to the left of the bar. */
  label?: string;
  /** Optional spoken description; falls back to `label value%`. */
  caption?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const tone = pct > 50 ? "high" : pct > 20 ? "mid" : "low";
  return (
    <div className="flex items-center gap-2.5">
      <span className="gb-label shrink-0 text-[8px] text-faint">{label}</span>
      <div
        className="gb-hp min-w-0 flex-1"
        data-tone={tone === "high" ? undefined : tone}
        role="img"
        aria-label={caption ?? `${label} ${pct}%`}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="gb-term shrink-0 text-[17px] leading-none tabular-nums text-dim">
        {pct}%
      </span>
    </div>
  );
}

/**
 * The section header every section shares: pixel kicker, pixel heading,
 * optional lead.
 *
 * It exists because thirteen sections restyled in parallel drift — the most
 * likely failure of this page is not any one ugly section but fourteen
 * different heading sizes. Reach for this first; only drop to manual markup
 * when the section genuinely needs something else, and keep the same classes
 * when you do.
 *
 * Keep `kicker` to a few words: it is set in Press Start 2P, and a sentence
 * in that face is a wall.
 */
export function SectionHead({
  kicker,
  children,
  lead,
  className,
}: {
  kicker?: React.ReactNode;
  children: React.ReactNode;
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {kicker ? <p className="gb-label text-[10px] text-glow">{kicker}</p> : null}
      <h2 className="gb-h mt-4 text-[clamp(1.8rem,3.2vw,2.6rem)] text-ink">
        {children}
      </h2>
      {lead ? (
        <div className="mt-5 max-w-2xl text-[15px] leading-relaxed text-dim">
          {lead}
        </div>
      ) : null}
    </div>
  );
}

/** Window buttons. Squares, because a Game Boy window has no macOS chrome. */
export function TrafficDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="size-2 bg-canvas" />
      <span className="size-2 bg-canvas" />
      <span className="size-2 bg-canvas" />
    </div>
  );
}

/**
 * Terminal-style window frame shared by the hero, the replay and the
 * quickstart. The title bar is a bright dialogue-box strip rather than a
 * grey app bar: it is the one piece of chrome a reader sees on every screen,
 * so it is where the page says what it is.
 */
export function TerminalWindow({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="gb-panel lift overflow-hidden">
      <div className="flex items-center gap-3 border-b-[3px] border-canvas bg-glow px-3 py-2">
        <TrafficDots />
        <div className="flex min-w-0 flex-1 justify-center">
          <span className="gb-label truncate text-[9px] text-canvas">{title}</span>
        </div>
        <div className="flex min-w-[28px] items-center justify-end gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

/** Browser-style frame for the dashboard screenshots. */
export function BrowserFrame({ url, src, alt }: { url: string; src: string; alt: string }) {
  return (
    <div className="gb-panel lift overflow-hidden">
      <div className="flex items-center gap-3 border-b-[3px] border-canvas bg-glow px-3 py-2">
        <TrafficDots />
        <div className="flex min-w-0 flex-1 justify-center">
          <span className="gb-label truncate text-[9px] text-canvas">{url}</span>
        </div>
        <div className="min-w-[28px]" aria-hidden="true" />
      </div>
      <img src={src} alt={alt} className="w-full" loading="lazy" width={1400} height={900} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* copy button                                                         */
/* ------------------------------------------------------------------ */

export function CopyButton({
  text,
  label = "Copy to clipboard",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (insecure context) — fall back.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-line bg-panel-2 text-dim transition-colors hover:border-line-bright hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-glow"
    >
      {copied ? (
        <Check className="size-3.5 text-glow" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* buttons                                                             */
/* ------------------------------------------------------------------ */

/**
 * The primary action: a Gen 1 menu button. The press comes from the inset
 * bevel in `.gb-btn` and a two-frame translate, not from a shadow — see the
 * frame rule in `landing.css`.
 *
 * The label is Press Start 2P at 10px, so every caller keeps it to two or
 * three words. Set a sentence in that face and it stops being chrome and
 * starts being a wall.
 */
export function PrimaryLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const cls = "gb-btn gb-label inline-flex items-center gap-2 px-5 py-3 text-[10px] font-normal";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

export function GhostLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const cls = "gb-btn-dark gb-label inline-flex items-center gap-2 px-5 py-3 text-[10px] font-normal";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* nav                                                                 */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { href: "#alphabet", label: "Alphabet" },
  { href: "#loop", label: "How it learns" },
  { href: "#benchmarks", label: "Benchmarks" },
  { href: "#integrity", label: "Integrity" },
  { href: "#faq", label: "FAQ" },
];

/**
 * A console menu bar: bright rule underneath, pixel wordmark, and a `▶`
 * cursor that lights up in the gutter on hover.
 *
 * The cursor is absolutely positioned into the 20px link gap rather than
 * laid out in front of the label, so hovering costs no reflow — six links
 * shifting by nine pixels each is the kind of jitter that makes a sticky
 * header feel cheap. The nav keeps Geist for its links on purpose: Press
 * Start 2P is a fixed-width bitmap face, and "HOW IT LEARNED" in it overruns
 * the header below 1200px. The retro here comes from the rule, the wordmark
 * and the cursor, not from making the navigation hard to read.
 */
export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b-[3px] border-glow bg-panel/92 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <Glyph
            id="U"
            weight="heavy"
            className="size-7 text-glow"
            label="Unown"
          />
          <span className="gb-label text-[13px] text-ink">unown</span>
          <span className="gb-label hidden text-[7px] text-faint min-[430px]:inline">
            self-improving
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-5 lg:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="group relative text-[13px] text-dim transition-colors hover:text-glow focus-visible:text-glow focus:outline-none"
            >
              <PixelCursor className="absolute -left-3.5 top-1/2 h-3 w-[7px] -translate-y-1/2 text-glow opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              {l.label}
            </a>
          ))}
          <Link
            href="/dashboard"
            className="group relative text-[13px] text-dim transition-colors hover:text-glow focus-visible:text-glow focus:outline-none"
          >
            <PixelCursor className="absolute -left-3.5 top-1/2 h-3 w-[7px] -translate-y-1/2 text-glow opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            Dashboard
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2.5 lg:ml-0">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Unown on GitHub"
            className="inline-flex size-9 items-center justify-center text-dim transition-colors hover:text-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-glow"
          >
            <GithubMark className="size-[18px]" />
          </a>
          <a
            href="#quickstart"
            className="gb-btn gb-label px-4 py-2.5 text-[9px] font-normal"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* footer                                                              */
/* ------------------------------------------------------------------ */

export function Footer() {
  const { wake } = useAlphabetWake();
  useKonami(wake);

  return (
    <footer className="border-t-[3px] border-glow pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-10">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <Glyph id="U" weight="heavy" className="size-6 text-glow" />
              <span className="gb-label text-[11px]">unown</span>
            </div>
            <p className="gb-term mt-3 text-[17px] leading-snug text-faint">
              A terminal coding agent that turns sessions into notes, and notes into
              verified memory.
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13px] sm:grid-cols-3">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="text-dim transition-colors hover:text-glow">
              GitHub
            </a>
            <a href={DOCS_URL} target="_blank" rel="noreferrer noopener" className="text-dim transition-colors hover:text-glow">
              Documentation
            </a>
            <Link href="/dashboard" className="text-dim transition-colors hover:text-glow">
              Dashboard
            </Link>
            <a href={BENCH_URL} target="_blank" rel="noreferrer noopener" className="text-dim transition-colors hover:text-glow">
              Benchmarks
            </a>
            <a href="#alphabet" className="text-dim transition-colors hover:text-glow">
              The alphabet
            </a>
            <a href="#quickstart" className="text-dim transition-colors hover:text-glow">
              Install
            </a>
          </nav>
        </div>

        <div className="rule-hair my-8" />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-2xl text-[11px] leading-relaxed text-faint">
            Built on the{" "}
            <a
              href="https://github.com/badlogic/pi-mono"
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-glow"
            >
              pi coding agent
            </a>
            , MIT licensed. Unown is an independent open-source project — not affiliated
            with, endorsed by or sponsored by Nintendo, Game Freak, Creatures Inc. or The
            Pokémon Company. Pokémon and Unown are trademarks of their respective owners.
            No official art ships here: every glyph, box and bar on this page is drawn
            in code.
          </p>
          <p className="font-mono text-[10px] text-dim">
            <span className="hidden sm:inline">psst — try ↑↑↓↓←→←→ba</span>
          </p>
        </div>
      </div>
    </footer>
  );
}