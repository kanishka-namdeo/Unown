"use client";

import * as React from "react";
import Fuse from "fuse.js";
import { Creature } from "./creature";
import { DEX, type DexEntry, type DexType } from "./dex-data";
import { FadeUp, SectionHead, toneAttr } from "./shell";

/**
 * The capability dex — band three, and since 2026-10-20 the one canonical
 * home for the feature creatures and the capability copy both.
 *
 * The interaction is the Gen-3 Pokédex pattern (see docs/landing-research.md
 * Part 15): a numbered list you walk with the arrow keys, a search box, and
 * a detail pane that redraws the moment the cursor moves — selection
 * follows focus, exactly like the handheld's cursor. The research round
 * found no reusable library that renders this with a project's OWN sprites
 * (every npm "pokedex" is a PokéAPI data client or a tutorial app shipping
 * official Nintendo art — the non-affiliation wall forbids exactly that),
 * so the pattern is built here in the page's furniture and the one genuine
 * dependency it needs is real: fuse.js drives the search.
 *
 * A11y: the list is a WAI-ARIA listbox (roving tabindex, arrows / Home /
 * End, selection follows focus); the detail pane mounts ALL ten entries
 * with the inactive ones `hidden` — the same contract the proof band's
 * tabbed panes keep, so every capability line stays in the DOM for
 * crawlers and for the `landing_*.mjs` gates. The cry is an ORIGINAL
 * synthesized chirp (Web Audio square wave, deterministic per creature) —
 * no sampled audio, nothing borrowed; it is inert until clicked and
 * silently absent where AudioContext does not exist.
 *
 * No-JS: the server renders the full list and the first entry's detail,
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

/* ------------------------------------------------------------------ */
/* one detail pane                                                     */
/* ------------------------------------------------------------------ */

function DexDetail({ entry, no, shown }: { entry: DexEntry; no: number; shown: boolean }) {
  return (
    <article
      aria-label={`${entry.name}, dex entry ${entry.no} of ten`}
      hidden={!shown}
      className="gb-panel lift flex flex-col"
    >
      {/* the specimen — h-48 is 3× the 64px logical grid, so the sprite
          stays on its own pixels (integer multiple, never resampled); the
          dex is the one place a creature is the show, so it gets the big
          frame (VLM review round 1 verdict: an h-32 specimen reads
          unanchored beside the 36px name) */}
      <div className="flex items-start gap-5 border-b border-line p-4 sm:p-5">
        <Creature id={entry.id} className="h-48 w-auto shrink-0" />
        {/* self-center: the name block centers against the 192px specimen
            instead of hanging off its top edge (VLM crop review round 1 —
            the header read left-heavy with dead space below the name) */}
        <div className="min-w-0 flex-1 self-center">
          <p className="gb-label text-[9px] text-(--hue-accent)">
            № {entry.no} · {entry.category}
          </p>
          {/* aria-live: the pane does not take focus when the cursor moves,
              so the name announces itself instead */}
          <p aria-live="polite" className="gb-term mt-1 text-[36px] leading-none text-ink">
            {entry.name}
          </p>
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

      {/* the entry — the dex speaks from the screen, so it sits on the
          gb-box like every quotation on this page (the wrapper carries only
          a hairline's padding; the box brings its own) */}
      <div className="border-b border-line p-3 sm:p-3.5">
        <div className="gb-box p-3.5">
          <blockquote className="quote text-[18px] leading-relaxed text-canvas">
            {entry.entry}
          </blockquote>
        </div>
      </div>

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
        <div className="flex gap-3">
          <dt className="gb-label w-20 shrink-0 pt-1 text-[8px] text-faint">weakness</dt>
          <dd className="min-w-0 pt-0.5 font-mono text-[11.5px] text-dim">{entry.weakness}</dd>
        </div>
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
      <span className="sr-only">entry {no} of ten</span>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* section                                                             */
/* ------------------------------------------------------------------ */

export function DexSection() {
  const [sel, setSel] = React.useState(0);
  const [q, setQ] = React.useState("");
  const opts = React.useRef<(HTMLButtonElement | null)[]>([]);

  // fuse.js: the drivable search dependency of this band (Part 15) —
  // fuzzy over everything a visitor might type: the name, the category,
  // the weakness, the capability copy, even the type word. Threshold 0.3 +
  // minMatchCharLength 2 was measured against this list: looser (0.38)
  // fuzzy-matched a third of the dex for a three-letter query, which reads
  // as broken, not forgiving.
  const fuse = React.useMemo(
    () =>
      new Fuse([...DEX], {
        keys: ["name", "category", "weakness", "practice", "type"],
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
            Every feature, catalogued as a creature.
          </SectionHead>
          <p className="mt-4 text-pretty leading-relaxed text-dim">
            The session tools and the engine mechanisms, one original render each —
            walk the list, type to filter, play a cry. Every entry links the source
            that ships it.
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
                    {visible.length}/10
                  </span>
                </div>
              </div>

              <div
                role="listbox"
                aria-label="The capability dex — ten forms"
                onKeyDown={onListKey}
                /* Capped + scrollable below lg so the mobile page cannot grow
                   a tenth-of-the-page list; on desktop all ten rows show —
                   a cut-off row 9-10 with no scroll affordance read as a
                   broken list (VLM review round 1, light scheme). */
                className="grid max-h-[26rem] gap-px overflow-y-auto border border-line bg-line lg:max-h-none lg:overflow-visible"
              >
                {visible.length === 0 ? (
                  <p className="bg-panel px-3.5 py-4 font-mono text-[11px] text-faint">
                    no form matches — esc clears
                  </p>
                ) : (
                  visible.map((i) => {
                    const e = DEX[i];
                    const on = i === shown;
                    return (
                      <button
                        key={e.id}
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
                        <span
                          className={`gb-label ml-auto shrink-0 text-[8px] ${
                            on ? "text-canvas/80" : "text-faint"
                          }`}
                        >
                          {TYPE_LABEL[e.type]}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <p className="mt-3 font-mono text-[10px] text-faint">
                ↑ ↓ walk the list · type to filter · esc clears · every entry links its
                receipts
              </p>
            </div>

            {/* the detail — all ten mounted, the inactive ones hidden (the
                proof band's pane contract: crawlers and gates read every
                capability line) */}
            <div className="min-w-0">
              {DEX.map((e, i) => (
                <DexDetail key={e.id} entry={e} no={i + 1} shown={i === shown} />
              ))}
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
