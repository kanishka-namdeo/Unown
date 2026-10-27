import { NextResponse } from "next/server";
import { dailyStats, totals, currentStreak } from "@/lib/sigil/stats";
import type { FocusLogEntry } from "@/lib/sigil/types";
import {
  getServerTasks,
  getServerFocusLog,
  setServerFocusLog,
} from "@/lib/sigil/server-store";

function validEntry(e: unknown): e is FocusLogEntry {
  if (typeof e !== "object" || e === null) return false;
  const r = e as Record<string, unknown>;
  return typeof r.taskId === "string" && typeof r.startedAt === "string";
}

export async function GET() {
  const tasks = getServerTasks();
  const focusLog = getServerFocusLog();
  const now = new Date();
  return NextResponse.json({
    days: dailyStats(tasks, focusLog, 14, now),
    streak: currentStreak(tasks.map((t) => t.completedAt), now),
    totals: totals(
      tasks.map((t) => ({ completedAt: t.completedAt })),
      focusLog,
    ),
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  let log = getServerFocusLog();
  if (Array.isArray(b.entries)) {
    const entries = (b.entries as unknown[]).filter(validEntry).map((e) => ({
      ...e,
      durationMin: typeof e.durationMin === "number" ? e.durationMin : 0,
    }));
    log = setServerFocusLog([...log, ...entries]);
  } else if (validEntry(b)) {
    log = setServerFocusLog([
      ...log,
      {
        taskId: b.taskId,
        startedAt: b.startedAt,
        durationMin: typeof b.durationMin === "number" ? b.durationMin : 0,
      },
    ]);
  } else {
    return NextResponse.json(
      { error: "Provide { taskId, startedAt, durationMin } or { entries: [...] }" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, count: log.length }, { status: 201 });
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.log)) {
    return NextResponse.json({ error: "log array is required" }, { status: 400 });
  }
  const log = setServerFocusLog(
    (b.log as unknown[])
      .filter(validEntry)
      .map((e) => ({ ...e, durationMin: e.durationMin || 0 })),
  );
  return NextResponse.json({ ok: true, count: log.length });
}
