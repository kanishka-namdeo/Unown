/**
 * job-editor.test.ts — the compose-draft validation + the five-kind
 * schedule mapping (Lane A, DOM-free).
 */
import { describe, test, expect } from "bun:test";
import {
  DEFAULT_DRAFT,
  validateDraft,
  draftToScheduleSpec,
  isFiveFieldCron,
  isValidInterval,
  isValidTimeZoneId,
  type JobEditorDraft,
} from "./job-editor.js";

function draft(over: Partial<JobEditorDraft> = {}): JobEditorDraft {
  return {
    ...DEFAULT_DRAFT,
    title: "t",
    prompt: "p",
    scheduleExpr: "1d",
    ...over,
  };
}

describe("draft validation", () => {
  test("an empty draft reports title + prompt errors", () => {
    const errs = validateDraft({ ...DEFAULT_DRAFT });
    expect(errs.title).toBeDefined();
    expect(errs.prompt).toBeDefined();
  });

  test("a fully valid every-draft has no errors", () => {
    const errs = validateDraft(draft());
    expect(Object.keys(errs)).toHaveLength(0);
  });

  test("cron must be five-field", () => {
    expect(isFiveFieldCron("0 9 * * 1-5")).toBe(true);
    expect(isFiveFieldCron("* * * *")).toBe(false);
    const errs = validateDraft(draft({ scheduleKind: "cron", scheduleExpr: "bad" }));
    expect(errs.scheduleExpr).toBeDefined();
  });

  test("interval grammar: N + unit in {m,h,d,w}", () => {
    expect(isValidInterval("2d")).toBe(true);
    expect(isValidInterval("30m")).toBe(true);
    expect(isValidInterval("2 days")).toBe(false);
    const errs = validateDraft(draft({ scheduleExpr: "xx" }));
    expect(errs.scheduleExpr).toBeDefined();
  });

  test("once delayMinutes range 1..525600", () => {
    const ok = validateDraft(draft({ scheduleKind: "once", scheduleMinutes: 5 }));
    expect(Object.keys(ok)).toHaveLength(0);
    const bad = validateDraft(draft({ scheduleKind: "once", scheduleMinutes: 0 }));
    expect(bad.scheduleMinutes).toBeDefined();
    const big = validateDraft(draft({ scheduleKind: "once", scheduleMinutes: 525601 }));
    expect(big.scheduleMinutes).toBeDefined();
  });

  test("event needs a name", () => {
    const bad = validateDraft(draft({ scheduleKind: "event", scheduleExpr: "" }));
    expect(bad.scheduleExpr).toBeDefined();
    const ok = validateDraft(draft({ scheduleKind: "event", scheduleExpr: "commit" }));
    expect(Object.keys(ok)).toHaveLength(0);
  });

  test("timezone is an IANA id", () => {
    expect(isValidTimeZoneId("America/New_York")).toBe(true);
    expect(isValidTimeZoneId("Not/A_Zone")).toBe(false);
    const errs = validateDraft(draft({ timezone: "Not/A_Zone" }));
    expect(errs.timezone).toBeDefined();
  });

  test("spend cap must be non-negative or off", () => {
    const bad = validateDraft(draft({ spendCap: -1 }));
    expect(bad.spendCap).toBeDefined();
    const off = validateDraft(draft({ spendCap: "off" }));
    expect(Object.keys(off)).toHaveLength(0);
  });
});

describe("draft -> domain ScheduleSpec (all five kinds)", () => {
  test("cron", () => {
    expect(draftToScheduleSpec(draft({ scheduleKind: "cron", scheduleExpr: "0 9 * * 1-5" })))
      .toEqual({ kind: "cron", expr: "0 9 * * 1-5" });
  });
  test("every", () => {
    expect(draftToScheduleSpec(draft())).toEqual({ kind: "every", spec: "1d" });
  });
  test("after", () => {
    expect(draftToScheduleSpec(draft({ scheduleKind: "after", scheduleExpr: "3h" })))
      .toEqual({ kind: "after", spec: "3h" });
  });
  test("once", () => {
    expect(draftToScheduleSpec(draft({ scheduleKind: "once", scheduleMinutes: 30 })))
      .toEqual({ kind: "once", delayMinutes: 30 });
  });
  test("event", () => {
    expect(draftToScheduleSpec(draft({ scheduleKind: "event", scheduleExpr: "commit" })))
      .toEqual({ kind: "event", name: "commit" });
  });
});
