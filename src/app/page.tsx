import "./landing.css";

import { AlphabetSection } from "@/components/landing/alphabet";
import {
  AlphabetWakeProvider,
  LetterRainProvider,
  LandingStyles,
} from "@/components/landing/effects";
import { BenchmarksSection } from "@/components/landing/benchmarks";
import { FaqSection } from "@/components/landing/faq";
import { FieldNotesSection } from "@/components/landing/field-notes";
import { FinaleSection } from "@/components/landing/finale";
import { Hero } from "@/components/landing/hero";
import { IntegritySection } from "@/components/landing/integrity";
import { LoopSection } from "@/components/landing/loop";
import { MechanismsSection } from "@/components/landing/mechanisms";
import { ModelsBand } from "@/components/landing/models";
import { OriginSection } from "@/components/landing/origin";
import { QuickstartSection } from "@/components/landing/quickstart";
import { ShowcaseSection } from "@/components/landing/showcase";
import { Footer, Nav } from "@/components/landing/shell";

/**
 * The marketing landing page at `/`. Composition only — every section owns
 * itself in `src/components/landing/`, and the contracts for that folder live
 * in its own AGENTS.md.
 *
 * The order is the argument, and it is deliberate:
 *
 *   hero (claim + a real session)            what it is, proven in one screen
 *   origin (one Unown alone is just pi)      why it is two halves, not one
 *   alphabet (the identity)                  the pun, and the 28 mechanisms
 *   loop (the real artifacts)                what each stage actually writes
 *   mechanisms (problem, then the answers)   the objection, then the receipts
 *   showcase                                 what the engine looks like
 *   models                                   the lock-in objection, answered
 *   benchmarks                               proof, including where it loses
 *   integrity                                the objection that decides installs
 *   quickstart                               the five commands
 *   field notes                              where the name came from
 *   faq                                      the remaining hard questions
 *   finale                                   the last ask, plus the toy
 *
 * `NAV_LINKS` in `shell.tsx` mirrors the top-level anchors. If you add a
 * section, add it there too or the page grows an orphan.
 */
export default function LandingPage() {
  return (
    <LetterRainProvider>
      <AlphabetWakeProvider>
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
            <OriginSection />
            <AlphabetSection />
            <LoopSection />
            <MechanismsSection />
            <ShowcaseSection />
            <ModelsBand />
            <BenchmarksSection />
            <IntegritySection />
            <QuickstartSection />
            <FieldNotesSection />
            <FaqSection />
            <FinaleSection />
          </main>
          <Footer />
        </div>
      </AlphabetWakeProvider>
    </LetterRainProvider>
  );
}