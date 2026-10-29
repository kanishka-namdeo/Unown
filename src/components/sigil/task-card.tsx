"use client";

import { useState } from "react";
import type { ColumnId, Task } from "@/lib/sigil/types";
import { COLUMNS } from "@/lib/sigil/types";

// A11Y (found by the landing page's axe gate, which scans the demo iframe):
// the -500 accent shades read 3.85:1 on the dark surface — below WCAG AA's
// 4.5:1 for 10px text. The -400 shades clear it on both themes (the light
// theme's surface is lighter still, where -400 also holds).
const PRIORITY_STYLES: Record<Task["priority"], string> = {
  high: "text-red-400 bg-red-500/10 border-red-500/30",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  low: "text-sky-400 bg-sky-500/10 border-sky-500/30",
};

const PRIORITY_LABEL: Record<Task["priority"], string> = {
  high: "High",
  medium: "Med",
  low: "Low",
};

interface TaskCardProps {
  task: Task;
  onEdit: () => void;
  onDelete: () => void;
  onMoveTo: (col: ColumnId) => void;
  onLogFocus: () => void;
}

export function TaskCard({
  task,
  onEdit,
  onDelete,
  onMoveTo,
  onLogFocus,
}: TaskCardProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      aria-label={`${task.title}, priority ${task.priority}, column ${COLUMNS.find((c) => c.id === task.column)?.title ?? task.column}`}
      className={`group cursor-grab rounded-lg border bg-sf-surface-2 p-3 transition-[transform,border-color,box-shadow] active:cursor-grabbing ${
        dragging ? "opacity-50 ring-2 ring-sf-accent" : "border-sf-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className="cursor-pointer text-sm font-medium leading-snug hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
          onClick={onEdit}
        >
          {task.title}
        </h3>
        {task.storyPoints != null && (
          <span
            className="rounded-full border border-sf-border bg-sf-surface px-1.5 text-xs font-semibold text-sf-dim"
            title={`${task.storyPoints} story points`}
          >
            {task.storyPoints}
          </span>
        )}
      </div>

      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-sf-dim">{task.description}</p>
      )}

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <span
              key={l}
              className="rounded-full bg-sf-accent/10 px-2 py-0.5 text-[10px] font-medium text-sf-accent"
            >
              {l}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_STYLES[task.priority]}`}
        >
          {PRIORITY_LABEL[task.priority]}
        </span>
        <div className="flex items-center gap-1 text-xs text-sf-dim">
          {task.focusSessions.length > 0 && (
            <span title={`${task.focusSessions.length} focus sessions`}>
              ◔ {task.focusSessions.length}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 hidden border-t border-sf-border pt-2 group-hover:block group-focus-within:block">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded px-1.5 py-0.5 text-xs text-sf-dim hover:bg-sf-surface hover:text-sf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onLogFocus}
            className="rounded px-1.5 py-0.5 text-xs text-sf-dim hover:bg-sf-surface hover:text-sf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
          >
            Focus
          </button>
          <select
            aria-label={`Move ${task.title} to column`}
            value={task.column}
            onChange={(e) => onMoveTo(e.target.value as ColumnId)}
            className="rounded border border-sf-border bg-sf-surface px-1 py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
          >
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                → {c.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${task.title}`}
            className="rounded px-1.5 py-0.5 text-xs text-sf-dim hover:bg-red-500/10 hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
          >
            ✕
          </button>
        </div>
      </div>
    </article>
  );
}
