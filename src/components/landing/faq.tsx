"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQ } from "./faq-data";
import { FadeUp, PixelCursor, SectionHead } from "./shell";

/**
 * The skeptic's questions — the data lives in `faq-data.ts` (one source for
 * both the accordion and the FAQPage JSON-LD; see that file's header).
 */

export function FaqSection() {
  return (
    <section data-hue="gold" id="faq" className="scroll-mt-16 border-t border-line py-16 sm:py-[72px]">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14">
          <FadeUp>
            <SectionHead
              kicker="FAQ"
              lead="Including the one that decides installs: will it rewrite my tests to make them pass."
            >
              The skeptic&apos;s questions.
            </SectionHead>
          </FadeUp>

          <FadeUp delay={0.06}>
            <Accordion type="single" collapsible className="w-full">
              {FAQ.map((item) => (
                <AccordionItem
                  key={item.q}
                  value={item.q}
                 
                  className="gb-panel mb-3 border-0 last:mb-0"
                >
                  <AccordionTrigger className="group rounded-none text-left text-[14.5px] font-medium text-ink hover:no-underline hover:text-gold [&>svg]:hidden">
                    <span className="flex items-center gap-2.5">
                      {/* The disclosure affordance: a dim ▶ on every closed row
                          (a closed question that shows nothing reads as plain
                          text — the chevron-on-open-only version shipped that
                          way and nobody could tell the list was clickable),
                          brightening to gold on hover and to solid gold when
                          open. Same PixelCursor the nav and the rail use. */}
                      <PixelCursor
                        className="h-3 w-[7px] shrink-0 text-faint transition-[color,opacity] [transition-timing-function:steps(2,end)] group-hover:text-dim group-data-[state=open]:text-gold"
                      />
                      <span>{item.q}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="gb-term text-[19px] leading-snug text-dim">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}
