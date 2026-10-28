import "./landing.css";

import { AlphabetSection } from "@/components/landing/alphabet";
import { ChangelogRail } from "@/components/landing/changelog";
import {
  AlphabetWakeProvider,
  LetterRainProvider,
  LandingStyles,
  SpotlightProvider,
} from "@/components/landing/effects";
import { DexSection } from "@/components/landing/dex";
import { FaqSection } from "@/components/landing/faq";
import { FinaleSection } from "@/components/landing/finale";
import { Hero } from "@/components/landing/hero";
import { BuiltImprovedSection } from "@/components/landing/built-improved";
import { LiveDemoSection } from "@/components/landing/live-demo";
import { LoopSection } from "@/components/landing/loop";
import { ProofSection } from "@/components/landing/proof";
import { ShowcaseSection } from "@/components/landing/showcase";
import { LandingJsonLd } from "@/components/landing/seo";
import { Footer, LandingMotion, Nav } from "@/components/landing/shell";

/**
 * The marketing landing page at `/`. Composition only — every section owns
 * itself in `src/components/landing/`, and the contracts for that folder live
 * in its own AGENTS.md.
 *
 * Eleven bands (the live demo joined 2026-10-28; the built & improved
 * showcase followed it 2026-10-29). The page ran fourteen sections / 21.5 viewports / 5,488 words
 * (2026-10-20), and visitors scrolled past most of it (see
 * docs/landing-research.md: ~57% of attention lands above the fold, 74%
 * within two screenfuls). The redesign kept every checkable claim and cut the
 * scroll roughly in half by merging sections that told one story:
 *
 *   hero (claim + install + full manual quickstart)   what it is; the one-liner chip,
 *                                                     the sequence and the command
 *                                                     surface in collapsed expanders
 *   loop (origin + loop)                              how it learns: the three
 *                                                     artifacts and the two halves
 *   dex (the capability dex)                          what it can do, and the proof
 *                                                     it can: one numbered spine
 *                                                     № 001-020 — the ten drawn
 *                                                     forms, the ten filmed
 *                                                     behaviors, each entry with
 *                                                     its specimen, its capture or
 *                                                     its honest empty stage, its
 *                                                     weakness and its receipts. The
 *                                                     one home for creature art,
 *                                                     capability copy, the TUI
 *                                                     captures and the `/split*`
 *                                                     display-command table
 *   showcase (mission control)                        what the engine looks like
 *   live demo (the agent-built app)                   what it BUILDS, running
 *                                                     live in the visitor's
 *                                                     browser — the /demo
 *                                                     route iframed in
 *                                                     browser chrome
 *   built & improved (the SOTA round's receipts)     what the loop minted,
 *                                                     remembered and proved
 *                                                     while it built Fugue:
 *                                                     the six-receipt
 *                                                     tally, the Mission
 *                                                     Control stills, the
 *                                                     three receipt links
 *   proof (benchmarks + integrity + models)           the receipts, one tabbed band
 *   alphabet (+ field notes)                          the identity: the wall, the
 *                                                     decode panel, the lexicon
 *   faq                                               the remaining hard questions
 *   changelog (from CHANGELOG.md)                     the record, still being written
 *   finale                                            the last ask, plus the toy
 *
 * The order is still the argument: claim → mechanism → capability → proof →
 * identity → record. Install sits in the hero because for a clone-and-run tool
 * the install IS the argument. The proof band's tabs keep all three panes
 * mounted (inactive ones `hidden`), so every generated number stays in the DOM
 * for crawlers and for the `landing_*.mjs` gates — the dex keeps the same
 * contract for its twenty entries and their media.
 *
 * On 2026-10-23 the dex absorbed the feature-capture carousel (band five,
 * `#features`): one subject, one instrument. The merge paid for itself before
 * it landed — the carousel's writeups moved into the entries they belonged to
 * instead of being restated, and the harness-provenance paragraph that used to
 * repeat inside every empty stage is now said once for the whole band.
 *
 * `NAV_ENTRIES` in `shell.tsx` mirrors the top-level anchors. If you add a
 * section, add it there too or the page grows an orphan — `group: "more"` is
 * the default home for a new entry; the bar's four are the argument's four.
 */
export default function LandingPage() {
  return (
    <LetterRainProvider>
      <AlphabetWakeProvider>
        {/* `LandingMotion` makes every framer animation on this page honour
            `prefers-reduced-motion`, including the staged ones that are not
            written through `FadeUp`. See its doc comment in `shell.tsx`. */}
        <LandingMotion>
        {/* `SpotlightProvider` installs the one passive pointer listener that
            lights `[data-spotlight]` cards under the cursor (`effects.tsx`).
            It owns no DOM, so nesting it inside the motion root changes
            nothing about the page's rendered shape. */}
        <SpotlightProvider>
        {/* The page's structured data (Organization + SoftwareApplication +
            FAQPage, one graph) — a server-rendered <script>, first in the
            body so it never paints. See `seo.tsx`. */}
        <LandingJsonLd />
        <LandingStyles />
        <div className="grain grain-fixed relative isolate flex min-h-screen flex-col overflow-x-clip bg-canvas text-ink">
          {/* The route bar — reading progress scrubbed on the compositor by
              the page's own scroll (`animation-timeline: scroll(root)`,
              `.route-bar` in landing.css). Decorative and `aria-hidden`;
              browsers without scroll timelines and reduced-motion visitors
              get no bar at all, which is the honest rendering of "no
              scrubbing, no progress". */}
          <div className="route-bar" aria-hidden="true" />
          <a
            href="#main"
            className="skip-link bg-gold px-4 py-2 text-sm font-medium text-canvas"
          >
            Skip to content
          </a>
          <Nav />
          <main id="main" className="flex-1">
            <Hero />
            <LoopSection />
            <DexSection />
            <ShowcaseSection />
            <LiveDemoSection />
            <BuiltImprovedSection />
            <ProofSection />
            <AlphabetSection />
            <FaqSection />
            <ChangelogRail />
            <FinaleSection />
          </main>
          <Footer />
        </div>
        </SpotlightProvider>
        </LandingMotion>
      </AlphabetWakeProvider>
    </LetterRainProvider>
  );
}
