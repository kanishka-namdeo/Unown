/**
 * rest-adapter.ts — F-3's real HTTP adapter: the F-2 `EngineAdapter`
 * interface implemented over the runner's raw engine client, with
 * every response passed through `assertContract` (the F-2 pins in
 * contract.ts) BEFORE returning — drift throws EngineDrift, never a
 * silent type error (the anti-rot law).
 *
 * Boundary law (PLAN §1/§3): this file imports ONLY from src/domain
 * and src/adapter. The raw fetch transport lives in runner/
 * (engine-client.ts) and is INJECTED through `RestAdapterClient` —
 * the src/ closure stays network-free (boundary-adapter.test.ts
 * enforces it).
 *
 * Wire-shape ruling (the pinned engine contract, verified live
 * 2026-11-07 from server.ts + automations.ts): the engine's
 * AutomationRecord is SNAKE_CASE (schedule_kind, cron_expr,
 * delay_ms, event_kind/...) with `lifecycle: "active" | "paused"`
 * — the F-2 `AutomationRecord` view is the camelCase domain shape.
 * The mapper below bridges both; the F-2 fixture rows (camelCase
 * `schedule`/`state`) and engine-native rows both map cleanly.
 */

import {
  type EngineAdapter,
  type AutomationRecord,
  type CreateAutomationInput,
  type DreamRecord,
  type NoteRecord,
  type MemoryView,
  type SpendReport,
  EngineLocked,
  EngineDown,
  EngineDrift,
} from "./engine-adapter.js";
import {
  assertContract,
  type ContractEndpoint,
} from "./contract.js";
import type {
  EngineStatusView,
  RunRecordView,
  ScheduleSpec,
} from "../domain/types.js";

/** The narrow client surface the adapter needs — implemented by
 *  runner/engine-client.ts (fetch + token discovery + error mapping)
 *  and by the fixture-backed test doubles. The adapter never sees a
 *  transport; it sees raw JSON + the two taxonomy errors. */
export interface RestAdapterClient {
  call(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown>;
  /** Injected clock — keeps the once-kind mapping deterministic. */
  nowMs(): number;
}

/** The POST/PATCH/GET-per-id wire row — camelCase when the row was
 *  created through the fixture's POST lane, snake_case when the row is
 *  engine-native. Both shapes map to the domain AutomationRecord via
 *  mapAutomationRow. */
export interface WireAutomationRow {
  id: number | string;
  title: string;
  prompt: string;
  schedule:
    | { kind: string; expr?: string; spec?: string; delayMinutes?: number; name?: string; filter?: string }
    | Record<string, unknown>;
  mode: "read-only" | "standard";
  model?: string;
  timezone?: string;
  state?: "active" | "paused";
  lifecycle?: "active" | "paused";
  created_at?: number;
  updated_at?: number;
}
/** The engine's wire row (snake_case, automations.ts AutomationRow
 *  — the fields observed live 2026-11-07). */
export interface EngineAutomationRow {
  cron_expr: string | null;
  delay_ms: number | null;
  schedule_kind: "cron" | "every" | "after" | "once" | "event" | null;
  interval_n: number | null;
  interval_unit: "m" | "h" | "d" | "w" | null;
  interval_at: string | null;
  timezone: string | null;
  until_ms: number | null;
  misfire: "skip" | "catch-up" | null;
  event_kind: string | null;
  event_filter: string | null;
  active_hours: string | null;
  idle_only: number;
  deliver_url: string | null;
  jitter_secs: number | null;
  retry_max: number | null;
  retry_backoff_secs: number | null;
  model: string | null;
  mode: "read-only" | "standard";
  spend_cap: number | null;
  lifecycle: "active" | "paused";
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
}

/** The engine's wire run record (snake_case, the pinned fields). */
export interface EngineRunRecord {
  id: string;
  task_id: string;
  kind: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  tokens_in: number;
  tokens_out: number;
  tool_calls: number;
  turns: number;
  error: string | null;
}

/** Map the engine's schedule columns to the domain's five-kind
 *  ScheduleSpec (the task's mapping ruling):
 *   schedule_kind cron -> { kind:"cron", expr: cron_expr }
 *   every/after    -> { kind, spec: interval_n + interval_unit }
 *   once           -> { kind:"once", delayMinutes: (delay_ms-now)/60k }
 *   event          -> { kind:"event", name: event_kind, filter? } */
export function mapScheduleToSpec(
  row: {
    schedule_kind: string | null;
    cron_expr: string | null;
    delay_ms: number | null;
    interval_n: number | null;
    interval_unit: string | null;
    event_kind: string | null;
    event_filter: string | null;
    /** CamelCase domain schedule (fixture lane — the POST-created rows). */
    schedule?: {
      kind: string;
      expr?: string;
      spec?: string;
      delayMinutes?: number;
      name?: string;
      filter?: string;
    };
  },
  nowMs: number,
): ScheduleSpec {
  // Fixture lane: the row already carries a camelCase domain schedule.
  if (row.schedule && typeof row.schedule.kind === "string") {
    switch (row.schedule.kind) {
      case "cron":
        return { kind: "cron", expr: row.schedule.expr ?? "" };
      case "every":
        return { kind: "every", spec: row.schedule.spec ?? "1d" };
      case "after":
        return { kind: "after", spec: row.schedule.spec ?? "1d" };
      case "once":
        return { kind: "once", delayMinutes: row.schedule.delayMinutes ?? 0 };
      case "event":
        return {
          kind: "event",
          name: row.schedule.name ?? "",
          ...(row.schedule.filter ? { filter: row.schedule.filter } : {}),
        };
      default:
        return { kind: "every", spec: "1d" };
    }
  }
  const kind = row.schedule_kind ?? "every";
  const unit = row.interval_unit ?? "d";
  const n = row.interval_n ?? 1;
  switch (kind) {
    case "cron":
      return { kind: "cron", expr: row.cron_expr ?? "" };
    case "after":
      return { kind: "after", spec: `${n}${unit}` };
    case "once": {
      const delayMinutes =
        row.delay_ms !== null
          ? Math.max(0, Math.round((row.delay_ms - nowMs) / 60_000))
          : 0;
      return { kind: "once", delayMinutes };
    }
    case "event":
      return {
        kind: "event",
        name: row.event_kind ?? "",
        ...(row.event_filter ? { filter: row.event_filter } : {}),
      };
    case "every":
    default:
      return { kind: "every", spec: `${n}${unit}` };
  }
}

/** One wire row -> the F-2 AutomationRecord view (the bridge from
 *  engine-native snake_case to the camelCase domain shape). */
export function mapAutomationRow(
  row: Record<string, unknown>,
  nowMs: number,
  fallbackId: number,
): AutomationRecord {
  const r = row as Partial<EngineAutomationRow> & Partial<WireAutomationRow>;
  const numId = Number(r.id);
  return {
    id: Number.isFinite(numId) && numId > 0 ? numId : fallbackId,
    title: String(r.title ?? ""),
    prompt: String(r.prompt ?? ""),
    schedule: mapScheduleToSpec(r, nowMs),
    mode: r.mode === "standard" ? "standard" : "read-only",
    model: r.model != null ? String(r.model) : undefined,
    timezone: r.timezone != null ? String(r.timezone) : undefined,
    state: r.state === "paused" || r.lifecycle === "paused" ? "paused" : "active",
  } as AutomationRecord;
}

export class RestAdapter implements EngineAdapter {
  constructor(private readonly client: RestAdapterClient) {}

  async listAutomations(): Promise<AutomationRecord[]> {
    const raw = (await this.checked("automations", () =>
      this.client.call("GET", "/api/automations"),
    )) as { automations: unknown };
    return mapAutomationList(raw.automations);
  }

  async createAutomation(input: CreateAutomationInput): Promise<AutomationRecord> {
    const body: Record<string, unknown> = {
      title: input.title,
      prompt: input.prompt,
      mode: input.mode,
    };
    const s = input.schedule;
    switch (s.kind) {
      case "cron":
        body.cron = s.expr;
        break;
      case "every":
        body.every = s.spec;
        break;
      case "after":
        body.after = s.spec;
        break;
      case "once":
        body.delayMinutes = s.delayMinutes;
        break;
      case "event":
        body.event = s.name;
        if (s.filter !== undefined) body.filter = s.filter;
        break;
    }
    if (input.model !== undefined) body.model = input.model;
    if (input.timezone !== undefined) body.timezone = input.timezone;
    const raw = (await this.checked("single-automation", () =>
      this.client.call("POST", "/api/automations", body),
    )) as { automation?: unknown; [k: string]: unknown };
    return mapAutomationList(raw.automation ? [raw.automation] : [raw])[0];
  }

  async pauseAutomation(id: number): Promise<void> {
    await this.lifecyclePatch(id, "paused");
  }

  async resumeAutomation(id: number): Promise<void> {
    await this.lifecyclePatch(id, "active");
  }

  async runNow(id: number): Promise<void> {
    await this.client.call("POST", `/api/automations/${id}/run`);
  }

  async skip(id: number): Promise<void> {
    await this.client.call("POST", `/api/automations/${id}/skip`);
  }

  async snooze(id: number, minutes: number): Promise<void> {
    await this.client.call("POST", `/api/automations/${id}/snooze`, { minutes });
  }

  async history(id: number, limit?: number): Promise<RunRecordView[]> {
    const raw = (await this.checked("runs", () =>
      this.client.call("GET", `/api/automations/${id}/runs${limit ? `?limit=${limit}` : ""}`),
    )) as { runs: unknown };
    return mapRuns(raw.runs);
  }

  async overview(): Promise<EngineStatusView> {
    return this.checked("overview", () =>
      this.client.call("GET", "/api/overview"),
    ) as Promise<EngineStatusView>;
  }

  async runs(limit?: number): Promise<RunRecordView[]> {
    const raw = (await this.checked("runs", () =>
      this.client.call("GET", `/api/runs${limit ? `?limit=${limit}` : ""}`),
    )) as { runs: unknown };
    return mapRuns(raw.runs);
  }

  async dreams(limit?: number): Promise<DreamRecord[]> {
    const raw = (await this.checked("dreams", () =>
      this.client.call("GET", `/api/dreams${limit ? `?limit=${limit}` : ""}`),
    )) as { dreams: unknown };
    return mapDreams(raw.dreams, limit);
  }

  async notes(limit?: number): Promise<NoteRecord[]> {
    const raw = (await this.checked("notes", () =>
      this.client.call("GET", `/api/notes${limit ? `?limit=${limit}` : ""}`),
    )) as { notes: unknown };
    return mapNotes(raw.notes, limit);
  }

  async memories(): Promise<MemoryView> {
    return this.checked("memories", () =>
      this.client.call("GET", "/api/memories"),
    ) as Promise<MemoryView>;
  }

  async spend(): Promise<SpendReport> {
    return this.checked("spend", () =>
      this.client.call("GET", "/api/automations/spend"),
    ) as Promise<SpendReport>;
  }

  /** Call + `assertContract` (the F-2 pins; drift throws EngineDrift
   *  with the dotted-path message) before the raw JSON is returned. */
  private async checked<T>(endpoint: ContractEndpoint, call: () => Promise<unknown>): Promise<T> {
    const raw = await call();
    assertContract(endpoint, raw);
    return raw as T;
  }

  /** pause/resume: the engine has no dedicated /pause /resume route —
   *  they are lifecycle PATCHes (pinned from server.ts's PATCH body). */
  private async lifecyclePatch(id: number, lifecycle: "active" | "paused"): Promise<void> {
    await this.checked("single-automation", () =>
      this.client.call("PATCH", `/api/automations/${id}`, { lifecycle }),
    );
  }
}

/* — the pure mapping helpers (exported for the F-3 test pins) — */

export function mapAutomationList(rows: unknown): AutomationRecord[] {
  if (!Array.isArray(rows))
    throw new EngineDrift("automations: expected array, got " + typeof rows);
  return (rows as Record<string, unknown>[]).map((row, i) =>
    mapAutomationRow(row, 0, i + 1),
  );
}

export function mapRuns(rows: unknown): RunRecordView[] {
  if (!Array.isArray(rows))
    throw new EngineDrift("runs: expected array, got " + typeof rows);
  return (rows as Record<string, unknown>[]).map((r, i) => {
    const numId = Number(r.id);
    const numTask = Number(r.taskId ?? r.task_id);
    return {
      id: Number.isFinite(numId) && numId > 0 ? numId : i + 1,
      taskId: Number.isFinite(numTask) && numTask > 0 ? numTask : 0,
      kind: String(r.kind ?? "cron"),
      status: r.status as RunRecordView["status"],
      startedAt: String(r.startedAt ?? r.started_at ?? ""),
      endedAt: (r.endedAt ?? r.ended_at ?? null) as RunRecordView["endedAt"],
      tokensIn: Number(r.tokensIn ?? r.tokens_in ?? 0),
      tokensOut: Number(r.tokensOut ?? r.tokens_out ?? 0),
      toolCalls: Number(r.toolCalls ?? r.tool_calls ?? 0),
      turns: Number(r.turns ?? 0),
      error: (r.error ?? null) as RunRecordView["error"],
    };
  });
}

function mapDreams(rows: unknown, limit?: number): DreamRecord[] {
  if (!Array.isArray(rows))
    throw new EngineDrift("dreams: expected array, got " + typeof rows);
  const mapped = (rows as Record<string, unknown>[]).map((d, i) => {
    const numId = Number(d.id);
    return {
      id: Number.isFinite(numId) && numId > 0 ? numId : i + 1,
      status: d.status as DreamRecord["status"],
      summary: String(d.summary ?? ""),
      at: String(d.at ?? ""),
      ...(d.rolledBackTo != null ? { rolledBackTo: Number(d.rolledBackTo) } : {}),
    };
  });
  return limit !== undefined ? mapped.slice(0, limit) : mapped;
}

function mapNotes(rows: unknown, limit?: number): NoteRecord[] {
  if (!Array.isArray(rows))
    throw new EngineDrift("notes: expected array, got " + typeof rows);
  const mapped = (rows as Record<string, unknown>[]).map((n, i) => {
    const numId = Number(n.id);
    return {
      id: Number.isFinite(numId) && numId > 0 ? numId : i + 1,
      text: String(n.text ?? ""),
      at: String(n.at ?? ""),
    };
  });
  return limit !== undefined ? mapped.slice(0, limit) : mapped;
}

export { EngineLocked, EngineDown, EngineDrift };
