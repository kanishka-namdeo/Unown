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
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function TrafficDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="size-2.5 rounded-full bg-line-bright" />
      <span className="size-2.5 rounded-full bg-line-bright" />
      <span className="size-2.5 rounded-full bg-line-bright" />
    </div>
  );
}

/** Terminal-style window frame shared by the hero, the replay and the quickstart. */
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
    <div className="lift overflow-hidden rounded-lg border border-line bg-panel shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)]">
      <div className="flex items-center gap-3 border-b border-line px-3.5 py-2.5">
        <TrafficDots />
        <div className="flex min-w-0 flex-1 justify-center">
          <span className="truncate font-mono text-[11px] text-faint">{title}</span>
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
    <div className="lift overflow-hidden rounded-lg border border-line bg-panel hover:border-line-bright">
      <div className="flex items-center gap-3 border-b border-line bg-panel-2 px-3.5 py-2">
        <TrafficDots />
        <div className="flex min-w-0 flex-1 justify-center">
          <span className="truncate rounded border border-line bg-canvas px-2.5 py-0.5 font-mono text-[10px] text-faint">
            {url}
          </span>
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

export function PrimaryLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const cls =
    "glow-hover inline-flex items-center gap-2 rounded-md bg-glow px-5 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-glow-soft";
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
  const cls =
    "lift inline-flex items-center gap-2 rounded-md border border-line px-5 py-2.5 text-sm text-dim transition-colors hover:border-line-bright hover:text-ink";
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

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Glyph
            id="U"
            weight="heavy"
            className="size-6 text-glow"
            label="Unown"
          />
          <span className="text-base font-medium tracking-tight">unown</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-faint min-[430px]:inline">
            self-improving
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-6 lg:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[13px] text-dim transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
          <Link href="/dashboard" className="text-[13px] text-dim transition-colors hover:text-ink">
            Dashboard
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2.5 lg:ml-0">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Unown on GitHub"
            className="inline-flex size-9 items-center justify-center rounded-md text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-glow"
          >
            <GithubMark className="size-[18px]" />
          </a>
          <a
            href="#quickstart"
            className="rounded-md bg-glow px-4 py-2 text-[13px] font-medium text-canvas transition-colors hover:bg-glow-soft"
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
    <footer className="border-t border-line pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-10">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <Glyph id="U" weight="heavy" className="size-5 text-glow" />
              <span className="text-sm font-medium">unown</span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-faint">
              A terminal coding agent that turns sessions into notes, and notes into
              verified memory.
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13px] sm:grid-cols-3">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="text-dim transition-colors hover:text-ink">
              GitHub
            </a>
            <a href={DOCS_URL} target="_blank" rel="noreferrer noopener" className="text-dim transition-colors hover:text-ink">
              Documentation
            </a>
            <Link href="/dashboard" className="text-dim transition-colors hover:text-ink">
              Dashboard
            </Link>
            <a href={BENCH_URL} target="_blank" rel="noreferrer noopener" className="text-dim transition-colors hover:text-ink">
              Benchmarks
            </a>
            <a href="#alphabet" className="text-dim transition-colors hover:text-ink">
              The alphabet
            </a>
            <a href="#quickstart" className="text-dim transition-colors hover:text-ink">
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
              className="underline underline-offset-2 hover:text-dim"
            >
              pi coding agent
            </a>
            , MIT licensed. Unown is an independent open-source project — not affiliated
            with, endorsed by or sponsored by Nintendo, Game Freak, Creatures Inc. or The
            Pokémon Company. Pokémon and Unown are trademarks of their respective owners.
          </p>
          <p className="font-mono text-[10px] text-faint/70">
            <span className="hidden sm:inline">psst — try ↑↑↓↓←→←→ba</span>
          </p>
        </div>
      </div>
    </footer>
  );
}