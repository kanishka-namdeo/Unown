"use client";

/**
 * CadenceShell — the minimal placeholder shell for the /cadence route.
 *
 * Phase 3a: the full UI components (TodayView, HabitsView, StatsView,
 * habit form, 52-week heatmap) land in Phase 3b. This placeholder renders
 * the app title and the three view buttons so the route compiles and the
 * iframe frame has real content before the UI is built.
 *
 * Docs: docs/cadence-demo-session.md (created in a later phase).
 */
import { useCadence, type CadenceView } from "@/lib/cadence/store";

const VIEW_LABELS: Record<CadenceView, string> = {
  today: "Today",
  habits: "Habits",
  stats: "Stats",
};

export function CadenceShell({ embed }: { embed: boolean }) {
  const { state, setView } = useCadence();

  return (
    <div className="flex min-h-full flex-col p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Cadence</h1>
        {embed && (
          <span className="text-xs text-muted">live demo · embedded</span>
        )}
      </header>

      {/* View buttons — static for now; Phase 3b wires them to real views */}
      <nav className="mb-6 flex gap-2">
        {(Object.keys(VIEW_LABELS) as CadenceView[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              state.view === v
                ? "bg-accent text-background"
                : "bg-surface text-muted hover:text-foreground"
            }`}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </nav>

      {/* Placeholder body — Phase 3b replaces this with the real views */}
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted">
          {state.habits.length} habits ·{" "}
          {Object.values(state.entries).reduce((n, a) => n + a.length, 0)}{" "}
          check-offs
        </p>
      </main>
    </div>
  );
}
