"use client";

import { CHANGELOG_STOPS, CHANGELOG_TOTAL_ENTRIES, type ChangelogStop } from "./changelog-data";
import { FadeUp, GITHUB_URL, SectionHead } from "./shell";

const CHANGELOG_URL = `${GITHUB_URL}/blob/main/CHANGELOG.md`;
const RELEASES_URL = `${GITHUB_URL}/releases`;

/** Which buckets get their titles printed. The rest are counted, not listed. */
const LISTED = new Set(["Added", "Behavior"]);
/** Entries a stop prints before the rest are counted and linked out. Exported
 *  so the test can assert the overflow arithmetic instead of hardcoding 8. */
export const MAX_LISTED = 8;

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
 * `2026-10-18` -> `18 October 2026`, built from the ISO parts by hand.
 * `toLocaleDateString` would read the runtime locale, so a prerender on a UTC
 * server and a hydration in a browser with another locale could disagree.
 */
function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

function items(stop: ChangelogStop, max = MAX_LISTED) {
  const listed = stop.groups.filter((g) => LISTED.has(g.bucket)).flatMap((g) => g.items);
  const shown = listed.slice(0, max);
  return { shown, hidden: listed.length - shown.length };
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

function Stop({ stop }: { stop: ChangelogStop }) {
  const cut = Boolean(stop.date);
  const { shown, hidden } = items(stop);
  return (
    <li className="relative pl-6 sm:pl-8">
      <span
        aria-hidden="true"
        className={
          cut
            ? "absolute left-[-5px] top-[7px] size-2 border border-line-bright bg-canvas"
            : "absolute left-[-5px] top-[7px] size-2 border border-line-bright bg-(--hue-accent)"
        }
      />

      <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="gb-label text-[10px] text-(--hue-accent)">
          {cut ? `v${stop.label}` : "Not cut yet"}
        </span>
        {cut ? (
          <time dateTime={stop.date ?? undefined} className="font-mono text-[12px] text-faint">
            {longDate(stop.date ?? "")}
          </time>
        ) : (
          <span className="font-mono text-[12px] text-faint">
            merged on <span className="text-ink">main</span>, no tag yet
          </span>
        )}
      </h3>

      <p className="mt-2 text-[12px] leading-relaxed text-faint">{tally(stop)}</p>

      <ul role="list" className="mt-3 space-y-1.5">
        {shown.map((item) => (
          <li key={item.title} className="text-[13px] leading-snug text-dim">
            {item.title}
          </li>
        ))}
      </ul>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {hidden > 0 ? (
          <span className="text-faint">
            {hidden} more in{" "}
            <a
              href={CHANGELOG_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-gold underline underline-offset-2 hover:text-gold-soft"
            >
              CHANGELOG.md
            </a>
          </span>
        ) : null}
        <a
          href={cut ? `${RELEASES_URL}/tag/v${stop.label}` : CHANGELOG_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="gb-label text-[9px] text-gold hover:text-gold-soft"
        >
          {cut ? `v${stop.label} release` : "CHANGELOG.md"}
        </a>
      </p>
    </li>
  );
}

/**
 * The shipping rail: what has been added to Unown, in release order.
 *
 * It sits between the FAQ and the finale because that is where a visitor has
 * just finished doubting: the answer to "is this a live project or a screenshot
 * of one" is a list with dates on it. It is also the page's only section whose
 * content is not authored in the component. `CHANGELOG_STOPS` is generated from
 * `CHANGELOG.md` by `scripts/landing_changelog.mjs`, and CI re-runs that script
 * with `--check`, so a feature that landed without the rail being regenerated
 * fails the build rather than quietly making the page stale.
 *
 * Three consequences of that wiring, each of which is a rule:
 *   - dates come only from release headings, so the rail never claims a cadence
 *     the repository does not have (two releases, both cut on the same day);
 *   - `[Unreleased]` renders with no date at all, because it has not happened
 *     yet and an undated promise is the one thing this page cannot check;
 *   - totals and tallies are read off the data, never typed into prose, so an
 *     appended changelog entry cannot leave a stale number behind.
 *
 * And one that the screenshot caught: the entry count never sits in the `h2`.
 * Pixelify Sans renders `57` as `S7` at heading size, and an ambiguous digit on
 * the one page whose argument is that its numbers are checkable is a defect, not
 * a type choice. The count lives in the lead, in Geist with a mono span.
 */
export function ChangelogRail() {
  const stops = CHANGELOG_STOPS;
  return (
    <section
      data-hue="magma"
      id="changelog"
      className="scroll-mt-16 border-y border-line py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <FadeUp>
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
              <div className="gb-box mt-8 p-5">
                <p className="gb-term text-[17px] leading-snug text-canvas">
                  Add a feature, add a changelog entry, re-run one script, and this rail moves. If
                  the page and the file disagree, CI fails.
                </p>
              </div>
            </FadeUp>

            <FadeUp delay={0.14}>
              <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
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
            </FadeUp>
          </div>

          <FadeUp delay={0.1}>
            <ol
              role="list"
              reversed
              aria-label="Release stops, newest first"
              className="space-y-10 border-l border-line pl-0"
            >
              {stops.map((stop) => (
                <Stop key={stop.label} stop={stop} />
              ))}
            </ol>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}
