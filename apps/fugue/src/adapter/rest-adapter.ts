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
  type MemoryTier,
  type MemoryHealthView,
  type SpendReport,
  type SkillRecord,
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

/** The engine's wire run record (snake_case, the pinned fields).
 *  The run view ids are STRINGS (the F-7 ruling) — the RAW string run
 *  id and RAW task reference flow through uncoerced. */
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

/** The engine's live wire dream row (GET /api/dreams, the operator's
 *  verbatim capture 2026-11-07 — pi-repo .../dashboard-types.ts
 *  `Dream`). snake_case, raw string ids, epoch ms, the closed
 *  DreamStatus vocabulary. */
export interface EngineDreamRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  status: string;
  notes_in: number;
  entries_merged: number;
  entries_pruned: number;
  entries_added: number;
  output: string | null;
}

/** The F-2 fixture's camelCase dream row (the pre-registered V-24
 *  hypothesis shape — kept in the pins; the mapper normalizes both
 *  forms onto the live DreamRecord). */
export interface FixtureDreamRow {
  id: number | string;
  status: string;
  summary: string;
  at: string; // ISO-8601 or epoch-string
  rolledBackTo?: number;
}

/** The engine's live wire memory tier (GET /api/memory `tiers[]`,
 *  the operator's verbatim capture 2026-11-07 — the brief's form:
 *  tier / version / content; the engine's MemoryTierInfo also carries
 *  chars + updatedAt, admitted when present). */
export interface EngineMemoryTierRow {
  tier: string;
  version: number;
  content: string;
  chars?: number;
  updatedAt?: number | null;
}

/** The engine's live wire memory health (GET /api/memory/health —
 *  the `health` + `platform` objects). */
export interface EngineMemoryHealthRow {
  health: {
    scope: string;
    lastReconcile: number;
    duplicateCount: number;
    conflictCount: number;
    warnings: string[];
    memoryCount: number;
  };
  platform: {
    available: boolean;
    backend: string;
    embedderRequested?: string;
    reconcile?: boolean;
    dir?: string;
    model?: string;
    collection?: string;
    maxRendered: number;
  };
}

/** The F-2 fixture's memories view ({ tiers: number, version, healthy })
 *  — the pre-registered V-24 hypothesis, kept in the pins. */
export interface FixtureMemoryRow {
  tiers: number;
  version: number;
  healthy: boolean;
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
    id: Number.isFinite(numId) && numId > 0 ? numId : (typeof r.id === "string" && r.id !== "" ? r.id : fallbackId),
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

  async pauseAutomation(id: number | string): Promise<void> {
    await this.lifecyclePatch(id, "paused");
  }

  async resumeAutomation(id: number | string): Promise<void> {
    await this.lifecyclePatch(id, "active");
  }

  async runNow(id: number | string): Promise<void> {
    await this.client.call("POST", `/api/automations/${id}/run`);
  }

  async skip(id: number | string): Promise<void> {
    await this.client.call("POST", `/api/automations/${id}/skip`);
  }

  async snooze(id: number | string, minutes: number): Promise<void> {
    await this.client.call("POST", `/api/automations/${id}/snooze`, { minutes });
  }

  async history(id: number | string, limit?: number): Promise<RunRecordView[]> {
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
    // Two calls, both asserted (the anti-rot law): /api/memory's tier
    // array + /api/memory/health's health/platform objects, merged by
    // mapMemory into the single MemoryView the views consume. A failed
    // health call degrades honestly: the tiers stay, health gets the
    // zeroed defaults (the view renders them, never a crash).
    const rawMemory = (await this.checked("memory", () =>
      this.client.call("GET", "/api/memory"),
    )) as { tiers?: unknown };
    let rawHealth: unknown;
    try {
      rawHealth = await this.checked("memory-health", () =>
        this.client.call("GET", "/api/memory/health"),
      );
    } catch {
      rawHealth = undefined;
    }
    return mapMemory(rawMemory?.tiers, rawHealth);
  }

  async spend(): Promise<SpendReport> {
    const raw = await this.checked("spend", () =>
      this.client.call("GET", "/api/automations/spend"),
    );
    return mapSpend(raw);
  }

  async skills(): Promise<SkillRecord[]> {
    const raw = (await this.checked("skills", () =>
      this.client.call("GET", "/api/skills"),
    )) as { skills: unknown };
    return mapSkills(raw.skills);
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
  private async lifecyclePatch(id: number | string, lifecycle: "active" | "paused"): Promise<void> {
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
    // The automation-run wire form (GET /api/automations/:id/runs) carries
    // automation_id + trigger_kind + string ids + automation statuses;
    // the generic lane carries task_id + numeric ids + generic statuses.
    // Both forms are normalized here at the adapter boundary (F-1 law).
    // The run view ids are STRINGS (the operator ruling, F-7): the RAW
    // string run id ('auto-xxx:manual:yyy' or a uuid) and the RAW task
    // reference flow through uncoerced — the groupRuns String-equality
    // join needs the raw values, never a Number() collapse.
    const rawTask = (r.automation_id ?? r.task_id ?? r.taskId ?? null) as
      | string
      | number
      | null;
    const rawId = (r.id ?? null) as string | number | null;
    const numTask = rawTask !== null ? Number(rawTask) : NaN;
    const taskId =
      rawTask !== null
        ? String(rawTask)
        : numTask > 0
          ? String(numTask)
          : "0";
    const runId =
      typeof rawId === "number" && Number.isFinite(rawId) && rawId > 0
        ? String(rawId)
        : typeof rawId === "string" && rawId !== ""
          ? rawId
          : String(i + 1);
    // status map: succeeded->ok, failed->failed, stopped->capped,
    // running->ok (the open-run label renders via the null endedAt below).
    const rawStatus = String(r.status ?? "ok");
    let status: string;
    switch (rawStatus) {
      case "succeeded":
      case "running":
      case "passed":
        status = "ok";
        break;
      case "stopped":
        status = "capped";
        break;
      default:
        status = rawStatus;
        break;
    }
    // A running automation-run has no ended_at (the '…' duration label).
    let endedAt = (r.endedAt ?? r.ended_at ?? null) as RunRecordView["endedAt"];
    if (rawStatus === "running") endedAt = null;
    // trigger_kind -> kind (fallback to the generic r.kind ?? "manual").
    const kind =
      typeof r.trigger_kind === "string" && r.trigger_kind !== ""
        ? r.trigger_kind
        : String(r.kind ?? "manual");
    return {
      id: runId,
      taskId,
      kind,
      status: status as RunRecordView["status"],
      startedAt: String(toEpochMs(r.startedAt ?? r.started_at)),
      endedAt,
      tokensIn: Number(r.tokensIn ?? r.tokens_in ?? 0),
      tokensOut: Number(r.tokensOut ?? r.tokens_out ?? 0),
      toolCalls: Number(r.toolCalls ?? r.tool_calls ?? 0),
      turns: Number(r.turns ?? 0),
      error: (r.error ?? null) as RunRecordView["error"],
    };
  });
}


/** Epoch-ms normalization: a finite number stays; an ISO-8601 string
 *  parses to its epoch; a bare numeric string coerces; missing -> 0. */
export function toEpochMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
    return Number(v) || 0;
  }
  return 0;
}

export { EngineLocked, EngineDown, EngineDrift };

function num(obj: unknown, key: string): number {
  const v = (obj as Record<string, unknown>)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/* — the dreams + memory mappers (the F-7 chunk 2 dual-form bridge) — */

const DREAM_STATUSES: readonly string[] = ["done", "running", "no-notes", "error", "gated"];

/** One wire dream row (LIVE snake_case form OR F-2 camelCase fixture
 *  form) -> the adapter-native DreamRecord. The mapper passes the
 *  RAW string id through uncoerced (a fixture's numeric id stringifies
 *  — the raw-passthrough law); status is validated against the closed
 *  DreamStatus vocabulary; a fixture-form `summary` rides into `output`
 *  when no `output` field exists, so the journal's preview stays honest.
 *  Timestamps normalize to epoch ms (the toEpochMs law). */
export function mapDream(d: Record<string, unknown>, i: number): DreamRecord {
  const rawId = d.id;
  const id =
    typeof rawId === "string" && rawId !== ""
      ? rawId
      : typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : String(i + 1);
  const rawStatus = String(d.status ?? "error");
  // Live wire: closed vocabulary. Fixture lane: the pre-registered
  // hypothesis statuses map onto the live spelling honestly —
  // applied -> done (the success badge), rolled-back -> error,
  // everything else (gated / running / no-notes) passes through as-is
  // (E-06: gated NEVER becomes done).
  const status =
    DREAM_STATUSES.includes(rawStatus)
      ? (rawStatus as DreamRecord["status"])
      : rawStatus === "applied"
        ? "done"
        : rawStatus === "rolled-back"
          ? "error"
          : "error";
  // Timestamps: the live wire carries snake_case epoch-ms pairs (the
  // running dream's ended_at is null — an open run, never a fake 0).
  // The fixture lane carries a single camelCase `at` (ISO or epoch
  // string) — it becomes both start and end.
  let startedAt: number;
  let endedAt: number | null;
  if ("started_at" in d) {
    startedAt = toEpochMs(d.started_at);
    endedAt = d.ended_at == null ? null : toEpochMs(d.ended_at);
  } else {
    const at = toEpochMs(d.at);
    startedAt = at;
    endedAt = at > 0 ? at : null;
  }
  // The consolidation ledger: live fields when present; the fixture's
  // ledger-less rows stay honest zeros (no invented numbers).
  const ledger = (
    v: unknown,
    fallback = 0,
  ) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  // The output: live `output` (markdown, null -> ""); the fixture's
  // `summary` rides in as the preview text.
  const output =
    typeof d.output === "string"
      ? d.output
      : typeof d.summary === "string"
        ? d.summary
        : "";
  return {
    id,
    status,
    startedAt,
    endedAt,
    notesIn: ledger(d.notes_in),
    entriesMerged: ledger(d.entries_merged),
    entriesPruned: ledger(d.entries_pruned),
    entriesAdded: ledger(d.entries_added),
    output,
  };
}

/** Rows (LIVE form OR F-2 fixture form, mixed) -> DreamRecord[],
 *  newest first (the journal's ordering). `limit` trims AFTER the
 *  sort, the way the engine's own lane would page. */
export function mapDreams(rows: unknown, limit?: number): DreamRecord[] {
  if (!Array.isArray(rows))
    throw new EngineDrift("dreams: expected array, got " + typeof rows);
  const mapped = (rows as Record<string, unknown>[]).map((d, i) => mapDream(d, i));
  mapped.sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
  return limit !== undefined ? mapped.slice(0, limit) : mapped;
}

/** The zeroed health defaults (the honest-degradation lane: a failed
 *  /api/memory/health call degrades to these — the view renders them,
 *  a missing health object NEVER reads as a healthy one). */
const EMPTY_MEMORY_HEALTH: MemoryHealthView = {
  memoryCount: 0,
  duplicateCount: 0,
  conflictCount: 0,
  warnings: [],
  lastReconcile: 0,
  available: false,
  backend: "",
  model: "",
  maxRendered: 0,
};

/** Merge /api/memory (the tiers array — live OR F-2 fixture form) and
 *  /api/memory/health (the health + platform objects) into the single
 *  MemoryView the views consume. Fixture-lane rows ({ tiers: number,
 *  version, healthy }) map to an honest empty tier list + the degraded
 *  health defaults (no invented tiers, no fake counts). */
export function mapMemory(rawTiers: unknown, rawHealth?: unknown): MemoryView {
  // — the tiers lane —
  let tiers: MemoryTier[] = [];
  if (Array.isArray(rawTiers)) {
    tiers = (rawTiers as Record<string, unknown>[]).map((t) => ({
      tier: String(t.tier ?? ""),
      version: typeof t.version === "number" ? t.version : 0,
      content: typeof t.content === "string" ? t.content : "",
      chars: typeof t.chars === "number" ? t.chars : 0,
      updatedAt: t.updatedAt == null ? null : toEpochMs(t.updatedAt),
    }));
  } else if (rawTiers !== null && typeof rawTiers === "object") {
    // The F-2 fixture lane: { tiers: 4, version: 3, healthy: true } —
    // the V-24 hypothesis shape. Honest mapping: zero tiers (the
    // fixture carries no tier content), the version stamp rides into
    // lastReconcile = 0 (no reconcile is known); no invented tiers.
    tiers = [];
  }
  // — the health lane —
  let health = { ...EMPTY_MEMORY_HEALTH };
  const h = (rawHealth ?? {}) as Record<string, unknown>;
  const healthObj = h.health;
  const platformObj = h.platform;
  if (healthObj !== null && typeof healthObj === "object") {
    const w = (healthObj as Record<string, unknown>).warnings;
    health = {
      ...health,
      memoryCount: num(healthObj, "memoryCount"),
      duplicateCount: num(healthObj, "duplicateCount"),
      conflictCount: num(healthObj, "conflictCount"),
      lastReconcile: toEpochMs((healthObj as Record<string, unknown>).lastReconcile),
      warnings: Array.isArray(w) ? w.filter((x): x is string => typeof x === "string") : [],
    };
  }
  if (platformObj !== null && typeof platformObj === "object") {
    const p = platformObj as Record<string, unknown>;
    health = {
      ...health,
      available: p.available === true,
      backend: typeof p.backend === "string" ? p.backend : "",
      model: typeof p.model === "string" ? p.model : "",
      maxRendered: num(p, "maxRendered"),
    };
  }
  return { tiers, health };
}


function mapNotes(rows: unknown, limit?: number): NoteRecord[] {
  if (!Array.isArray(rows))
    throw new EngineDrift("notes: expected array, got " + typeof rows);
  // Dual-lane + raw-passthrough (the H-24 catch, 2026-11-07): the live
  // wire's uuid string ids pass through UNCOERCED (the old Number()
  // coercion silently replaced every uuid with a row index — V-24
  // fiction #1); the content lane bridges text (fixture) / content
  // (live); the timestamp lane bridges at (fixture) / created_at (live).
  const mapped = (rows as Record<string, unknown>[]).map((n): NoteRecord => {
    const rawId = n.id;
    const id: number | string =
      typeof rawId === "string" || typeof rawId === "number" ? rawId : "";
    const text = typeof n.text === "string" ? n.text : typeof n.content === "string" ? n.content : "";
    const atRaw = n.at ?? n.created_at;
    const at =
      typeof atRaw === "string" ? atRaw : typeof atRaw === "number" ? new Date(atRaw).toISOString() : "";
    return { id, text, at };
  });
  return limit !== undefined ? mapped.slice(0, limit) : mapped;
}

/** The live-wire spend body ({ now, routines, total }) mapped into the
 * SpendReport view (the H-24 catch, 2026-11-07 — the pin used to reject
 * this shape and safeSpend() masked the drift, leaving the spend panel
 * silently dead against the real engine). The six legacy fields carry
 * the honest mapped values; the `live` block carries the native windows
 * for the meter's live rendering. The fixture lane passes through
 * unchanged (the six canned fields verbatim). */
export function mapSpend(body: unknown): SpendReport {
  const b = body as Record<string, unknown>;
  if (b && typeof b === "object" && b.total !== undefined) {
    const total = b.total as {
      day: { tokens: number; runs: number; turns: number };
      week: { tokens: number; runs: number; turns: number };
      cap: number;
      throttledNow: boolean;
      drainAt?: number | null;
    };
    const routines = (Array.isArray(b.routines) ? b.routines : []) as Array<Record<string, unknown>>;
    return {
      // The honest mapping: the day window's runs against the cap (both
      // sides use "0 = unlimited"); the token total is the day window's
      // combined count (the live wire has no in/out split).
      tokensIn: total.day.tokens,
      tokensOut: 0,
      calls: total.day.runs,
      windowStartedAt: "",
      windowLimit: total.cap,
      throttled: total.throttledNow,
      live: {
        now: typeof b.now === "number" ? b.now : 0,
        day: total.day,
        week: total.week,
        cap: total.cap,
        throttledNow: total.throttledNow,
        drainAt: total.drainAt ?? null,
        routines: routines.map((r) => ({
          id: (typeof r.id === "string" || typeof r.id === "number" ? r.id : "") as number | string,
          title: typeof r.title === "string" ? r.title : "",
          day: (r.day ?? { tokens: 0, runs: 0, turns: 0 }) as { tokens: number; runs: number; turns: number },
          week: (r.week ?? { tokens: 0, runs: 0, turns: 0 }) as { tokens: number; runs: number; turns: number },
          throttled: r.throttled === true,
        })),
      },
    };
  }
  // The fixture lane — the six canned fields verbatim (assertSpend
  // already pinned them before this mapper runs).
  return body as SpendReport;
}

/** Rows (LIVE snake_case SkillRow form OR camelCase fixture form,
 *  mixed) -> SkillRecord[]. The RAW string id passes through
 *  uncoerced; the optional slug/timestamp fields are honest
 *  defaults ("" / 0) when the engine omits them — a fresh engine
 *  home's {"skills":[]} answers as an honest empty array. */
export function mapSkills(rows: unknown): SkillRecord[] {
  if (!Array.isArray(rows))
    throw new EngineDrift("skills: expected array, got " + typeof rows);
  return (rows as Record<string, unknown>[]).map((r, i) => {
    const rawId = r.id;
    const id =
      typeof rawId === "string" && rawId !== ""
        ? rawId
        : typeof rawId === "number" && Number.isFinite(rawId)
          ? String(rawId)
          : String(i + 1);
    const slug =
      typeof r.project_slug === "string"
        ? r.project_slug
        : typeof r.projectSlug === "string"
          ? r.projectSlug
          : "";
    return {
      id,
      projectSlug: slug,
      createdAt: toEpochMs(r.created_at ?? r.createdAt),
      updatedAt: toEpochMs(r.updated_at ?? r.updatedAt),
    };
  });
}
