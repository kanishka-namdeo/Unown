"use client";

import { useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { CHANGELOG_STOPS, CHANGELOG_TOTAL_ENTRIES, type ChangelogStop } from "./changelog-data";
import { FadeUp, GITHUB_URL, PixelCursor, SectionHead } from "./shell";

const CHANGELOG_URL = `${GITHUB_URL}/blob/main/CHANGELOG.md`;
const RELEASES_URL = `${GITHUB_URL}/releases`;

/** Which buckets get their titles printed. The rest are counted, not listed. */
const LISTED = new Set(["Added", "Behavior"]);
/** Titles a stop prints before the rest are counted and linked out. Exported so
 *  the test asserts the overflow arithmetic instead of hardcoding a number. */
export const MAX_LISTED = 5;

const NOUNS: Record<string, [string, string]> = {
  Added: ["addition", "additions"],
  Changed: ["change", "changes"],
  Deprecated: ["deprecation", "deprecations"],
  Removed: ["removal", "removals"],
  Fixed: ["fix", "fixes"],
  Security: ["security fix", "security fixes"],
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * `2026-10-18` -> `18 Oct 2026`, built from the ISO parts by hand.
 * `toLocaleDateString` reads the runtime locale, so a prerender on a UTC server
 * and a hydration in a browser with another locale could disagree — and a short
 * month keeps a tile from wrapping its date onto a second line.
 */
function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]?.slice(0, 3)} ${y}`;
}

function listedItems(stop: ChangelogStop, max = MAX_LISTED) {
  const listed = stop.groups.filter((g) => LISTED.has(g.bucket)).flatMap((g) => g.items);
  return { shown: listed.slice(0, max), hidden: Math.max(0, listed.length - max) };
}

/** `20 additions · 1 fix · 5 alter agent behavior` */
function tally(stop: ChangelogStop) {
  const parts = Object.entries(stop.counts)
    .filter(([bucket, n]) => n > 0 && NOUNS[bucket])
    .map(([bucket, n]) => {
      const [one, many] = NOUNS[bucket];
      return `${n} ${n === 1 ? one : many}`;
    });
  const behavior = stop.groups.reduce((n, g) => n + g.items.filter((i) => i.behavior).length, 0);
  if (behavior) parts.push(`${behavior} alter agent behavior`);
  return parts.join(" · ");
}

/** The newest stop that has actually been cut. That is the one the ▶ marks. */
export function latestCutIndex(stops: ChangelogStop[]) {
  return stops.findIndex((s) => s.date);
}

function Stop({ stop, isLatest }: { stop: ChangelogStop; isLatest: boolean }) {
  const cut = Boolean(stop.date);
  const { shown, hidden } = listedItems(stop);
  return (
    <li className="gb-rail-stop" aria-current={isLatest ? "date" : undefined}>
      {/* The route itself: a node at the stop, the line travelling forward to
          the next one. Decorative — the version and its date carry the same
          information as text, so nothing here is the only signal. */}
      <div aria-hidden="true" className="flex h-7 items-center">
        <span
          className={
            isLatest
              ? "size-[13px] border-[3px] border-(--hue-accent) bg-(--hue-accent)"
              : cut
                ? "size-[13px] border-[3px] border-(--hue-accent) bg-canvas"
                : "size-[13px] border-[3px] border-dashed border-(--hue-accent) bg-canvas"
          }
        />
        <span className="gb-rail-line h-[3px] flex-1 bg-(--hue-accent)" />
      </div>

      <div className="gb-panel relative flex flex-1 flex-col p-5">
        {isLatest ? (
          <PixelCursor className="absolute -left-[22px] top-[26px] size-4 text-(--hue-accent)" />
        ) : null}

        <p className="font-pixel text-[13px] leading-none text-(--hue-accent)">
          {cut ? `v${stop.label}` : "UNCUT"}
        </p>

        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[12px]">
          {cut ? (
            <time dateTime={stop.date ?? undefined} className="font-mono text-faint">
              {shortDate(stop.date ?? "")}
            </time>
          ) : (
            <span className="font-mono text-faint">no tag yet</span>
          )}
          {isLatest ? <span className="gb-label text-[8px] text-gold">latest</span> : null}
        </p>

        <p className="mt-3 text-[11px] leading-snug text-faint">{tally(stop)}</p>

        <ul role="list" className="mt-3 space-y-1.5 border-t border-line pt-3">
          {shown.map((item) => (
            <li key={item.title} className="text-[13px] leading-snug text-dim">
              {item.title}
            </li>
          ))}
        </ul>

        <p className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-4 text-[12px]">
          <a
            href={cut ? `${RELEASES_URL}/tag/v${stop.label}` : CHANGELOG_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="gb-label text-[9px] text-gold hover:text-gold-soft"
          >
            {cut ? `v${stop.label} release` : "CHANGELOG.md"}
          </a>
          {hidden > 0 ? (
            <a
              href={CHANGELOG_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-faint underline underline-offset-2 hover:text-gold"
            >
              +{hidden} more
            </a>
          ) : null}
        </p>
      </div>
    </li>
  );
}

/**
 * The shipping rail: what has been added to Unown, laid out as a route you
 * scroll sideways along.
 *
 * It sits between the FAQ and the finale because that is where a visitor has
 * just finished doubting, and the answer to "is this a live project or a
 * screenshot of one" is a record with dates on it.
 *
 * **Horizontal, and horizontal for a specific reason.** A vertical list of
 * releases makes the page grow every time the project ships: the section's
 * height would be a function of how much work has happened, which is the wrong
 * shape for both the page and the argument. Here the band is fixed height and
 * the history grows sideways, so the fortieth release costs the page nothing.
 *
 * That rules out the flashy version of the same idea. A pinned, scroll-jacked
 * horizontal panel (a tall container that translates the band sideways) just
 * moves the page-growth problem somewhere less reachable, takes the wheel from
 * the reader, and is explicitly the wrong call on touch and for text-heavy
 * content. So this is a native scroll container: trackpad, thumb, arrow keys
 * once the band has focus, and `◀ ▶` buttons for everyone else. The only
 * scroll-linked motion is the route drawing itself in, behind
 * `@supports (animation-timeline: view())`, authored from its finished state.
 *
 * Three constraints the design obeys rather than negotiates:
 *   - **the axis is ordinal, not proportional.** Two releases cut on the same
 *     day and a 48-day hole in the commit history would either fuse into one
 *     pixel or print a gap that reads as a rhythm this repository does not
 *     have. Distance carries order only; every date is printed as text, and the
 *     component test greps its own copy for cadence phrasing.
 *   - **a stop never needs sideways scrolling to be *read*.** Tiles are capped
 *     below the viewport width, so horizontal travel moves you between stops,
 *     never into the middle of one.
 *   - **the newest relevant stop is at the left edge.** The payoff is not
 *     behind an interaction: the frontier stop and the latest release are what
 *     you see before touching anything.
 *
 * The content is generated. `CHANGELOG_STOPS` comes from `CHANGELOG.md` via
 * `scripts/landing_changelog.mjs`, CI re-runs that with `--check`, and so a
 * release that shipped without the rail being regenerated is a red build. Dates
 * come only from release headings, `[Unreleased]` stays undated, and every
 * number on a tile is read off the data.
 */
export function ChangelogRail() {
  // The scroll container is the `.gb-rail` region div — `overflow-x: auto`
  // lives there in landing.css, NOT on the `<ol>` track (which is a plain
  // `width: max-content` flex row). The nudge originally called `scrollBy` on
  // the track itself: a non-scrollable element scrolls by exactly zero, so
  // the ◀ ▶ buttons shipped dead while the page copy advertised them. The
  // step is still measured off a `.gb-rail-stop` tile so a tile-width change
  // never desynchronises the nudge distance from the CSS.
  const scroller = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const latest = latestCutIndex(CHANGELOG_STOPS);

  const nudge = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    // One tile plus its gap; measured from the scroller so it survives a
    // tile-width change and never scrolls by a value the CSS has to agree
    // with by hand.
    const step =
      el.querySelector<HTMLElement>(".gb-rail-stop")?.getBoundingClientRect().width ??
      320;
    el.scrollBy({ left: dir * (step + 16), behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <section
      data-hue="aqua"
      id="changelog"
      className="scroll-mt-16 border-y border-line py-16 sm:py-[72px]"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <FadeUp className="max-w-2xl">
            <SectionHead
              kicker="Changelog"
              lead={
                <>
                  <span className="font-mono text-ink">{CHANGELOG_TOTAL_ENTRIES} entries</span>{" "}
                  so far, read out of{" "}
                  <span className="font-mono text-ink">CHANGELOG.md</span>, the same file{" "}
                  <span className="font-mono text-ink">unown changelog</span> prints in your
                  terminal. Dates come from release headings, titles from the bullets under them,
                  so nothing on this rail was written for the page.
                </>
              }
            >
              What has been added, and when.
            </SectionHead>
          </FadeUp>

          <FadeUp delay={0.08}>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => nudge(-1)}
                aria-label="Scroll the release rail to newer stops"
                className="gb-btn-dark inline-flex size-9 items-center justify-center"
              >
                <PixelCursor className="size-3 rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => nudge(1)}
                aria-label="Scroll the release rail to older stops"
                className="gb-btn-dark inline-flex size-9 items-center justify-center"
              >
                <PixelCursor className="size-3" />
              </button>
            </div>
          </FadeUp>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-6xl px-5 sm:px-6">
        <FadeUp>
          <div
            ref={scroller}
            className="gb-rail"
            role="region"
            tabIndex={0}
            aria-label="Release rail, newest stop first"
          >
            <ol role="list" reversed className="gb-rail-track">
              {CHANGELOG_STOPS.map((stop) => (
                <Stop
                  key={stop.label}
                  stop={stop}
                  isLatest={CHANGELOG_STOPS.indexOf(stop) === latest}
                />
              ))}
              {/* The band's exit. NOT aria-hidden: it holds two links, and a
                  focusable element inside a hidden-from-screen-readers subtree
                  is the `aria-hidden-focus` violation axe reports for it. Only
                  the decorative route stub above it is hidden. */}
              <li className="gb-rail-stop">
                <div aria-hidden="true" className="flex h-7 items-center">
                  <span className="h-[3px] flex-1 border-t-[3px] border-dashed border-(--hue-accent)" />
                </div>
                <div className="gb-inset flex-1 border-[3px] border-line p-5">
                  <p className="gb-label text-[9px] text-faint">the full record</p>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    <a
                      href={CHANGELOG_URL}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-gold underline underline-offset-2 hover:text-gold-soft"
                    >
                      CHANGELOG.md
                    </a>
                    <a
                      href={RELEASES_URL}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-gold underline underline-offset-2 hover:text-gold-soft"
                    >
                      GitHub Releases
                    </a>
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </FadeUp>

        <p className="gb-term mt-4 text-[15px] leading-snug text-faint">
          Newest on the left; the trail of cut releases recedes to the right. Scroll it sideways, or
          use ◀ ▶.
        </p>
      </div>
    </section>
  );
}
