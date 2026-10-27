"use client";

import { useEffect, useState } from "react";
import type { ColumnId, Task } from "@/lib/sigil/types";
import { COLUMNS } from "@/lib/sigil/types";
import { TaskCard } from "./task-card";

interface BoardProps {
  tasks: Task[];
  activeColumn: ColumnId;
  onColumnClick: (c: ColumnId) => void;
  onNewTask: () => void;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, column: ColumnId) => void;
  onLogFocus: (taskId: string) => void;
}

export function Board({
  tasks,
  activeColumn,
  onColumnClick,
  onNewTask,
  onEdit,
  onDelete,
  onMove,
  onLogFocus,
}: BoardProps) {
  const tasksByColumn = (col: ColumnId) => tasks.filter((t) => t.column === col);
  // Active column is driven by keyboard shortcuts (1-4) and tab clicks.
  // On mobile only the active column is rendered; on desktop all are shown.
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const shown = isMobile
    ? COLUMNS.filter((c) => c.id === activeColumn)
    : [...COLUMNS];

  return (
    <section aria-label="Kanban board" className="space-y-3">
      {/* Mobile column tabs */}
      <div
        role="tablist"
        aria-label="Board columns"
        className="flex gap-1 overflow-x-auto md:hidden"
      >
        {COLUMNS.map((c, i) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={activeColumn === c.id}
            onClick={() => onColumnClick(c.id)}
            className={`whitespace-nowrap rounded-t-lg border-b-2 px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent ${
              activeColumn === c.id
                ? "border-sf-accent text-sf"
                : "border-transparent text-sf-dim"
            }`}
          >
            <span className="sr-only">
              Jump to {c.title} column (key {i + 1})
            </span>
            {c.title}{" "}
            <span className="text-xs text-sf-dim">
              ({tasksByColumn(c.id).length})
            </span>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        aria-label="Board columns"
        className={`grid items-stretch gap-3 ${
          isMobile ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
        }`}
      >
        {shown.map((col) => (
          <Column
            key={col.id}
            column={col.id}
            title={col.title}
            tasks={tasksByColumn(col.id)}
            active={activeColumn === col.id}
            onColumnClick={onColumnClick}
            onNewTask={onNewTask}
            onEdit={onEdit}
            onDelete={onDelete}
            onMove={onMove}
            onLogFocus={onLogFocus}
          />
        ))}
      </div>
    </section>
  );
}

interface ColumnProps {
  column: ColumnId;
  title: string;
  tasks: Task[];
  active: boolean;
  onColumnClick: (c: ColumnId) => void;
  onNewTask: () => void;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, column: ColumnId) => void;
  onLogFocus: (taskId: string) => void;
}

function Column({
  column,
  title,
  tasks,
  active,
  onColumnClick,
  onNewTask,
  onEdit,
  onDelete,
  onMove,
  onLogFocus,
}: ColumnProps) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      role="region"
      aria-label={`${title} column, ${tasks.length} tasks`}
      tabIndex={0}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData("text/task-id");
        if (id) onMove(id, column);
      }}
      onClick={() => onColumnClick(column)}
      className={`flex h-full flex-col rounded-xl border bg-sf-surface p-3 transition-colors ${
        dragOver ? "border-sf-accent" : active ? "border-sf-accent/40" : "border-sf-border"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-sf-dim">
          {title}
          <span className="ml-2 text-xs font-normal text-sf-dim">{tasks.length}</span>
        </h2>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onColumnClick(column);
            onNewTask();
          }}
          aria-label={`Add task to ${title}`}
          className="rounded px-2 text-lg leading-none text-sf-dim hover:bg-sf-surface-2 hover:text-sf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
        >
          +
        </button>
      </div>

      <ul role="list" className="flex flex-1 flex-col gap-2">
        {tasks.length === 0 && (
          <li className="px-1 py-3 text-center text-xs text-sf-dim/70">
            Drop tasks here or press <kbd className="rounded border border-sf-border px-1 font-mono">n</kbd>
          </li>
        )}
        {tasks.map((task) => (
          <li key={task.id} onClick={(e) => e.stopPropagation()}>
            <TaskCard
              task={task}
              onEdit={() => onEdit(task)}
              onDelete={() => onDelete(task.id)}
              onMoveTo={(col) => onMove(task.id, col)}
              onLogFocus={() => onLogFocus(task.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
