"use client";

/**
 * The Today view: a header row (long date + a CompletionRing of today's
 * done/active ratio), then the habit rows via HabitCard (not-done first),
 * a "N of M done" progress line, and an empty state when there are no
 * habits.
 */
import { useCadence } from "@/lib/cadence/store";
import type { CheckoffDate } from "@/lib/cadence/types";
import { HabitCard } from "./habit-card";
import { CompletionRing } from "./primitives";
import { formatLongDate, todayKey } from "./format";

export function Dashboard({ asOf }: { asOf?: CheckoffDate }) {
  const { state, toggleCheckoff, selectHabit, setView } = useCadence();
  const day = asOf ?? todayKey(new Date());
  const habits = state.habits;
  const doneCount = habits.filter((h) => (state.entries[h.id] ?? []).includes(day)).length;
  const pct = habits.length === 0 ? 0 : Math.round((doneCount / habits.length) * 100);

  // Not-done first so the open work is what the eye lands on.
  const sorted = [...habits].sort((a, b) => {
    const ad = (state.entries[a.id] ?? []).includes(day) ? 1 : 0;
    const bd = (state.entries[b.id] ?? []).includes(day) ? 1 : 0;
    return ad - bd;
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* header row: long date + ring */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{formatLongDate(day)}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {doneCount} of {habits.length} done
          </p>
        </div>
        <CompletionRing
          percent={pct}
          label={"Today: " + doneCount + " of " + habits.length + " habits done"}
        />
      </div>

      {habits.length === 0 ? (
        <EmptyState onNew={() => setView("habits")} />
      ) : (
        <ul className="space-y-2" aria-label="Habits for today">
          {sorted.map((h) => (
            <li key={h.id}>
              <HabitCard
                habit={h}
                entries={state.entries[h.id] ?? []}
                asOf={day}
                onToggle={() => toggleCheckoff(h.id, day)}
                onOpen={() => selectHabit(h.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
      <div className="text-3xl" aria-hidden="true">
        🌱
      </div>
      <h2 className="mt-2 font-bold">No habits yet</h2>
      <p className="mt-1 text-sm text-muted">Add your first habit to start building a streak.</p>
      <button
        onClick={onNew}
        className="mt-4 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent"
      >
        + New habit
      </button>
    </div>
  );
}
