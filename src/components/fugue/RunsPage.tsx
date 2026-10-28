"use client";

import { useCallback, useEffect, useState } from "react";
import type { Run, StepAttempt, Workspace } from "@/lib/fugue/types";
import { apiFetch, apiErrorText, StatusChip } from "@/components/fugue/shared";

// ── snapshot formatting (500-char truncation matches the engine's cap) ──

function snapshotText(value: unknown): string {
  if (value === undefined) return "—";
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return String(value);
  }
}

/** One expandable step-timeline entry. */
export function StepTimelineRow({ attempt, index }: { attempt: StepAttempt; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-secondary"
      >
        <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
        <span
          className={
            attempt.status === "passed"
              ? "h-2 w-2 rounded-full bg-emerald-500"
              : "h-2 w-2 rounded-full bg-red-500"
          }
          aria-hidden
        />
        <span className="font-medium">{attempt.name}</span>
        <span className="rounded-full border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
          {attempt.stepType}
        </span>
        {attempt.attempt > 1 && (
          <span className="text-xs text-amber-600">attempt {attempt.attempt}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{attempt.durationMs}ms</span>
        <span className="text-xs text-muted-foreground" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 bg-muted/40 px-3 py-3">
          {attempt.error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {attempt.error}
            </p>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Input snapshot</p>
            <pre className="overflow-x-auto rounded-md border border-border bg-card p-2 font-mono text-xs">
              {snapshotText(attempt.input)}
            </pre>
          </div>
          {attempt.output !== undefined && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Output snapshot</p>
              <pre className="overflow-x-auto rounded-md border border-border bg-card p-2 font-mono text-xs">
                {snapshotText(attempt.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Run inspector: header + step timeline + notifications. */
export function RunInspector({ run, flowName }: { run: Run; flowName: string }) {
  const tone =
    run.status === "passed"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : run.status === "failed"
        ? "bg-red-50 text-red-700 border-red-200"
        : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{flowName}</h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
          aria-label={`run status ${run.status}`}
        >
          {run.status}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{run.id}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(run.startedAt).toLocaleString()}
          {run.endedAt ? ` → ${new Date(run.endedAt).toLocaleString()}` : ""}
        </span>
      </div>

      <section aria-label="Step timeline">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">
          Step timeline ({run.attempts.length} attempts)
        </h3>
        <ol className="rounded-lg border border-border bg-card shadow-sm">
          {run.attempts.map((a, i) => (
            <StepTimelineRow key={`${a.stepId}:${a.attempt}:${i}`} attempt={a} index={i} />
          ))}
        </ol>
      </section>

      {run.notifications.length > 0 && (
        <section aria-label="Notifications">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            Notifications ({run.notifications.length})
          </h3>
          <ul className="space-y-1 rounded-lg border border-border bg-card p-3 shadow-sm">
            {run.notifications.map((n, i) => (
              <li key={i} className="text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(n.at).toLocaleString()}
                </span>{" "}
                {n.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Final payload">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Final payload</h3>
        <pre className="overflow-x-auto rounded-lg border border-border bg-card p-3 font-mono text-xs shadow-sm">
          {snapshotText(run.payload)}
        </pre>
      </section>
    </div>
  );
}

// ── Runs page: history table + inspector (?id=) ──

export default function RunsPage({ workspaces }: { workspaces: Workspace[] }) {
  const [ws, setWs] = useState<string>("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [inspecting, setInspecting] = useState<Run | null>(null);
  const [flowNames, setFlowNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("workspaceId");
    if (fromUrl && workspaces.some((w) => w.id === fromUrl)) setWs(fromUrl);
    else if (workspaces.length > 0) setWs(workspaces[0].id);
  }, [workspaces]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (!id) return;
    apiFetch<{ run: Run }>(`/runs/${id}`).then((body) => {
      if (body?.run) setInspecting(body.run);
    });
  }, []);

  const load = useCallback(async () => {
    if (!ws) return;
    const body = await apiFetch<{ runs: Run[] }>(`/runs?workspaceId=${ws}`);
    if (body) {
      setRuns(body.runs.slice().reverse()); // newest first
      // Fetch flow names for the table labels.
      const names: Record<string, string> = {};
      await Promise.all(
        body.runs.map(async (r) => {
          const fb = await apiFetch<{ flow: { name: string } }>(`/flows/${r.flowId}`);
          if (fb?.flow) names[r.flowId] = fb.flow.name;
        }),
      );
      setFlowNames(names);
    } else {
      setError(apiErrorText(null));
    }
  }, [ws]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (run: Run) => {
    setInspecting(run);
    const params = new URLSearchParams(window.location.search);
    params.set("id", run.id);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Runs</h1>
        {ws && (
          <span className="text-xs text-muted-foreground">
            workspace: {workspaces.find((w) => w.id === ws)?.name ?? ws}
          </span>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {inspecting ? (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <RunInspector
            run={inspecting}
            flowName={flowNames[inspecting.flowId] ?? inspecting.flowId}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">Flow</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => open(r)}
                      className="font-mono text-xs hover:underline"
                    >
                      {r.id}
                    </button>
                  </td>
                  <td className="px-3 py-2">{flowNames[r.flowId] ?? r.flowId}</td>
                  <td className="px-3 py-2">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.endedAt
                      ? `${Math.round(new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime())}ms`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                    No runs in this workspace yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
