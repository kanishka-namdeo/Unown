/**
 * PATCH /aria/api/tasks/[id] — `task.update` (the matrix's ✗ for
 * viewer). 404 cross-tenant / unknown; the done toggle fills in a
 * `doneAt` timestamp when completed.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { updateTask } from "@/lib/aria/aria-store";
import { validateUpdateTask } from "@/lib/aria/validation";
import type { TaskPriority } from "@/lib/aria/types";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("task updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "task.update");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
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
  const { errors } = validateUpdateTask({
    title: input.title !== undefined ? String(input.title) : undefined,
    due: input.due !== undefined ? String(input.due) : undefined,
    priority: input.priority as TaskPriority | undefined,
    done: input.done as boolean | undefined,
    doneAt: input.doneAt as string | null | undefined,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const updated = updateTask(
    session.ctx,
    id,
    input as Parameters<typeof updateTask>[2],
  );
  if (!updated) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  return NextResponse.json(updated);
}
