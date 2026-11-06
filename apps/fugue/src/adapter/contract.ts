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
      id: 11,
      taskId: 1,
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
      id: 12,
      taskId: 2,
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

type Fixtures = typeof CONTRACT_FIXTURES;

export const RUN_FIXTURE: RunRecordView[] = CONTRACT_FIXTURES.runs as unknown as RunRecordView[];
export const OVERVIEW_FIXTURE: EngineStatusView = CONTRACT_FIXTURES.overview;
export const DREAM_FIXTURE: DreamRecord[] = CONTRACT_FIXTURES.dreams;
export const NOTE_FIXTURE: NoteRecord[] = CONTRACT_FIXTURES.notes;
export const MEMORIES_FIXTURE: MemoryView = CONTRACT_FIXTURES.memories;
export const SPEND_FIXTURE: SpendReport = CONTRACT_FIXTURES.spend;

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
    | "string-or-null"
    | "number-or-null",
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
  pin(payload, `${p}.id`, "number", "automation id");
  pin(payload, `${p}.title`, "string");
  pin(payload, `${p}.prompt`, "string");
  pin(payload, `${p}.schedule`, "object");
  pinEnum(payload, `${p}.schedule.kind`, ["cron", "every", "after", "once", "event"]);
  pinEnum(payload, `${p}.mode`, ["read-only", "standard"]);
  pin(payload, `${p}.state`, "string");
  pinEnum(payload, `${p}.state`, ["active", "paused"]);
  // Optional fields, pinned only when present (the engine may omit them).
  const row = dig(payload, p);
  if (row != null && typeof row === "object" && !Array.isArray(row)) {
    const r = row as Record<string, unknown>;
    for (const f of ["model", "timezone", "rolledBackTo"] as const) {
      if (f in r) pin(payload, `${p}.${f}`, "string");
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
  pin(payload, "automation.id", "number");
  pin(payload, "automation.title", "string");
  pin(payload, "automation.prompt", "string");
  pin(payload, "automation.schedule", "object");
  pinEnum(payload, "automation.schedule.kind", ["cron", "every", "after", "once", "event"]);
  pinEnum(payload, "automation.mode", ["read-only", "standard"]);
  pin(payload, "automation.state", "string");
  pinEnum(payload, "automation.state", ["active", "paused"]);
  // Optional fields pinned when present.
  if ("model" in r) pin(payload, "automation.model", "string");
  if ("timezone" in r) pin(payload, "automation.timezone", "string");
  if ("lifecycle" in r) pin(payload, "automation.lifecycle", "string");
  if ("created_at" in r) pin(payload, "automation.created_at", "number-or-null");
  if ("updated_at" in r) pin(payload, "automation.updated_at", "number-or-null");
}

export function assertRunRecord(payload: unknown): void {
  pin(payload, "id", "number");
  pin(payload, "taskId", "number");
  pin(payload, "kind", "string");
  pin(payload, "status", "string");
  pinEnum(payload, "status", RUN_STATUSES);
  pin(payload, "startedAt", "string");
  pin(payload, "tokensIn", "number");
  pin(payload, "tokensOut", "number");
  pin(payload, "toolCalls", "number");
  pin(payload, "turns", "number");
  pin(payload, "error", "string-or-null");
  if (dig(payload, "endedAt") !== undefined) pin(payload, "endedAt", "string-or-null");
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

export function assertDreams(payload: unknown): void {
  pin(payload, "dreams", "array");
  const arr = (payload as { dreams: unknown[] }).dreams;
  for (let i = 0; i < arr.length; i++) {
    const p = `dreams[${i}]`;
    pin(payload, `${p}.id`, "number");
    pin(payload, `${p}.status`, "string");
    pinEnum(payload, `${p}.status`, ["applied", "gated", "rolled-back"]);
    pin(payload, `${p}.summary`, "string");
    pin(payload, `${p}.at`, "string");
    if (dig(payload, `${p}.rolledBackTo`) !== undefined)
      pin(payload, `${p}.rolledBackTo`, "number");
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

export function assertMemories(payload: unknown): void {
  pin(payload, "tiers", "number");
  pin(payload, "version", "number");
  pin(payload, "healthy", "boolean");
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
  | "spend";

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
    default:
      // Unreachable: `endpoint` is the closed ContractEndpoint set.
      throw new EngineDrift(`assertContract: unknown endpoint ${String(endpoint)}`);
  }
}
