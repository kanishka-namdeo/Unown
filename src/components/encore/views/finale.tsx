"use client";

import * as React from "react";
import { ENCORE_ITERATIONS } from "@/lib/encore/seed";
import { score } from "@/lib/encore/format";
import { ReceiptRef } from "../primitives";

/**
 * Band 7 — The Finale (plan §5.7).
 *
 * The program's success question and its live-rendered answer.
 *
 * The question is static: "Can a measured, receipted critique loop
 * take a page from FAIL to PASS, and prove it?"
 *
 * The answer is LIVE from `ENCORE_ITERATIONS` — it renders the
 * latest iteration's `passed` boolean. Today (baseline only), the
 * answer is "not yet — the loop is mid-flight". When the critique
 * loop lands a passing receipt (iter1 with `passed: true`), the
 * answer flips with zero code change — the same append-clean
 * invariant that powers the delta table (plan risk #10).
 *
 * CTA back to the gallery: "Back to the gallery" → `/#live-demo`
 * (the landing's live-demo band, which iframes Encore).
 * "Read the session log" → the session doc on GitHub.
 *
 * A11y (plan §5.7):
 *  - The question is an `h2`
 *  - The answer is `role="status"` (announced on load; flips only
 *    when a new receipt lands, never a loop)
 *  - The CTA is a single clearly-labeled link
 */

const SESSION_LOG_URL =
  "https://github.com/kanishka-namdeo/Unown/blob/main/docs/website-excellence-session.md";

export function Finale({ embed }: { embed: boolean }) {
  void embed;
  const latest = ENCORE_ITERATIONS[ENCORE_ITERATIONS.length - 1];
  const passed = latest.passed;
  const overall = score(latest.overall);

  return (
    <section
      id="finale"
      className="encore-section"
      aria-labelledby="finale-heading"
    >
      <div className="mx-auto w-full max-w-3xl text-center">
        <FinaleHeading />

        {/* The question + the live answer */}
        <div className="mt-8">
          <p className="encore-type-body-lg mx-auto max-w-2xl text-dim">
            The program&apos;s success question:
          </p>
          <blockquote className="mx-auto mt-4 max-w-xl border-l-2 border-gold pl-4 text-left">
            <p className="encore-type-body text-ink italic">
              &ldquo;Can a measured, receipted critique loop take a
              page from FAIL to PASS, and prove it?&rdquo;
            </p>
          </blockquote>

          {/* The answer — LIVE from ENCORE_ITERATIONS. When a
              passing receipt lands, this flips with zero code
              change (the append-clean invariant). */}
          <div
            role="status"
            aria-live="polite"
            className="encore-reveal mx-auto mt-6 inline-flex flex-col items-center gap-2 border border-line bg-panel px-6 py-4"
            data-testid="finale-answer"
          >
            <span className="encore-type-caption text-dim">
              Current answer ·{" "}
              <ReceiptRef path={latest.receiptPath} short={`receipt · ${latest.label}`} />
            </span>
            {passed ? (
              <span className="encore-type-body-lg font-semibold text-gold">
                Yes — the latest iteration ({score(latest.overall)}{" "}
                overall) passes all 11 gates.
              </span>
            ) : (
              <>
                <span className="encore-type-body-lg font-semibold text-dim">
                  Not yet — the loop is mid-flight at{" "}
                  <strong className="text-gold">{overall}</strong>{" "}
                  overall ({latest.label}).
                </span>
                <span className="encore-type-caption text-dim">
                  The answer flips when the next receipt lands with{" "}
                  <code className="font-mono">passed: true</code> —
                  zero code change.
                </span>
              </>
            )}
          </div>
        </div>

        {/* The CTAs — back to the gallery + the session log */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a
            href="/#live-demo"
            className="encore-type-body-sm border border-gold bg-gold px-6 py-3 font-medium text-canvas transition-colors hover:bg-gold-soft"
            data-testid="finale-cta-gallery"
          >
            Back to the gallery
          </a>
          <a
            href={SESSION_LOG_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="encore-type-body-sm border border-line bg-panel px-6 py-3 font-medium text-ink transition-colors hover:border-line-bright"
            data-testid="finale-cta-log"
          >
            Read the session log
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── sub-components ───────────────────────────────────────────────── */

function FinaleHeading() {
  return (
    <header>
      <p className="encore-type-eyebrow encore-face-accent text-gold">
        The Finale
      </p>
      <h2
        id="finale-heading"
        className="encore-type-display-4 mt-4 text-ink"
      >
        The question the round set out to answer
      </h2>
    </header>
  );
}
