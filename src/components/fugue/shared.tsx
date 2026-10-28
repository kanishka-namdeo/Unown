/**
 * Fugue UI — shared client primitives + fetch helpers.
 * PLAN.md §7 (UI). All pages are client components that talk to the API.
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  Flow,
  PublicUser,
  Run,
  StepConfig,
  StepType,
  Workspace,
  WorkspaceStats,
} from "@/lib/fugue/types";

export const DEMO_EMAIL = "demo@fugue.local";
export const DEMO_PASSWORD = "fugue-demo";

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  transform: "Transform",
  classify: "Classify",
  enrich: "Enrich",
  branch: "Branch",
  notify: "Notify",
};

// ── fetch helpers ──

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`/fugue/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (res.status === 204) return null as T;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface ApiError {
  message?: string;
  errors?: Array<{ path: string; message: string }>;
}

export function apiErrorText(body: ApiError | undefined | null): string {
  if (!body) return "request failed";
  if (body.errors?.length) return body.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
  return body.message ?? "request failed";
}

/** GET /auth/me — 401 body is { user: null }, resolved to null. */
export function useAuth(): { user: PublicUser | null; loading: boolean; logout: () => Promise<void> } {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ user: PublicUser | null }>("/auth/me").then((body) => {
      if (!cancelled) {
        setUser(body?.user ?? null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return { user, loading, logout };
}

// ── embed / sync channel ──

export interface EmbedOptions {
  /**
   * Mount the origin-checked embed listener (host → frame channel).
   * Only set true in embed mode; the landing frame never mounts it
   * otherwise. Cadence-round pattern (docs/cadence-demo-session.md, adaptation 3).
   */
  embed?: boolean;
  /** Host may postMessage { source: "unown-landing", type: "fugue-reset" } to wipe + re-seed. */
  onReset?: () => void;
  /** Host may postMessage { type: "fugue-sync", value } — sync opt-out channel. */
  onSync?: (value: unknown) => void;
}

/**
 * Embed mode arms a postMessage reset channel (the cadence-round embedding
 * pattern, docs/cadence-demo-session.md adaptation 3): the host landing's
 * "Reset demo" button posts { source: "unown-landing", type: "fugue-reset" }
 * to this frame. The listener is mounted ONLY when `embed` is true and is
 * origin-checked + shape-checked: a postMessage from any other window in the
 * hierarchy (or a foreign origin) is ignored — never a bare postMessage trust.
 * Opt-out of sync: the host may post { type: "fugue-sync", value: ... }
 * which this hook exposes via onSync (that channel is not origin-gated).
 */
export function useEmbedChannel({
  embed = false,
  onReset,
  onSync,
}: EmbedOptions & { embed?: boolean }) {
  useEffect(() => {
    // Embed-only channel (the cadence contract): never mounted in the
    // standalone app — the landing's reset posts can't reach a non-embedded
    // copy, and a stray same-origin postMessage must not reset anyone's app.
    if (!embed || typeof window === "undefined") return;
    const handler = (ev: MessageEvent) => {
      // Origin check first: ignore any message not from this window's origin.
      if (ev.origin !== window.origin) return;
      const data = ev.data as { source?: string; type?: string; value?: unknown } | null;
      if (!data || data.source !== "unown-landing") return;
      // Shape check: the landing's reset payload is exactly this pair.
      if (data.type === "fugue-reset") onReset?.();
      else if (data.type === "fugue-sync") onSync?.(data.value);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [embed, onReset, onSync]);
}

// ── status chip (used by flows list + runs table) ──

export function StatusChip({ status }: { status: Run["status"] | "disabled" }) {
  const tone =
    status === "passed" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : status === "failed" ? "bg-red-50 text-red-700 border-red-200"
    : status === "running" ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span
      aria-label={`status: ${status}`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  );
}

// ── per-step config forms (switch on step.type) ──

/**
 * A per-type config form. Pure-ish: takes config + onChange(config) and renders
 * the inputs for that step type. Shared by the flow editor.
 *
 * Classify rules are edited as one `label: kw1,kw2` row per line.
 */
export function StepConfigForm({
  step,
  flow,
  onChange,
}: {
  step: { id: string; type: StepType; name: string; config: StepConfig };
  /** All steps, for branch target pickers. */
  flow: Array<{ id: string; name: string }>;
  onChange: (config: StepConfig) => void;
}) {
  switch (step.type) {
    case "transform": {
      const template = (step.config as { template?: string }).template ?? "";
      return (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">
            Template{" "}
            <span className="font-normal text-muted-foreground">
              ({"{{input}}"} / {"{{field}}"} placeholders)
            </span>
          </span>
          <input
            value={template}
            aria-label="Transform template"
            onChange={(e) =>
              onChange({ template: e.target.value })
            }
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm"
          />
        </label>
      );
    }
    case "classify": {
      const rules: Record<string, string[]> = {
        ...((step.config as { rules?: Record<string, string[]> }).rules ?? {}),
      };
      const rows = Object.entries(rules).map(([label, kws]) => ({
        label,
        keywords: kws.join(", "),
      }));
      return (
        <div className="space-y-2">
          <span className="block text-sm font-medium text-foreground">
            Rules <span className="font-normal text-muted-foreground">(one `label: kw1,kw2` per line)</span>
          </span>
          {rows.map((row, i) => (
            <div key={row.label} className="flex gap-2">
              <input
                value={row.label}
                aria-label={`classify label ${i + 1}`}
                onChange={(e) => {
                  const next: Record<string, string[]> = { ...rules };
                  const kws = next[row.label];
                  delete next[row.label];
                  const nv = e.target.value.trim();
                  if (nv !== "") next[nv] = kws ?? [];
                  onChange({ rules: next });
                }}
                className="w-32 rounded-md border border-border bg-card px-2 py-1 text-sm shadow-sm"
              />
              <input
                value={row.keywords}
                aria-label={`classify keywords for ${row.label}`}
                onChange={(e) => {
                  const next: Record<string, string[]> = {
                    ...rules,
                    [row.label]: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                  };
                  onChange({ rules: next });
                }}
                className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm shadow-sm"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const next: Record<string, string[]> = { ...rules };
              let n = rows.length + 1;
              while (next[`label_${n}`] !== undefined) n += 1;
              next[`label_${n}`] = [];
              onChange({ rules: next });
            }}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-secondary"
          >
            + Add rule
          </button>
        </div>
      );
    }
    case "enrich": {
      const fields = (step.config as { fields?: Record<string, unknown> }).fields ?? {};
      const entries = Object.entries(fields);
      return (
        <div className="space-y-2">
          <span className="block text-sm font-medium text-foreground">
            Fields <span className="font-normal text-muted-foreground">(shallow-merged onto the payload)</span>
          </span>
          {entries.map(([k, v], i) => (
            <div key={k} className="flex gap-2">
              <input
                value={k}
                aria-label={`enrich field key ${i + 1}`}
                onChange={(e) => {
                  const renamed: Record<string, unknown> = { ...fields };
                  delete renamed[k];
                  renamed[e.target.value] = v;
                  onChange({ fields: renamed });
                }}
                className="w-32 rounded-md border border-border bg-card px-2 py-1 text-sm shadow-sm"
              />
              <input
                value={String(v)}
                aria-label={`enrich value for ${k}`}
                onChange={(e) => onChange({ fields: { ...fields, [k]: e.target.value } })}
                className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm shadow-sm"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ fields: { ...fields, field: "" } })}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-secondary"
          >
            + Add field
          </button>
        </div>
      );
    }
    case "branch": {
      const when: Array<{ field: string; target?: string }> = ((
        step.config as { when?: Array<{ field: string; target?: string }> }
      ).when ?? []);
      return (
        <div className="space-y-2">
          <span className="block text-sm font-medium text-foreground">
            When clauses <span className="font-normal text-muted-foreground">(field: `payloadKey` or `labels:&lt;label&gt`)</span>
          </span>
          {when.map((clause, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input
                value={clause.field}
                aria-label={`branch field ${i + 1}`}
                onChange={(e) => {
                  const next = when.map((c, ci) => (ci === i ? { ...c, field: e.target.value } : c));
                  onChange({ when: next });
                }}
                className="w-44 rounded-md border border-border bg-card px-2 py-1 text-sm shadow-sm"
              />
              <select
                value={clause.target ?? ""}
                aria-label={`branch target ${i + 1}`}
                onChange={(e) => {
                  const next = when.map((c, ci) =>
                    ci === i ? { ...c, target: e.target.value || undefined } : c,
                  );
                  onChange({ when: next });
                }}
                className="w-44 rounded-md border border-border bg-card px-2 py-1 text-sm shadow-sm"
              >
                <option value="">fall-through (next step)</option>
                <option value="end">end</option>
                {flow.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`remove branch clause ${i + 1}`}
                onClick={() => onChange({ when: when.filter((_, ci) => ci !== i) })}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-destructive shadow-sm hover:bg-secondary"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ when: [...when, { field: "labels:" }] })}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-secondary"
          >
            + Add clause
          </button>
        </div>
      );
    }
    case "notify": {
      const message = (step.config as { message?: string }).message ?? "";
      return (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">Message (optional)</span>
          <input
            value={message}
            aria-label="Notify message"
            onChange={(e) => onChange({ message: e.target.value })}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm"
          />
        </label>
      );
    }
  }
}

// ── default config factory per step type (used by "add step") ──

export function defaultConfigFor(type: StepType): StepConfig {
  switch (type) {
    case "transform":
      return { template: "{{input}}" };
    case "classify":
      return { rules: { urgent: ["urgent"], routine: ["routine"] } };
    case "enrich":
      return { fields: {} };
    case "branch":
      return { when: [{ field: "labels:" }] };
    case "notify":
      return { message: "" };
  }
}

// ── run payload editor (JSON textarea with parse feedback) ──

export function RunPayloadEditor({
  value,
  onChange,
  onRun,
  running,
  result,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  running: boolean;
  result: string | null;
}) {
  let parseError: string | null = null;
  if (value.trim() !== "") {
    try {
      JSON.parse(value);
    } catch (e) {
      parseError = e instanceof Error ? e.message : "invalid JSON";
    }
  }
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">
          Run payload{" "}
          <span className="font-normal text-muted-foreground">
            (JSON; use <code className="font-mono text-xs">{"{ text: &quot;…&quot; }"}</code>)
          </span>
        </span>
        <textarea
          value={value}
          aria-label="Run payload JSON"
          rows={4}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs shadow-sm"
        />
      </label>
      {parseError && (
        <p role="alert" className="text-xs text-destructive">
          Invalid JSON: {parseError}
        </p>
      )}
      <button
        type="button"
        onClick={onRun}
        disabled={running || parseError !== null}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-50"
      >
        {running ? "Running…" : "Run"}
      </button>
      {result && <p className="text-xs text-muted-foreground">{result}</p>}
    </div>
  );
}

export type { Flow, Run, Workspace, WorkspaceStats };
