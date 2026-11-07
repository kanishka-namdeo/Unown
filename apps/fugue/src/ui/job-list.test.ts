/**
 * job-list.test.ts — grouped view model + arrow-key navigation
 * (Lane A, DOM-free).
 */
import { describe, test, expect } from "bun:test";
import {
  jobListViewModel,
  renderJobList,
  moveSelection,
} from "./job-list.js";
import type { Job } from "../domain/types.js";
import type { AutomationRecord } from "../adapter/engine-adapter.js";

const auto: AutomationRecord = {
  id: 1,
  title: "Fixture daily",
  prompt: "p",
  schedule: { kind: "every", spec: "1d" },
  mode: "read-only",
  state: "active",
};
const auto2: AutomationRecord = {
  id: 2,
  title: "Fixture paused",
  prompt: "p",
  schedule: { kind: "cron", expr: "0 9 * * 1-5" },
  mode: "standard",
  state: "paused",
};

function job(id: number): Job {
  return {
    id,
    title: `Shadow ${id}`,
    prompt: "local",
    schedule: { kind: "once", delayMinutes: 1 },
    mode: "read-only",
    model: "",
    timezone: "",
    misfire: "skip",
    spendCap: "off",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("job list view model", () => {
  test("groups engine lane above shadow lane", () => {
    const vm = jobListViewModel({ automations: [auto, auto2], shadow: [job(9)], selected: 2 });
    expect(vm.groups.map((g) => g.lane)).toEqual(["engine", "shadow"]);
    expect(vm.totalRows).toBe(3);
    expect(vm.selectedIndex).toBe(1);
  });

  test("selected null -> no selection index", () => {
    const vm = jobListViewModel({ automations: [auto], shadow: [], selected: null });
    expect(vm.selectedIndex).toBe(-1);
  });

  test("render lists the rows with status + lane", () => {
    const html = renderJobList(null, { automations: [auto, auto2], shadow: [], selected: 1 });
    expect(html).toContain("Fixture daily");
    expect(html).toContain('data-state="paused"');
    expect(html).toContain('data-lane="engine"');
  });

  test("render of empty input -> no-jobs panel (O-1)", () => {
    const html = renderJobList(null, { automations: [], shadow: [], selected: null });
    expect(html).toContain('data-panel="no-jobs"');
  });

  test("moveSelection clamps at both ends", () => {
    expect(moveSelection(0, 3, -1)).toBe(0);
    expect(moveSelection(2, 3, 1)).toBe(2);
    expect(moveSelection(0, 3, 1)).toBe(1);
  });
});
