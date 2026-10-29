/**
 * GET /nocturne/api/runbooks/[id] — 200 the runbook + its
 * per-incident checklists; 404 when unknown or cross-tenant.
 *
 * PATCH /nocturne/api/runbooks/[id] — the `runbook.update` lane
 * (owner + admin). 200 the updated row.
 *
 * DELETE /nocturne/api/runbooks/[id] — the `runbook.delete` lane
 * (owner + admin). 204; the checklists that referenced it are
 * dropped (a deleted runbook leaves no dangling checklist state).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { validateUpdateRunbook } from "@/lib/nocturne/validation";
import { crossTenant } from "@/lib/nocturne/tenancy";
import type { NocturneRunbook, NocturneState, Severity } from "@/lib/nocturne/types";
import { getNocturne, nocturneTransaction } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

function findRunbook(s: NocturneState, id: string): NocturneRunbook | undefined {
  return s.runbooks.find((x) => x.id === id);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "runbook.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const s = getNocturne();
  const runbook = findRunbook(s, id);
  if (!runbook || crossTenant(runbook, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  return NextResponse.json({
    ...runbook,
    checklists: s.checklists.filter((c) => c.runbookId === runbook.id),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("runbook updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s = getNocturne();
  const runbook = findRunbook(s, id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!runbook || crossTenant(runbook, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "runbook.update");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    name?: string;
    steps?: Array<{ title: string; command?: string }>;
    forSeverities?: Severity[];
  };
  const { errors } = validateUpdateRunbook(input);
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const updated: NocturneRunbook = {
    ...runbook,
    ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
    ...(input.steps !== undefined
      ? {
          steps: input.steps.map((step, i) => ({
            id: `s${i + 1}`,
            title: String(step.title ?? "").trim(),
            ...(step.command !== undefined ? { command: String(step.command) } : {}),
          })),
        }
      : {}),
    ...(input.forSeverities !== undefined ? { forSeverities: input.forSeverities } : {}),
  };
  nocturneTransaction((state) => ({
    ...state,
    runbooks: state.runbooks.map((x) => (x.id === id ? updated : x)),
  }));
  return NextResponse.json(getNocturne().runbooks.find((x) => x.id === id)!);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("runbook deletes"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s = getNocturne();
  const runbook = findRunbook(s, id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!runbook || crossTenant(runbook, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "runbook.delete");
  if (denied) return NextResponse.json(denied, { status: 403 });

  nocturneTransaction((state) => ({
    ...state,
    runbooks: state.runbooks.filter((x) => x.id !== id),
    checklists: state.checklists.filter((c) => c.runbookId !== id),
  }));
  return new NextResponse(null, { status: 204 });
}
