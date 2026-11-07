/**
 * fake-engine-adapter.ts — FakeEngineAdapter (PLAN §3 F-2; the unit
 * lane's deterministic double, cf. Chaconne's FakePageAdapter).
 *
 * Seeded from the contract fixtures; every method resolves from
 * in-memory canned state with NO network and NO timers. Two knobs make
 * the typed error paths scriptable:
 *
 * - `setNextResponse(endpoint, payload | null)` — script the next
 *   response for one endpoint (a `null` clears it; the canned state
 *   answers after that). Drives EngineDrift deterministically: script a
 *   MUTATED fixture, call the method, expect the typed drift error.
 * - `failWith(kind, message?)` — force the NEXT call to reject with
 *   the matching taxonomy class (EngineLocked / EngineDown /
 *   EngineDrift). Clears after one call.
 *
 * The clock is INJECTED (`now()`); the adapter never reads
 * `Date.now` / `new Date()` itself (the Fugue law), and a call
 * that stamps timestamps (createAutomation's `updatedAt`) reads the
 * injected clock.
 */

import {
  type EngineAdapter,
  type AutomationRecord,
  type CreateAutomationInput,
  type DreamRecord,
  type NoteRecord,
  type MemoryView,
  type SpendReport,
  type SkillRecord,
} from "./engine-adapter.js";
import {
  EngineLocked,
  EngineDown,
  EngineDrift,
  type EngineErrorKind,
} from "./engine-adapter.js";
import {
  assertContract,
  type ContractEndpoint,
  CONTRACT_FIXTURES,
  DREAMS_LIVE_FIXTURE,
  MEMORY_LIVE_FIXTURE,
  MEMORY_HEALTH_LIVE_FIXTURE,
} from "./contract.js";
import { mapDreams, mapMemory } from "./rest-adapter.js";
import type { EngineStatusView, RunRecordView } from "../domain/types.js";
import { DomainInvariantError } from "../domain/types.js";

/** The scriptable error the fake can force on the next call. */
interface ForcedError {
  kind: EngineErrorKind;
  message: string;
}

export type FakeClock = () => number;

/** A default deterministic clock: starts at the fixture epoch and only
 *  moves when `advance` is called. No real timers, no Date.now. */
export function makeFakeClock(startMs: number): {
  now: FakeClock;
  advance: (ms: number) => void;
} {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** ISO-8601 from epoch ms (the fake stamps created records; the clock
 *  is injected, so this is deterministic per test). */
export class FakeEngineAdapter implements EngineAdapter {
  private automations: AutomationRecord[];
  private runsState: RunRecordView[];
  private dreamsState: DreamRecord[];
  private notesState: NoteRecord[];
  private memoriesState: MemoryView;
  private spendState: SpendReport;
  /** The engine's skills table — a FRESH engine home has zero DB
   *  skills (the honest empty state, operator-captured 2026-11-07).
   *  Seeded rows are admitted through the seed knob; the default
   *  lane is the honest empty. */
  private skillsState: SkillRecord[];
  private nextAutomationId = 3;
  private nextRunId = 13; // the fixture lane's decimal string ids
  /** The canned engine overview (mutated via setOverview). */
  private overviewState: EngineStatusView;

  /** Swap the canned engine overview (overview() reads it). */
  setOverview(o: EngineStatusView): void {
    this.overviewState = o;
  }

  /** Scripted per-endpoint response; consumed on the next matching
   *  call. `null` clears a scripted response. */
  private scripted: Partial<Record<ContractEndpoint, unknown | null>> = {};
  /** The forced next error (cleared after one call). */
  private forced: ForcedError | null = null;

  constructor(
    private readonly clock: FakeClock,
    seed?: {
      automations?: AutomationRecord[];
      runs?: RunRecordView[];
      dreams?: DreamRecord[];
      notes?: NoteRecord[];
      memories?: MemoryView;
      spend?: SpendReport;
      overview?: EngineStatusView;
      skills?: SkillRecord[];
    },
  ) {
    this.automations = structuredClone(
      (seed?.automations ?? CONTRACT_FIXTURES.automations) as unknown as AutomationRecord[],
    );
    this.runsState = structuredClone(
      (seed?.runs ?? CONTRACT_FIXTURES.runs) as unknown as RunRecordView[],
    );
    // The canned lane serves BOTH wire forms (the V-24 law): the live
    // rows (done + gated + running, snake_case) through the dual-form
    // mapper, plus the F-2 fixture's camelCase rows — the dreams()
    // answer carries the live forms first (the journal's ordering),
    // the fixture forms after (neither lane deleted).
    this.dreamsState = structuredClone([
      ...mapDreams((DREAMS_LIVE_FIXTURE as unknown as { dreams: Record<string, unknown>[] }).dreams),
      ...mapDreams(CONTRACT_FIXTURES.dreams as unknown as Record<string, unknown>[]),
    ]);
    if (seed?.dreams) this.dreamsState = structuredClone(seed.dreams);
    this.notesState = structuredClone(
      (seed?.notes ?? CONTRACT_FIXTURES.notes) as unknown as NoteRecord[],
    );
    // The memories canned state: the live tiers + health (mapped), with
    // the F-2 fixture's numbers folded in honestly (the fixture's
    // `version` stamp rides into lastReconcile via mapMemory's
    // degraded lane only when no health object is present).
    const liveMemory = mapMemory(
      (MEMORY_LIVE_FIXTURE as unknown as { tiers: Record<string, unknown>[] }).tiers,
      MEMORY_HEALTH_LIVE_FIXTURE as unknown,
    );
    const fixMemory = seed?.memories ?? (CONTRACT_FIXTURES.memories as unknown as MemoryView);
    this.memoriesState =
      "tiers" in (fixMemory as object) && Array.isArray((fixMemory as MemoryView).tiers)
        ? fixMemory
        : liveMemory;
    this.spendState = { ...(seed?.spend ?? CONTRACT_FIXTURES.spend) };
    this.overviewState = { ...(seed?.overview ?? CONTRACT_FIXTURES.overview) };
    // The honest empty engine skills table (a fresh engine home has
    // zero DB skills — never a seeded fake row, the V-41 law).
    this.skillsState = structuredClone(seed?.skills ?? []);
  }

  /* — scriptable knobs (test hooks) — */

  /** Script the next response for `endpoint`. `payload` is validated
   *  against the endpoint's contract BEFORE it is stored — a script that
   *  itself is malformed throws immediately (the fake never serves
   *  its own drift). Pass `null` to clear the scripted response. */
  setNextResponse(endpoint: ContractEndpoint, payload: unknown | null): void {
    if (payload !== null) assertContract(endpoint, payload);
    this.scripted[endpoint] = payload;
  }

  /** Force the next call to reject with the given taxonomy class.
   *  Clears after one call; subsequent calls return to canned state. */
  failWith(kind: EngineErrorKind, message?: string): void {
    const msg =
      message ??
      ({
        "engine-locked": "EngineLocked: token missing or rotated",
        "engine-down": "EngineDown: engine transport unreachable",
        "engine-drift": "EngineDrift: response violates a contract pin",
      } satisfies Record<EngineErrorKind, string>)[kind];
    this.forced = { kind, message: msg };
  }

  /* — EngineAdapter: engine views — */

  /** Resolve the next call's payload for `endpoint`: the forced error
   *  (if any), then a scripted response, then the canned state. */
  private nextPayload(endpoint: ContractEndpoint): unknown {
    if (this.forced) {
      const f = this.forced;
      this.forced = null;
      const ctor =
        f.kind === "engine-locked"
          ? EngineLocked
          : f.kind === "engine-down"
            ? EngineDown
            : EngineDrift;
      throw new ctor(f.message);
    }
    const s = this.scripted[endpoint];
    if (s !== undefined) {
      const out = s;
      this.scripted[endpoint] = undefined; // one-shot script
      if (out !== null) {
        // A scripted payload is asserted against the contract (the fake
        // refuses to serve drift it scripted — the F-3 anti-rot law,
        // mirrored in the unit lane).
        assertContract(endpoint, out);
        return out;
      }
      return undefined; // cleared: fall through to canned
    }
    return undefined;
  }

  /* — EngineAdapter: automation lifecycle — */

  async listAutomations(): Promise<AutomationRecord[]> {
    const p = this.nextPayload("automations");
    if (p !== undefined) {
      const rows = (p as { automations: AutomationRecord[] }).automations;
      return rows;
    }
    return this.automations;
  }

  async createAutomation(input: CreateAutomationInput): Promise<AutomationRecord> {
    this.nextPayload("automations"); // honor a forced error, if any
    const rec: AutomationRecord = {
      id: this.nextAutomationId++,
      title: input.title,
      prompt: input.prompt,
      schedule: input.schedule,
      mode: input.mode,
      model: input.model,
      timezone: input.timezone,
      state: "active",
    };
    this.automations.push(rec);
    return rec;
  }

  async pauseAutomation(id: number | string): Promise<void> {
    this.requireAutomation(id);
    this.setState(id, "paused");
  }

  async resumeAutomation(id: number | string): Promise<void> {
    this.requireAutomation(id);
    this.setState(id, "active");
  }

  async runNow(id: number | string): Promise<void> {
    this.requireAutomation(id);
    // The fake records a synthetic run (E-12's accounting honesty: the
    // numbers come from the fake's own state, never invented live).
    const owner = this.automations.find((a) => String(a.id) === String(id));
    this.runsState.unshift({
      // The run view ids are STRINGS (the F-7 ruling): the fixture lane
      // keeps its decimal string ids; the owner join is a String-equality.
      id: String(this.nextRunId++),
      taskId: owner ? String(owner.id) : "0",
      kind: this.automations.find((a) => String(a.id) === String(id))?.schedule.kind ?? "cron",
      status: "ok" as const,
      startedAt: this.clock(),
      endedAt: this.clock(),
      tokensIn: 100,
      tokensOut: 25,
      toolCalls: 1,
      turns: 1,
      error: null,
    });
  }

  async skip(id: number | string): Promise<void> {
    this.requireAutomation(id);
  }

  async snooze(id: number | string, minutes: number): Promise<void> {
    this.requireAutomation(id);
    if (minutes < 1) {
      throw new DomainInvariantError(`snooze: minutes must be >= 1 (got ${minutes})`);
    }
  }

  async history(id: number | string, limit?: number): Promise<RunRecordView[]> {
    this.requireAutomation(id);
    const rows = this.runsState
      .filter((r) => String(r.taskId ?? "0") === String(id))
      .sort((a, b) =>
        Number(a.id) - Number(b.id) ||
        (Number.isNaN(Number(a.id)) && !Number.isNaN(Number(b.id)) ? 1 : -1),
      );
    return limit !== undefined ? rows.slice(0, limit) : rows;
  }

  /* — EngineAdapter: engine views — */

  async overview(): Promise<EngineStatusView> {
    const p = this.nextPayload("overview");
    if (p !== undefined) return p as EngineStatusView;
    return this.overviewState;
  }

  async runs(limit?: number): Promise<RunRecordView[]> {
    const p = this.nextPayload("runs");
    if (p !== undefined) {
      const rows = (p as { runs: RunRecordView[] }).runs;
      return limit !== undefined ? rows.slice(0, limit) : rows;
    }
    return limit !== undefined ? this.runsState.slice(0, limit) : this.runsState;
  }

  async dreams(limit?: number): Promise<DreamRecord[]> {
    const p = this.nextPayload("dreams");
    if (p !== undefined) {
      const rows = (p as { dreams: DreamRecord[] }).dreams;
      return limit !== undefined ? rows.slice(0, limit) : rows;
    }
    return limit !== undefined ? this.dreamsState.slice(0, limit) : this.dreamsState;
  }

  async notes(limit?: number): Promise<NoteRecord[]> {
    const p = this.nextPayload("notes");
    if (p !== undefined) {
      const rows = (p as { notes: NoteRecord[] }).notes;
      return limit !== undefined ? rows.slice(0, limit) : rows;
    }
    return limit !== undefined ? this.notesState.slice(0, limit) : this.notesState;
  }

  async memories(): Promise<MemoryView> {
    const p = this.nextPayload("memories");
    if (p !== undefined) return p as MemoryView;
    return this.memoriesState;
  }

  async spend(): Promise<SpendReport> {
    const p = this.nextPayload("spend");
    if (p !== undefined) return p as SpendReport;
    return this.spendState;
  }

  async skills(): Promise<SkillRecord[]> {
    const p = this.nextPayload("skills");
    if (p !== undefined) {
      const rows = (p as { skills: SkillRecord[] }).skills;
      return rows;
    }
    return this.skillsState;
  }

  /* — internals — */

  private requireAutomation(id: number | string): void {
    this.nextPayload("automations"); // honor a forced error, if any
    if (!this.automations.some((a) => String(a.id) === String(id))) {
      throw new DomainInvariantError(
        `automation ${id}: unknown automation id (the engine owns the id space)`,
      );
    }
  }

  private setState(id: number | string, state: "active" | "paused"): void {
    const a = this.automations.find((x) => String(x.id) === String(id));
    if (a) a.state = state;
  }
}
