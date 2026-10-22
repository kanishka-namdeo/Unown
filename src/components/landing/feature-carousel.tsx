"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { FadeUp, PixelCursor, SectionHead, TerminalWindow } from "./shell";

/**
 * The feature carousel — band five (aqua), the split-view band converted into
 * a stage that plays every feature's capture in turn.
 *
 * The rule this band keeps from its split-view predecessor: media exists,
 * prose explains — every frame and every second here is a real capture. The
 * video set is the nine scenarios the TUI-capture harness shipped
 * (`public/landing/tui/README.md`, workflow contract in
 * `docs/tui-capture-workflow.md`); split view keeps its pane-truth stills (its
 * lane ships no video); five features the page claims have no capture yet and
 * show an empty stage instead. No new capture was made for this band —
 * placeholders stay placeholders until the harness turns through that lane.
 *
 * Playbook (the pane contract, the proof band's): all fifteen slides render
 * into the server DOM with the inactive ones `hidden`, so every writeup and
 * placeholder stays crawlable. The active video starts muted + looping in
 * `useEffect` (never via an `autoPlay` attribute, so a reduced-motion visitor
 * never gets one rendered); `prefers-reduced-motion` gets poster-first frames
 * and the explicit play button instead. Slides do not auto-advance: the band
 * is conservative motion, the reader is the rotor.
 *
 * The `/split*` command table stays in this band as a collapsed expander —
 * it is still the one home for the display-command surface, and
 * `scripts/landing_claims.mjs` gates each row against the `registerCommand`
 * calls in the extension (the PAGES map named this file when the band moved).
 */

const REPO =
  "https://github.com/kanishka-namdeo/Unown/blob/main";

type Media =
  | { kind: "video"; webm: string; mp4: string; poster: string }
  | { kind: "still"; src: string; alt: string }
  | { kind: "empty" };

type Slide = {
  id: string;
  /** Counter-friendly short name. */
  label: string;
  title: string;
  writeup: string;
  /** [label, href] — one row, at the doc or file that ships the claim. */
  receipt?: [string, string];
  media: Media;
};

/**
 * One slide per capture lane, in the order the band narrates: the working
 * loop first, the mode-specific flights behind it, split view's stills, then
 * the five no-capture slots. Posters are each scenario's first audited still
 * — the frame the video's opening beat resembles — because a poster that lies
 * about its movie would fail the band's own honesty rule.
 */
const SLIDES: Slide[] = [
  {
    id: "loop",
    label: "The fix loop",
    title: "The fix loop",
    writeup:
      "A failing suite in a real repo: the agent investigates, edits, re-runs the tests until they pass. Six audited stills compress to one turn of the working loop.",
    receipt: ["tui-beauty RESULTS.md", `${REPO}/benchmarks/tui-beauty/RESULTS.md`],
    media: {
      kind: "video",
      webm: "/landing/tui/hero-bugfix/hero-bugfix.webm",
      mp4: "/landing/tui/hero-bugfix/hero-bugfix.mp4",
      poster: "/landing/tui/hero-bugfix/stills/01-boot-fresh-session.png",
    },
  },
  {
    id: "plan",
    label: "Plan mode",
    title: "Plan mode",
    writeup:
      "Read-only until approved: /plan drafts the numbered plan, the approval overlay hands execution over, and the plan runs to completion.",
    receipt: ["docs/usage.md", `${REPO}/docs/usage.md`],
    media: {
      kind: "video",
      webm: "/landing/tui/plan-mode/plan-mode.webm",
      mp4: "/landing/tui/plan-mode/plan-mode.mp4",
      poster: "/landing/tui/plan-mode/stills/01-session.png",
    },
  },
  {
    id: "checkpoints",
    label: "Checkpoints",
    title: "Checkpoints",
    writeup:
      "One session, four beats: a rename writes the checkpoint, /checkpoints lists them, /undo reverts the tree, /redo restores it.",
    receipt: ["docs/usage.md", `${REPO}/docs/usage.md`],
    media: {
      kind: "video",
      webm: "/landing/tui/checkpoints/checkpoints.webm",
      mp4: "/landing/tui/checkpoints/checkpoints.mp4",
      poster: "/landing/tui/checkpoints/stills/01-rename-done.png",
    },
  },
  {
    id: "overlays",
    label: "The overlays",
    title: "The overlays",
    writeup:
      "The in-session panels: the /model picker switches models live, then /permissions and /hooks open over the running session.",
    receipt: ["docs/usage.md", `${REPO}/docs/usage.md`],
    media: {
      kind: "video",
      webm: "/landing/tui/overlays/overlays.webm",
      mp4: "/landing/tui/overlays/overlays.mp4",
      poster: "/landing/tui/overlays/stills/01-model-picker.png",
    },
  },
  {
    id: "review",
    label: "Review",
    title: "Review",
    writeup:
      "A /review over an uncommitted fix: the reviewers run, the SHIP verdict lands, the review artifact is written to disk.",
    receipt: ["docs/usage.md", `${REPO}/docs/usage.md`],
    media: {
      kind: "video",
      webm: "/landing/tui/review/review.webm",
      mp4: "/landing/tui/review/review.mp4",
      poster: "/landing/tui/review/stills/01-session-with-uncommitted-diff.png",
    },
  },
  {
    id: "subagent",
    label: "Subagent",
    title: "A subagent runs",
    writeup:
      "The task tool spawns an agent with a fresh context, and it maps the real Unown repo into a module map you can read.",
    receipt: ["docs/subagents.md", `${REPO}/docs/subagents.md`],
    media: {
      kind: "video",
      webm: "/landing/tui/subagent-explore/subagent-explore.webm",
      mp4: "/landing/tui/subagent-explore/subagent-explore.mp4",
      poster: "/landing/tui/subagent-explore/stills/01-boot-in-real-repo.png",
    },
  },
  {
    id: "fleet",
    label: "The fleet",
    title: "The fleet",
    writeup:
      "Subagents run async: the fleet widget shows the spawn, ask_question gets the orchestrator's answer channel, task_control steers the run, /tasks keeps the registry resumable.",
    receipt: ["docs/subagents.md", `${REPO}/docs/subagents.md`],
    media: {
      kind: "video",
      webm: "/landing/tui/fleet/fleet.webm",
      mp4: "/landing/tui/fleet/fleet.mp4",
      poster: "/landing/tui/fleet/stills/01-boot-fleet-ready.png",
    },
  },
  {
    id: "wiki",
    label: "The wiki",
    title: "The wiki",
    writeup:
      "/wiki generates this repository's wiki, then the same panel searches it with scored results.",
    receipt: ["repo-wiki.ts", `${REPO}/pi-repo/packages/self-learning/src/repo-wiki.ts`],
    media: {
      kind: "video",
      webm: "/landing/tui/wiki/wiki.webm",
      mp4: "/landing/tui/wiki/wiki.mp4",
      poster: "/landing/tui/wiki/stills/01-wiki-generating.png",
    },
  },
  {
    id: "doctor",
    label: "Doctor",
    title: "Out of the session",
    writeup:
      "A shell showcase in three commands: unown doctor walks the chat path, models lists the routing, usage reports the spend.",
    receipt: ["docs/usage.md", `${REPO}/docs/usage.md`],
    media: {
      kind: "video",
      webm: "/landing/tui/cli-doctor/cli-doctor.webm",
      mp4: "/landing/tui/cli-doctor/cli-doctor.mp4",
      poster: "/landing/tui/cli-doctor/stills/01-doctor.png",
    },
  },
  {
    id: "split",
    label: "Split view",
    title: "Split view",
    writeup:
      "The display mode this band used to be about on its own: a Thinking panel and a Tool Usage band across the top, a Files dock with its edit-diff subpanel on the right, a response-only transcript. A built-in port of pi-split-view 1.1.0, shipped with every session. Stills only — this lane has no video.",
    receipt: ["docs/split-view.md", `${REPO}/docs/split-view.md`],
    media: {
      kind: "still",
      src: "/landing/tui/split-view/stills/01-band-thinking-tools.png",
      alt: "unown split view — the top band with a Thinking panel beside a Tool Usage panel, the transcript below",
    },
  },
  {
    id: "goals",
    label: "Goals",
    title: "Goals",
    writeup:
      "A durable objective the session completes against cited evidence — the usage docs' goals section carries the rules. No capture yet.",
    receipt: ["docs/usage.md", `${REPO}/docs/usage.md`],
    media: { kind: "empty" },
  },
  {
    id: "routines",
    label: "Routines",
    title: "Routines",
    writeup:
      "Recurring runs on real recurrence semantics — docs/routines.md is the decision record. No capture yet.",
    receipt: ["docs/routines.md", `${REPO}/docs/routines.md`],
    media: { kind: "empty" },
  },
  {
    id: "mcp",
    label: "MCP",
    title: "MCP servers",
    writeup:
      "Connect and manage MCP servers in the session and from the CLI — the usage docs carry both sections. No capture yet.",
    receipt: ["docs/usage.md", `${REPO}/docs/usage.md`],
    media: { kind: "empty" },
  },
  {
    id: "websearch",
    label: "Web search",
    title: "Web search + webfetch",
    writeup:
      "The web lane rides every session — the capability dex (the crawler form, 001) carries the capability. No capture yet.",
    receipt: ["docs/usage.md", `${REPO}/docs/usage.md`],
    media: { kind: "empty" },
  },
  {
    id: "skills",
    label: "Skills",
    title: "Skills",
    writeup:
      "Instruction files the session loads on demand — docs/skills.md has the surface. No capture yet.",
    receipt: ["docs/skills.md", `${REPO}/docs/skills.md`],
    media: { kind: "empty" },
  },
];

const VIDEO_COUNT = SLIDES.filter((s) => s.media.kind === "video").length;
const STILL_COUNT = SLIDES.filter((s) => s.media.kind === "still").length;
const PENDING_COUNT = SLIDES.filter((s) => s.media.kind === "empty").length;

/**
 * The split-view command surface. Each command name is gated by
 * `scripts/landing_claims.mjs` against the `registerCommand` calls in
 * `splitview.ts` — a command the extension does not register turns the page
 * red. The hero keeps the `unown` CLI surface; this expander is the one home
 * for the display commands. The rows parser reads this array's shape, so it
 * stays exactly as it was in split-view.tsx.
 */
const COMMANDS: [string, string][] = [
  ["/split", "toggle all panels; off restores pi's bare layout"],
  ["/split-thinking", "toggle the thinking panel"],
  ["/split-tools", "toggle the tools panel"],
  ["/files", "toggle the files panel (dock or overlay)"],
  ["/split-diff", "toggle the dock's edit-diff subpanel"],
  ["/split-tools-view", "tool panel: compact or full detail"],
  ["/split-height", "top band height in rows (6-40)"],
  ["/split-tools-width", "tools panel width, % of the band (20-60)"],
  ["/split-divider", "divider between answers: rule or space"],
  ["/split-trim-response", "transcript: full or responses only"],
  ["/split-save", "save this layout as the startup defaults"],
];

/** Pause chrome: two crisp bars — the steps() sibling of PixelCursor's ▶. */
function PauseBars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden="true"
      shapeRendering="crispEdges"
      className={className}
      fill="currentColor"
    >
      <rect x="1" y="1" width="3" height="8" />
      <rect x="6" y="1" width="3" height="8" />
    </svg>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

export function FeatureCarouselSection() {
  const [active, setActive] = React.useState(0);
  const [userPaused, setUserPaused] = React.useState(false);
  const reduced = useReducedMotion() ?? false;
  const videoRefs = React.useRef<(HTMLVideoElement | null)[]>([]);

  const slide = SLIDES[active];
  const next = () => setActive((a) => (a + 1) % SLIDES.length);
  const prev = () => setActive((a) => (a - 1 + SLIDES.length) % SLIDES.length);

  // Playback sync. No autoplay attribute is ever rendered: the video starts
  // from this effect after hydration, so the decision (-muted, looping,
  // entitled to autoplay) is made once, in JS, where reduced motion is known.
  // Everything else pauses — the stage is one moving picture at a time.
  React.useEffect(() => {
    for (const [i, v] of videoRefs.current.entries()) {
      if (!v) continue;
      if (i === active && !reduced && !userPaused) {
        try {
          const p = v.play?.();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch {
          // an autoplay rejection is the finished (paused) state
        }
      } else {
        v.pause?.();
      }
    }
  }, [active, reduced, userPaused]);

  const togglePause = () =>
    setUserPaused((p) => !p);

  const hasVideoNow = slide.media.kind === "video";

  return (
    <section data-hue="aqua" id="features" className="scroll-mt-16 py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <FadeUp className="max-w-2xl">
            <SectionHead
              kicker="In motion"
              lead={
                <>
                  Real captures, end to end: the fix loop, plan mode,
                  checkpoints, the overlays, review, subagents, the wiki,
                  doctor and split view. {VIDEO_COUNT} of {SLIDES.length} carry
                  video, {STILL_COUNT} is still-only, {PENDING_COUNT} slots
                  stay empty.
                </>
              }
            >
              Watch it work.
            </SectionHead>
          </FadeUp>

          <FadeUp delay={0.06} className="mt-6">
            <TerminalWindow title="unown — feature captures">
              {/* the pane contract (the proof band's, inherited from the
                  split-view band): all slides mounted, inactive hidden, so
                  every writeup and every placeholder stays in the SSR DOM */}
              {SLIDES.map((s, i) => {
                const on = i === active;
                return (
                  <div
                    key={s.id}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`${pad(i + 1)} of ${pad(SLIDES.length)}: ${s.label}`}
                    hidden={!on}
                    className="border-t border-line"
                  >
                    <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-8">
                      <div className="min-w-0">
                        <div className="aspect-[1600/1074] w-full overflow-hidden border border-line bg-canvas">
                          {s.media.kind === "video" ? (
                            <video
                              ref={(el) => {
                                videoRefs.current[i] = el;
                              }}
                              className="h-full w-full object-contain"
                              muted
                              loop
                              playsInline
                              preload="none"
                              poster={s.media.poster}
                              width={1600}
                              height={1074}
                            >
                              <source src={s.media.webm} type="video/webm" />
                              <source src={s.media.mp4} type="video/mp4" />
                            </video>
                          ) : s.media.kind === "still" ? (
                            <img
                              src={s.media.src}
                              alt={s.media.alt}
                              width={2214}
                              height={1369}
                              loading="lazy"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center px-6 text-center sm:px-10">
                              <div>
                                <p className="gb-label text-[9px] text-faint">
                                  no capture yet
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-col">
                        <h3 className="gb-h text-[clamp(1.3rem,2vw,1.7rem)] text-(--hue-accent)">
                          {s.title}
                        </h3>
                        <p className="mt-3 text-[13.5px] leading-relaxed text-dim">
                          {s.writeup}
                        </p>
                        {s.receipt ? (
                          <p className="mt-4 pt-1">
                            <a
                              href={s.receipt[1]}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="font-mono text-[10px] text-faint underline underline-offset-2 transition-colors hover:text-gold"
                            >
                              {s.receipt[0]}
                            </a>
                          </p>
                        ) : null}
                        {s.media.kind === "empty" ? (
                          <p className="mt-4 text-[11px] leading-relaxed text-faint">
                            Captures are made only by the harness in{" "}
                            <code className="font-mono text-dim">scripts/tui-capture/</code>{" "}
                            — it turns through a feature and lays down its stills
                            and its movie. Nothing here was captured by hand.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </TerminalWindow>

            {/* controls under the stage: stepped buttons, a live counter, no
                auto-advance — the reader is the rotor */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={prev}
                aria-label="Show the previous feature capture"
                className="gb-btn-dark inline-flex size-9 items-center justify-center"
              >
                <PixelCursor className="size-3 rotate-180" />
              </button>
              <button
                type="button"
                onClick={togglePause}
                aria-label={userPaused ? "Play the feature capture" : "Pause the feature capture"}
                className={`gb-btn-dark inline-flex size-9 items-center justify-center ${
                  hasVideoNow ? "" : "cursor-not-allowed opacity-40"
                }`}
                disabled={!hasVideoNow}
              >
                {userPaused ? (
                  <PixelCursor className="size-2.5" />
                ) : (
                  <PauseBars className="size-3" />
                )}
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Show the next feature capture"
                className="gb-btn-dark inline-flex size-9 items-center justify-center"
              >
                <PixelCursor className="size-3" />
              </button>
              <p
                aria-live="polite"
                className="ml-auto font-mono text-[12.5px] text-dim"
              >
                {pad(active + 1)} / {pad(SLIDES.length)} — {slide.label}
              </p>
            </div>

            {/* provenance + placeholder contract, one line */}
            <p className="mt-2 text-[11px] text-faint">
              Captured 2026-10-20 by the harness from real unown sessions at
              128 × 36, audited still by still; posters are each scenario&apos;s
              first audited still; {PENDING_COUNT} slots are features without a
              capture — the page does not make media up.
            </p>

            {/* the display-command surface keeps this band as its one home,
                collapsed the hero-expander way: the gate resolves each row
                against splitview.ts's registerCommand calls */}
            <details className="group mt-3 max-w-xl border border-line bg-panel-2/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[11px] text-dim transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                <span className="gb-label text-[9px] text-gold">/split</span>
                the display commands ({COMMANDS.length}) — the split-view
                mode&apos;s keyboard surface
                <span aria-hidden="true" className="ml-auto text-faint group-open:hidden">
                  +
                </span>
                <span aria-hidden="true" className="ml-auto hidden text-faint group-open:inline">
                  –
                </span>
              </summary>
              <div className="border-t border-line px-3 py-3">
                <ul>
                  {COMMANDS.map(([cmd, what]) => (
                    <li
                      key={cmd}
                      className="flex flex-col gap-0.5 border-b border-line py-1.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-3"
                    >
                      <code className="shrink-0 font-mono text-[11.5px] text-ink sm:w-40">
                        {cmd}
                      </code>
                      <span className="text-[12.5px] leading-relaxed text-dim">
                        {what}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
                  Toggles last the session. <code className="font-mono text-dim">/split-save</code>{" "}
                  writes the layout to{" "}
                  <span className="font-mono">~/.unown/agent/ui-panels.json</span> and new
                  windows start from it. The response-only mode keeps the thinking and tool
                  traffic in the band and dock and prints just the conversation in the
                  transcript. The band and dock compose in fullscreen mode, the default for
                  new installs; in regular mode{" "}
                  <code className="font-mono text-dim">/files</code> falls back to an overlay.
                </p>
              </div>
            </details>
          </FadeUp>
        </div>
      </section>
  );
}
