import { describe, expect, it } from "bun:test";
import { STARTER_TEMPLATES, getTemplate } from "@/lib/sigil/templates";
import { createTask, moveTask, normalizeTasks } from "@/lib/sigil/tasks";

describe("templates: starter library", () => {
  it("exposes a non-empty library with unique ids", () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template task draft has a non-empty title and valid column", () => {
    const validColumns = new Set(["backlog", "doing", "review", "done"]);
    for (const t of STARTER_TEMPLATES) {
      for (const draft of t.tasks) {
        expect(draft.title.trim().length).toBeGreaterThan(0);
        expect(validColumns.has(draft.column ?? "backlog")).toBe(true);
      }
    }
  });

  it("getTemplate returns the matching template or undefined", () => {
    expect(getTemplate("sprint")?.name).toBe("Two-week sprint");
    expect(getTemplate("nope")).toBeUndefined();
  });

  it("template tasks materialize into full Task objects via createTask", () => {
    const sprint = getTemplate("sprint");
    const [first] = (sprint?.tasks ?? []).map((d) => createTask(d, new Date("2026-01-01T00:00:00Z")));
    expect(first?.title).toBe("Ship login fix");
    expect(first?.priority).toBe("high");
    expect(first?.column).toBe("doing");
    expect(first?.storyPoints).toBe(5);
    expect(first?.completedAt).toBeNull();
  });
});

describe("tasks: createTask defaults", () => {
  it("applies safe defaults to a minimal draft", () => {
    const now = new Date("2026-02-01T08:00:00Z");
    const t = createTask({ title: "  Do thing  " }, now);
    expect(t.title).toBe("Do thing");
    expect(t.description).toBe("");
    expect(t.priority).toBe("medium");
    expect(t.labels).toEqual([]);
    expect(t.storyPoints).toBeNull();
    expect(t.column).toBe("backlog");
    expect(t.createdAt).toBe(now.toISOString());
    expect(t.completedAt).toBeNull();
  });

  it("sets completedAt when the draft lands directly in done", () => {
    const now = new Date("2026-02-01T08:00:00Z");
    const t = createTask({ title: "X", column: "done" }, now);
    expect(t.column).toBe("done");
    expect(t.completedAt).toBe(now.toISOString());
  });
});

describe("tasks: moveTask recompute", () => {
  it("clears completedAt when moved out of done", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const t = createTask({ title: "Y", column: "done" }, now);
    const back = moveTask(t, "doing", now);
    expect(back.column).toBe("doing");
    expect(back.completedAt).toBeNull();
    expect(back.updatedAt).toBe(now.toISOString());
  });

  it("normalizeTasks drops invalid rows and keeps valid ones", () => {
    const cleaned = normalizeTasks([
      { id: "ok", title: "Valid" },
      { id: "bad" },
      "junk",
      null,
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].id).toBe("ok");
  });
});
