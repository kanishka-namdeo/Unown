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

/** One consolidated dream record (F-7 renders the journal; E-06 pins
 *  the `gated` + rollback-pointer fields). */
export interface DreamRecord {
  id: number;
  status: "applied" | "gated" | "rolled-back";
  summary: string;
  rolledBackTo?: number; // dream id the rollback restored, when status is "rolled-back"
  at: string; // ISO-8601 string (the domain stores no Date objects)
}

/** One session note record. */
export interface NoteRecord {
  id: number;
  text: string;
  at: string; // ISO-8601 string
}

/** The engine's tiered-memory health view. */
export interface MemoryView {
  tiers: number; // how many memory tiers are present
  version: number; // the current memory version stamp
  healthy: boolean;
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

