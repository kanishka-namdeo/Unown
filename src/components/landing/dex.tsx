"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import Fuse from "fuse.js";
import { Creature } from "./creature";
import {
  DEX,
  DEFAULT_INDEX,
  isFilmed,
  TALLY,
  TALLY_SENTENCE,
  type Capture,
  type DexEntry,
  type DexType,
} from "./dex-data";
import { FadeUp, PixelCursor, SectionHead, TerminalWindow, toneAttr } from "./shell";

/**
 * The capability dex — band three, and since 2026-10-23 the one band that
 * holds BOTH what the agent can do and the footage that shows it.
 *
 * It absorbed the feature-capture carousel (band five, `feature-carousel.tsx`)
 * on the merge: one numbered spine № 001-020, where the ten drawn forms keep
 * their specimen, flavor and weakness and the ten behaviors are the filmed
 * surfaces that belong to no single form. One search, one cursor, one detail
 * pane — the reader stops meeting the capability at position 3 and its
 * evidence at position 5.
 *
 * The interaction is the Gen-3 Pokédex pattern (docs/landing-research.md
 * Part 15): a numbered list you walk with the arrow keys, a search box, and a
 * detail pane that redraws the moment the cursor moves — selection follows
 * focus, exactly like the handheld's cursor. No npm library renders this with
 * a project's OWN sprites, so the pattern is built here in the page's
 * furniture and the one genuine dependency is real: fuse.js drives the search.
 *
 * The media rule is the one the carousel brought with it: the frames and the
 * seconds are the TUI-capture lane's audited set (`public/landing/tui/
 * README.md`; workflow in `docs/tui-capture-workflow.md`), nothing is
 * fabricated, and an entry the harness has not turned through renders the
 * honest empty plate in the same aspect box — so the stage's height never
 * depends on which entry is selected. Playback is an effect decision, never an
 * `autoPlay` attribute: the active reel starts muted + looping after hydration,
 * when reduced motion is already known; under `prefers-reduced-motion` the
 * stage keeps its poster and the explicit button does the starting; nothing
 * auto-advances, because the reader is the rotor. `loading="lazy"` stays on
 * the still image only — on a `<video>` it would delay the poster too.
 *
 * A11y: the list is a WAI-ARIA listbox (roving tabindex, arrows / Home / End,
 * selection follows focus) and the detail pane mounts ALL twenty entries with
 * the inactive ones `hidden` — the proof band's pane contract, so every
 * capability line, receipt and pending plate stays in the DOM for crawlers and
 * for the `landing_*.mjs` gates. Exactly two live regions: the search tally and
 * the selection readout. The cry is an ORIGINAL synthesized chirp (Web Audio
 * square wave, deterministic per creature) — nothing sampled, nothing borrowed,
 * inert where AudioContext does not exist.
 *
 * No-JS: the server renders the full list and the default entry's detail,
 * which is the same deal the beats tabs and the proof panes offer.
 */

const TYPE_LABEL: Record<DexType, string> = {
  session: "session",
  engine: "engine",
};

/** The tone each side of the house carries its badge in — aqua for what
 * joins a session, gold for what runs in the engine. Inside the magma
 * section these are deliberate element-level overrides (`toneAttr`). */
const TYPE_TONE: Record<DexType, "aqua" | "gold"> = {
  session: "aqua",
  engine: "gold",
};

/**
 * The split-view command surface, kept in this band as the display commands'
 * one canonical home (it lived in the split-view band, then the carousel, and
 * moved with the merge). Each command name is gated by
 * `scripts/landing_claims.mjs` against the `registerCommand` calls in
 * `splitview.ts` — a command the extension does not register turns the page
 * red. The hero keeps the `unown` CLI surface. `parseCommands` reads the first
 * `const COMMANDS` in the file it is pointed at, so this is the only such array
 * in `dex.tsx` and the catalog above is `DEX`.
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

/* ------------------------------------------------------------------ */
/* the cry                                                             */
/* ------------------------------------------------------------------ */

/**
 * An original chiptune chirp, deterministic per creature: the id hashes to
 * a base frequency, a note count and a rising-or-falling contour, so the
 * same form always sounds like itself and no two forms sound alike. Square
 * wave + per-note envelope is the whole instrument — the GBA's sound
 * channel had two of those. Nothing is sampled; nothing is borrowed.
 */
function playCry(id: string) {
  const AC: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    let h = 7;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const base = 160 + (h % 9) * 35; // 160–440 Hz
    const notes = 3 + (h % 3); // 3–5 notes
    const rising = ((h >> 3) & 1) === 1;
    const t0 = ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);
    for (let i = 0; i < notes; i++) {
      const step = rising ? i : notes - 1 - i;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = base * Math.pow(2, (step * (2 + (h % 3))) / 12);
      const g = ctx.createGain();
      const t = t0 + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.09);
    }
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, notes * 90 + 400);
  } catch {
    /* no audio lane — the button stays, inert. */
  }
}

/** A pixel level-meter: three hard bars, the only speaker this page needs. */
function CryIcon() {
  return (
    <svg viewBox="0 0 12 12" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true" className="size-3.5">
      <rect x="1" y="7" width="2" height="4" />
      <rect x="5" y="4" width="2" height="7" />
      <rect x="9" y="1" width="2" height="10" />
    </svg>
  );
}

/** Pause chrome: two crisp bars — the steps() sibling of PixelCursor's ▶. */
function PauseBars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden="true"
      shapeRendering="crispEdges"
      className={className}
      fill="currentColor"
    >
      <rect x="1" y="1" width="3" height="8" />
      <rect x="6" y="1" width="3" height="8" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* the two marks the catalog carries                                   */
/* ------------------------------------------------------------------ */

/**
 * Filmed or pending — and the word travels with the glyph, because a mark
 * that is only a shape or only a colour fails the page's own rule that no
 * signal is carried alone (the `.gb-hp` bar always ships its number). On the
 * selected row the accent fill is the background, so the mark drops to the
 * canvas ink like the № and the name do.
 */
function FilmMark({ filmed, selected }: { filmed: boolean; selected: boolean }) {
  const tone = selected
    ? "text-canvas/80"
    : filmed
      ? "text-(--hue-accent)"
      : "text-faint";
  return (
    <span className={`gb-label shrink-0 text-[8px] ${tone}`}>
      <span aria-hidden="true" className="mr-1">
        {filmed ? "●" : "○"}
      </span>
      {filmed ? "filmed" : "pending"}
    </span>
  );
}

/** The band's one selection readout: where the cursor is, and what the stage
 *  is actually doing — a reduced-motion visitor is told "poster", not
 *  "playing", because the page does not claim a motion it refused to make. */
function readout(entry: DexEntry, reel: number, reduced: boolean, paused: boolean) {
  const head = `№ ${entry.no} — ${entry.name}`;
  if (!isFilmed(entry)) return `${head} · no capture yet`;
  const capture = entry.captures[reel];
  const state = paused ? "paused" : reduced ? "poster" : "playing";
  const what =
    capture.kind === "video"
      ? `${capture.label ? `${capture.label} · ` : ""}${state}`
      : capture.kind === "still"
        ? "still"
        : "pending";
  return entry.captures.length > 1
    ? `${head} · reel ${reel + 1}/${entry.captures.length} · ${what}`
    : `${head} · ${what}`;
}

/* ------------------------------------------------------------------ */
/* the capture stage                                                   */
/* ------------------------------------------------------------------ */

function CaptureStage({
  entry,
  reel,
  onReel,
  paused,
  onTogglePause,
  registerVideo,
}: {
  entry: DexEntry;
  reel: number;
  onReel: (i: number) => void;
  paused: boolean;
  onTogglePause: () => void;
  registerVideo: (no: string, i: number, el: HTMLVideoElement | null) => void;
}) {
  const active: Capture = entry.captures[reel] ?? { kind: "pending" };

  return (
    <div className="border-b border-line px-3 pb-3.5 sm:px-3.5">
      <TerminalWindow
        title={`unown — ${entry.name}`}
        actions={
          active.kind === "video" ? (
            <button
              type="button"
              onClick={onTogglePause}
              aria-label={
                paused
                  ? `Play the ${entry.name} capture`
                  : `Pause the ${entry.name} capture`
              }
              title={paused ? "play" : "pause"}
              /* The bar is an accent fill, so its ink is the canvas ink — the
                 same pairing every `.gb-box` quotation on this page uses. A
                 `text-dim` control here would be a light grey on orange. */
              className="inline-flex size-7 items-center justify-center border border-canvas/60 text-canvas transition-colors [transition-timing-function:steps(2,end)] hover:border-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-canvas"
            >
              {paused ? <PixelCursor className="size-2.5" /> : <PauseBars className="size-3" />}
            </button>
          ) : null
        }
      >
        {/* every reel mounts, the inactive ones hide: the pane contract, kept
            down to the media, so the SSR DOM names every capture the band
            plays and the pending gaps stay crawlable too */}
        {entry.captures.map((c, i) => (
          <div key={`${entry.no}-capture-${i}`} hidden={i !== reel} className="border-t border-line">
            <div className="aspect-[1600/1074] w-full overflow-hidden border border-line bg-canvas">
              {c.kind === "video" ? (
                <video
                  ref={(el) => registerVideo(entry.no, i, el)}
                  className="h-full w-full object-contain"
                  muted
                  loop
                  playsInline
                  preload="none"
                  poster={c.poster}
                  width={1600}
                  height={1074}
                >
                  <source src={c.webm} type="video/webm" />
                  <source src={c.mp4} type="video/mp4" />
                </video>
              ) : c.kind === "still" ? (
                <img
                  src={c.src}
                  alt={c.alt}
                  width={2214}
                  height={1369}
                  loading="lazy"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center px-6 text-center sm:px-10">
                  <p className="gb-label text-[9px] text-faint">no capture yet</p>
                </div>
              )}
            </div>
          </div>
        ))}
        {/* the reel picker sits on the panel surface, not on the accent bar,
            so it can carry the same selected/inactive pairing the dex rows
            already use (`.gb-box` against `bg-panel`) in both schemes */}
        {entry.captures.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <span className="gb-label text-[8px] text-faint">reel</span>
            {entry.captures.map((c, i) => (
              <button
                key={`${entry.no}-reel-${i}`}
                type="button"
                aria-pressed={i === reel}
                onClick={() => onReel(i)}
                className={`gb-label px-1.5 py-0.5 text-[8px] transition-colors [transition-timing-function:steps(2,end)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold ${
                  i === reel
                    ? "gb-box text-canvas"
                    : "border border-line bg-panel text-dim hover:bg-panel-2 hover:text-ink"
                }`}
              >
                {c.kind === "video" && c.label ? c.label : `reel ${i + 1}`}
              </button>
            ))}
          </div>
        ) : null}
      </TerminalWindow>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* one detail pane                                                     */
/* ------------------------------------------------------------------ */

function DexDetail({
  entry,
  index,
  shown,
  reel,
  onReel,
  paused,
  onTogglePause,
  registerVideo,
}: {
  entry: DexEntry;
  index: number;
  shown: boolean;
  reel: number;
  onReel: (i: number) => void;
  paused: boolean;
  onTogglePause: () => void;
  registerVideo: (no: string, i: number, el: HTMLVideoElement | null) => void;
}) {
  return (
    <article
      aria-label={`${entry.name}, capability ${entry.no} of ${TALLY.total}`}
      hidden={!shown}
      className="gb-panel lift flex flex-col"
    >
      {entry.kind === "form" ? (
        /* the specimen — h-48 is 3× the 64px logical grid, so the sprite
           stays on its own pixels (integer multiple, never resampled); the
           dex is the one place a creature is the show, so it gets the big
           frame (VLM review round 1 verdict: an h-32 specimen reads
           unanchored beside the 36px name) */
        <div className="flex items-start gap-5 border-b border-line p-4 sm:p-5">
          <Creature id={entry.id} className="h-48 w-auto shrink-0" />
          {/* self-center: the name block centers against the 192px specimen
              instead of hanging off its top edge */}
          <div className="min-w-0 flex-1 self-center">
            <p className="gb-label text-[9px] text-(--hue-accent)">
              № {entry.no} · {entry.category}
            </p>
            <p className="gb-term mt-1 text-[36px] leading-none text-ink">{entry.name}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span
                {...toneAttr(TYPE_TONE[entry.type])}
                className="inline-flex items-center gap-1.5 border border-line px-1.5 py-0.5"
              >
                <span aria-hidden="true" className="size-1.5 bg-(--tone-fill)" />
                <span className="gb-label text-[8px] text-dim">{TYPE_LABEL[entry.type]}</span>
              </span>
              <span className="font-mono text-[10px] text-faint">{entry.habitat}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => playCry(entry.id)}
            aria-label={`play the ${entry.name} cry`}
            title={`the ${entry.name} cry`}
            className="inline-flex size-9 shrink-0 items-center justify-center border border-line bg-panel-2 text-dim transition-colors hover:border-line-bright hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <CryIcon />
          </button>
        </div>
      ) : (
        /* a behavior is filmed, not drawn: the name row carries the gloss, and
           the stage below it is its portrait */
        <div className="border-b border-line px-4 py-3.5 sm:px-5">
          <p className="gb-label text-[9px] text-(--hue-accent)">
            № {entry.no} · behavior · {isFilmed(entry) ? "recorded" : "no capture yet"}
          </p>
          <p className="gb-term mt-1 text-[36px] leading-none text-ink">{entry.name}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-dim">{entry.summary}</p>
        </div>
      )}

      {/* the capture stage — constant height for filmed and pending entries
          alike, so the band's measured height does not move with the cursor */}
      <CaptureStage
        entry={entry}
        reel={reel}
        onReel={onReel}
        paused={paused}
        onTogglePause={onTogglePause}
        registerVideo={registerVideo}
      />

      {entry.kind === "form" ? (
        /* the entry — the dex speaks from the screen, so it sits on the
           gb-box like every quotation on this page */
        <div className="border-b border-line p-3 sm:p-3.5">
          <div className="gb-box p-3.5">
            <blockquote className="quote text-[18px] leading-relaxed text-canvas">
              {entry.entry}
            </blockquote>
          </div>
        </div>
      ) : null}

      <dl className="flex-1 space-y-3 p-4 sm:p-5">
        <div className="flex gap-3">
          <dt className="gb-label w-20 shrink-0 pt-0.5 text-[8px] text-faint">in practice</dt>
          <dd className="min-w-0 space-y-1.5">
            {entry.practice.map((p) => (
              <p key={p} className="text-[13px] leading-relaxed text-dim">
                {p}
              </p>
            ))}
          </dd>
        </div>
        {entry.kind === "form" ? (
          <div className="flex gap-3">
            <dt className="gb-label w-20 shrink-0 pt-1 text-[8px] text-faint">weakness</dt>
            <dd className="min-w-0 pt-0.5 font-mono text-[11.5px] text-dim">
              {entry.weakness}
            </dd>
          </div>
        ) : null}
        <div className="flex gap-3">
          <dt className="gb-label w-20 shrink-0 pt-1 text-[8px] text-faint">receipts</dt>
          <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
            {entry.receipts.map(([label, href]) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-[10px] text-faint underline underline-offset-2 transition-colors hover:text-gold"
              >
                {label}
              </a>
            ))}
          </dd>
        </div>
      </dl>
      <span className="sr-only">entry {index + 1} of {TALLY.total}</span>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function DexSection() {
  const [sel, setSel] = React.useState(DEFAULT_INDEX);
  const [q, setQ] = React.useState("");
  const [reels, setReels] = React.useState<Record<string, number>>({});
  const [paused, setPaused] = React.useState(false);
  const opts = React.useRef<(HTMLButtonElement | null)[]>([]);
  const videoEls = React.useRef(new Map<string, HTMLVideoElement>());
  // The page's own reduced-motion read, the same one every other animated band
  // uses — the decision of whether a video may start is made with it, never
  // with an `autoPlay` attribute in the markup.
  const reduced = useReducedMotion() ?? false;

  // fuse.js: the drivable search dependency of this band (Part 15) —
  // fuzzy over everything a visitor might type: the name, the category, the
  // weakness, the capability copy, the type word and a behavior's gloss.
  // Threshold 0.3 + minMatchCharLength 2 was measured against this list:
  // looser (0.38) fuzzy-matched a third of the dex for a three-letter query,
  // which reads as broken, not forgiving.
  const fuse = React.useMemo(
    () =>
      new Fuse([...DEX], {
        keys: ["name", "category", "weakness", "practice", "type", "summary"],
        threshold: 0.3,
        minMatchCharLength: 2,
        ignoreLocation: true,
      }),
    [],
  );

  const visible = React.useMemo(() => {
    const s = q.trim();
    if (!s) return DEX.map((_, i) => i);
    return fuse.search(s).map((r) => r.refIndex);
  }, [q, fuse]);

  // The cursor never points at a filtered-out row: an empty result keeps
  // the last selection, anything else snaps to the first match.
  const shown = visible.length === 0 || visible.includes(sel) ? sel : visible[0];
  const entry = DEX[shown];
  const reel = Math.min(reels[entry.no] ?? 0, Math.max(0, entry.captures.length - 1));

  // Playback sync, the rule the carousel brought: no autoplay attribute is
  // ever rendered, so the decision (muted, looping, entitled to play) is made
  // once, in JS, after hydration, where reduced motion is already known.
  // Everything that is not the visible pane's active reel stays paused — the
  // band shows one moving picture at a time.
  React.useEffect(() => {
    for (const [key, el] of videoEls.current) {
      const [no, index] = key.split(":");
      const on =
        no === entry.no && Number(index) === reel && !reduced && !paused;
      if (on) {
        try {
          const p = el.play?.();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch {
          // an autoplay rejection is the finished (paused) state
        }
      } else {
        el.pause?.();
      }
    }
  }, [entry, reel, reduced, paused]);

  const registerVideo = (no: string, i: number, el: HTMLVideoElement | null) => {
    const key = `${no}:${i}`;
    if (el) videoEls.current.set(key, el);
    else videoEls.current.delete(key);
  };

  function onListKey(e: React.KeyboardEvent) {
    if (!visible.length) return;
    const pos = visible.indexOf(shown);
    let next = pos < 0 ? 0 : pos;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (next + 1) % visible.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
      next = (next - 1 + visible.length) % visible.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = visible.length - 1;
    else return;
    e.preventDefault();
    setSel(visible[next]);
    opts.current[visible[next]]?.focus();
    opts.current[visible[next]]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <section
      data-hue="magma"
      id="dex"
      className="scroll-mt-16 border-y border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp className="max-w-2xl">
          <SectionHead kicker="The capability dex">
            Every capability, catalogued and filmed.
          </SectionHead>
          <p className="mt-4 text-pretty leading-relaxed text-dim">
            The session tools, the engine mechanisms and the filmed surfaces —
            one numbered spine. Walk the list, type to filter, play a cry, watch
            the capture. {TALLY_SENTENCE}
          </p>
        </FadeUp>

        <FadeUp delay={0.06} className="mt-8">
          <div className="grid gap-5 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-8">
            {/* the list — search box, then the numbered rows */}
            <div className="min-w-0">
              <div className="border border-b-0 border-line bg-panel-2/40 px-3.5 pb-2.5 pt-3">
                <label htmlFor="dex-search" className="gb-label text-[10px] text-faint">
                  search the dex
                </label>
                <div className="mt-1.5 flex items-center gap-2 border-b border-line pb-1.5 focus-within:border-gold">
                  <span aria-hidden="true" className="font-mono text-xs text-faint">
                    /
                  </span>
                  <input
                    id="dex-search"
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setQ("");
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="name, weakness, what it does"
                    className="w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-dim"
                  />
                  <span
                    aria-live="polite"
                    className="shrink-0 font-mono text-[10px] tabular-nums text-faint"
                  >
                    {visible.length}/{TALLY.total}
                  </span>
                </div>
              </div>

              <div
                role="listbox"
                aria-label={`The capability dex — ${TALLY.total} entries`}
                onKeyDown={onListKey}
                /* Capped + scrollable below lg so the mobile page cannot grow
                   an eighth-of-the-page list; on desktop every row shows,
                   because a cut-off row with no scroll affordance read as a
                   broken list (VLM review round 1, light scheme). Twenty rows
                   still stand shorter than the detail column, so the pane is
                   what binds the band's height. */
                className="grid max-h-[26rem] gap-px overflow-y-auto border border-line bg-line lg:max-h-none lg:overflow-visible"
              >
                {visible.length === 0 ? (
                  <p className="bg-panel px-3.5 py-4 font-mono text-[11px] text-faint">
                    no entry matches — esc clears
                  </p>
                ) : (
                  visible.map((i) => {
                    const e = DEX[i];
                    const on = i === shown;
                    return (
                      <button
                        key={e.no}
                        ref={(el) => {
                          opts.current[i] = el;
                        }}
                        type="button"
                        role="option"
                        aria-selected={on}
                        tabIndex={on ? 0 : -1}
                        onClick={() => setSel(i)}
                        className={`group flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [transition-timing-function:steps(2,end)] ${
                          on ? "gb-box" : "bg-panel hover:bg-panel-2"
                        }`}
                      >
                        {on ? (
                          <span className="gb-label shrink-0 text-[9px] tabular-nums text-canvas">
                            № {e.no}
                          </span>
                        ) : (
                          <span className="gb-label shrink-0 text-[9px] tabular-nums text-faint group-hover:text-dim">
                            № {e.no}
                          </span>
                        )}
                        {on ? (
                          <span className="text-[14px] text-canvas">{e.name}</span>
                        ) : (
                          <span className="text-[14px] text-ink">{e.name}</span>
                        )}
                        <span className="ml-auto shrink-0">
                          <FilmMark filmed={isFilmed(e)} selected={on} />
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* one legend line: the keys, the two marks, and who makes the
                  media — stated once for the whole band instead of once per
                  pending stage, which is what keeps the word budget */}
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
                ↑ ↓ walk the list · type to filter · esc clears ·{" "}
                <span aria-hidden="true">●</span> filmed <span aria-hidden="true">○</span> pending ·
                captures come only from the harness in{" "}
                <code className="font-mono text-dim">scripts/tui-capture/</code>, never by hand
              </p>
            </div>

            {/* the detail — all twenty entries mounted, the inactive ones
                hidden (the proof band's pane contract: crawlers and gates read
                every capability line and every pending gap) */}
            <div className="min-w-0">
              {DEX.map((e, i) => (
                <DexDetail
                  key={e.no}
                  entry={e}
                  index={i}
                  shown={i === shown}
                  reel={i === shown ? reel : 0}
                  onReel={(next) => setReels((r) => ({ ...r, [e.no]: next }))}
                  paused={paused}
                  onTogglePause={() => setPaused((p) => !p)}
                  registerVideo={registerVideo}
                />
              ))}

              {/* the selection readout: the band's one live region besides the
                  search tally, so the cursor's position is announced without
                  every pane shouting */}
              <p aria-live="polite" className="mt-3 font-mono text-[11.5px] tabular-nums text-dim">
                {readout(entry, reel, reduced, paused)}
              </p>
            </div>
          </div>

          {/* provenance, once: what the lane filmed and what it has not */}
          <p className="mt-4 text-[11px] leading-relaxed text-faint">
            The {TALLY.videos} movies and the {TALLY.stills} still set were
            captured 2026-10-20 by the harness from real unown sessions at
            128 × 36 and audited still by still; each poster is that scenario's
            first audited still. {TALLY.pending} entries have no capture, and
            the page says so instead of making media up.
          </p>

          {/* the display-command surface keeps this band as its one home,
              collapsed the hero-expander way: the gate resolves each row
              against splitview.ts's registerCommand calls */}
          <details className="group mt-3 max-w-xl border border-line bg-panel-2/40">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[11px] text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
              <span className="gb-label text-[9px] text-gold">/split</span>
              the display commands ({COMMANDS.length}) — the split-view
              mode&apos;s keyboard surface
              <span aria-hidden="true" className="ml-auto text-faint group-open:hidden">
                +
              </span>
              <span aria-hidden="true" className="ml-auto hidden text-faint group-open:inline">
                –
              </span>
            </summary>
            <div className="border-t border-line px-3 py-3">
              <ul>
                {COMMANDS.map(([cmd, what]) => (
                  <li
                    key={cmd}
                    className="flex flex-col gap-0.5 border-b border-line py-1.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
                  >
                    <code className="shrink-0 font-mono text-[11.5px] text-ink sm:w-40">
                      {cmd}
                    </code>
                    <span className="text-[12.5px] leading-relaxed text-dim">
                      {what}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
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
          </details>
        </FadeUp>
      </div>
    </section>
  );
}
