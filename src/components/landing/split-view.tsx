"use client";

import * as React from "react";
import { FadeUp, PixelCursor, SectionHead, TerminalWindow } from "./shell";

/**
 * The split-view band — the TUI display mode, a built-in port of
 * pi-split-view 1.1.0 (pi-repo/packages/self-learning/src/splitview.ts).
 *
 * What the band argues: the session does not have to be a single scrolling
 * transcript. Thinking, tool usage and file changes each get a panel, and a
 * response-only mode drops the noise entirely. Everything shown here is a
 * real capture — the stills come from actual `unown` sessions run at 128x36
 * (`public/landing/tui/split-view/stills/`), and every command name in the
 * table is gated by `scripts/landing_claims.mjs` against the extension's
 * `registerCommand` calls, the same contract the hero's command surface has.
 *
 * The stills render as tabs with all four panes mounted (inactive ones
 * `hidden`) — the proof band's pane contract, so every image and caption
 * stays in the server-rendered DOM for crawlers, and the band keeps one
 * still's height instead of four.
 */

type Still = {
  id: string;
  label: string;
  caption: string;
  src: string;
  alt: string;
};

const STILLS: Still[] = [
  {
    id: "band",
    label: "The band",
    caption: "The top band: a Thinking panel beside a Tool Usage panel, transcript below.",
    src: "/landing/tui/split-view/stills/01-band-thinking-tools.png",
    alt: "unown split view — the top band with a Thinking panel beside a Tool Usage panel, the transcript below",
  },
  {
    id: "dock",
    label: "Files dock",
    caption: "The Files dock on the right, with its legend and the Last Edit subpanel.",
    src: "/landing/tui/split-view/stills/02-files-dock.png",
    alt: "unown split view — the Files dock on the right with its legend and edit-diff subpanel beside the top band",
  },
  {
    id: "thinking",
    label: "Live thinking",
    caption: "Model reasoning streaming into the Thinking panel mid-turn.",
    src: "/landing/tui/split-view/stills/04-live-thinking.png",
    alt: "unown split view — live model reasoning streaming into the Thinking panel",
  },
  {
    id: "turn",
    label: "An agent turn",
    caption: "An agent turn: the tool entry in the band, the files panel tracking README.md, the answer in the transcript.",
    src: "/landing/tui/split-view/stills/05-agent-turn-tools.png",
    alt: "unown split view — an agent turn with the tool entry, the files panel tracking the edit and the answer in the transcript",
  },
];

/**
 * The split-view command surface. Each command name is gated by
 * `scripts/landing_claims.mjs` against the `registerCommand` calls in
 * `splitview.ts` — a command the extension does not register turns the page
 * red. The hero keeps the `unown` CLI surface; this table is the one home
 * for the display commands.
 */
const COMMANDS: [string, string][] = [
  ["/split", "toggle all panels; off restores pi's bare layout"],
  ["/split-thinking", "toggle the thinking panel"],
  ["/split-tools", "toggle the tools panel"],
  ["/files", "toggle the files panel (dock or overlay)"],
  ["/split-diff", "toggle the dock's edit-diff subpanel"],
  ["/split-tools-view", "tool panel: compact or full detail"],
  ["/split-height", "top band height in rows (6-40)"],
  ["/split-tools-width", "tools panel width, % of the band (20-60)"],
  ["/split-divider", "divider between answers: rule or space"],
  ["/split-trim-response", "transcript: full or responses only"],
  ["/split-save", "save this layout as the startup defaults"],
];

export function SplitViewSection() {
  const [active, setActive] = React.useState(0);
  const tabs = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Roving tabindex with arrow keys, per the WAI-ARIA tabs pattern — the same
  // implementation as the loop's stage tabs and the proof band's panes.
  function onKeyDown(e: React.KeyboardEvent) {
    const last = STILLS.length - 1;
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
    <section data-hue="aqua" id="split" className="scroll-mt-16 py-16 sm:py-[72px]">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="Split view" lead={
            <>
              The fullscreen TUI has a split view: a Thinking panel and a Tool
              Usage band across the top, a Files dock with an edit-diff subpanel
              on the right, and a response-only transcript mode. A built-in port
              of pi-split-view 1.1.0.
            </>
          }>
            Watch it think.
          </SectionHead>
        </FadeUp>

        {/* commands left, stills right on desktop (the inverse of the showcase
            band's rhythm, so the two media-heavy bands do not stack as twins);
            stills first on mobile, where the proof should precede the
            reference table */}
        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-10">
            <div className="min-w-0 lg:order-2">
              <TerminalWindow title="unown — split view">
                {/* tab strip: the loop's stage-tab rhythm, compacted to fit the
                    narrower column */}
                <div
                  role="tablist"
                  aria-label="Split-view stills"
                  onKeyDown={onKeyDown}
                  className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4"
                >
                  {STILLS.map((s, i) => {
                    const on = i === active;
                    return (
                      <button
                        key={s.id}
                        ref={(el) => {
                          tabs.current[i] = el;
                        }}
                        role="tab"
                        id={`split-tab-${s.id}`}
                        aria-selected={on}
                        aria-controls={`split-panel-${s.id}`}
                        tabIndex={on ? 0 : -1}
                        onClick={() => setActive(i)}
                        className={`group relative flex items-center gap-2 px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [transition-timing-function:steps(2,end)] ${
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
                        <span
                          className={`min-w-0 truncate text-[12.5px] ${
                            on ? "text-ink" : "text-dim"
                          }`}
                        >
                          {s.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* panes: all mounted, inactive hidden — every still and caption
                    stays in the DOM for crawlers, and the band pays for one
                    still's height, not four */}
                {STILLS.map((s, i) => (
                  <div
                    key={s.id}
                    role="tabpanel"
                    id={`split-panel-${s.id}`}
                    aria-labelledby={`split-tab-${s.id}`}
                    tabIndex={0}
                    hidden={i !== active}
                    className="focus:outline-none"
                  >
                    <figure className="m-0">
                      <img
                        src={s.src}
                        alt={s.alt}
                        width={2214}
                        height={1369}
                        loading="lazy"
                        className="w-full"
                      />
                      <figcaption className="border-t border-line px-3.5 py-2 text-[11.5px] leading-relaxed text-faint">
                        {s.caption}
                      </figcaption>
                    </figure>
                  </div>
                ))}
              </TerminalWindow>
              <p className="mt-3 text-[11px] text-faint">
                Stills from real unown sessions, captured at 128x36 — every panel,
                entry and glyph is what the TUI actually rendered.
              </p>
            </div>

            <div className="lg:order-1">
              <p className="gb-label text-[9px] text-gold">
                The display commands
              </p>
              <ul className="mt-4">
                {COMMANDS.map(([cmd, what]) => (
                  <li
                    key={cmd}
                    className="flex flex-col gap-0.5 border-b border-line py-1.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
                  >
                    <code className="shrink-0 font-mono text-[11.5px] text-ink sm:w-40">
                      {cmd}
                    </code>
                    <span className="text-[12.5px] leading-relaxed text-dim">{what}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
                Toggles last the session. <code className="font-mono text-dim">/split-save</code>{" "}
                writes the layout to{" "}
                <span className="font-mono">~/.unown/agent/ui-panels.json</span> and new
                windows start from it. The response-only mode keeps the thinking and tool
                traffic in the band and dock and prints just the conversation in the
                transcript. The band and dock compose in fullscreen mode, the default for
                new installs; in regular mode{" "}
                <code className="font-mono text-dim">/files</code> falls back to an overlay.
              </p>
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
