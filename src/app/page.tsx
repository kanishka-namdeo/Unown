import "./landing.css";

import { AlphabetSection } from "@/components/landing/alphabet";
import { ChangelogRail } from "@/components/landing/changelog";
import {
  AlphabetWakeProvider,
  LetterRainProvider,
  LandingStyles,
} from "@/components/landing/effects";
import { DexSection } from "@/components/landing/dex";
import { FaqSection } from "@/components/landing/faq";
import { FinaleSection } from "@/components/landing/finale";
import { Hero } from "@/components/landing/hero";
import { LoopSection } from "@/components/landing/loop";
import { ProofSection } from "@/components/landing/proof";
import { ShowcaseSection } from "@/components/landing/showcase";
import { Footer, LandingMotion, Nav } from "@/components/landing/shell";

/**
 * The marketing landing page at `/`. Composition only — every section owns
 * itself in `src/components/landing/`, and the contracts for that folder live
 * in its own AGENTS.md.
 *
 * Nine bands, 2026-10-20. The page ran fourteen sections / 21.5 viewports /
 * 5,488 words, and visitors scrolled past most of it (see
 * docs/landing-research.md: ~57% of attention lands above the fold, 74%
 * within two screenfuls). The redesign kept every checkable claim and cut the
 * scroll roughly in half by merging sections that told one story:
 *
 *   hero (claim + install + full manual quickstart)   what it is; the one-liner chip,
 *                                                     the sequence and the command
 *                                                     surface in collapsed expanders
 *   loop (origin + loop)                              how it learns: the three
 *                                                     artifacts and the two halves
 *   dex (the capability dex)                          what it can do: every feature
 *                                                     as a creature, searchable —
 *                                                     the one home for creature art
 *                                                     and capability copy since
 *                                                     the party strip and the
 *                                                     mechanisms bento moved in
 *   showcase (mission control)                        what the engine looks like
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
 * contract for its ten entries.
 *
 * `NAV_LINKS` in `shell.tsx` mirrors the top-level anchors. If you add a
 * section, add it there too or the page grows an orphan.
 */
export default function LandingPage() {
  return (
    <LetterRainProvider>
      <AlphabetWakeProvider>
        {/* `LandingMotion` makes every framer animation on this page honour
            `prefers-reduced-motion`, including the staged ones that are not
            written through `FadeUp`. See its doc comment in `shell.tsx`. */}
        <LandingMotion>
        <LandingStyles />
        <div className="grain grain-fixed relative isolate flex min-h-screen flex-col overflow-x-clip bg-canvas text-ink">
          <a
            href="#main"
            className="skip-link rounded-md bg-gold px-4 py-2 text-sm font-medium text-canvas"
          >
            Skip to content
          </a>
          <Nav />
          <main id="main" className="flex-1">
            <Hero />
            <LoopSection />
            <DexSection />
            <ShowcaseSection />
            <ProofSection />
            <AlphabetSection />
            <FaqSection />
            <ChangelogRail />
            <FinaleSection />
          </main>
          <Footer />
        </div>
        </LandingMotion>
      </AlphabetWakeProvider>
    </LetterRainProvider>
  );
}
