"use client";

import * as React from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { CopyButton, TerminalWindow } from "./shell";

/**
 * A scripted replay of one `unown` session.
 *
 * The accessibility contract is the whole point of this component, and it
 * follows the pattern the best terminal demos use:
 *
 *   - the animated screen is `aria-hidden`; the same transcript ships as a
 *     visually-hidden ordered list, so a screen reader gets the content in
 *     order and never the animation;
 *   - the scrubber is a real `role="slider"` with a seconds value and a text
 *     value naming the current step, operable with arrows / Home / End / Space;
 *   - play, pause and replay are real buttons, and only *user-initiated*
 *     playback is announced — autoplay is silent;
 *   - `prefers-reduced-motion` paints the finished session and never autoplays,
 *     while leaving the scrubber usable so the transcript is still explorable.
 *
 * The lines are the real formats the engine writes — the memory banner, the
 * hook decision log, the note template — not invented output.
 */

type Line =
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string; tone?: "dim" | "good" | "warn" | "accent" }
  | { kind: "rule" };

export const SESSION: Line[] = [
  { kind: "cmd", text: "unown \"why does checkout.spec flake in CI only?\"" },
  { kind: "out", text: "✓ preflight  bridge :3031 · kimi-k2.5 · 412ms", tone: "good" },
  { kind: "out", text: "✓ memory     policy → project v6 → user → local", tone: "good" },
  { kind: "out", text: "  hooks      SessionStart · PostToolUse · Stop", tone: "dim" },
  { kind: "out", text: "  read       tests/checkout.spec.ts" },
  { kind: "out", text: "  read       src/checkout.ts" },
  { kind: "out", text: "  grep       sharedCartFixture — 3 files" },
  { kind: "out", text: "▸ the fixture is module-level state, so beforeEach inherits", tone: "accent" },
  { kind: "out", text: "  the previous test's cart. Build it inside the hook.", tone: "accent" },
  { kind: "out", text: "  hook       PreToolUse deny  refusing rm on filesystem root", tone: "warn" },
  { kind: "out", text: "  edit       src/checkout.spec.ts  (+3 −1)" },
  { kind: "out", text: "  verify     14/14 passing · 2.1s", tone: "good" },
  { kind: "rule" },
  { kind: "out", text: "note queued → engine :3030", tone: "accent" },
  {
    kind: "out",
    text: "  \"Terminal session in ~/code/checkout (3 min): 1 prompt(s),",
    tone: "dim",
  },
  {
    kind: "out",
    text: "   14 tool call(s). The cart fixture was module-level state and",
    tone: "dim",
  },
  {
    kind: "out",
    text: "   leaked between tests — build it inside beforeEach.\"",
    tone: "dim",
  },
  { kind: "out", text: "  outbox     ~/.unown/notes/outbox/1757…-checkout.md", tone: "dim" },
];

/* ------------------------------------------------------------------ */
/* schedule                                                            */
/* ------------------------------------------------------------------ */

const CMD_MS_PER_CHAR = 26;
const LINE_HOLD = 420;
const LINE_STEP = 130;

type Slot = { line: Line; start: number; dur: number };

function schedule(script: Line[]): Slot[] {
  let t = 700;
  return script.map((line) => {
    const start = t;
    const dur =
      line.kind === "cmd"
        ? Math.max(LINE_HOLD, line.text.length * CMD_MS_PER_CHAR) + LINE_HOLD
        : line.kind === "rule"
          ? 220
          : LINE_STEP;
    t += dur;
    return { line, start, dur };
  });
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

const TONE: Record<NonNullable<Extract<Line, { kind: "out" }>["tone"]>, string> = {
  dim: "text-faint",
  good: "text-glow-soft",
  warn: "text-amber",
  accent: "text-ink",
};

export function SessionReplay({ script = SESSION }: { script?: Line[] }) {
  const reduced = useReducedMotion();
  const slots = React.useMemo(() => schedule(script), [script]);
  const total = React.useMemo(
    () => slots[slots.length - 1].start + slots[slots.length - 1].dur,
    [slots],
  );

  const [t, setT] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [announce, setAnnounce] = React.useState("");
  const raf = React.useRef(0);
  const last = React.useRef(0);

  const finished = t >= total;

  // Autoplay once on mount, unless the visitor asked for less motion.
  React.useEffect(() => {
    if (reduced) {
      setT(total);
      return;
    }
    setPlaying(true);
  }, [reduced, total]);

  React.useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, total]);

  function jump(ms: number) {
    setPlaying(false);
    setT(Math.min(total, Math.max(0, ms)));
  }

  function describe(ms: number): string {
    const at = slots.findIndex((s) => ms < s.start + s.dur);
    const idx = at === -1 ? slots.length - 1 : at;
    const line = slots[idx]?.line;
    if (!line) return "end of session";
    return `step ${idx + 1} of ${slots.length}: ${
      line.kind === "cmd" ? line.text : line.kind === "rule" ? "divider" : line.text
    }`;
  }

  function toggle() {
    if (playing) {
      setPlaying(false);
      setAnnounce("Paused.");
      return;
    }
    if (finished) setT(0);
    setPlaying(true);
    setAnnounce(finished ? "Replaying." : "Playing.");
  }

  function onSliderKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const jumpTo = (ms: number) => {
      e.preventDefault();
      jump(ms);
      setAnnounce(describe(ms));
    };
    switch (e.key) {
      case "ArrowRight":
        return jumpTo(t + 500);
      case "ArrowLeft":
        return jumpTo(t - 500);
      case "Home":
        return jumpTo(0);
      case "End":
        return jumpTo(total);
      case " ":
      case "Spacebar":
        e.preventDefault();
        return toggle();
    }
  }

  // Visible transcript: everything up to `t`, with the active command mid-type.
  const visible = slots.map((slot, i) => {
    const local = t - slot.start;
    if (local < 0) return null;
    if (slot.line.kind === "cmd") {
      const typed = Math.min(
        slot.line.text.length,
        Math.floor(local / CMD_MS_PER_CHAR),
      );
      return { key: i, slot, text: slot.line.text.slice(0, typed), live: typed < slot.line.text.length };
    }
    return { key: i, slot, text: slot.line.kind === "out" ? slot.line.text : "", live: false };
  });

  const commands = React.useMemo(
    () => script.filter((l): l is Extract<Line, { kind: "cmd" }> => l.kind === "cmd").map((l) => l.text),
    [script],
  );

  return (
    <figure className="m-0">
      <TerminalWindow
        title="unown — session"
        actions={<CopyButton text={commands.join("\n")} label="Copy the commands in this session" />}
      >
        {/* Animated surface — hidden from assistive tech; the list below is the
            accessible equivalent. */}
        <div aria-hidden="true" className="term-lines h-[19rem] overflow-hidden sm:h-[21rem]">
          <div className="flex h-full flex-col justify-end gap-[3px] p-4 gb-term text-[17px] leading-relaxed sm:p-5 sm:text-[19px]">
            {visible.map(
              (v) =>
                v && (
                  <div key={v.key} className="whitespace-pre-wrap break-words">
                    {v.slot.line.kind === "cmd" ? (
                      <span>
                        <span className="text-glow">$ </span>
                        <span className="text-ink">{v.text}</span>
                        {v.live ? (
                          <span className="unown-cursor ml-0.5 inline-block h-[0.95em] w-[0.5em] translate-y-[2px] bg-glow" />
                        ) : null}
                      </span>
                    ) : v.slot.line.kind === "rule" ? (
                      <span className="text-faint">────────────────────────────────</span>
                    ) : (
                      <span className={TONE[v.slot.line.tone ?? "dim"]}>{v.text}</span>
                    )}
                  </div>
                ),
            )}
          </div>
        </div>

        {/* controls */}
        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2.5">
          <button
            type="button"
            onClick={toggle}
            className="inline-flex size-7 items-center justify-center border border-line bg-panel-2 text-dim transition-colors duration-100 [transition-timing-function:steps(2,end)] hover:border-line-bright hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-glow"
            aria-label={playing ? "Pause the session replay" : finished ? "Replay the session" : "Play the session replay"}
          >
            {playing ? (
              <Pause className="size-3.5" aria-hidden="true" />
            ) : finished ? (
              <RotateCcw className="size-3.5" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" aria-hidden="true" />
            )}
          </button>

          {/* scrubber */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Session replay position"
            aria-valuemin={0}
            aria-valuemax={Math.round(total / 1000)}
            aria-valuenow={Math.round(t / 1000)}
            aria-valuetext={`${Math.round(t / 1000)} of ${Math.round(total / 1000)} seconds — ${describe(t)}`}
            onKeyDown={onSliderKey}
            onPointerDown={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - box.left) / box.width;
              jump(ratio * total);
              (e.currentTarget as HTMLElement).focus();
            }}
            className="relative h-6 flex-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-glow [transition-timing-function:steps(2,end)]"
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-line">
              <div
                className="h-full bg-glow/70"
                style={{ width: `${(t / total) * 100}%` }}
              />
            </div>
            <div
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 border border-canvas bg-glow"
              style={{ left: `${(t / total) * 100}%` }}
            />
          </div>

          <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
            {(t / 1000).toFixed(1)}s / {(total / 1000).toFixed(1)}s
          </span>
        </div>
      </TerminalWindow>

      {/* the same content, reachable without the animation */}
      <figcaption className="sr-only">
        <p>Transcript of an unown session:</p>
        <ol className="list-decimal pl-5">
          {script.map((line, i) => (
            <li key={i}>
              {line.kind === "cmd"
                ? `Command: ${line.text}`
                : line.kind === "rule"
                  ? "Divider"
                  : line.text}
            </li>
          ))}
        </ol>
        <p>
          The session ends by queueing a note in ~/.unown/notes/outbox for the engine's
          AutoDream job to consolidate.
        </p>
      </figcaption>

      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </figure>
  );
}

export type { Line };