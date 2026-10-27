import { describe, expect, it } from "bun:test";
import { deserializeStore, serializeStore, DEFAULT_STORE } from "@/lib/sigil/persistence";
import type { AppStore } from "@/lib/sigil/types";

const sampleStore: AppStore = {
  version: 1,
  tasks: [
    {
      id: "a1",
      title: "Ship it",
      description: "details",
      priority: "high",
      labels: ["launch", "urgent"],
      storyPoints: 5,
      column: "doing",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      completedAt: null,
      focusSessions: [
        { id: "s1", startedAt: "2026-01-01T09:00:00.000Z", durationMin: 25, completed: true },
      ],
    },
  ],
  focusLog: [{ taskId: "a1", startedAt: "2026-01-01T09:00:00.000Z", durationMin: 25 }],
  timer: { focusMin: 25, breakMin: 5 },
  theme: "dark",
};

describe("persistence: serialize/deserialize round-trip", () => {
  it("round-trips a valid store losslessly", () => {
    const json = JSON.stringify(serializeStore(sampleStore));
    const back = deserializeStore(json);
    expect(back).toEqual(sampleStore);
  });

  it("returns defaults for malformed JSON", () => {
    const bad = deserializeStore("{not json!!");
    expect(bad.tasks).toEqual([]);
    expect(bad.theme).toBe("dark");
    expect(bad.timer).toEqual(DEFAULT_STORE.timer);
  });

  it("coerces invalid nested fields to safe defaults", () => {
    const json = JSON.stringify({
      version: 1,
      tasks: [
        { id: "x", title: "", column: "nope" }, // empty title -> dropped
        { id: "y", title: "Ok", priority: "bogus", storyPoints: 999 },
        "garbage",
      ],
      focusLog: [{ bogus: true }, { taskId: "y", startedAt: "2026-01-01T00:00:00.000Z", durationMin: 10 }],
      timer: { focusMin: -5, breakMin: 500 },
      theme: "purple",
    });
    const s = deserializeStore(json);
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].title).toBe("Ok");
    expect(s.tasks[0].priority).toBe("medium"); // coerced
    expect(s.tasks[0].storyPoints).toBe(64); // clamped
    expect(s.focusLog).toHaveLength(1);
    expect(s.focusLog[0].durationMin).toBe(10);
    expect(s.timer.focusMin).toBe(DEFAULT_STORE.timer.focusMin); // rejected -5
    expect(s.timer.breakMin).toBe(60); // clamped to max
    expect(s.theme).toBe("dark"); // rejected "purple"
  });

  it("serializes to a versioned persisted shape", () => {
    const out = serializeStore(sampleStore);
    expect(out.version).toBe(1);
    expect(out.tasks).toHaveLength(1);
    expect(out.theme).toBe("dark");
  });
});
