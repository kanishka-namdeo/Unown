"use client";

/**
 * The Habits view: every habit as a compact card (with Edit and a two-step
 * archive/remove), a "+ New habit" affordance that opens HabitForm in
 * create mode, and a detail panel for `selectedHabitId` — the 52-week
 * heatmap plus that habit's own numbers.
 */
import { useState } from "react";
import { useCadence } from "@/lib/cadence/store";
import { bestStreak, currentStreak, weeklyTarget } from "@/lib/cadence/streaks";
import { cadenceStats } from "@/lib/cadence/stats";
import type { CheckoffDate } from "@/lib/cadence/types";
import { HabitCard } from "./habit-card";
import { Heatmap } from "./heatmap";
import { HabitForm } from "./habit-form";
import { Kpi } from "./primitives";
import { todayKey } from "./format";

export function Habits({ asOf }: { asOf?: CheckoffDate }) {
  const { state, removeHabit, selectHabit, setView } = useCadence();
  const day = asOf ?? todayKey(new Date());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const selected = state.selectedHabitId
    ? state.habits.find((h) => h.id === state.selectedHabitId)
    : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Habits</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-accent-strong px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-accent"
        >
          + New habit
        </button>
      </div>

      {state.habits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-sm text-muted">No habits yet — create one to get started.</p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="All habits">
          {state.habits.map((h) => (
            <li key={h.id} className="flex items-stretch gap-2">
              <div className="flex-1">
                <HabitCard
                  compact
                  habit={h}
                  entries={state.entries[h.id] ?? []}
                  asOf={day}
                  onEdit={() => setEditing(true)}
                  onOpen={() => selectHabit(h.id)}
                />
              </div>
              <button
                onClick={() => {
                  if (confirmId === h.id) {
                    removeHabit(h.id);
                    setConfirmId(null);
                  } else {
                    setConfirmId(h.id);
                  }
                }}
                className={
                  "shrink-0 rounded-xl border px-3 text-xs " +
                  (confirmId === h.id
                    ? "border-danger bg-danger/15 text-danger"
                    : "border-line text-muted hover:text-danger")
                }
                aria-label={
                  (confirmId === h.id ? "Confirm archive " : "Archive ") + h.name
                }
              >
                {confirmId === h.id ? "Sure?" : "Archive"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <DetailPanel habitId={selected.id} day={day} />
      )}

      {creating && <HabitForm onClose={() => setCreating(false)} />}
      {editing && selected && (
        <HabitForm habit={selected} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function DetailPanel({ habitId, day }: { habitId: string; day: CheckoffDate }) {
  const { state, selectHabit } = useCadence();
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return null;
  const hEntries = state.entries[habitId] ?? [];
  const { last30 } = cadenceStats({ [habitId]: hEntries }, [habit], day);

  return (
    <div className="rounded-xl border border-line bg-surface p-5 animate-pop">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">
          <span aria-hidden="true">{habit.glyph || "•"} </span>
          {habit.name}
        </h2>
        <button
          onClick={() => selectHabit(null)}
          aria-label="Close detail panel"
          className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-surface-2"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Current streak" value={currentStreak(habit, hEntries, day) + "d"} />
        <Kpi label="Best streak" value={bestStreak(hEntries) + "d"} />
        <Kpi label="30-day rate" value={last30.percent.toFixed(0) + "%"} />
        <Kpi label="Total" value={String(hEntries.length)} delta={weeklyTarget(habit) + "d/wk goal"} />
      </div>
      <div className="mt-4">
        <Heatmap habit={habit} entries={hEntries} asOf={day} />
      </div>
    </div>
  );
}
