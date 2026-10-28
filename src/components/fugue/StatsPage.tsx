"use client";

import { useCallback, useEffect, useState } from "react";
import type { StepType, Workspace, WorkspaceStats } from "@/lib/fugue/types";
import { STEP_TYPE_LABELS } from "@/components/fugue/shared";
import { apiFetch } from "@/components/fugue/shared";

/** Pure-CSS bar chart of step-type usage (PLAN.md §7 — no chart lib). */
export function StepTypeBarChart({ counts }: { counts: Record<StepType, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="space-y-2" role="img" aria-label="Step type usage bar chart">
      {(Object.entries(counts) as [StepType, number][]).map(([type, count]) => (
        <div key={type} className="flex items-center gap-3">
          <span className="w-20 text-xs font-medium text-muted-foreground">
            {STEP_TYPE_LABELS[type]}
          </span>
          <div className="flex-1 rounded-md border border-border bg-muted">
            <div
              className="h-3 rounded-md bg-primary/80"
              style={{ width: `${total === 0 ? 0 : (count / max) * 100}%` }}
              aria-hidden
            />
          </div>
          <span className="w-10 text-right font-mono text-xs text-muted-foreground">{count}</span>
        </div>
      ))}
    </div>
  );
}

export default function StatsPage({ workspaces }: { workspaces: Workspace[] }) {
  const [ws, setWs] = useState<string>("");
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("workspaceId");
    if (fromUrl && workspaces.some((w) => w.id === fromUrl)) setWs(fromUrl);
    else if (workspaces.length > 0) setWs(workspaces[0].id);
  }, [workspaces]);

  const load = useCallback(async () => {
    if (!ws) return;
    const body = await apiFetch<{ stats: WorkspaceStats }>(`/stats?workspaceId=${ws}`);
    if (body) setStats(body.stats);
    else setError("Failed to load stats");
  }, [ws]);

  useEffect(() => {
    void load();
  }, [load]);

  const wsName = workspaces.find((w) => w.id === ws)?.name ?? ws;

  if (error) {
    return <p role="alert" className="text-sm text-destructive">{error}</p>;
  }
  if (!stats) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Stats</h1>
        <span className="text-xs text-muted-foreground">workspace: {wsName}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">Total runs</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.totalRuns}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">Pass rate</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {Math.round(stats.passRate * 100)}%
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">Mean duration</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {stats.meanDurationMs}ms
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground">Most used step</p>
          <p className="mt-1 text-2xl font-semibold">
            {stats.mostUsedStepType ? STEP_TYPE_LABELS[stats.mostUsedStepType] : "—"}
          </p>
        </div>
      </div>

      <section aria-label="Step type usage" className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Step type usage</h2>
        <StepTypeBarChart counts={stats.stepTypeCounts} />
      </section>
    </div>
  );
}
