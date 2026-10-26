"use client";

import * as React from "react";
import { Glyph } from "./glyph";
import type { GlyphId } from "./glyphs";
import { FadeUp, SectionHead, PixelCursor } from "./shell";
import { BenchmarksPane } from "./benchmarks";
import { IntegrityPane } from "./integrity";
import { ModelsPane } from "./models";

/**
 * The proof band — one section, three panes.
 *
 * Benchmarks, integrity and models used to be three stacked sections
 * (benchmarks alone was 3.74 viewports / 1,275 words), and together with the
 * models band they formed the longest dry stretch on the page. The 2026-10
 * research round (docs/landing-research.md) converged on the pattern every
 * reference site uses for sibling proof sections: tabs. One band, one scroll
 * position, three claims a click apart.
 *
 * All three panes stay MOUNTED (inactive ones carry the `hidden` attribute),
 * which keeps every generated number in the server-rendered DOM for crawlers
 * and for `landing_benchmarks.mjs --check`'s "all six tracks render"
 * contract, and lets in-pane whileInView animations re-trigger when a pane
 * is revealed. Tabs follow the WAI-ARIA pattern with a roving tabindex, the
 * same implementation as `loop.tsx`'s stage tabs; the active marker is a
 * gold bar plus a lit glyph, never colour alone.
 */

const PANES: {
  id: string;
  glyph: GlyphId;
  label: string;
  caption: string;
  Component: React.ComponentType;
}[] = [
  {
    id: "benchmarks",
    glyph: "B",
    label: "Benchmarks",
    caption: "six tracks, measured",
    Component: BenchmarksPane,
  },
  {
    id: "integrity",
    glyph: "I",
    label: "Integrity",
    caption: "eight gates, every log line",
    Component: IntegrityPane,
  },
  {
    id: "models",
    glyph: "M",
    label: "Models",
    caption: "bring your own brain",
    Component: ModelsPane,
  },
];

export function ProofSection() {
  const [active, setActive] = React.useState(0);
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Deep links into a PANE (benchmarks.tsx's "Integrity" link →
  // #proof-tab-integrity). The panes are `hidden` until their tab activates,
  // so an anchor that stopped at the section would land a reader on the
  // Benchmarks pane while promising the zero behind the Integrity tab.
  // Runs on mount (a visitor arriving with the hash set) and on hashchange
  // (a click while already on the page); the ids come from PANES so the
  // matcher cannot drift from the tab strip.
  React.useEffect(() => {
    const matcher = new RegExp(`^#proof-tab-(${PANES.map((p) => p.id).join("|")})$`);
    function activateFromHash() {
      const id = window.location.hash.match(matcher)?.[1];
      if (!id) return;
      const next = PANES.findIndex((p) => p.id === id);
      if (next !== -1) setActive(next);
    }
    activateFromHash();
    window.addEventListener("hashchange", activateFromHash);
    return () => window.removeEventListener("hashchange", activateFromHash);
  }, []);

  // Roving tabindex with arrow keys, per the WAI-ARIA tabs pattern.
  function onKeyDown(e: React.KeyboardEvent) {
    const last = PANES.length - 1;
    let next = active;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = active === last ? 0 : active + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = active === 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <section data-hue="magma" id="proof" className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead
            kicker="Proof"
            lead={
              <>
                Every number is generated from receipts and re-checked in CI —
                including the ones where memory made things worse.
              </>
            }
          >
            Receipts, not promises.
          </SectionHead>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-8">
          {/* tab strip: same rhythm as the loop's stage tabs so the two
              interactive bands on the page read as one system */}
          <div
            role="tablist"
            aria-label="Proof"
            onKeyDown={onKeyDown}
            className="grid gap-px overflow-hidden border border-b-0 border-line bg-line sm:grid-cols-3"
          >
            {PANES.map((p, i) => {
              const on = i === active;
              return (
                <button
                  key={p.id}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  role="tab"
                  id={`proof-tab-${p.id}`}
                  aria-selected={on}
                  aria-controls={`proof-panel-${p.id}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setActive(i)}
                  className={`group relative flex items-center gap-3.5 px-5 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [transition-timing-function:steps(2,end)] ${
                    on ? "bg-panel-2" : "bg-panel hover:bg-panel-2"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 top-0 h-0.5 origin-left transition-transform duration-300 ${
                      on ? "scale-x-100 bg-gold" : "scale-x-0 bg-gold"
                    }`}
                  />
                  {on ? (
                    <PixelCursor className="size-2.5 shrink-0 text-gold" />
                  ) : (
                    <span className="size-2.5 shrink-0" aria-hidden="true" />
                  )}
                  <Glyph
                    id={p.glyph}
                    weight="heavy"
                    tone={on ? "lit" : "dim"}
                    className={`size-7 shrink-0 transition-colors ${
                      on ? "text-gold" : "text-faint group-hover:text-dim"
                    }`}
                  />
                  <span className="min-w-0">
                    <span
                      className={`block text-[15px] ${on ? "text-ink" : "text-dim"}`}
                    >
                      {p.label}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                      {p.caption}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* panes: all mounted, inactive hidden — generated numbers stay in
              the DOM for crawlers and the gates, and framer whileInView
              reveals re-trigger on reveal */}
          <div className="border border-line p-5 sm:p-6">
            {PANES.map((p, i) => (
              <div
                key={p.id}
                role="tabpanel"
                id={`proof-panel-${p.id}`}
                aria-labelledby={`proof-tab-${p.id}`}
                tabIndex={0}
                hidden={i !== active}
                className="focus:outline-none"
              >
                <p.Component />
              </div>
            ))}
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
