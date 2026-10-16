import "./landing.css";

import { AlphabetSection } from "@/components/landing/alphabet";
import { AlphabetWakeProvider, LetterRainProvider, LandingStyles } from "@/components/landing/effects";
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
 * Order matters here. The persuasive sequence is deliberate:
 *   hero → proof-of-work session → trust strip → (alphabet, identity) →
 *   (why two halves, the architecture argument) → the loop with real artifacts
 *   → the problem and the five mechanisms → mission control → model agnostic →
 *   benchmarks → integrity → install → field notes → FAQ → close.
 *
 * `nav` order in `shell.tsx` mirrors the top-level anchors; if you add a
 * section, add it there too or the page grows an orphan.
 */
export default function LandingPage() {
  return (
    <LetterRainProvider>
      <AlphabetWakeProvider>
        <LandingStyles />
        <div className="grain grain-fixed relative isolate flex min-h-screen flex-col overflow-x-clip bg-canvas text-ink">
          <Nav />
          <main className="flex-1">
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