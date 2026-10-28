"use client";

/**
 * One habit row for the Today view. Full variant: glyph, name, frequency
 * summary, current-streak chip, on-track/off-track badge, and the
 * check-off button for today. Compact variant (for the Habits list):
 * glyph + name + streak only.
 */
import type { CheckoffDate, Habit } from "@/lib/cadence/types";
import { currentStreak, isOnTrack, weeklyTarget } from "@/lib/cadence/streaks";
import { StreakChip } from "./primitives";

function frequencySummary(habit: Habit): string {
  if (habit.frequency.kind === "weekly") {
    const t = habit.frequency.target;
    return t + "× per week";
  }
  return "daily";
}

export function HabitCard({
  habit,
  entries,
  asOf,
  onToggle,
  compact,
  onEdit,
  onOpen,
}: {
  habit: Habit;
  entries: CheckoffDate[];
  /** the "today" day key the check-off targets */
  asOf: CheckoffDate;
  /** toggle today's check-off (full variant) */
  onToggle?: () => void;
  compact?: boolean;
  /** edit affordance (Habits view) */
  onEdit?: () => void;
  /** open the habit's detail (heatmap) — Today view */
  onOpen?: () => void;
}) {
  const streak = currentStreak(habit, entries, asOf);
  const onTrack = isOnTrack(habit, entries, asOf);
  const checked = entries.includes(asOf);

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen?.();
          }
        }}
        aria-label={"Open detail for " + habit.name}
        className={"flex items-center gap-3 rounded-xl border border-line bg-surface p-3 " + (onOpen ? "cursor-pointer hover:border-accent/40" : "")}
      >
        <HabitGlyph habit={habit} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{habit.name}</div>
          <div className="text-xs text-muted">
            {frequencySummary(habit)} · {weeklyTarget(habit)}d/wk goal
          </div>
        </div>
        <StreakChip days={streak} />
        {onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.();
            }}
            aria-label={"Edit " + habit.name}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-surface-2"
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={
        "flex items-center gap-3 rounded-xl border p-4 " +
        (checked ? "border-accent/40 bg-surface" : "border-line bg-surface")
      }
    >
      <HabitGlyph habit={habit} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{habit.name}</span>
          <span
            className={
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium " +
              (onTrack ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn")
            }
          >
            {onTrack ? "on track" : "off track"}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-muted">{frequencySummary(habit)}</div>
      </div>
      <StreakChip days={streak} />
      <button
        onClick={onToggle}
        aria-pressed={checked}
        aria-label={(checked ? "Uncheck" : "Check off") + " " + habit.name + " for today"}
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-lg transition " +
          (checked
            ? "border-accent bg-accent/20 text-accent"
            : "border-line text-muted hover:border-accent hover:text-accent")
        }
      >
        {checked ? "✓" : "○"}
      </button>
      {onOpen && (
        <button
          onClick={onOpen}
          aria-label={"View heatmap for " + habit.name}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-surface-2"
        >
          Heatmap
        </button>
      )}
    </div>
  );
}

/** CSS-free glyph slot: the habit's one-character glyph in a rounded tile. */
function HabitGlyph({ habit }: { habit: Habit }) {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xl"
      aria-hidden="true"
    >
      {habit.glyph || "•"}
    </div>
  );
}
