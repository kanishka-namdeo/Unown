"use client";

import * as React from "react";
import { F_LEDGER } from "@/lib/encore/seed";
import { FChip } from "../primitives";
import type { FailureEntry } from "@/lib/encore/types";

/**
 * Band 6 — The Failures (the F-ledger, plan §5.6).
 *
 * The round's failures, ledgered: each entry gets the F-code chip
 * (F10, F11, …), its one-line root cause (`what`), how it was closed
 * (`outcome`), and the `fixRef` link (the commit + the session doc).
 *
 * The band's thesis: "Every failure became a benchmark." Each entry
 * in the ledger is not just a scar — it is a data point that
 * strengthens the loop. F10 made the pre-push checklist; F11 put
 * lint in the checklist. A new failure APPENDS to `F_LEDGER`
 * (the seed array) — the UI renders the array, so a new entry is
 * a data add, not a code change (plan §5.6).
 *
 * A11y (plan §5.6): a single-column `ul` of `li`, each an
 * `article` named by its code.
 *
 * Iter0 critique fixes: the card padding is SYMMETRIC top/bottom
 * (the 24/16 asymmetry, work order 6); the `fix-ref` line is
 * body-sm (the cramped micro-text, work order 4's floor is 12px
 * and this was at it — moved up a tier); the CLOSED label is
 * SANS gold-semibold (the amber-nearly-invisible defect, work
 * order 7 — now clearly above the 4.5:1 floor on panel); the
 * chip-to-text gap is tightened (the "floaty" label defect); the
 * closing paragraph gains bottom room (the rhythm defect).
 */

export function Failures({ embed }: { embed: boolean }) {
  void embed;
  const entries = F_LEDGER;

  return (
    <section
      id="failures"
      className="encore-section"
      aria-labelledby="failures-heading"
    >
      <div className="mx-auto w-full max-w-3xl">
        <FailuresHeading />

        {/* The F-ledger: single-column ul of li, each an article
            named by its code (plan §5.6 a11y contract). */}
        <ul
          aria-label="The F-ledger — every failure became a benchmark"
          className="flex flex-col gap-4"
          data-testid="failures-ledger"
        >
          {entries.map((entry) => (
            <li key={entry.code}>
              <FailureRow entry={entry} />
            </li>
          ))}
        </ul>

        {/* The thesis line — the band's claim. Bottom margin gives
            the band its close (the cramped-against-boundary
            defect, iter0 band05). */}
        <p className="encore-type-body-sm mt-8 pb-4 text-dim">
          Every failure on this ledger became a benchmark that the
          loop runs every time. A new failure appends to the array
          — the UI renders it with zero code change.
        </p>
      </div>
    </section>
  );
}

/* ── sub-components ───────────────────────────────────────────────── */

function FailuresHeading() {
  return (
    <header className="mb-8">
      <p className="encore-type-eyebrow encore-face-accent text-gold">
        The Failures
      </p>
      <h2
        id="failures-heading"
        className="encore-type-display-4 mt-4 font-semibold text-ink"
      >
        Every failure became a benchmark
      </h2>
      <p className="encore-type-body-lg mt-4 max-w-xl text-dim">
        The round&apos;s P0s and P1s, ledgered with their root
        causes, their fixes, and the receipt that proves each one
        is closed.
      </p>
    </header>
  );
}

/**
 * One F-ledger row: the code chip, the one-line root cause, the
 * outcome, and the `fixRef` link.
 *
 * Symmetric card padding (work order 6): 16px all around — the
 * 24-top/16-bottom split was the optical imbalance. The chip sits
 * closer to the text block (gap-4 → gap-3, the cohesion fix).
 *
 * The `fixRef` is a commit hash + session doc reference — the
 * "no number without a receipt" contract (plan risk #5): the
 * `fixRef` is a link, not a claim. It is body-sm with the commit
 * hash in mono (the hash is code; the surrounding words are
 * not — work order 5).
 */
function FailureRow({ entry }: { entry: FailureEntry }) {
  // The fixRef shape: "docs/... CP0 — commit 3c4cf87". Split the
  // commit hash out so it renders in mono, the doc ref in sans.
  const commitMatch = entry.fixRef.match(/commit\s+([0-9a-f]+)$/);
  const commit = commitMatch ? commitMatch[1] : "";
  const docPart = commit && commitMatch
    ? entry.fixRef.replace(commitMatch[0], "").trim().replace(/\s+$/, "")
    : entry.fixRef;

  return (
    <article
      aria-label={`Failure ${entry.code}`}
      className="encore-reveal border border-line bg-panel p-4"
      data-testid={`failure-${entry.code}`}
    >
      <div className="flex items-start gap-3">
        <FChip code={entry.code} />
        <div className="min-w-0 flex-1">
          {/* The one-line root cause */}
          <p className="encore-type-body text-ink">{entry.what}</p>
          {/* The outcome (how it was closed) — CLOSED is SANS
              gold-semibold (the luminance-defect fix, work order 7)
              and the outcome reads dim on panel. */}
          <p className="encore-type-body-sm mt-2 text-dim">
            <span className="encore-type-caption mr-2 border border-gold/40 bg-panel-2 px-2 py-1 font-semibold text-gold">
              CLOSED
            </span>
            {entry.outcome}
          </p>
          {/* The fix-ref line — body-sm (the cramped micro-text
              defect, work order 4). The commit hash is the only
              mono in the line (it IS a code value, work order 5). */}
          <p className="encore-type-body-sm mt-2 break-words text-dim">
            fix-ref:{" "}
            <a
              href={`https://github.com/kanishka-namdeo/Unown/commit/${commit}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-amber underline underline-offset-2 hover:text-amber"
            >
              {docPart}
              {commit ? (
                <>
                  {" · commit "}
                  <code className="font-mono">{commit}</code>
                </>
              ) : null}
            </a>
          </p>
        </div>
      </div>
    </article>
  );
}
