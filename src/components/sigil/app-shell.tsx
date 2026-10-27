"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "./use-app-store";
import { type ColumnId, type Task, type TaskDraft } from "@/lib/sigil/types";
import { Header } from "./header";
import { Board } from "./board";
import { CardEditor } from "./card-editor";
import { FocusTimer } from "./focus-timer";
import { StatsView } from "./stats-view";
import { TemplatesPanel } from "./templates-panel";

type View = "board" | "focus" | "stats";
export type { View };

export function AppShell({ initialEmbed }: { initialEmbed?: boolean } = {}) {
  const app = useAppStore({ initialEmbed });
  const { store, hydrated, embed, demoBadgeVisible, dismissDemoBadge, resetBoard } = app;
  const [view, setView] = useState<View>("board");
  const [activeColumn, setActiveColumn] = useState<ColumnId>("backlog");
  const [search, setSearch] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!hydrated) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) {
        if (e.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          setEditingTask(null);
          setEditorOpen(true);
          break;
        case "/":
          e.preventDefault();
          document.getElementById("search-input")?.focus();
          break;
        case "1":
          setActiveColumn("backlog");
          break;
        case "2":
          setActiveColumn("doing");
          break;
        case "3":
          setActiveColumn("review");
          break;
        case "4":
          setActiveColumn("done");
          break;
        case "t":
        case "T":
          app.toggleTheme();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hydrated, app]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return store.tasks;
    return store.tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }, [store.tasks, search]);

  const openNew = useCallback(() => {
    setEditingTask(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((task: Task) => {
    setEditingTask(task);
    setEditorOpen(true);
  }, []);

  const handleSave = useCallback(
    (draft: TaskDraft) => {
      if (editingTask) {
        app.updateTask(editingTask.id, { ...draft, column: editingTask.column });
        notify("Task updated");
      } else {
        app.addTask(draft);
        notify("Task added");
      }
      setEditorOpen(false);
      setEditingTask(null);
    },
    [app, editingTask, notify],
  );

  const handleMove = useCallback(
    (id: string, column: ColumnId) => {
      app.moveTaskTo(id, column);
      if (column === "done") notify("Task completed 🎉");
    },
    [app, notify],
  );

  const handleReset = useCallback(() => {
    resetBoard();
    setResetOpen(false);
    setView("board");
    notify("Board reset");
  }, [resetBoard, notify]);

  return (
    <div className="flex min-h-screen flex-col px-3 sm:px-6">
      {!embed && (
        <Header
          theme={store.theme}
          onToggleTheme={() => app.toggleTheme()}
          view={view}
          onView={setView}
          search={search}
          onSearch={setSearch}
        />
      )}

      {/* Demo badge — dismissible, only when demo data was seeded */}
      {demoBadgeVisible && !embed && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between rounded-lg border border-sf-accent/30 bg-sf-accent/10 px-3 py-1.5 text-xs text-sf"
        >
          <span>
            <span aria-hidden>◈</span> Demo data loaded — explore freely. Your changes are saved locally.
          </span>
          <button
            type="button"
            onClick={dismissDemoBadge}
            aria-label="Dismiss demo data notice"
            className="ml-3 rounded px-1.5 text-sf-dim hover:text-sf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
          >
            ✕
          </button>
        </div>
      )}

      <main className="mx-auto w-full flex-1 py-3">
        {view === "board" && (
          <Board
            tasks={filteredTasks}
            activeColumn={activeColumn}
            onColumnClick={setActiveColumn}
            onNewTask={openNew}
            onEdit={openEdit}
            onDelete={(id) => {
              app.deleteTask(id);
              notify("Task deleted");
            }}
            onMove={handleMove}
            onLogFocus={(taskId) => {
              setSelectedTaskId(taskId);
              setView("focus");
            }}
          />
        )}

        {view === "focus" && (
          <FocusTimer
            tasks={store.tasks}
            timer={store.timer}
            onTimer={app.setTimer}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onSessionComplete={app.logFocus}
          />
        )}

        {view === "stats" && (
          <StatsView
            tasks={store.tasks}
            focusLog={store.focusLog}
            onReset={embed ? undefined : handleReset}
          />
        )}
      </main>

      {editorOpen && (
        <CardEditor
          task={editingTask}
          defaultColumn={activeColumn}
          onClose={() => {
            setEditorOpen(false);
            setEditingTask(null);
          }}
          onSave={handleSave}
        />
      )}

      {!embed && (
        <TemplatesPanel
          onApply={(id, drafts) => {
            app.applyTemplate(id, drafts);
            setView("board");
            notify(`Template "${id}" applied`);
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-sf-border bg-sf-surface px-4 py-2 text-sm text-sf shadow-lg"
        >
          {toast}
        </div>
      )}

      {!embed && (
        <footer className="border-t border-sf-border py-4">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-sf-dim">
            <span>Local-first · syncs to API when available</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-sf-border bg-sf-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-sf">n</kbd>
                new
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-sf-border bg-sf-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-sf">/</kbd>
                search
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-sf-border bg-sf-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-sf">1–4</kbd>
                columns
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-sf-border bg-sf-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-sf">t</kbd>
                theme
              </span>
            </span>
          </div>
        </footer>
      )}
    </div>
  );
}
