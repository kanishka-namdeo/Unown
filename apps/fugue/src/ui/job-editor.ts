/**
 * job-editor.ts — the compose dialog (ostinato dialog contract:
 * focus trap, Esc restores focus to the invoker, Enter submits, aria
 * attributes, inline validation errors).
 *
 * Every field of the F-4 brief: prompt, schedule (all five F-1
 * ScheduleSpec kinds), mode, model, timezone, misfire policy, spend
 * cap. Validation is inline: each invalid field shows its own error
 * message; the submit button is disabled until the draft is valid.
 *
 * DOM-free validation + draft shape; the DOM wiring (open / close /
 * key handling / focus trap) lives in app.ts.
 */
import type { ScheduleSpec } from "../domain/types.js";

/** The draft shape for the compose dialog (one field per input). */
export interface JobEditorDraft {
  title: string;
  prompt: string;
  /** The schedule-kind select (the five closed kinds, SCHEDULE_KINDS). */
  scheduleKind: "cron" | "every" | "after" | "once" | "event";
  /** The kind-specific value: cron expr / every+after spec / event name.
   *  For `once` the delay minutes live in `scheduleMinutes`. */
  scheduleExpr: string;
  /** The `once`-kind delay minutes (1..525600, the engine's ruling). */
  scheduleMinutes: number;
  model: string;
  timezone: string;
  mode: "read-only" | "standard";
  misfire: "skip" | "catch-up";
  spendCap: number | "off";
}

export const DEFAULT_DRAFT: JobEditorDraft = {
  title: "",
  prompt: "",
  scheduleKind: "every",
  scheduleExpr: "1d",
  scheduleMinutes: 5,
  model: "",
  timezone: "",
  mode: "read-only",
  misfire: "skip",
  spendCap: "off",
};

/** Inline validation: returns the per-field error map (empty = valid).
 *  Pure; no DOM. */
export function validateDraft(d: JobEditorDraft): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!d.title.trim()) errs.title = "Title is required.";
  if (!d.prompt.trim()) errs.prompt = "Prompt is required.";

  switch (d.scheduleKind) {
    case "cron":
      if (!isFiveFieldCron(d.scheduleExpr)) errs.scheduleExpr = "Cron must be a 5-field expression (min hour dom mon dow).";
      break;
    case "every":
      if (!isValidInterval(d.scheduleExpr)) errs.scheduleExpr = "Interval must look like `2d`, `6h`, `30m`, or `1w`.";
      break;
    case "after":
      if (!isValidInterval(d.scheduleExpr)) errs.scheduleExpr = "Completion-anchored interval, same grammar as `every`.";
      break;
    case "once":
      if (!Number.isInteger(d.scheduleMinutes) || d.scheduleMinutes < 1 || d.scheduleMinutes > 525600) {
        errs.scheduleMinutes = "delayMinutes must be an integer in 1..525600.";
      }
      break;
    case "event":
      if (!d.scheduleExpr.trim()) errs.scheduleExpr = "Event name is required.";
      break;
  }
  if (d.timezone && !isValidTimeZoneId(d.timezone)) {
    errs.timezone = "Timezone must be an IANA id (e.g. America/New_York).";
  }
  if (d.spendCap !== "off" && (!Number.isFinite(d.spendCap) || d.spendCap < 0)) {
    errs.spendCap = "Spend cap must be a non-negative number or `off`.";
  }
  return errs;
}

/** Build the domain ScheduleSpec from a valid draft (all five kinds).
 *  Pure. */
export function draftToScheduleSpec(d: JobEditorDraft): ScheduleSpec {
  switch (d.scheduleKind) {
    case "cron":
      return { kind: "cron", expr: d.scheduleExpr };
    case "every":
      return { kind: "every", spec: d.scheduleExpr };
    case "after":
      return { kind: "after", spec: d.scheduleExpr };
    case "once":
      return { kind: "once", delayMinutes: d.scheduleMinutes };
    case "event":
      return { kind: "event", name: d.scheduleExpr };
  }
}

/** Five-field cron — the engine's grammar (docs/routines.md). */
export function isFiveFieldCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => /^[\d*,-/]+$/.test(p));
}

/** Interval grammar: N + unit, unit in {m, h, d, w}. */
export function isValidInterval(spec: string): boolean {
  return /^\d+[mhdw]$/.test(spec.trim());
}

/** IANA timezone id sanity check (the Intl guard). */
export function isValidTimeZoneId(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
