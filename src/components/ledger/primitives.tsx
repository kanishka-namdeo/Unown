"use client";

/**
 * Ledger — the primitives (the encore primitives pattern).
 *
 * Small, semantic building blocks every band shares. Every value is a
 * token or a Tailwind class over a token — no hand-picked hexes (the
 * design-system-generator rule 10: a value not in the system is a bug).
 */
import { type CSSProperties, type ReactNode } from "react";

export function Micro({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`lg-micro text-[var(--lg-faint)] ${className}`}>{children}</p>;
}

export function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) {
    return <p className="lg-num text-[13px] text-[var(--lg-dim)]">{label}</p>;
  }
  const up = pct >= 0;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
      <span
        className={`lg-num rounded-[4px] border px-1.5 py-0.5 text-[12px] font-medium ${
          up
            ? "border-[var(--lg-pos)]/40 bg-[var(--lg-pos)]/10 text-[var(--lg-pos)]"
            : "border-[var(--lg-neg)]/40 bg-[var(--lg-neg)]/10 text-[var(--lg-neg)]"
        }`}
      >
        {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
      </span>
      <span className="text-[var(--lg-dim)]">{label}</span>
    </p>
  );
}

export function Card({
  children,
  className = "",
  as: As = "div",
  style,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li" | "article";
  style?: CSSProperties;
}) {
  return (
    <As
      className={`rounded-[12px] border border-[var(--lg-line)] bg-white/60 p-6 ${className}`}
      style={style}
    >
      {children}
    </As>
  );
}

export function PrimaryAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-[8px] px-4 py-2.5 text-[15px] font-medium text-[var(--lg-paper)] transition-[background-color] duration-150 ease-out hover:bg-[var(--lg-ink-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lg-clay-deep)]"
      style={{ backgroundColor: "var(--lg-clay-deep)" }}
    >
      {children}
    </a>
  );
}

export function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-[var(--lg-clay-deep)] underline decoration-1 underline-offset-4 transition-colors duration-150 ease-out hover:text-[var(--lg-ink-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lg-clay-deep)]"
    >
      {children}
    </a>
  );
}
