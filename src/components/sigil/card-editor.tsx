"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnId, Priority, Task, TaskDraft } from "@/lib/sigil/types";
import { COLUMNS, PRIORITIES } from "@/lib/sigil/types";
import { clampStoryPoints } from "@/lib/sigil/tasks";

interface CardEditorProps {
  task: Task | null;
  defaultColumn: ColumnId;
  onClose: () => void;
  onSave: (draft: TaskDraft) => void;
}

export function CardEditor({ task, defaultColumn, onClose, onSave }: CardEditorProps) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [labelsText, setLabelsText] = useState((task?.labels ?? []).join(", "));
  const [storyPoints, setStoryPoints] = useState<string>(
    task?.storyPoints != null ? String(task.storyPoints) : "",
  );
  const [column, setColumn] = useState<ColumnId>(task?.column ?? defaultColumn);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const sp = storyPoints.trim() === "" ? null : clampStoryPoints(Number(storyPoints));
    onSave({
      title: t,
      description,
      priority,
      labels: labelsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8),
      storyPoints: sp,
      column,
    });
  }

  const field =
    "w-full rounded-lg border border-sf-border bg-sf-surface px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={task ? "Edit task" : "New task"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-sf-border bg-sf-surface p-5 shadow-2xl"
      >
        <h2 className="mb-4 text-base font-semibold">
          {task ? "Edit task" : "New task"}
        </h2>

        <label htmlFor="card-title" className="mb-1 block text-xs font-medium text-sf-dim">
          Title
        </label>
        <input
          id="card-title"
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={120}
          className={field}
          placeholder="What needs doing?"
        />

        <label htmlFor="card-desc" className="mt-3 mb-1 block text-xs font-medium text-sf-dim">
          Description
        </label>
        <textarea
          id="card-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={field}
          placeholder="Optional details…"
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="card-priority" className="mb-1 block text-xs font-medium text-sf-dim">
              Priority
            </label>
            <select
              id="card-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className={field}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="card-column" className="mb-1 block text-xs font-medium text-sf-dim">
              Column
            </label>
            <select
              id="card-column"
              value={column}
              onChange={(e) => setColumn(e.target.value as ColumnId)}
              className={field}
              disabled={!!task}
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="card-labels" className="mb-1 block text-xs font-medium text-sf-dim">
              Labels
            </label>
            <input
              id="card-labels"
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              className={field}
              placeholder="bug, growth, design"
            />
          </div>
          <div>
            <label htmlFor="card-sp" className="mb-1 block text-xs font-medium text-sf-dim">
              Story points
            </label>
            <input
              id="card-sp"
              type="number"
              min={1}
              max={64}
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value)}
              className={field}
              placeholder="—"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-sf-dim hover:text-sf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="rounded-lg bg-sf-accent px-4 py-2 text-sm font-medium text-sf-accent-contrast disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent focus-visible:outline-offset-2"
          >
            {task ? "Save changes" : "Add task"}
          </button>
        </div>
      </form>
    </div>
  );
}
