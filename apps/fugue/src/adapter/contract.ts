/**
 * contract.ts — the Fugue response-shape pins (PLAN §3 F-2; F-3's
 * fixture-server + real adapter both call `assertContract`).
 *
 * The law: every engine REST response is asserted against its pinned
 * shape BEFORE the UI sees it. A drift (a field renamed, dropped, or
 * re-typed on the engine side) throws `EngineDrift` with a DOTTED-PATH
 * message (the F-1 `invariants.ts` style: `automations[0].schedule.kind: …`).
 * Drift is a ticket, never silent — the anti-rot law.
 *
 * `CONTRACT_FIXTURES` is the canned valid sample per endpoint; both the
 * fake adapter and F-3's fixture server seed from it, so a green
 * fixture test set is also the green pinned shape set.
 */

import { RUN_STATUSES } from "../domain/types.js";
import type {
  EngineStatusView,
  RunRecordView,
} from "../domain/types.js";
import {
  EngineDrift,
  type DreamRecord,
  type NoteRecord,
  type MemoryView,
  type MemoryTier,
  type MemoryHealthView,
  type SpendReport,
} from "./engine-adapter.js";

/* ------------------------------------------------------------------ */
/* Canned valid fixtures (the pinned response shapes, one per endpoint) */
/* ------------------------------------------------------------------ */

export const CONTRACT_FIXTURES = {
  automations: [
    {
      id: 1,
      title: "Weekly memory consolidation",
      prompt: "Consolidate this week's session notes into project memory.",
      schedule: { kind: "cron", expr: "0 9 * * 1" },
      mode: "read-only" as const,
      model: "agnes-3.0-flash",
      timezone: "America/New_York",
      state: "active" as const,
    },
    {
      id: 2,
      title: "Nightly benchmark sweep",
      prompt: "Run the receipted benchmark sweep and file a summary note.",
      schedule: { kind: "every", spec: "1d" },
      mode: "standard" as const,
      model: "agnes-2.5-flash",
      state: "paused" as const,
    },
  ],
  runs: [
    {
      id: "11",
      taskId: "1",
      kind: "cron",
      status: "ok" as const,
      startedAt: "2026-11-07T09:00:00Z",
      endedAt: "2026-11-07T09:04:32Z",
      tokensIn: 1200,
      tokensOut: 340,
      toolCalls: 4,
      turns: 5,
      error: null,
    },
    {
      id: "12",
      taskId: "2",
      kind: "every",
      status: "failed" as const,
      startedAt: "2026-11-08T00:00:00Z",
      endedAt: "2026-11-08T00:01:05Z",
      tokensIn: 800,
      tokensOut: 0,
      toolCalls: 1,
      turns: 2,
      error: "upstream 429: rate limit exceeded",
    },
  ],
  overview: {
    phase: "ready" as const,
    pid: 8974,
    version: "engine.v1",
    memoryVersion: 3,
    dreams: 2,
  },
  dreams: [
    {
      id: 1,
      status: "applied" as const,
      summary: "Consolidated 3 session notes into project memory.",
      at: "2026-11-05T02:00:00Z",
    },
    {
      id: 2,
      status: "gated" as const,
      summary: "Gated: proposed edit to instruction set (deny-queue).",
      at: "2026-11-07T02:00:00Z",
    },
  ],
  notes: [
    { id: 1, text: "Pinned the no-phantom-drift invariant.", at: "2026-11-06T12:00:00Z" },
    { id: 2, text: "Fixed the engine drain-budget flake.", at: "2026-11-06T18:30:00Z" },
  ],
  memories: {
    tiers: 4,
    version: 3,
    healthy: true,
  },
  spend: {
    tokensIn: 52_000,
    tokensOut: 14_500,
    calls: 41,
    windowStartedAt: "2026-11-06T00:00:00Z",
    windowLimit: 0,
    throttled: false,
  },
};

/* ------------------------------------------------------------------ */
/* The LIVE wire fixtures (operator captures, 2026-11-07)            */
/* ------------------------------------------------------------------ */

/** GET /api/dreams — the live row shape (snake_case, raw string ids,
 *  epoch ms, the engine's DreamStatus vocabulary): a done row, a
 *  gated row (E-06: never a success badge), and a running row
 *  (ended_at null — an open run, never a fake 0). */
export const DREAMS_LIVE_FIXTURE = {
  dreams: [
    {
      id: "project-85ebe9ad-36eb-48e2-ac09-369231b6caea",
      started_at: 1794063969594,
      ended_at: 1794064145248,
      status: "done",
      notes_in: 3,
      entries_merged: 0,
      entries_pruned: 2,
      entries_added: 3,
      output: "# Project Memory\n\n## Known pitfalls\n- ...",
    },
    {
      id: "8f2b1c0e-1234-4abc-9def-85ebe9ad0002",
      started_at: 1794063000000,
      ended_at: 1794063000000,
      status: "gated",
      notes_in: 1,
      entries_merged: 0,
      entries_pruned: 0,
      entries_added: 0,
      output: "Gated: proposed edit to instruction set (deny-queue).",
    },
    {
      id: "c0ffee00-0000-4abc-9def-85ebe9ad0003",
      started_at: 1794064500000,
      ended_at: null,
      status: "running",
      notes_in: 2,
      entries_merged: 0,
      entries_pruned: 0,
      entries_added: 0,
      output: null,
    },
  ],
};

/** GET /api/memory — the live tiers array (one object per tier:
 *  tier name string, version integer, content markdown). */
export const MEMORY_LIVE_FIXTURE = {
  tiers: [
    {
      tier: "policy",
      version: 1,
      content: "# Tier 0 — Policy (non-negotiable guardrails)\n\n- Never delete...",
    },
  ],
};

/** GET /api/memory/health — the live health + platform objects. */
export const MEMORY_HEALTH_LIVE_FIXTURE = {
  health: {
    scope: "unown-engine",
    lastReconcile: 1794064205283,
    duplicateCount: 0,
    conflictCount: 0,
    warnings: [],
    memoryCount: 5,
  },
  platform: {
    available: true,
    backend: "lexical",
    embedderRequested: "auto",
    reconcile: true,
    dir: "/home/z/.unown",
    model: "agnes-3.0-flash",
    collection: "unown",
    maxRendered: 110,
  },
};

/** GET /api/memory/projects — the live terminal project tiers. */
export const MEMORY_PROJECTS_LIVE_FIXTURE = {
  projects: [
    {
      slug: "agent-service-c5ccfe",
      tier: "project:agent-service-c5ccfe",
      version: 1,
      chars: 1663,
      updatedAt: 1794064205286,
    },
  ],
};

type Fixtures = typeof CONTRACT_FIXTURES;

export const RUN_FIXTURE: RunRecordView[] = CONTRACT_FIXTURES.runs as unknown as RunRecordView[];
export const OVERVIEW_FIXTURE: EngineStatusView = CONTRACT_FIXTURES.overview;
export const DREAM_FIXTURE: DreamRecord[] = CONTRACT_FIXTURES.dreams;
export const NOTE_FIXTURE: NoteRecord[] = CONTRACT_FIXTURES.notes;
export const MEMORIES_FIXTURE: MemoryView = CONTRACT_FIXTURES.memories;
export const SPEND_FIXTURE: SpendReport = CONTRACT_FIXTURES.spend;
export const DREAMS_LIVE_FIXTURE_ROWS: Record<string, unknown>[] =
  DREAMS_LIVE_FIXTURE.dreams as unknown as Record<string, unknown>[];
export const MEMORY_LIVE_FIXTURE_TIERS: Record<string, unknown>[] =
  MEMORY_LIVE_FIXTURE.tiers as unknown as Record<string, unknown>[];

/* ------------------------------------------------------------------ */
/* The per-endpoint shape pins (dotted-path drift messages)           */
/* ------------------------------------------------------------------ */

/** Read one nested field by a dotted path ("automations[0].title").
 *  Returns undefined when a segment is missing — the caller turns that
 *  into the right dotted-path EngineDrift. */
function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    const arr = seg.match(/^(\w+)\[(\d+)\]$/);
    if (arr) {
      const key = arr[1];
      const idx = Number(arr[2]);
      const container = (cur as Record<string, unknown>)[key];
      cur = Array.isArray(container) ? container[idx] : undefined;
    } else if (/^\d+$/.test(seg)) {
      cur = Array.isArray(cur) ? cur[Number(seg)] : undefined;
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Require a field to be present with the given shape; throw
 *  EngineDrift with the dotted-path message otherwise. */
function pin(
  payload: unknown,
  path: string,
  kind:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "object-or-string"
    | "string-or-null"
    | "number-or-null"
    | "number-or-string",
  label?: string,
): void {
  const v = dig(payload, path);
  if (v === undefined) {
    throw new EngineDrift(
      `${path}: missing required field${label ? ` (${label})` : ""}`,
    );
  }
  switch (kind) {
    case "string":
      if (typeof v !== "string")
        throw new EngineDrift(`${path}: expected string, got ${typeOf(v)}`);
      break;
    case "number-or-string":
      // Engine automation ids are strings ('auto-xxx'); the fixture lane
      // keeps numeric ids. Both wire forms are legal; anything else is
      // drift. (F-6 cycle-5: the id-model cure's contract side.)
      if (
        (typeof v !== "number" || !Number.isFinite(v)) &&
        typeof v !== "string"
      )
        throw new EngineDrift(`${path}: expected number or string, got ${typeOf(v)}`);
      break;
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v))
        throw new EngineDrift(`${path}: expected number, got ${typeOf(v)}`);
      break;
    case "boolean":
      if (typeof v !== "boolean")
        throw new EngineDrift(`${path}: expected boolean, got ${typeOf(v)}`);
      break;
    case "object":
      if (v === null || typeof v !== "object" || Array.isArray(v))
        throw new EngineDrift(`${path}: expected object, got ${typeOf(v)}`);
      break;
    case "object-or-string":
      // A schedule descriptor: an object (the domain form { kind, ... })
      // OR a string (the engine's describeRoutineSchedule lane, e.g.
      // "every 1 day"). Both wire forms are legal; the kind enum is
      // pinned only for the object form (drift stays drift).
      if (v !== null && typeof v !== "object" && typeof v !== "string")
        throw new EngineDrift(`${path}: expected object or string, got ${typeOf(v)}`);
      break;
    case "array":
      if (!Array.isArray(v))
        throw new EngineDrift(`${path}: expected array, got ${typeOf(v)}`);
      break;
    case "string-or-null":
      if (v !== null && typeof v !== "string")
        throw new EngineDrift(`${path}: expected string or null, got ${typeOf(v)}`);
      break;
    case "number-or-null":
      if (v !== null && typeof v !== "number")
        throw new EngineDrift(`${path}: expected number or null, got ${typeOf(v)}`);
      break;
  }
}

/** Pin the closed enum on a dotted-path field (the F-1 invariants
 *  style: a value outside the closed set is drift, never a fallback). */
function pinEnum(payload: unknown, path: string, values: readonly string[]): void {
  const v = dig(payload, path);
  if (typeof v !== "string" || !values.includes(v)) {
    throw new EngineDrift(
      `${path}: must be one of [${values.join("|")}] (got ${JSON.stringify(v)})`,
    );
  }
}

/** Pin one AutomationRecord (used per-row in the automations endpoint). */
function pinAutomation(payload: unknown, base: string, i: number): void {
  const p = `${base}[${i}]`;
  pin(payload, `${p}.id`, "number-or-string", "automation id");
  pin(payload, `${p}.title`, "string");
  pin(payload, `${p}.prompt`, "string");
  pin(payload, `${p}.schedule`, "object-or-string");
  const schedList = dig(payload, `${p}.schedule`);
  if (schedList !== null && typeof schedList === "object" && !Array.isArray(schedList)) {
    pinEnum(payload, `${p}.schedule.kind`, ["cron", "every", "after", "once", "event"]);
  }
  pinEnum(payload, `${p}.mode`, ["read-only", "standard"]);
  // State lane: the engine-native wire carries "lifecycle" instead of a
  // camelCase "state" (exactly one required); the pin accepts either.
  const row = dig(payload, p);
  if (row != null && typeof row === "object" && !Array.isArray(row)) {
    const r = row as Record<string, unknown>;
    if ("state" in r || "lifecycle" in r) {
      const stateLane = ("state" in r ? r.state : r.lifecycle) as unknown;
      if (typeof stateLane !== "string" || !["active", "paused"].includes(stateLane)) {
        throw new EngineDrift(
          `${p} state lane: expected string active|paused, got ${JSON.stringify(stateLane)}`,
        );
      }
    } else {
      throw new EngineDrift(`${p}.state: missing required field (neither state nor lifecycle)`);
    }
    // Optional fields, pinned only when present (the engine may omit them).
    // The engine-native wire sends null for optional fields — string-or-null.
    for (const f of ["model", "timezone", "rolledBackTo"] as const) {
      if (f in r) pin(payload, `${p}.${f}`, "string-or-null");
    }
    if ("spendCap" in r) pin(payload, `${p}.spendCap`, "number");
    if ("nextRunAt" in r) pin(payload, `${p}.nextRunAt`, "string-or-null");
  }
}

export function assertAutomations(payload: unknown): void {
  pin(payload, "automations", "array");
  for (let i = 0; i < (payload as { automations: unknown[] }).automations.length; i++) {
    pinAutomation(payload, "automations", i);
  }
}

/** Pin a single automation row — used by POST /api/automations (create,
 *  returns `{ automation }`) and PATCH /api/automations/:id (lifecycle,
 *  returns `{ automation }`). The row may be a camelCase domain row or an
 *  engine-native snake_case row; required fields are pinned, snake_case
 *  wire fields are optional-pinned when present. */
export function assertSingleAutomation(payload: unknown): void {
  pin(payload, "automation", "object");
  const row = dig(payload, "automation") as Record<string, unknown>;
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) r[k] = v;
  pin(payload, "automation.id", "number-or-string", "automation id");
  pin(payload, "automation.title", "string");
  pin(payload, "automation.prompt", "string");
  // The schedule field: the fixture lane sends a camelCase domain object
  // ({ kind, ... }); the engine-native wire may carry it as a STRING
  // descriptor (describeRoutineSchedule, e.g. "every 1 day"). Both
  // forms are legal; anything else is drift.
  pin(payload, "automation.schedule", "object-or-string");
  const sched = dig(payload, "automation.schedule");
  if (sched !== null && typeof sched === "object" && !Array.isArray(sched)) {
    pinEnum(payload, "automation.schedule.kind", ["cron", "every", "after", "once", "event"]);
  }
  pinEnum(payload, "automation.mode", ["read-only", "standard"]);
  // State lane: the engine-native snake_case shape carries "lifecycle" instead
  // of a camelCase "state" (the wire drift the fixture masked). Exactly one
  // is required; the pin accepts either (an active|paused string).
  if ("state" in r || "lifecycle" in r) {
    const stateLane = ("state" in r ? r.state : r.lifecycle) as unknown;
    if (typeof stateLane !== "string" || !["active", "paused"].includes(stateLane)) {
      throw new EngineDrift(
        `automation state lane: expected string active|paused, got ${JSON.stringify(stateLane)}`,
      );
    }
  } else {
    throw new EngineDrift(`automation.state: missing required field (neither state nor lifecycle)`);
  }
  // Optional fields pinned when present. The engine-native wire sends null
  // for optional fields (model, timezone); the fixture lane omits them.
  // Both wire forms are legal — string-or-null.
  if ("model" in r) pin(payload, "automation.model", "string-or-null");
  if ("timezone" in r) pin(payload, "automation.timezone", "string-or-null");
  if ("lifecycle" in r) pin(payload, "automation.lifecycle", "string");
  if ("created_at" in r) pin(payload, "automation.created_at", "number-or-null");
  if ("updated_at" in r) pin(payload, "automation.updated_at", "number-or-null");
}

export function assertRunRecord(payload: unknown): void {
  // Task reference: the generic runs lane carries task_id/taskId; the
  // automation-run wire form (GET /api/automations/:id/runs) carries
  // automation_id. All three are legal; exactly one required.
  const rec = payload as Record<string, unknown>;
  const taskRef = "taskId" in rec ? rec.taskId
    : "task_id" in rec ? rec.task_id
    : "automation_id" in rec ? rec.automation_id
    : undefined;
  if (taskRef === undefined) {
    throw new EngineDrift(
      `run task reference: missing required field (neither taskId, task_id, nor automation_id)`,
    );
  }
  // id: the generic lane carries numeric ids; the automation-run wire form
  // carries string ids ("auto-xxx:manual:yyy"). Both are legal.
  pinNumOrString(payload, "id");
  // startedAt / started_at: epoch ms (number) OR ISO-8601 (string) — both
  // wire forms are legal, in either camelCase or snake_case spelling.
  // The adapter's toEpochMs normalizes.
  if ("startedAt" in rec) {
    pinNumOrString(payload, "startedAt");
  } else if ("started_at" in rec) {
    // The snake_case lane carries the run's start in `started_at` — but
    // the fixture's generic lane always carries `startedAt`. For the
    // generic wire form, the camelCase field is REQUIRED; the automation-run
    // wire form (the live lane) carries `started_at` exclusively. Honor
    // the per-row contract: if the row has `started_at` but NOT `startedAt`,
    // pin `started_at`; otherwise `startedAt` is required (a generic-form
    // row missing `startedAt` is drift — the F-2 pin).
    pinNumOrString(payload, "started_at");
  } else {
    throw new EngineDrift(
      `startedAt: missing required field (neither startedAt nor started_at)`,
    );
  }
  // Kind lane: the generic lane carries `kind`; the automation-scoped
  // lane (GET /api/automations/:id/runs) carries `trigger_kind` and no
  // `kind` at all (the operator-witnessed wire, live 2026-11-07). Either
  // field satisfies the lane — the taskRef either-form pattern; at
  // least one is required, the present one is pinned.
  if ("kind" in rec) {
    pin(payload, "kind", "string-or-null");
  } else if ("trigger_kind" in rec) {
    pin(payload, "trigger_kind", "string");
  } else {
    throw new EngineDrift(
      `run kind lane: missing required field (neither kind nor trigger_kind)`,
    );
  }
  // status: the automation-run wire form (succeeded/failed/running/stopped)
  // plus the generic fixture statuses; 'passed' is the learning loop's
  // success spelling on the global /api/runs lane (the live fix-fizzbuzz
  // row carries it, 2026-11-07) and maps to 'ok' in mapRuns. Anything
  // else is drift.
  pin(payload, "status", "string");
  const statusLane = rec.status;
  const autoStatuses = ["succeeded", "failed", "running", "stopped", "passed"];
  if (!RUN_STATUSES.includes(statusLane as RunRecordView["status"]) &&
      !autoStatuses.includes(statusLane as string)) {
    throw new EngineDrift(
      `status: must be one of [${[...RUN_STATUSES, ...autoStatuses].join("|")}] (got ${JSON.stringify(statusLane)})`,
    );
  }
  // Tokens lane: the generic lane carries camelCase tokensIn/tokensOut;
  // the automation-scoped lane carries snake_case tokens_in/tokens_out
  // (the operator-witnessed wire, live 2026-11-07). Either form is
  // legal — require at least one of each, pin the present one.
  if ("tokensIn" in rec) {
    pin(payload, "tokensIn", "number");
  } else if ("tokens_in" in rec) {
    pin(payload, "tokens_in", "number");
  } else {
    throw new EngineDrift(
      `run tokensIn: missing required field (neither tokensIn nor tokens_in)`,
    );
  }
  if ("tokensOut" in rec) {
    pin(payload, "tokensOut", "number");
  } else if ("tokens_out" in rec) {
    pin(payload, "tokens_out", "number");
  } else {
    throw new EngineDrift(
      `run tokensOut: missing required field (neither tokensOut nor tokens_out)`,
    );
  }
  // toolCalls: optional in BOTH lane forms (the automation-scoped wire
  // omits it — the operator-witnessed row has no tool_calls). Pin only
  // when present; the generic-lane F-2 fixture keeps its numeric pin.
  if ("toolCalls" in rec) pin(payload, "toolCalls", "number");
  if ("tool_calls" in rec) pin(payload, "tool_calls", "number");
  // turns + error: required in both lane forms (the operator-witnessed
  // row carries both).
  pin(payload, "turns", "number");
  pin(payload, "error", "string-or-null");
  if (dig(payload, "endedAt") !== undefined) pin(payload, "endedAt", "string-or-null");
  // ended_at: the automation-scoped lane's ended timestamp (epoch ms or
  // null); optional-pin when present.
  if (dig(payload, "ended_at") !== undefined) {
    const ev = dig(payload, "ended_at");
    if (ev !== null) pinNumOrString(payload, "ended_at");
  }
}

/** A "number-or-string" helper for run records (a finite number OR a
 *  string is legal; anything else is drift). The id/scheduling fields of
 *  the automation-run wire form carry string values the generic lane
 *  omits; the fixture lane's numeric values keep working. */
function pinNumOrString(payload: unknown, path: string): void {
  const v = dig(payload, path);
  if (v === undefined) {
    throw new EngineDrift(`${path}: missing required field`);
  }
  if (typeof v === "number" && Number.isFinite(v)) return;
  if (typeof v === "string") return;
  throw new EngineDrift(`${path}: expected number or string, got ${JSON.stringify(v)}`);
}

export function assertRuns(payload: unknown): void {
  pin(payload, "runs", "array");
  const arr = (payload as { runs: unknown[] }).runs;
  for (const r of arr) assertRunRecord(r);
}

export function assertOverview(payload: unknown): void {
  pin(payload, "phase", "string");
  pinEnum(payload, "phase", ["warming", "ready", "draining"]);
  if (dig(payload, "pid") !== undefined) pin(payload, "pid", "number-or-null");
  if (dig(payload, "version") !== undefined) pin(payload, "version", "string");
  if (dig(payload, "memoryVersion") !== undefined) pin(payload, "memoryVersion", "number");
  if (dig(payload, "dreams") !== undefined) pin(payload, "dreams", "number");
}

/** The dual-lane dream rows (F-7 chunk 2, the V-24 law): the LIVE
 *  wire form (snake_case — started_at/ended_at epoch or null,
 *  notes_in + the consolidation ledger, output) and the F-2 fixture
 *  form (camelCase — a single `at`, `summary`, numeric ids). A row
 *  must carry AT LEAST one timestamp lane (started_at OR at);
 *  status is pinned to the closed DreamStatus vocabulary PLUS the
 *  fixture lane's hypothesis spellings (applied/rolled-back — the
 *  V-24 pre-registered class), nothing else. */
const DREAM_LIVE_STATUSES = ["done", "running", "no-notes", "error", "gated"];
const DREAM_FIXTURE_STATUSES = ["applied", "rolled-back"];

export function assertDreams(payload: unknown): void {
  pin(payload, "dreams", "array");
  const arr = (payload as { dreams: unknown[] }).dreams;
  for (let i = 0; i < arr.length; i++) {
    const p = `dreams[${i}]`;
    pin(payload, `${p}.id`, "number-or-string", "dream id (raw string uuid / project-<uuid> live, numeric fixture)");
    pin(payload, `${p}.status`, "string");
    pinEnum(payload, `${p}.status`, [...DREAM_LIVE_STATUSES, ...DREAM_FIXTURE_STATUSES]);
    const row = dig(payload, p) as Record<string, unknown> | undefined;
    if (row != null && typeof row === "object" && !Array.isArray(row)) {
      // Timestamp lane: the live row carries started_at; the fixture
      // row carries `at`. Exactly one lane required (the pinTs law:
      // epoch numbers and ISO strings both accepted).
      if ("started_at" in row) {
        pin(payload, `${p}.started_at`, "number-or-string");
        if ("ended_at" in row) {
          const ev = dig(payload, `${p}.ended_at`);
          // A running dream's ended_at is null (an open run — never a fake 0).
          if (ev !== null) pin(payload, `${p}.ended_at`, "number-or-string");
        }
      } else if ("at" in row) {
        pin(payload, `${p}.at`, "string");
        if ("rolledBackTo" in row) pin(payload, `${p}.rolledBackTo`, "number");
      } else {
        throw new EngineDrift(
          `${p} timestamp lane: missing required field (neither started_at nor at)`,
        );
      }
      // The consolidation ledger: live fields, optional-pinned when
      // present (the fixture lane omits them — honest zeros at the mapper).
      for (const f of ["notes_in", "entries_merged", "entries_pruned", "entries_added"] as const) {
        if (f in row) pin(payload, `${p}.${f}`, "number");
      }
      // Output lane: the live `output` (markdown, null when open) or
      // the fixture's `summary` (the preview text). Either when present.
      if ("output" in row) {
        const ov = dig(payload, `${p}.output`);
        if (ov !== null) pin(payload, `${p}.output`, "string");
      }
      if ("summary" in row) pin(payload, `${p}.summary`, "string");
    }
  }
}

export function assertNotes(payload: unknown): void {
  pin(payload, "notes", "array");
  const arr = (payload as { notes: unknown[] }).notes;
  for (let i = 0; i < arr.length; i++) {
    const p = `notes[${i}]`;
    pin(payload, `${p}.id`, "number");
    pin(payload, `${p}.text`, "string");
    pin(payload, `${p}.at`, "string");
  }
}

/** GET /api/memory — the DUAL-LANE pin (the V-24 law): the LIVE wire
 *  form ({ tiers: [{ tier, version, content, chars?, updatedAt? }] })
 *  and the F-2 fixture form ({ tiers: number, version, number, healthy
 *  boolean }). A body with a tier-list object lane where the tier rows
 *  are objects is drift, and a body with a numeric `tiers` is the
 *  fixture lane — both accepted, nothing else. */
export function assertMemories(payload: unknown): void {
  const t = dig(payload, "tiers");
  if (Array.isArray(t)) {
    // The live wire lane: the tiers array (one object per tier).
    for (let i = 0; i < t.length; i++) {
      const p = `tiers[${i}]`;
      pin(payload, `${p}.tier`, "string");
      pin(payload, `${p}.version`, "number");
      pin(payload, `${p}.content`, "string");
      // The engine's MemoryTierInfo also carries chars + updatedAt —
      // optional-pinned when present (the brief's minimal row omits
      // both; a row that sends a bad type is still drift).
      if (dig(payload, `${p}.chars`) !== undefined) pin(payload, `${p}.chars`, "number");
      if (dig(payload, `${p}.updatedAt`) !== undefined) {
        const ev = dig(payload, `${p}.updatedAt`);
        if (ev !== null) pin(payload, `${p}.updatedAt`, "number-or-string");
      }
    }
  } else if (typeof t === "number") {
    // The F-2 fixture lane (the pre-registered V-24 hypothesis shape).
    pin(payload, "tiers", "number");
    pin(payload, "version", "number");
    pin(payload, "healthy", "boolean");
  } else {
    throw new EngineDrift(`tiers: expected array (live lane) or number (fixture lane), got ${typeOf(t)}`);
  }
}

/** GET /api/memory/health — the live health + platform objects (the
 *  brief's verbatim capture). */
export function assertMemoryHealth(payload: unknown): void {
  const h = dig(payload, "health");
  if (h !== null && typeof h === "object" && !Array.isArray(h)) {
    pin(payload, "health.memoryCount", "number");
    pin(payload, "health.duplicateCount", "number");
    pin(payload, "health.conflictCount", "number");
    pin(payload, "health.lastReconcile", "number-or-string");
    pin(payload, "health.warnings", "array");
    for (let i = 0; i < (dig(payload, "health.warnings") as unknown[]).length; i++) {
      pin(payload, `health.warnings[${i}]`, "string");
    }
    if (dig(payload, "health.scope") !== undefined) pin(payload, "health.scope", "string");
  }
  const p = dig(payload, "platform");
  if (p !== null && typeof p === "object" && !Array.isArray(p)) {
    pin(payload, "platform.available", "boolean");
    pin(payload, "platform.backend", "string");
    pin(payload, "platform.maxRendered", "number");
    if (dig(payload, "platform.model") !== undefined) pin(payload, "platform.model", "string");
  }
  if (h === undefined && p === undefined) {
    throw new EngineDrift("health+platform: missing required fields (neither health nor platform)");
  }
}

/** GET /api/memory/projects — the live terminal project tiers
 *  (the brief's verbatim capture). */
export function assertMemoryProjects(payload: unknown): void {
  pin(payload, "projects", "array");
  const arr = (payload as { projects: unknown[] }).projects;
  for (let i = 0; i < arr.length; i++) {
    const p = `projects[${i}]`;
    pin(payload, `${p}.slug`, "string");
    pin(payload, `${p}.tier`, "string");
    pin(payload, `${p}.version`, "number");
    pin(payload, `${p}.chars`, "number");
    if (dig(payload, `${p}.updatedAt`) !== undefined) {
      const ev = dig(payload, `${p}.updatedAt`);
      if (ev !== null) pin(payload, `${p}.updatedAt`, "number-or-string");
    }
  }
}

export function assertSpend(payload: unknown): void {
  pin(payload, "tokensIn", "number");
  pin(payload, "tokensOut", "number");
  pin(payload, "calls", "number");
  pin(payload, "windowStartedAt", "string");
  pin(payload, "windowLimit", "number");
  pin(payload, "throttled", "boolean");
}

export type ContractEndpoint =
  | "automations"
  | "single-automation"
  | "runs"
  | "overview"
  | "dreams"
  | "notes"
  | "memories"
  | "spend"
  | "memory"
  | "memory-health"
  | "memory-projects";

/**
 * The single entrypoint F-3's real adapter calls on every response.
 * `endpoint` names which pinned shape to assert; `payload` is the raw
 * JSON body (or an enveloped body like { automations: [...] }).
 * Throws EngineDrift with a dotted-path message on the FIRST breach.
 */
export function assertContract(endpoint: ContractEndpoint, payload: unknown): void {
  switch (endpoint) {
    case "automations":
      assertAutomations(payload);
      return;
    case "single-automation":
      assertSingleAutomation(payload);
      return;
    case "runs":
      assertRuns(payload);
      return;
    case "overview":
      assertOverview(payload);
      return;
    case "dreams":
      assertDreams(payload);
      return;
      case "notes":
      assertNotes(payload);
      return;
    case "memories":
      assertMemories(payload);
      return;
    case "spend":
      assertSpend(payload);
      return;
    case "memory":
      assertMemories(payload);
      return;
    case "memory-health":
      assertMemoryHealth(payload);
      return;
    case "memory-projects":
      assertMemoryProjects(payload);
      return;
    default:
      // Unreachable: `endpoint` is the closed ContractEndpoint set.
      throw new EngineDrift(`assertContract: unknown endpoint ${String(endpoint)}`);
  }
}
