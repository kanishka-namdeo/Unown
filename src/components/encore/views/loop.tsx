"use client";

import * as React from "react";

/**
 * Band 3 — the critique loop stepper (plan §5.3).
 *
 * The six-step loop `build → capture → audit → critique → fix →
 * re-score` (README "The method") as a keyboard-operable
 * tablist/stepper:
 *
 *  - `role="tablist"` + `role="tab"` nodes with `aria-selected`
 *    on the active tab;
 *  - arrow-key nav (Left/Right, Up/Down), Home/End to the ends;
 *  - each panel = the step's one line + its artifact;
 *  - the full loop exposed as an ordered list inside the tab
 *    panels (not just the visual nodes);
 *  - the tool mapping is a visible caption (which tool owns which
 *    step).
 *
 * The active step is one of the three reset-wiped states (plan
 * §3.4) — the parent shell drives it through the `activeStep`
 * prop, and the reset handshake re-anchors it to 0.
 */

/* The six-step loop (plan §5.3, README "The method"). */
export const LOOP_STEPS = [
  {
    key: "build",
    label: "build",
    detail:
      "Next builds /encore — the app is the surface, and it must build clean before the critic can audit it.",
    artifact: "`next build` exit 0",
  },
  {
    key: "capture",
    label: "capture",
    detail:
      "The Playwright lane shoots 1440×900 desktop + 390×844 mobile at every band. No shot, no score.",
    artifact: "`shots/<route>/` PNGs",
  },
  {
    key: "audit",
    label: "audit",
    detail:
      "The objective audit runs on the captured DOM: 11 gates (font sizes ≤ 8, off-grid ≤ 15%, contrast 0, overflow 0, …), computed per device.",
    artifact: "`audit.{desktop,mobile}` JSON",
  },
  {
    key: "critique",
    label: "critique",
    detail:
      "The VLM critiques the shots against the seven axes — hierarchy, typography, spacing, color, alignment, density, overall. Each miss is a named, receipted line.",
    artifact: "`critiques[]` + 7-axis scores",
  },
  {
    key: "fix",
    label: "fix",
    detail:
      "The agent fixes the named misses — the F-ledger grows, the pre-push checklist gains whatever it was missing.",
    artifact: "commit + F-ledger entry",
  },
  {
    key: "re-score",
    label: "re-score",
    detail:
      "The loop runs again on the new build. A run without a receipt never counts — the new receipt is the only thing that proves the fix moved the number.",
    artifact: "new receipt in `critiques/`",
  },
] as const;

type LoopStep = (typeof LOOP_STEPS)[number];

export function Loop({
  activeStep,
  onSelect,
}: {
  activeStep: number;
  onSelect: (k: number) => void;
}) {
  return (
    <section
      id="loop"
      className="encore-section"
      aria-labelledby="loop-heading"
    >
      <div className="mx-auto w-full max-w-3xl">
        <LoopHeading />
        <LoopStepper steps={LOOP_STEPS} activeStep={activeStep} onSelect={onSelect} />
        <LoopToolMapping />
      </div>
    </section>
  );
}

function LoopHeading() {
  return (
    <header className="mb-8">
      <p className="encore-type-eyebrow encore-face-accent text-gold">
        The Loop
      </p>
      <h2 id="loop-heading" className="encore-type-display-4 mt-4 text-ink">
        A measured critique loop, receipted
      </h2>
      <p className="encore-type-body-lg mt-4 max-w-xl text-dim">
        Six steps, run by the critic. A run without a receipt never counts
        — every number on this page traces back to one.
      </p>
    </header>
  );
}

function LoopToolMapping() {
  return (
    <div className="mt-6">
      <p className="encore-type-caption text-dim">
        The tool that owns each step: <code className="font-mono">design_critic.mjs</code>{" "}
        runs build → capture → audit; the VLM runs critique; the agent runs
        fix; the re-score is the next receipt.
      </p>
    </div>
  );
}

/**
 * The keyboard-operable 6-node loop stepper (plan §5.3).
 *
 * Controlled component: the parent owns `activeStep`; this
 * component handles keyboard nav and calls `onSelect` when the
 * user steps. The reset handshake (plan §3.4) drives `activeStep`
 * back to 0 through the parent — the stepper itself just
 * re-renders to the new value.
 */
function LoopStepper({
  steps,
  activeStep,
  onSelect,
}: {
  steps: readonly LoopStep[];
  activeStep: number;
  onSelect: (k: number) => void;
}) {
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, Math.min(steps.length - 1, activeStep));

  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    const n = steps.length;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (idx + 1) % n;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (idx - 1 + n) % n;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = n - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onSelect(next!);
    // Move focus to the newly-selected tab (the tabpanel's tab).
    tabRefs.current[next!]?.focus();
  }

  const active = steps[selected];

  return (
    <div>
      {/* The tablist — the six nodes. */}
      <div
        role="tablist"
        aria-label="The critique loop"
        className="flex flex-wrap gap-2"
      >
        {steps.map((s, i) => {
          const isSelected = i === selected;
          return (
            <button
              key={s.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`loop-tab-${s.key}`}
              aria-selected={isSelected}
              aria-controls={`loop-panel-${s.key}`}
              tabIndex={isSelected ? 0 : -1}
              data-testid={`loop-tab-${s.key}`}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`encore-type-body-sm border px-4 py-2 ${
                isSelected
                  ? "border-gold bg-panel-2 text-gold"
                  : "border-line bg-panel text-dim hover:text-ink"
              }`}
            >
              <span className="encore-type-caption text-dim mr-2">
                {i + 1}.
              </span>
              {s.label}
            </button>
          );
        })}
      </div>

      {/* The active panel — the step's one-line detail + artifact.
          Rendered as a single visible panel (the others stay out of
          the DOM, not just hidden, so the a11y tree matches what
          is shown). The full ordered list of steps lives in the
          sr-only list below (plan §5.3: "the full loop is exposed
          as an ordered list inside the tab panels"). */}
      <div
        role="tabpanel"
        id={`loop-panel-${active.key}`}
        aria-labelledby={`loop-tab-${active.key}`}
        className="mt-6 border border-line bg-panel px-6 py-6"
        data-testid={`loop-panel-${active.key}`}
      >
        <div className="flex items-start gap-4">
          <span className="encore-type-eyebrow encore-face-accent text-gold shrink-0">
            {selected + 1}/6
          </span>
          <div className="min-w-0">
            <h3 className="encore-type-body-lg font-semibold text-ink">
              {active.label}
            </h3>
            <p className="encore-type-body mt-4 text-dim">{active.detail}</p>
            <p className="encore-type-body-sm mt-4 text-dim">
              artifact: <code className="font-mono text-ink">{active.artifact}</code>
            </p>
          </div>
        </div>
      </div>

      {/* The full loop, exposed as an ordered list (plan §5.3 a11y
          contract). Visually hidden — the tab nodes + panel already
          show the current step; the list is for SRs reading the
          whole sequence. */}
      <ol
        className="sr-only"
        aria-label="The critique loop, all six steps"
      >
        {steps.map((s) => (
          <li key={s.key}>
            {s.label} — {s.detail} Artifact: {s.artifact}
          </li>
        ))}
      </ol>
    </div>
  );
}
