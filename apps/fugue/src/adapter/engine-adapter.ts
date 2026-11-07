/**
 * engine-adapter.ts — the Fugue EngineAdapter seam (PLAN §1/§3, F-2).
 *
 * `EngineAdapter` is the whole surface the Fugue UI needs to observe and
 * curate the engine's automation + learning loop: author jobs, control
 * their lifecycle, read run history, and see spend/dreams/notes/memory.
 *
 * Two implementors (the house seam pattern, cf. Chaconne's PageAdapter):
 *   - `FakeEngineAdapter` (fake-engine-adapter.ts) — in-memory canned
 *     state + injected clock; drives every typed error path
 *     deterministically with NO network.
 *   - the real HTTP adapter (F-3, runner edge) — talks to the engine
 *     REST surface and calls `assertContract` on every response.
 *
 * UI and domain depend on this INTERFACE, never on a transport
 * (PLAN §1 law: the browser closure is network-free).
 */

/* ------------------------------------------------------------------ */
/* The typed error taxonomy (PLAN §3 F-2; E-01 / E-02 pins)           */
/* ------------------------------------------------------------------ */

/** The closed error-kind set the taxonomy throws (each = one Error
 *  subclass, distinguished by the `kind` discriminator). */
export type EngineErrorKind = "engine-locked" | "engine-down" | "engine-drift";

/** Base class for every adapter-native error; `kind` is the
 *  discriminator callers switch on (never a string-peek on messages). */
export class EngineError extends Error {
  constructor(
    public readonly kind: EngineErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** E-01 — the engine's bearer token is missing or rotated: the app is
 *  "engine locked". The console surfaces an honest retry panel, never
 *  a blank. */
export class EngineLocked extends EngineError {
  constructor(message: string) {
    super("engine-locked", message);
    this.name = "EngineLocked";
  }
}

/** E-02 — a transport failure (engine down / unreachable). The console
 *  surfaces the outbox panel; a failed call NEVER reads as success. */
export class EngineDown extends EngineError {
  constructor(message: string) {
    super("engine-down", message);
    this.name = "EngineDown";
  }
}

/** Engine REST drift — a response that violates the contract pins in
 *  contract.ts. Drift is a ticket, never silent (the anti-rot law). */
export class EngineDrift extends EngineError {
  constructor(message: string) {
    super("engine-drift", message);
    this.name = "EngineDrift";
  }
}

/* ------------------------------------------------------------------ */
/* Adapter-native record types (engine-only shapes, plain JSON)       */
/* ------------------------------------------------------------------ */

import type { EngineStatusView, RunRecordView, ScheduleSpec } from "../domain/types.js";

/** The engine's automation row — adapter-native; typed engine fields.
 *  (F-3 maps engine REST JSON onto this before `assertContract`.) */
export interface AutomationRecord {
  id: number | string; // engine ids are strings ('auto-xxx'); fixture ids numeric.
  title: string;
  prompt: string;
  /** Engine-native schedule spec (five kinds, per domain ScheduleSpec). */
  schedule: ScheduleSpec;
  mode: "read-only" | "standard";
  model?: string;
  timezone?: string;
  /** Lifecycle: an engine automation is either live or paused. */
  state: "active" | "paused";
}

/** Input to create an automation — the console's authored fields;
 *  the engine fills the id and timestamps. */
export type CreateAutomationInput = Pick<
  AutomationRecord,
  "title" | "prompt" | "schedule" | "mode"
> &
  Partial<Pick<AutomationRecord, "model" | "timezone">>;

/** One consolidated dream record (F-7 chunk 2 renders the journal).
 *
 * The type carries the LIVE engine wire truth (the V-24 law — the F-2
 * seam types were hypotheses; the operator-probed GET /api/dreams body
 * is the governing shape, pi-repo .../dashboard-types.ts `Dream`):
 *   - `id` is a RAW STRING: "project-<uuid>" or a bare uuid, never a
 *     number (no Number() coercion — the raw-passthrough law).
 *   - `status` is the engine's closed DreamStatus vocabulary; a gated
 *     dream renders GATED (E-06), never a success badge.
 *   - `startedAt`/`endedAt` are epoch-ms numbers (a running dream has
 *     `endedAt === null` — it is still open, never a fake zero).
 *   - the consolidation ledger: `notesIn` in, `entriesMerged` merged,
 *     `entriesPruned` pruned, `entriesAdded` added; `output` is the
 *     rendered memory markdown the view previews (expandable).
 *
 * The fixture lane (F-2's canned rows) keeps its camelCase shape and
 * the pins in contract.ts accept BOTH forms — neither is deleted; the
 * mapper normalizes both onto this view. */
export type DreamStatus = "done" | "running" | "no-notes" | "error" | "gated";

export interface DreamRecord {
  id: string; // raw string id (uuid or "project-<uuid>"), uncoerced
  status: DreamStatus; // the engine's closed vocabulary, passed through honestly
  startedAt: number; // epoch ms
  endedAt: number | null; // epoch ms; null = still running (or open)
  notesIn: number;
  entriesMerged: number;
  entriesPruned: number;
  entriesAdded: number;
  output: string; // the rendered memory markdown ("" when the engine omits it)
}

/** One session note record. */
export interface NoteRecord {
  id: number;
  text: string;
  at: string; // ISO-8601 string
}

/** One memory tier (GET /api/memory `tiers[]` — the engine's
 *  MemoryTierInfo; the F-2 fixture's camelCase rows map onto the same
 *  view via mapMemory). */
export interface MemoryTier {
  tier: string; // "policy" | "project" | "user" | "local" | "project:<slug>"
  version: number;
  content: string; // the tier's markdown body
  chars: number;
  updatedAt: number | null; // epoch ms (null = never stamped)
}

/** The engine's tiered-memory health view (GET /api/memory/health —
 *  the `health` + `platform` objects flattened to the fields the view
 *  renders; the F-2 fixture lane keeps its { tiers, version, healthy }
 *  shape, admitted by the pin and mapped with honest defaults). */
export interface MemoryHealthView {
  memoryCount: number;
  duplicateCount: number;
  conflictCount: number;
  warnings: string[];
  lastReconcile: number; // epoch ms (0 = unknown / not reconciled)
  available: boolean;
  backend: string; // "lexical" | "embeddings" | … (the platform's lane)
  model: string; // the reconciler model ("" when the platform omits it)
  maxRendered: number; // the render cap (0 = the platform did not report one)
}

/** The engine's tiered-memory view (the live wire: the tiers array +
 *  the flattened health object). */
export interface MemoryView {
  tiers: MemoryTier[];
  health: MemoryHealthView;
}

/** The engine's spend-meter view (governor accounting, E-04's
 *  `budget-throttled` state is surfaced by `throttled`). */
export interface SpendReport {
  tokensIn: number;
  tokensOut: number;
  calls: number;
  windowStartedAt: string; // ISO-8601 — the current accounting window
  windowLimit: number; // calls; 0 = unlimited
  throttled: boolean; // the governor is currently throttling new jobs
}

/** History view for one automation: its runs, newest first. */
export type RunHistory = RunRecordView[];

/* ------------------------------------------------------------------ */
/* The EngineAdapter interface — the whole surface the UI consumes     */
/* ------------------------------------------------------------------ */

export interface EngineAdapter {
  /* — automation lifecycle — */
  listAutomations(): Promise<AutomationRecord[]>;
  createAutomation(input: CreateAutomationInput): Promise<AutomationRecord>;
  pauseAutomation(id: number | string): Promise<void>;
  resumeAutomation(id: number | string): Promise<void>;
  runNow(id: number | string): Promise<void>;
  skip(id: number | string): Promise<void>;
  snooze(id: number | string, minutes: number): Promise<void>;
  history(id: number | string, limit?: number): Promise<RunHistory>;

  /* — engine views — */
  overview(): Promise<EngineStatusView>;
  runs(limit?: number): Promise<RunRecordView[]>;
  dreams(limit?: number): Promise<DreamRecord[]>;
  notes(limit?: number): Promise<NoteRecord[]>;
  memories(): Promise<MemoryView>;
  spend(): Promise<SpendReport>;
}

