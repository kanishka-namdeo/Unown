"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "@/lib/sigil/types";

export interface TimerConfig {
  focusMin: number;
  breakMin: number;
}

interface FocusTimerProps {
  tasks: Task[];
  timer: TimerConfig;
  onTimer: (t: TimerConfig) => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onSessionComplete: (entry: { taskId: string; startedAt: string; durationMin: number }) => void;
}

interface Phase {
  name: "focus" | "break";
  remaining: number; // seconds
}

const focusTasks = (tasks: Task[]) =>
  tasks.filter((t) => t.column !== "done");

export function FocusTimer({
  tasks,
  timer,
  onTimer,
  selectedTaskId,
  onSelectTask,
  onSessionComplete,
}: FocusTimerProps) {
  const [phase, setPhase] = useState<Phase>({ name: "focus", remaining: timer.focusMin * 60 });
  const [running, setRunning] = useState(false);
  const startRef = useRef<string | null>(null); // ISO when the focus phase began
  const doneRef = useRef(false);

  // Keep timer config editable while idle
  useEffect(() => {
    if (!running) {
      setPhase((p) => ({ ...p, remaining: p.name === "focus" ? timer.focusMin * 60 : timer.breakMin * 60 }));
    }
  }, [timer, running]);

  const activeTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const start = useCallback(() => {
    if (!selectedTaskId) return;
    setPhase({ name: "focus", remaining: timer.focusMin * 60 });
    startRef.current = new Date().toISOString();
    doneRef.current = false;
    setRunning(true);
  }, [selectedTaskId, timer.focusMin]);

  const stop = useCallback(() => {
    setRunning(false);
  }, []);

  const skip = useCallback(() => {
    setRunning(false);
    setPhase((p) => ({
      name: p.name === "focus" ? "break" : "focus",
      remaining: p.name === "focus" ? timer.breakMin * 60 : timer.focusMin * 60,
    }));
  }, [timer]);

  // Tick every second while running
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setPhase((p) => {
        const remaining = p.remaining - 1;
        if (remaining > 0) return { ...p, remaining };
        // phase completed
        if (p.name === "focus" && startRef.current && !doneRef.current) {
          doneRef.current = true;
          onSessionComplete({
            taskId: selectedTaskId!,
            startedAt: startRef.current,
            durationMin: timer.focusMin,
          });
        }
        // auto-advance to the next phase
        const nextName = p.name === "focus" ? "break" : "focus";
        return {
          name: nextName,
          remaining: nextName === "focus" ? timer.focusMin * 60 : timer.breakMin * 60,
        };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, onSessionComplete, selectedTaskId, timer]);

  const mm = String(Math.floor(phase.remaining / 60)).padStart(2, "0");
  const ss = String(phase.remaining % 60).padStart(2, "0");
  const totalSec = (phase.name === "focus" ? timer.focusMin : timer.breakMin) * 60;
  const pct = totalSec > 0 ? ((totalSec - phase.remaining) / totalSec) * 100 : 0;

  const R = 120;
  const C = 2 * Math.PI * R;

  return (
    <section aria-label="Focus timer" className="mx-auto max-w-xl space-y-5">
      <div className="rounded-2xl border border-sf-border bg-sf-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {phase.name === "focus" ? "Focus" : "Break"}
          </h2>
          <span
            className="rounded-full bg-sf-accent/10 px-3 py-1 text-sm font-medium text-sf-accent"
            aria-live="polite"
          >
            {mm}:{ss}
          </span>
        </div>

        <div className="flex flex-col items-center gap-5">
          <div
            className="relative h-56 w-56"
            role="img"
            aria-label={`${phase.name} timer at ${mm}:${ss}`}
          >
            <svg viewBox="0 0 260 260" className="h-full w-full -rotate-90">
              <circle
                cx="130"
                cy="130"
                r={R}
                fill="none"
                stroke="var(--sf-surface-2)"
                strokeWidth="12"
              />
              <circle
                cx="130"
                cy="130"
                r={R}
                fill="none"
                stroke="var(--sf-accent)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C - (pct / 100) * C}
                className="transition-[color,background-color,border-color] duration-1000 ease-linear"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-bold tabular-nums">{mm}:{ss}</span>
              <span className="mt-1 text-sm text-sf-dim">
                {phase.name === "focus" ? "focus" : "break"}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            {!running ? (
              <button
                type="button"
                onClick={start}
                disabled={!selectedTaskId}
                className="rounded-lg bg-sf-accent px-5 py-2 text-sm font-medium text-sf-accent-contrast disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent focus-visible:outline-offset-2"
              >
                Start
              </button>
            ) : (
              <button
                type="button"
                onClick={stop}
                className="rounded-lg bg-sf-accent px-5 py-2 text-sm font-medium text-sf-accent-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent focus-visible:outline-offset-2"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={skip}
              className="rounded-lg border border-sf-border bg-sf-surface px-4 py-2 text-sm text-sf-dim hover:text-sf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
            >
              Skip
            </button>
          </div>
        </div>

        {/* Timer config (editable while not running) */}
        <fieldset
          disabled={running}
          className="mt-6 border-t border-sf-border pt-4 disabled:opacity-60"
        >
          <legend className="sr-only">Timer durations</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-sf-dim">
              Focus
              <input
                type="number"
                min={1}
                max={180}
                value={timer.focusMin}
                onChange={(e) =>
                  onTimer({ ...timer, focusMin: clampInt(e.target.value, 1, 180) })
                }
                aria-label="Focus minutes"
                className="w-16 rounded border border-sf-border bg-sf-surface px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
              />
              min
            </label>
            <label className="flex items-center gap-2 text-sm text-sf-dim">
              Break
              <input
                type="number"
                min={0}
                max={60}
                value={timer.breakMin}
                onChange={(e) =>
                  onTimer({ ...timer, breakMin: clampInt(e.target.value, 0, 60) })
                }
                aria-label="Break minutes"
                className="w-16 rounded border border-sf-border bg-sf-surface px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
              />
              min
            </label>
          </div>
        </fieldset>
      </div>

      {/* Task picker */}
      <div className="rounded-2xl border border-sf-border bg-sf-surface p-6">
        <h2 className="mb-3 text-sm font-semibold text-sf-dim">Pick a task to focus on</h2>
        <label htmlFor="focus-task-select" className="mb-2 block text-xs text-sf-dim">
          Task
        </label>
        <select
          id="focus-task-select"
          value={selectedTaskId ?? ""}
          onChange={(e) => onSelectTask(e.target.value || null)}
          className="w-full rounded-lg border border-sf-border bg-sf-surface px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
        >
          <option value="">— select a task —</option>
          {focusTasks(tasks).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>

        {activeTask && (
          <div className="mt-4 rounded-lg bg-sf-surface-2 p-3 text-sm">
            <p className="font-medium">{activeTask.title}</p>
            {activeTask.description && (
              <p className="mt-1 text-xs text-sf-dim">{activeTask.description}</p>
            )}
            <p className="mt-2 text-xs text-sf-dim">
              {activeTask.focusSessions.length} completed focus session
              {activeTask.focusSessions.length === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function clampInt(v: string, min: number, max: number): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}
