/**
 * Pure date/time helpers for the Parley UI. No DOM, no `Date.now()`
 * in a render path the tests pin — every function takes an explicit
 * `now` (ISO string), the cadence `asOf` convention.
 */
import type { Message, SystemEvent } from "@/lib/parley/types";

/** "12:34 PM" for an ISO timestamp. */
export function timeOf(iso: string, now?: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Oct 28" for an ISO timestamp (the list's relative-time helper). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
}

/**
 * A "2h 14m"-style countdown from an explicit `now` (the SLA chip's
 * ticking text — a pure function of `now`, so it's unit-testable).
 */
export function countdownLabel(dueIso: string, now: string): string {
  const ms = new Date(dueIso).getTime() - new Date(now).getTime();
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/**
 * Interleave the thread's messages + system events by `createdAt`
 * (oldest first) — the timeline the thread view renders.
 */
export function interleaveTimeline(
  messages: Message[],
  events: SystemEvent[],
): Array<{ kind: "message" | "event"; item: Message | SystemEvent; at: string }> {
  const all: Array<{ kind: "message" | "event"; item: Message | SystemEvent; at: string }> = [
    ...messages.map((m) => ({ kind: "message" as const, item: m, at: m.createdAt })),
    ...events.map((e) => ({ kind: "event" as const, item: e, at: e.createdAt })),
  ];
  all.sort((a, b) => a.at.localeCompare(b.at));
  return all;
}

/** "just now", "5m", "2h", "3d" — relative to an explicit `now`. */
export function relativeTime(iso: string, now: string): string {
  const ms = new Date(now).getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m";
  const h = Math.floor(min / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}
