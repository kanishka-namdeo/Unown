"use client";

/**
 * The create/edit habit form: a modal dialog (Bazaar checkout-wizard
 * pattern — Esc-to-close + Tab focus trap from bazaar's `useDialogDismiss`,
 * one column of labelled fields with inline `role="alert"` errors). Errors
 * come from `validation.habitErrors`; submit is blocked while any exist
 * (no store mutation, no API call). Create → `addHabit`; edit →
 * `editHabit`; delete → two-step confirm → `removeHabit`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogDismiss } from "../bazaar/primitives";
import { useCadence, type HabitInput } from "@/lib/cadence/store";
import type { Habit, HabitFrequency } from "@/lib/cadence/types";
import { habitErrors } from "@/lib/cadence/validation";
import { HABIT_NAME_MAX } from "@/lib/cadence/types";

export function HabitForm({
  habit,
  onClose,
}: {
  /** null/undefined = create mode; a habit = edit mode */
  habit?: Habit | null;
  onClose: () => void;
}) {
  const { addHabit, editHabit, removeHabit } = useCadence();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogDismiss(onClose, panelRef);

  const [name, setName] = useState(habit?.name ?? "");
  const [glyph, setGlyph] = useState(habit?.glyph ?? "");
  const [freqKind, setFreqKind] = useState<"daily" | "weekly">(
    habit?.frequency.kind ?? "daily",
  );
  const [weeklyTarget, setWeeklyTarget] = useState(
    habit?.frequency.kind === "weekly" ? habit.frequency.target : 3,
  );
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const draft = {
    name,
    weeklyTarget: freqKind === "daily" ? 0 : weeklyTarget,
    glyph,
  };
  const errors = useMemo(
    () => habitErrors(draft),
    [name, glyph, freqKind, weeklyTarget],
  );
  const hasErrors = Object.keys(errors).length > 0;

  function submit() {
    if (hasErrors) {
      setErrorSummary(Object.values(errors).join(" "));
      return;
    }
    setErrorSummary(null);
    const frequency: HabitFrequency =
      freqKind === "daily" ? { kind: "daily" } : { kind: "weekly", target: weeklyTarget };
    const input: HabitInput = { name: name.trim(), glyph, frequency };
    if (habit) editHabit(habit.id, input);
    else addHabit(input);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label={habit ? "Edit habit" : "New habit"}
    >
      <button
        aria-label="Close habit form"
        onClick={onClose}
        className="fixed inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 my-4 w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl animate-pop"
      >
        <h2 className="text-lg font-bold">{habit ? "Edit habit" : "New habit"}</h2>

        <div role="alert" aria-live="assertive" className="mt-3">
          {errorSummary && (
            <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
              {errorSummary}
            </div>
          )}
        </div>

        <form
          noValidate
          className="mt-3 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label
              htmlFor="habit-name"
              className="mb-1 block text-sm font-medium"
            >
              Name<span className="ml-0.5 text-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="habit-name"
              value={name}
              maxLength={HABIT_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              className={
                "w-full rounded-lg border px-3 py-2.5 text-sm focus:border-accent " +
                (errors.name ? "border-danger" : "border-line")
              }
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "err-name" : undefined}
            />
            {errors.name && (
              <p id="err-name" role="alert" className="mt-1 text-xs text-danger">
                {errors.name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="habit-glyph" className="mb-1 block text-sm font-medium">
              Glyph (one character, optional)
            </label>
            <input
              id="habit-glyph"
              value={glyph}
              onChange={(e) => setGlyph(Array.from(e.target.value).slice(0, 1).join(""))}
              className={
                "w-14 rounded-lg border px-3 py-2.5 text-center text-xl focus:border-accent " +
                (errors.glyph ? "border-danger" : "border-line")
              }
              aria-invalid={errors.glyph ? true : undefined}
              aria-describedby={errors.glyph ? "err-glyph" : undefined}
            />
            {errors.glyph && (
              <p id="err-glyph" role="alert" className="mt-1 text-xs text-danger">
                {errors.glyph}
              </p>
            )}
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">Frequency</div>
            <div role="radiogroup" aria-label="Frequency" className="space-y-2">
              <FreqOption
                checked={freqKind === "daily"}
                onChange={() => setFreqKind("daily")}
                label="Every day"
              />
              <FreqOption
                checked={freqKind === "weekly"}
                onChange={() => setFreqKind("weekly")}
                label={`${weeklyTarget} days per week`}
              />
              {freqKind === "weekly" && (
                <div className="pl-6">
                  <label htmlFor="weekly-target" className="mb-1 block text-xs text-muted">
                    Days per week
                  </label>
                  <input
                    id="weekly-target"
                    type="number"
                    min={1}
                    max={7}
                    value={weeklyTarget}
                    onChange={(e) => setWeeklyTarget(Number(e.target.value))}
                    className={
                      "w-20 rounded-lg border px-3 py-1.5 text-sm focus:border-accent " +
                      (errors.weeklyTarget ? "border-danger" : "border-line")
                    }
                    aria-invalid={errors.weeklyTarget ? true : undefined}
                  />
                  {errors.weeklyTarget && (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      {errors.weeklyTarget}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line pt-4">
            {habit ? (
              <button
                type="button"
                onClick={() => {
                  if (confirmDelete) {
                    removeHabit(habit.id);
                    onClose();
                  } else {
                    setConfirmDelete(true);
                  }
                }}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm " +
                  (confirmDelete
                    ? "border-danger bg-danger/15 text-danger"
                    : "border-line text-muted hover:text-danger")
                }
              >
                {confirmDelete ? "Confirm delete?" : "Delete"}
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={hasErrors}
                className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                {habit ? "Save changes" : "Add habit"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function FreqOption({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        name="freq"
        checked={checked}
        onChange={onChange}
        className="accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}
