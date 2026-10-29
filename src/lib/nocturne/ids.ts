/**
 * Deterministic id generation for nocturne (the parley pattern).
 *
 * ONLY through mulberry32 (the cadence seed's RNG, fixed integer seed
 * SEED_INTEGER from ./types, no `Math.random()` anywhere). Ids follow
 * the plan's scheme: `nc_<prefix>_<seq>`-shaped,
 * `nc_<kind>-<hex4>-<6-digit counter>`:
 *
 * - SEED rows use seed-constant ids (`nc_seed_*`, `nc_inc_seed_*` style)
 *   written directly by the seed — they never go through these helpers.
 * - LIVE rows use the `nc_`-prefixed helpers below; a module-scope
 *   6-digit counter keeps live ids unique across the server's lifetime
 *   (the parley counter pattern, deterministic given rng + call order).
 */

/** mulberry32 — a tiny deterministic PRNG (fixed integer seed). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format an rng value as a hex-4 suffix. */
function hex4(rng: () => number): string {
  return Math.floor(rng() * 0x10000)
    .toString(16)
    .padStart(4, "0");
}

/** The base live-row id shape: `nc_${prefix}_${seq}`. */
export function newId(prefix: string, seq: number): string {
  return `nc_${prefix}_${seq}`;
}

// Live-id uniqueness counters (module scope, parley style).
let alertCounter = 0;
let incidentCounter = 0;
let eventCounter = 0;
let noteCounter = 0;
let runbookCounter = 0;
let checklistCounter = 0;
let serviceCounter = 0;
let rotationCounter = 0;
let overrideCounter = 0;
let componentCounter = 0;
let postmortemCounter = 0;
let inviteCounter = 0;
let sessionCounter = 0;
let auditCounter = 0;

/** A new alert id (`nc_al-…`). */
export function newAlertId(rng: () => number): string {
  alertCounter += 1;
  return `nc_al-${hex4(rng)}-${String(alertCounter).padStart(6, "0")}`;
}

/** A new incident id (`nc_inc-…`). */
export function newIncidentId(rng: () => number): string {
  incidentCounter += 1;
  return `nc_inc-${hex4(rng)}-${String(incidentCounter).padStart(6, "0")}`;
}

/** A new timeline-event id (`evt-nc-…`). */
export function newEventId(rng: () => number): string {
  eventCounter += 1;
  return `evt-nc-${hex4(rng)}-${String(eventCounter).padStart(6, "0")}`;
}

/** A new note id (`nc_note-…`). */
export function newNoteId(rng: () => number): string {
  noteCounter += 1;
  return `nc_note-${hex4(rng)}-${String(noteCounter).padStart(6, "0")}`;
}

/** A new runbook id (`nc_rb-…`). */
export function newRunbookId(rng: () => number): string {
  runbookCounter += 1;
  return `nc_rb-${hex4(rng)}-${String(runbookCounter).padStart(6, "0")}`;
}

/** A new checklist-state id (`nc_cl-…`). */
export function newChecklistId(rng: () => number): string {
  checklistCounter += 1;
  return `nc_cl-${hex4(rng)}-${String(checklistCounter).padStart(6, "0")}`;
}

/** A new service id (`nc_svc-…`). */
export function newServiceId(rng: () => number): string {
  serviceCounter += 1;
  return `nc_svc-${hex4(rng)}-${String(serviceCounter).padStart(6, "0")}`;
}

/** A new rotation id (`nc_rot-…`). */
export function newRotationId(rng: () => number): string {
  rotationCounter += 1;
  return `nc_rot-${hex4(rng)}-${String(rotationCounter).padStart(6, "0")}`;
}

/** A new override id (`nc_ovr-…`). */
export function newOverrideId(rng: () => number): string {
  overrideCounter += 1;
  return `nc_ovr-${hex4(rng)}-${String(overrideCounter).padStart(6, "0")}`;
}

/** A new component id (`nc_cmp-…`). */
export function newComponentId(rng: () => number): string {
  componentCounter += 1;
  return `nc_cmp-${hex4(rng)}-${String(componentCounter).padStart(6, "0")}`;
}

/** A new postmortem id (`nc_pm-…`). */
export function newPostmortemId(rng: () => number): string {
  postmortemCounter += 1;
  return `nc_pm-${hex4(rng)}-${String(postmortemCounter).padStart(6, "0")}`;
}

/** A new invite id (`nc_inv-…`). */
export function newInviteId(rng: () => number): string {
  inviteCounter += 1;
  return `nc_inv-${hex4(rng)}-${String(inviteCounter).padStart(6, "0")}`;
}

/** A new session id (`nc_ses-…`). */
export function newSessionId(rng: () => number): string {
  sessionCounter += 1;
  return `nc_ses-${hex4(rng)}-${String(sessionCounter).padStart(6, "0")}`;
}

/** A new audit-event id (`nc_aud-…`). */
export function newAuditId(rng: () => number): string {
  auditCounter += 1;
  return `nc_aud-${hex4(rng)}-${String(auditCounter).padStart(6, "0")}`;
}
