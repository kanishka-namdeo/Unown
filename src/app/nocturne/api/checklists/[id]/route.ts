/**
 * POST /nocturne/api/checklists — start a runbook checklist on an
 * incident (plan §3.6, the `checklist.start` lane). 201 the
 * `NocturneChecklistState` row (all steps pending); 400 when the
 * runbook does not belong to the incident's service, or when a
 * checklist for the pair already exists; 404 when the incident or
 * runbook is unknown or belongs to another tenant.
 *
 * PATCH /nocturne/api/checklists/[id] — the `checklist.update`
 * lane. 200 the updated row; 400 when the step is not in the
 * runbook; 404 when the checklist is unknown or cross-tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  validateChecklistStart,
  validateChecklistUpdate,
} from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import { crossTenant } from "@/lib/nocturne/tenancy";
import type {
  NocturneChecklistState,
  NocturneState,
} from "@/lib/nocturne/types";
import { getNocturne, nocturneTransaction, nextId } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("checklist starts"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "checklist.start");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { incidentId?: string; runbookId?: string };
  const { errors } = validateChecklistStart({
    incidentId: String(input.incidentId ?? ""),
    runbookId: String(input.runbookId ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const s = getNocturne();
  const incident = s.incidents.find((i) => i.id === String(input.incidentId));
  if (!incident || crossTenant(incident, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  const runbook = s.runbooks.find((r) => r.id === String(input.runbookId));
  if (!runbook || crossTenant(runbook, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  // The 400 rung: a runbook must belong to the incident's service
  // (plan §3.6).
  if (runbook.serviceId !== incident.serviceId) {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: ["the runbook does not belong to the incident's service."],
      },
      { status: 400 },
    );
  }
  // One checklist per (incident, runbook) pair.
  const existing = s.checklists.find(
    (c) => c.incidentId === incident.id && c.runbookId === runbook.id,
  );
  if (existing) {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: ["a checklist for this incident + runbook already exists."],
      },
      { status: 400 },
    );
  }

  const now = nowClock();
  const id = nextId("cl");
  const checklist: NocturneChecklistState = {
    id,
    tenantId: session.ctx.tenantId,
    incidentId: incident.id,
    runbookId: runbook.id,
    stepStates: {},
    updatedAt: now,
  };
  nocturneTransaction((state) => ({
    ...state,
    checklists: [...state.checklists, checklist],
  }));
  return NextResponse.json(checklist, { status: 201 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("checklist updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s = getNocturne();
  const checklist = s.checklists.find((c) => c.id === id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!checklist || crossTenant(checklist, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "checklist.update");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { stepId?: string; state?: "pending" | "done" | "skipped" };
  const { errors } = validateChecklistUpdate({
    stepId: String(input.stepId ?? ""),
    state: input.state as "pending" | "done" | "skipped",
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  // The 404 rung (plan §3.6): the step must be a step of the
  // checklist's runbook.
  const runbook = s.runbooks.find((r) => r.id === checklist.runbookId);
  if (!runbook || !runbook.steps.some((step) => step.id === String(input.stepId))) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const now = nowClock();
  const stepId = String(input.stepId);
  const stepState = input.state!;
  nocturneTransaction((state) => ({
    ...state,
    checklists: state.checklists.map((c) => {
      if (c.id !== checklist.id) return c;
      const stepStates = { ...c.stepStates };
      stepStates[stepId] = stepState;
      return { ...c, stepStates, updatedAt: now };
    }),
  }));
  const updated = getNocturne().checklists.find((c) => c.id === id)!;
  return NextResponse.json(updated);
}

export type { NocturneState };
