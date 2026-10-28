/**
 * Fugue resource domain operations — workspaces, flows, runs, stats.
 * Shared by the API route shells (thin) and unit-tested directly.
 * PLAN.md §6.
 */
import { loadState, saveState, nextId, appendRun } from "./store";
import { validateFlow } from "./validation";
import { runFlow, prodCtx, type EngineCtx } from "./engine";
import { computeStats } from "./stats";
import type {
  FieldError,
  Flow,
  FlowDraft,
  FlowStep,
  Run,
  Workspace,
  WorkspaceStats,
} from "./types";

// ── Workspaces ──

export interface WorkspaceInput {
  name?: string;
  slug?: string;
  description?: string;
}

export type WorkspaceOpResult =
  | { status: 201; workspace: Workspace }
  | { status: 400; errors: FieldError[] };

export function createWorkspace(input: WorkspaceInput): WorkspaceOpResult {
  const errors: FieldError[] = [];
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    errors.push({ path: "name", message: "name must be a non-empty string" });
  }
  if (
    input.slug !== undefined &&
    (typeof input.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))
  ) {
    errors.push({ path: "slug", message: "slug must be URL-safe (lowercase alphanumeric, hyphens)" });
  }
  if (input.description !== undefined && typeof input.description !== "string") {
    errors.push({ path: "description", message: "description must be a string" });
  }
  if (errors.length > 0) return { status: 400, errors };

  const s = loadState();
  const slug =
    input.slug ??
    (input.name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  if (s.workspaces.some((w) => w.slug === slug)) {
    return {
      status: 400,
      errors: [{ path: "slug", message: `slug '${slug}' is already in use` }],
    };
  }

  const ws: Workspace = {
    id: nextId("ws"),
    slug,
    name: (input.name ?? "").trim(),
    description: input.description ?? "",
    createdAt: new Date().toISOString(),
  };
  s.workspaces.push(ws);
  saveState();
  return { status: 201, workspace: ws };
}

export function patchWorkspace(
  id: string,
  input: { name?: string; description?: string },
): { workspace: Workspace } | { status: 404 } | { status: 400; errors: FieldError[] } {
  const s = loadState();
  const ws = s.workspaces.find((w) => w.id === id);
  if (!ws) return { status: 404 };

  const errors: FieldError[] = [];
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim().length === 0)) {
    errors.push({ path: "name", message: "name must be a non-empty string" });
  }
  if (input.description !== undefined && typeof input.description !== "string") {
    errors.push({ path: "description", message: "description must be a string" });
  }
  if (errors.length > 0) return { status: 400, errors };

  if (input.name !== undefined) ws.name = input.name.trim();
  if (input.description !== undefined) ws.description = input.description;
  saveState();
  return { workspace: ws };
}

// ── Flows ──

export function getFlows(workspaceId?: string): { flows: Flow[] } | { status: 404 } {
  const s = loadState();
  if (workspaceId !== undefined && !s.workspaces.some((w) => w.id === workspaceId)) {
    return { status: 404 };
  }
  const flows =
    workspaceId === undefined ? s.flows : s.flows.filter((f) => f.workspaceId === workspaceId);
  return { flows };
}

export interface CreateFlowInput {
  workspaceId: string;
  name: string;
  description?: string;
  /** FlowStep[]; step ids are filled in with deterministic suffixes when missing. */
  steps: FlowStep[];
}

export type CreateFlowResult =
  | { status: 201; flow: Flow }
  | { status: 400; errors: FieldError[] }
  | { status: 404 };

export function createFlow(input: CreateFlowInput): CreateFlowResult {
  const s = loadState();
  if (!s.workspaces.some((w) => w.id === input.workspaceId)) {
    return { status: 404 };
  }

  const draft: FlowDraft = {
    name: input.name,
    description: input.description ?? "",
    steps: input.steps as FlowDraft["steps"],
  };
  const ctx = {
    id: nextId("fl"),
    workspaceId: input.workspaceId,
    now: new Date().toISOString(),
    enabled: true,
  };
  const result = validateFlow(draft, ctx);
  if (!result.ok) return { status: 400, errors: result.errors };

  s.flows.push(result.flow);
  saveState();
  return { status: 201, flow: result.flow };
}

export function patchFlow(
  id: string,
  input: {
    name?: string;
    description?: string;
    enabled?: boolean;
    /** When present, fully replaces the step list. */
    steps?: FlowStep[];
  },
): { flow: Flow } | { status: 404 } | { status: 400; errors: FieldError[] } {
  const s = loadState();
  const flow = s.flows.find((f) => f.id === id);
  if (!flow) return { status: 404 };

  const patchingStructure =
    input.name !== undefined ||
    input.description !== undefined ||
    input.steps !== undefined;

  if (patchingStructure) {
    const draft: FlowDraft = {
      name: input.name ?? flow.name,
      description: input.description ?? flow.description,
      steps: (input.steps ?? flow.steps) as FlowDraft["steps"],
    };
    const result = validateFlow(draft, {
      id: flow.id,
      workspaceId: flow.workspaceId,
      now: new Date().toISOString(),
      enabled: input.enabled ?? flow.enabled,
    });
    if (!result.ok) return { status: 400, errors: result.errors };
    flow.name = result.flow.name;
    flow.description = result.flow.description;
    flow.steps = result.flow.steps;
  }
  if (input.enabled !== undefined) flow.enabled = input.enabled;
  flow.updatedAt = new Date().toISOString();
  saveState();
  return { flow };
}

export function deleteFlow(id: string): { status: 204 } | { status: 404 } {
  const s = loadState();
  if (!s.flows.some((f) => f.id === id)) return { status: 404 };
  s.flows = s.flows.filter((f) => f.id !== id);
  saveState();
  return { status: 204 };
}

/**
 * Execute a flow over a payload and persist the run (retention applied).
 * Deterministic id via the store's seq counter; clock via prodCtx.
 */
export function executeFlow(
  flowId: string,
  payload: unknown,
): { status: 201; run: Run } | { status: 404 } | { status: 400; errors: FieldError[] } {
  const s = loadState();
  const flow = s.flows.find((f) => f.id === flowId);
  if (!flow) return { status: 404 };
  if (!flow.enabled) {
    return {
      status: 400,
      errors: [{ path: "flow", message: "flow is disabled; enable it before running" }],
    };
  }

  const base = prodCtx();
  const ctx: EngineCtx = {
    now: base.now,
    nextRunId: (fid: string) => {
      // nextId("run") already yields "run_<seq>" — use it directly.
      void fid;
      return nextId("run");
    },
    measure: base.measure,
    snapshot: base.snapshot,
  };
  const run = runFlow(flow, payload, ctx);
  appendRun(run);
  return { status: 201, run };
}

// ── Runs / stats ──

export function getRuns(
  workspaceId?: string,
  flowId?: string,
): { runs: Run[] } | { status: 404 } {
  const s = loadState();
  if (workspaceId !== undefined && !s.workspaces.some((w) => w.id === workspaceId)) {
    return { status: 404 };
  }
  let runs = s.runs;
  if (workspaceId !== undefined) runs = runs.filter((r) => r.workspaceId === workspaceId);
  if (flowId !== undefined) runs = runs.filter((r) => r.flowId === flowId);
  return { runs };
}

export function getRun(id: string): { run: Run } | { status: 404 } {
  const s = loadState();
  const run = s.runs.find((r) => r.id === id);
  if (!run) return { status: 404 };
  return { run };
}

export function getStats(workspaceId?: string): { stats: WorkspaceStats } | { status: 404 } {
  const s = loadState();
  if (workspaceId !== undefined && !s.workspaces.some((w) => w.id === workspaceId)) {
    return { status: 404 };
  }
  const runs =
    workspaceId === undefined ? s.runs : s.runs.filter((r) => r.workspaceId === workspaceId);
  return { stats: computeStats(runs) };
}
