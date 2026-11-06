/**
 * contract.test.ts — the F-2 contract-pin lane (PLAN §3/§6, co-located).
 *
 * Two halves:
 *   1. `assertContract` ACCEPTS every canned fixture (valid pinned shapes).
 *   2. `assertContract` REJECTS each mutated fixture with the right
 *      dotted-path `EngineDrift` message (the anti-rot law: a drift is a
 *      loud ticket, never a silent widening).
 */
import { test, expect } from "bun:test";
import {
  assertContract,
  CONTRACT_FIXTURES,
  assertAutomations,
  assertRuns,
  assertOverview,
  assertDreams,
  assertNotes,
  assertMemories,
  assertSpend,
} from "./contract.js";
import { EngineDrift } from "./engine-adapter.js";
import type {
  DreamRecord,
  NoteRecord,
  MemoryView,
  SpendReport,
} from "./engine-adapter.js";
import type { EngineStatusView, RunRecordView } from "../domain/types.js";

const FIX = CONTRACT_FIXTURES;

/* — 1. every valid fixture is accepted (the green pinned shape set) — */

test("assertContract accepts the automations fixture", () => {
  assertContract("automations", { automations: FIX.automations });
});
test("assertContract accepts the runs fixture", () => {
  assertContract("runs", { runs: FIX.runs });
});
test("assertContract accepts the overview fixture", () => {
  assertContract("overview", FIX.overview);
});
test("assertContract accepts the dreams fixture", () => {
  assertContract("dreams", { dreams: FIX.dreams });
});
test("assertContract accepts the notes fixture", () => {
  assertContract("notes", { notes: FIX.notes });
});
test("assertContract accepts the memories fixture", () => {
  assertContract("memories", FIX.memories);
});
test("assertContract accepts the spend fixture", () => {
  assertContract("spend", FIX.spend);
});

/* — 2. each mutated fixture is rejected with the dotted-path drift msg — */

function expectDrift(endpoint: Parameters<typeof assertContract>[0], payload: unknown, path: string) {
  let err: unknown;
  try {
    assertContract(endpoint, payload);
  } catch (e) {
    err = e;
  }
  expect(err, `${endpoint}: expected EngineDrift, none thrown`).toBeInstanceOf(EngineDrift);
  expect((err as EngineDrift).message.startsWith(path), `${endpoint}: drift message must start with "${path}"`).toBe(true);
}

test("a renamed run status enum is drift", () => {
  const runs = FIX.runs.map((r, i) =>
    i === 0 ? { ...r, status: "state" as unknown as RunRecordView["status"] } : r,
  );
  expectDrift("runs", { runs }, "status");
});
test("a missing run startedAt is drift", () => {
  const runs = FIX.runs.map((r, i) => {
    if (i !== 0) return r;
    const { startedAt, ...rest } = r;
    void startedAt;
    return rest as unknown as RunRecordView;
  });
  expectDrift("runs", { runs }, "startedAt");
});
test("an unknown schedule kind on an automation is drift", () => {
  const automations = FIX.automations.map((a, i) =>
    i === 0 ? { ...a, schedule: { kind: "fortnightly" } as unknown as typeof a.schedule } : a,
  );
  expectDrift("automations", { automations }, "automations[0].schedule.kind");
});
test("a missing automation state is drift", () => {
  const automations = FIX.automations.map((a, i) => {
    if (i !== 1) return a;
    const { state, ...rest } = a;
    void state;
    return rest as unknown as typeof a;
  });
  expectDrift("automations", { automations }, "automations[1].state");
});
test("an out-of-set dream status is drift", () => {
  const dreams = FIX.dreams.map((d, i) =>
    i === 0 ? { ...d, status: "pending" as unknown as DreamRecord["status"] } : d,
  );
  expectDrift("dreams", { dreams }, "dreams[0].status");
});
test("a missing note timestamp is drift", () => {
  const notes = FIX.notes.map((n, i) => {
    if (i !== 0) return n;
    const { at, ...rest } = n;
    void at;
    return rest as unknown as NoteRecord;
  });
  expectDrift("notes", { notes }, "notes[0].at");
});
test("a non-boolean memory health is drift", () => {
  const memories = { ...FIX.memories, healthy: "yes" as unknown as MemoryView["healthy"] };
  expectDrift("memories", memories, "healthy");
});
test("a missing spend window start is drift", () => {
  const { windowStartedAt, ...rest } = FIX.spend;
  void windowStartedAt;
  expectDrift("spend", rest as unknown as SpendReport, "windowStartedAt");
});
test("an out-of-set overview phase is drift", () => {
  const overview = { ...FIX.overview, phase: "cold" as unknown as EngineStatusView["phase"] };
  expectDrift("overview", overview, "phase");
});

/* — the per-endpoint assert fns throw the same drifts (the F-3 entrypoints) — */

test("assertAutomations rejects a missing title with the dotted path", () => {
  const automations = FIX.automations.map((a, i) => {
    if (i !== 0) return a;
    const { title, ...rest } = a;
    void title;
    return rest as unknown as typeof a;
  });
  let err: unknown;
  try {
    assertAutomations({ automations });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(EngineDrift);
  expect((err as EngineDrift).message).toBe("automations[0].title: missing required field");
});
test("assertRuns rejects a non-numeric tokensIn with the dotted path", () => {
  const runs = FIX.runs.map((r, i) =>
    i === 0 ? { ...r, tokensIn: "1200" as unknown as number } : r,
  );
  let err: unknown;
  try {
    assertRuns({ runs });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(EngineDrift);
  expect((err as EngineDrift).message).toBe("tokensIn: expected number, got string");
});
test("the other per-endpoint asserts accept their fixtures", () => {
  assertOverview(FIX.overview);
  assertDreams({ dreams: FIX.dreams });
  assertNotes({ notes: FIX.notes });
  assertMemories(FIX.memories);
  assertSpend(FIX.spend);
});
