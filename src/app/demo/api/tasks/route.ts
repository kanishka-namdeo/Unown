import { NextResponse } from "next/server";
import { createTask, moveTask, normalizeTasks } from "@/lib/sigil/tasks";
import type { ColumnId, Task } from "@/lib/sigil/types";
import { isColumnId } from "@/lib/sigil/tasks";
import { getServerTasks, setServerTasks } from "@/lib/sigil/server-store";

function persist(tasks: Task[]): Task[] {
  return setServerTasks(tasks);
}

export async function GET() {
  return NextResponse.json({ tasks: getServerTasks() });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.title !== "string" || b.title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const task = createTask({
    title: b.title,
    description: typeof b.description === "string" ? b.description : undefined,
    priority: b.priority as Task["priority"],
    labels: Array.isArray(b.labels) ? (b.labels as string[]) : undefined,
    storyPoints:
      typeof b.storyPoints === "number" ? b.storyPoints : null,
    column: isColumnId(b.column) ? (b.column as ColumnId) : "backlog",
  });
  persist([...getServerTasks(), task]);
  return NextResponse.json({ task }, { status: 201 });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const tasks = getServerTasks();
  const idx = tasks.findIndex((t) => t.id === b.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  const existing = tasks[idx];
  const updates: Partial<Task> = {};
  if (typeof b.title === "string") updates.title = b.title.trim();
  if (typeof b.description === "string") updates.description = b.description;
  if (b.priority !== undefined) updates.priority = b.priority as Task["priority"];
  if (Array.isArray(b.labels)) updates.labels = b.labels.filter((l): l is string => typeof l === "string");
  if (b.storyPoints !== undefined) updates.storyPoints = b.storyPoints as Task["storyPoints"];
  if (b.column !== undefined) {
    if (!isColumnId(b.column)) {
      return NextResponse.json({ error: "Invalid column" }, { status: 400 });
    }
  }
  const nextTasks = tasks.slice();
  if (isColumnId(b.column) && b.column !== existing.column) {
    nextTasks[idx] = moveTask({ ...existing, ...updates }, b.column as ColumnId);
  } else {
    nextTasks[idx] = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  }
  persist(nextTasks);
  return NextResponse.json({ task: nextTasks[idx] });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const tasks = getServerTasks();
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  persist(next);
  return NextResponse.json({ ok: true, id });
}

/** Bulk replace: body { tasks: unknown[] } — used for best-effort sync. */
export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.tasks)) {
    return NextResponse.json({ error: "tasks array is required" }, { status: 400 });
  }
  const normalized = normalizeTasks(b.tasks);
  persist(normalized);
  return NextResponse.json({ ok: true, count: normalized.length });
}
