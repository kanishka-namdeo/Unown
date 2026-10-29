/**
 * GET /aria/api/tasks — the tenant's tasks, each with its computed
 * `slaState` (ok / late / done), filtered by `?entityId=` /
 * `?ownerId=` / `?done=` / `?slaState=`.
 *
 * POST /aria/api/tasks — create (`task.create`: the matrix's ✗ for
 * viewer).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createTask,
  listTasks,
} from "@/lib/aria/aria-store";
import { validateCreateTask, validateUpdateTask } from "@/lib/aria/validation";
import type { EntityState, TaskPriority } from "@/lib/aria/types";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "task.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const entityId = search.get("entityId") ?? undefined;
  const ownerId = search.get("ownerId") ?? undefined;
  const doneParam = search.get("done");
  const done =
    doneParam === null ? undefined : doneParam === "true" ? true : false;
  const slaState = search.get("slaState") ?? undefined;

  return NextResponse.json(listTasks(session.ctx, entityId, ownerId, done, slaState));
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("task creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "task.create");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const { errors } = validateCreateTask({
    title: String(input.title ?? ""),
    ownerId: String(input.ownerId ?? ""),
    entityType: input.entityType as EntityState,
    entityId: String(input.entityId ?? ""),
    due: String(input.due ?? ""),
    priority: input.priority as TaskPriority,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const row = createTask(session.ctx, {
    title: String(input.title),
    ownerId: String(input.ownerId),
    entityType: input.entityType as EntityState,
    entityId: String(input.entityId),
    due: String(input.due),
    priority: input.priority as TaskPriority,
  });
  return NextResponse.json(row, { status: 201 });
}
