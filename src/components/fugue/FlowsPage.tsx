"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Flow, StepConfig, StepType, Workspace } from "@/lib/fugue/types";
import {
  apiErrorText,
  apiFetch,
  defaultConfigFor,
  RunPayloadEditor,
  STEP_TYPE_LABELS,
  StatusChip,
  StepConfigForm,
} from "@/components/fugue/shared";

interface FlowDraft {
  name: string;
  description: string;
  enabled: boolean;
  steps: Array<{
    id: string;
    type: StepType;
    name: string;
    config: StepConfig;
    retry: { maxAttempts: number };
  }>;
}

function emptyStep(i: number): FlowDraft["steps"][number] {
  const type: StepType = "transform";
  return {
    id: `st_new_${i}`,
    type,
    name: `Step ${i + 1}`,
    config: defaultConfigFor(type),
    retry: { maxAttempts: 1 },
  };
}

// ── Flow editor ──

export function FlowEditor({
  flow,
  onSaved,
  onCancel,
}: {
  flow: Flow | null; // null = creating
  onSaved: (flow: Flow) => void;
  onCancel: () => void;
}) {
  const isCreate = flow === null;
  const [draft, setDraft] = useState<FlowDraft>(() =>
    isCreate
      ? { name: "", description: "", enabled: true, steps: [emptyStep(0)] }
      : {
          name: flow.name,
          description: flow.description,
          enabled: flow.enabled,
          steps: flow.steps.map((s) => ({ ...s, config: { ...s.config } })),
        },
  );
  const [errors, setErrors] = useState<Array<{ path: string; message: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [runPayload, setRunPayload] = useState('{"text": "urgent: server down"}');
  const [runResult, setRunResult] = useState<string | null>(null);

  const setStep = (i: number, patch: Partial<FlowDraft["steps"][number]>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, si) => (si === i ? { ...s, ...patch } : s)),
    }));

  const save = async () => {
    setBusy(true);
    setErrors([]);
    setRunResult(null);
    if (isCreate) {
      const ws = new URLSearchParams(window.location.search).get("workspaceId") ?? "";
      const body = await apiFetch<{ flow: Flow } | { errors: Array<{ path: string; message: string }> }>(
        "/flows",
        { method: "POST", body: JSON.stringify({ workspaceId: ws, ...draft }) },
      );
      if (body && "flow" in body) {
        onSaved(body.flow);
      } else if (body) {
        setErrors(body.errors ?? []);
      } else {
        setErrors([{ path: "flow", message: "create failed" }]);
      }
      setBusy(false);
      return;
    }

    const body = await apiFetch<{ flow: Flow } | { errors: Array<{ path: string; message: string }> }>(
      `/flows/${flow.id}`,
      { method: "PATCH", body: JSON.stringify(draft) },
    );
    if (body && "flow" in body) {
      onSaved(body.flow);
    } else if (body) {
      setErrors(body.errors ?? []);
    } else {
      setErrors([{ path: "flow", message: "save failed" }]);
    }
    setBusy(false);
  };

  const run = async () => {
    if (!flow) {
      setRunResult("Save the flow before running it.");
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(runPayload);
    } catch (e) {
      setRunResult(`Invalid payload JSON: ${e instanceof Error ? e.message : ""}`);
      return;
    }
    setBusy(true);
    const body = await apiFetch<{ run: { id: string } } | { errors: Array<{ path: string; message: string }> }>(
      `/flows/${flow.id}/run`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    setBusy(false);
    if (body && "run" in body) {
      // Jump to the run inspector.
      window.location.href = `/fugue/runs?id=${body.run.id}`;
      return;
    }
    setRunResult(body ? apiErrorText(body as never) : "run failed");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          {isCreate ? "New flow" : `Edit ${flow.name}`}
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full rounded-md border border-border bg-card px-3 py-2 shadow-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Description</span>
          <input
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            className="w-full rounded-md border border-border bg-card px-3 py-2 shadow-sm"
          />
        </label>
      </div>

      {/* Step list */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Steps ({draft.steps.length})
        </h3>
        {draft.steps.map((step, i) => (
          <div key={step.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">#{i + 1}</span>
              <select
                aria-label={`Step ${i + 1} type`}
                value={step.type}
                onChange={(e) => {
                  const type = e.target.value as StepType;
                  setStep(i, { type, config: defaultConfigFor(type) });
                }}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm"
              >
                {(Object.entries(STEP_TYPE_LABELS) as [StepType, string][]).map(([t, label]) => (
                  <option key={t} value={t}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Step ${i + 1} name`}
                value={step.name}
                onChange={(e) => setStep(i, { name: e.target.value })}
                className="w-40 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm"
              />
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move step ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() =>
                    setDraft((d) => {
                      const steps = [...d.steps];
                      [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                      return { ...d, steps };
                    })
                  }
                  className="rounded-md border border-border bg-card px-2 py-0.5 text-xs shadow-sm disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move step ${i + 1} down`}
                  disabled={i === draft.steps.length - 1}
                  onClick={() =>
                    setDraft((d) => {
                      const steps = [...d.steps];
                      [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
                      return { ...d, steps };
                    })
                  }
                  className="rounded-md border border-border bg-card px-2 py-0.5 text-xs shadow-sm disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() =>
                    setDraft((d) => ({ ...d, steps: d.steps.filter((_, si) => si !== i) }))
                  }
                  className="rounded-md border border-border bg-card px-2 py-0.5 text-xs text-destructive shadow-sm"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_88px]">
              <StepConfigForm
                step={step}
                flow={draft.steps.map((s) => ({ id: s.id, name: s.name }))}
                onChange={(config) => setStep(i, { config })}
              />
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-muted-foreground">
                  Max attempts
                </span>
                <input
                  type="number"
                  min={1}
                  aria-label={`Step ${i + 1} max attempts`}
                  value={step.retry.maxAttempts}
                  onChange={(e) =>
                    setStep(i, {
                      retry: { maxAttempts: Math.max(1, parseInt(e.target.value, 10) || 1) },
                    })
                  }
                  className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm"
                />
              </label>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setDraft((d) => ({
              ...d,
              steps: [...d.steps, emptyStep(d.steps.length)],
            }))
          }
          className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium shadow-sm hover:bg-secondary"
        >
          + Add step
        </button>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {errors.map((e) => (
            <p key={`${e.path}:${e.message}`}>
              <span className="font-mono">{e.path}</span>: {e.message}
            </p>
          ))}
        </div>
      )}

      {/* Run button (existing flows only) */}
      {!isCreate && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-medium">Run this flow</h3>
          <RunPayloadEditor
            value={runPayload}
            onChange={setRunPayload}
            onRun={run}
            running={busy}
            result={runResult}
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || draft.name.trim() === ""}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-50"
        >
          {busy ? "Saving…" : isCreate ? "Create flow" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm shadow-sm hover:bg-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Flows list page content ──

export function FlowsContent({
  workspaces,
  onOpen,
  savedVersion = 0,
}: {
  workspaces: Workspace[];
  onOpen: (flow: Flow | null) => void;
  /**
   * Bumped by the parent after a successful save. Re-keys the list fetch so
   * the newly created/updated flow shows up without a full-page reload
   * (a reload would wipe keyboard focus, scroll position, and — in embed
   * mode — the host's iframe state).
   */
  savedVersion?: number;
}) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [ws, setWs] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("workspaceId");
    if (fromUrl && workspaces.some((w) => w.id === fromUrl)) setWs(fromUrl);
    else if (workspaces.length > 0) setWs(workspaces[0].id);
  }, [workspaces]);

  // Keep the URL's workspaceId param in sync with the selected workspace:
  // FlowsPage.create reads it for the POST /flows body (a plain /fugue/flows
  // URL would otherwise have no param and the create would 400).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get("workspaceId");
    if (ws && current !== ws) {
      params.set("workspaceId", ws);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }
  }, [ws]);

  const load = useCallback(async () => {
    if (!ws) return;
    const body = await apiFetch<{ flows: Flow[] }>(`/flows?workspaceId=${ws}`);
    if (body) setFlows(body.flows);
    else setError("Failed to load flows");
  }, [ws]);

  useEffect(() => {
    void load();
  }, [load, savedVersion]);

  const toggle = async (flow: Flow) => {
    const body = await apiFetch<{ flow: Flow }>(`/flows/${flow.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !flow.enabled }),
    });
    if (body && "flow" in body) {
      setFlows((fs) => fs.map((f) => (f.id === flow.id ? body.flow : f)));
    }
  };

  const del = async (flow: Flow) => {
    if (!confirm(`Delete flow '${flow.name}'?`)) return;
    await apiFetch(`/flows/${flow.id}`, { method: "DELETE" });
    void load();
  };

  const create = async () => {
    // Optimistically fill a create draft when the current ws has no flows yet.
    onOpen(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Flows</h1>
        <button
          type="button"
          onClick={() => void create()}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm"
        >
          + New flow
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
        {flows.map((f) => (
          <li key={f.id} className="flex items-center gap-3 p-3">
            <StatusChip status={f.enabled ? "passed" : "disabled"} />
            <button
              type="button"
              onClick={() => onOpen(f)}
              className="text-sm font-medium hover:underline"
            >
              {f.name}
            </button>
            <span className="text-xs text-muted-foreground">
              {f.steps.length} step{f.steps.length === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={f.enabled}
                aria-label={`Toggle ${f.name} enabled`}
                onClick={() => void toggle(f)}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm hover:bg-secondary"
              >
                {f.enabled ? "Enabled" : "Disabled"}
              </button>
              <button
                type="button"
                onClick={() => void del(f)}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-destructive shadow-sm hover:bg-secondary"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {flows.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">No flows in this workspace yet.</li>
        )}
      </ul>
    </div>
  );
}

export default function FlowsPage({ workspaces }: { workspaces: Workspace[] }) {
  const [editing, setEditing] = useState<Flow | null | "closed">("closed");
  const [savedVersion, setSavedVersion] = useState(0);

  if (editing !== "closed") {
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <FlowEditor
          flow={editing === null ? null : editing}
          onSaved={() => {
            // Bounce back to the list; bumping savedVersion re-keys the list
            // fetch so the newly created/updated flow shows up without a
            // full-page reload (a reload would wipe keyboard focus, scroll
            // position, and — in embed mode — the host's iframe state).
            setEditing("closed");
            setSavedVersion((v) => v + 1);
          }}
          onCancel={() => setEditing("closed")}
        />
      </div>
    );
  }

  return <FlowsContent workspaces={workspaces} onOpen={(f) => setEditing(f)} savedVersion={savedVersion} />;
}
