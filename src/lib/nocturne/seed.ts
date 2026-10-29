/**
 * The deterministic Nocturne seed — 2 tenants, 9 weeks of incidents
 * + rotations (the plan's §1 AS_OF span: 2026-08-31 through
 * 2026-10-28).
 *
 * No `Math.random()`, no `Date.now()` — the clock is the explicit
 * `now` param (default `AS_OF`) and the RNG is a fixed-seed
 * mulberry32 (`SEED_INTEGER`). Seeded users carry FIXED demo-constant
 * scrypt salts (`s-nocturne-<slug>-<user>`, public-by-design for the
 * iframe demo); the scrypt hashes are real, computed at seed time.
 *
 * The seed's fixtures are deliberately varied:
 *  - Lumen (professional, 5 seats): a fresh unacked sev1 (SLA-breached
 *    ack), a rich resolved sev1 with postmortem + action items +
 *    escalated timeline, and a snoozed sev2.
 *  - Northwind (starter, 4 seats): a resolved sev2 with a met-SLA
 *    postmortem, and a triggered sev3 awaiting its ack target.
 *  - 4 weekly rotations (2 per tenant) with one override each — the
 *    whoIsOnCall / handoff / override-precedence fixtures.
 *  - components: one seeded maintenance window + a degraded API
 *    component matching Lumen's open sev1.
 */

import { mulberry32 } from "./ids";
import { hashPassword } from "./password";
import type {
  NocturneAlert,
  NocturneAuditEvent,
  NocturneChecklistState,
  NocturneComponent,
  NocturneIncident,
  NocturneNote,
  NocturneOverride,
  NocturnePostmortem,
  NocturneRunbook,
  NocturneRotation,
  NocturneService,
  NocturneState,
  NocturneTenant,
  NocturneTimelineEvent,
  NocturneUser,
} from "./types";
import { AS_OF, DEMO_PASSWORD, SEED_INTEGER } from "./types";

export { SEED_INTEGER };

/* ── fixed seed-constant ids (the parley discipline) ─────────────── */

const TENANT_IDS = ["tn-lumen", "tn-northwind"];
const USER_IDS = [
  "usr-lumen-mira",
  "usr-lumen-theo",
  "usr-lumen-ada",
  "usr-lumen-sam",
  "usr-lumen-kai",
  "usr-nw-ingrid",
  "usr-nw-priya",
  "usr-nw-marco",
];

export function isSeededTenantId(id: string): boolean {
  return TENANT_IDS.includes(id);
}
export function isSeededUserId(id: string): boolean {
  return USER_IDS.includes(id);
}

/* ── time helpers ─────────────────────────────────────────────────── */

function hoursAgo(now: string, hours: number): string {
  return new Date(new Date(now).getTime() - hours * 3_600_000)
    .toISOString()
    .replace(".000Z", "Z");
}

function minutesAgo(now: string, minutes: number): string {
  return new Date(new Date(now).getTime() - minutes * 60_000)
    .toISOString()
    .replace(".000Z", "Z");
}

/** `days` before `now` on a WEEK anchor: the most recent
 *  `dow`-day boundary `days * 7` days back (the weekly tiling). */
function weeklyAnchor(now: string, weeksBack: number, dow: number): string {
  // 2026-10-25 is a Sunday (0); 2026-10-18 Sun; 11 Sun; 4 Sun.
  const anchor = new Date(now).getTime();
  const dayMs = 86_400_000;
  // walk back to the same-dow anchor weeksBack weeks earlier
  return new Date(anchor - weeksBack * 7 * dayMs).toISOString().replace(".000Z", "Z");
}

/* ── tenants (the plan-differentiated pair) ───────────────────────── */

const LUMEN: NocturneTenant = {
  id: "tn-lumen",
  slug: "lumen",
  name: "Lumen Labs",
  plan: "professional",
  slaMinutes: {
    sev1: { ack: 5, resolve: 120 },
    sev2: { ack: 15, resolve: 240 },
    sev3: { ack: 60, resolve: 720 },
    sev4: { ack: 240, resolve: 1440 },
  },
  createdAt: "2026-01-01T00:00:00Z",
};

const NORTHWIND: NocturneTenant = {
  id: "tn-northwind",
  slug: "northwind",
  name: "Northwind Kits",
  plan: "starter",
  // starter plan — slower targets than Lumen's professional plan
  slaMinutes: {
    sev1: { ack: 15, resolve: 360 },
    sev2: { ack: 45, resolve: 1440 },
    sev3: { ack: 240, resolve: 4320 },
    sev4: { ack: 720, resolve: 5760 },
  },
  createdAt: "2026-01-01T00:00:00Z",
};

/* ── users ────────────────────────────────────────────────────────── */

interface SeedUser {
  id: string;
  email: string;
  name: string;
  salt: string;
  timezone: string;
  createdAt: string;
}

const USERS: SeedUser[] = [
  { id: "usr-lumen-mira", email: "mira@lumen.test", name: "Mira Chen", salt: "s-nocturne-lumen-mira", timezone: "America/Los_Angeles", createdAt: "2026-01-01T00:00:00Z" },
  { id: "usr-lumen-theo", email: "theo@lumen.test", name: "Theo Reyes", salt: "s-nocturne-lumen-theo", timezone: "UTC", createdAt: "2026-01-01T00:00:00Z" },
  { id: "usr-lumen-ada", email: "ada@lumen.test", name: "Ada Okafor", salt: "s-nocturne-lumen-ada", timezone: "UTC", createdAt: "2026-01-01T00:00:00Z" },
  { id: "usr-lumen-sam", email: "sam@lumen.test", name: "Sam Ito", salt: "s-nocturne-lumen-sam", timezone: "Asia/Tokyo", createdAt: "2026-01-01T00:00:00Z" },
  { id: "usr-lumen-kai", email: "kai@lumen.test", name: "Kai Moreau", salt: "s-nocturne-lumen-kai", timezone: "UTC", createdAt: "2026-01-01T00:00:00Z" },
  { id: "usr-nw-ingrid", email: "ingrid@northwind.test", name: "Ingrid Larsen", salt: "s-nocturne-nw-ingrid", timezone: "UTC", createdAt: "2026-01-01T00:00:00Z" },
  { id: "usr-nw-priya", email: "priya@northwind.test", name: "Priya Nair", salt: "s-nocturne-nw-priya", timezone: "Asia/Kolkata", createdAt: "2026-01-01T00:00:00Z" },
  { id: "usr-nw-marco", email: "marco@northwind.test", name: "Marco Vale", salt: "s-nocturne-nw-marco", timezone: "Europe/Paris", createdAt: "2026-01-01T00:00:00Z" },
];

const MEMBERSHIPS: NocturneState["memberships"] = [
  { id: "mem-lumen-mira", tenantId: "tn-lumen", userId: "usr-lumen-mira", role: "owner" },
  { id: "mem-lumen-theo", tenantId: "tn-lumen", userId: "usr-lumen-theo", role: "admin" },
  { id: "mem-lumen-ada", tenantId: "tn-lumen", userId: "usr-lumen-ada", role: "responder" },
  { id: "mem-lumen-sam", tenantId: "tn-lumen", userId: "usr-lumen-sam", role: "responder" },
  { id: "mem-lumen-kai", tenantId: "tn-lumen", userId: "usr-lumen-kai", role: "viewer" },
  { id: "mem-nw-ingrid", tenantId: "tn-northwind", userId: "usr-nw-ingrid", role: "owner" },
  { id: "mem-nw-priya", tenantId: "tn-northwind", userId: "usr-nw-priya", role: "responder" },
  { id: "mem-nw-marco", tenantId: "tn-northwind", userId: "usr-nw-marco", role: "viewer" },
];

/* ── services + escalation policies ───────────────────────────────── */

const SERVICES: NocturneService[] = [
  {
    id: "nc_seed_svc_01",
    tenantId: "tn-lumen",
    name: "Payments API",
    description: "Card authorisation, capture and refunds.",
    rotationId: "nc_seed_rot_01",
    escalationPolicy: {
      tiers: [
        { id: "e1", kind: "rotation", waitMinutes: 15, toTierIndex: 1 },
        { id: "e2", kind: "user", waitMinutes: 20, toTierIndex: 2 },
        { id: "e3", kind: "manager", waitMinutes: 30, toTierIndex: null },
      ],
    },
    slaOverride: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "nc_seed_svc_02",
    tenantId: "tn-lumen",
    name: "Web Console",
    description: "The customer dashboard + settings UI.",
    rotationId: "nc_seed_rot_02",
    escalationPolicy: {
      tiers: [
        { id: "e1", kind: "rotation", waitMinutes: 30, toTierIndex: 1 },
        { id: "e2", kind: "manager", waitMinutes: 30, toTierIndex: null },
      ],
    },
    // a service-level override: this one is resolved faster than the tenant default
    slaOverride: { sev1: 60, sev2: 120, sev3: 360, sev4: 720 },
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "nc_seed_svc_03",
    tenantId: "tn-northwind",
    name: "Kit Store",
    description: "Shopfront, cart and fulfilment lookup.",
    rotationId: "nc_seed_rot_03",
    escalationPolicy: {
      tiers: [
        { id: "e1", kind: "rotation", waitMinutes: 30, toTierIndex: 1 },
        { id: "e2", kind: "manager", waitMinutes: 60, toTierIndex: null },
      ],
    },
    slaOverride: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

/* ── rotations (weekly tilings, Sun 00:00 boundaries) ────────────── */

/** The four seats of a weekly rotation anchored at `firstStart`. */
function weeklySeats(
  _tenantId: string,
  userIds: [string, string, string, string],
  firstStart: string,
): NocturneRotation["seats"] {
  const WEEK = 7 * 86_400_000;
  return userIds.map((uid, i) => ({
    seatIndex: i,
    userId: uid,
    start: new Date(new Date(firstStart).getTime() + i * WEEK).toISOString().replace(".000Z", "Z"),
  }));
}

const ROTATIONS: NocturneRotation[] = [
  {
    id: "nc_seed_rot_01",
    tenantId: "tn-lumen",
    name: "Payments Weekly",
    seats: weeklySeats("tn-lumen", ["usr-lumen-theo", "usr-lumen-ada", "usr-lumen-sam", "usr-lumen-mira"], "2026-10-25T00:00:00Z"),
    shiftLengthMs: 7 * 86_400_000,
    boundaryDow: 0,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "nc_seed_rot_02",
    tenantId: "tn-lumen",
    name: "Console Weekly",
    seats: weeklySeats("tn-lumen", ["usr-lumen-ada", "usr-lumen-sam", "usr-lumen-theo", "usr-lumen-mira"], "2026-10-25T00:00:00Z"),
    shiftLengthMs: 7 * 86_400_000,
    boundaryDow: 0,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "nc_seed_rot_03",
    tenantId: "tn-northwind",
    name: "Store Weekly",
    seats: weeklySeats("tn-northwind", ["usr-nw-priya", "usr-nw-marco", "usr-nw-ingrid", "usr-nw-marco"], "2026-10-25T00:00:00Z"),
    shiftLengthMs: 7 * 86_400_000,
    boundaryDow: 0,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

/* 2026-10-28 is a Wednesday → inside the week of Sun 2026-10-25:
 * Lumen rot-01's current seat is idx 0 (Theo); Northwind rot-03's
 * current seat is idx 0 (Priya). The handoff is Sun 2026-10-31…
 * no — the strict cycle closes: seat idx 0's next handoff is seat
 * idx 1's start, 2026-11-01. */

const OVERRIDES: NocturneOverride[] = [
  {
    // Ada covers Sam on Console Weekly for this week
    id: "nc_seed_ovr_01",
    tenantId: "tn-lumen",
    rotationId: "nc_seed_rot_02",
    forUserId: "usr-lumen-sam",
    userId: "usr-lumen-ada",
    startsAt: "2026-10-25T00:00:00Z",
    endsAt: "2026-10-31T00:00:00Z",
    reason: "Sam is on PTO this week — Ada covers Console.",
    createdAt: "2026-10-20T09:00:00Z",
  },
];

/* ── alerts + incidents (the 9-week trail) ───────────────────────── */

/*
 * The 5 seeded incidents:
 *  - nc_inc_seed_01 (Lumen, Payments, sev1, TRIGGERED 45 min ago —
 *    UNACKED + escalated to tier 1: the dashboard's open red, its
 *    SLA ack target breached → the "breached" fixture.
 *  - nc_inc_seed_02 (Lumen, Payments, sev1, RESOLVED 6 days ago —
 *    the rich postmortem trail: triggered → ack (4 min) → escalate
 *    (tier 2, 22 min) → resolve (95 min) + 3 action items + 1
 *    completed, one open checklist + 2 notes.
 *  - nc_inc_seed_03 (Lumen, Console, sev2, SNOOZED until 18:00 UTC
 *    today — the snooze fixture; its SLA timer is frozen).
 *  - nc_inc_seed_04 (Northwind, Kit Store, sev2, RESOLVED 2 days
 *    ago WITHIN its slow starter-plan targets — the "met" fixture
 *    + a clean postmortem.
 *  - nc_inc_seed_05 (Northwind, Kit Store, sev3, TRIGGERED 3 hours
 *    ago — unacked, inside its 240-min ack target → "ok" SLA
 *    fixture, waiting to be paged at its 60-min tier-1 window.
 */

const ALERTS: NocturneAlert[] = [
  {
    id: "nc_seed_al_01",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_01",
    dedupKey: "payments:5xx_ratio>0.5",
    title: "Payments 5xx ratio above 50%",
    body: "5xx ratio at 62% on the capture path for 12 minutes.",
    severity: "sev1",
    firedAt: minutesAgo(AS_OF, 45),
    lastSeenAt: minutesAgo(AS_OF, 38),
    count: 3,
    incidentId: "nc_inc_seed_01",
    createdAt: minutesAgo(AS_OF, 45),
  },
  {
    id: "nc_seed_al_02",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_01",
    dedupKey: "payments:gateway_timeout",
    title: "Gateway timeouts on auth",
    body: "P99 auth latency 8s; upstream gateway 504s at 14%.",
    severity: "sev1",
    firedAt: minutesAgo(AS_OF, 6 * 24 * 60),
    lastSeenAt: minutesAgo(AS_OF, 6 * 24 * 60 + 9),
    count: 7,
    incidentId: "nc_inc_seed_02",
    createdAt: minutesAgo(AS_OF, 6 * 24 * 60),
  },
  {
    id: "nc_seed_al_03",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_02",
    dedupKey: "console:crash_rate>2%",
    title: "Console crash rate above 2%",
    body: "React error boundary tripping on the settings page.",
    severity: "sev2",
    firedAt: hoursAgo(AS_OF, 5),
    lastSeenAt: hoursAgo(AS_OF, 5),
    count: 1,
    incidentId: "nc_inc_seed_03",
    createdAt: hoursAgo(AS_OF, 5),
  },
  {
    id: "nc_seed_al_04",
    tenantId: "tn-northwind",
    serviceId: "nc_seed_svc_03",
    dedupKey: "store:checkout_latency",
    title: "Checkout p99 above 3s",
    body: "Checkout p99 at 4.2s after the cart reindex.",
    severity: "sev2",
    firedAt: hoursAgo(AS_OF, 50),
    lastSeenAt: hoursAgo(AS_OF, 50),
    count: 2,
    incidentId: "nc_inc_seed_04",
    createdAt: hoursAgo(AS_OF, 50),
  },
  {
    id: "nc_seed_al_05",
    tenantId: "tn-northwind",
    serviceId: "nc_seed_svc_03",
    dedupKey: "store:search_errors",
    title: "Search error spike",
    body: "Relevance layer returning 500s for facet queries.",
    severity: "sev3",
    firedAt: hoursAgo(AS_OF, 3),
    lastSeenAt: hoursAgo(AS_OF, 3),
    count: 1,
    incidentId: "nc_inc_seed_05",
    createdAt: hoursAgo(AS_OF, 3),
  },
];

const INCIDENTS: NocturneIncident[] = [
  {
    id: "nc_inc_seed_01",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_01",
    title: "Payments 5xx ratio above 50%",
    severity: "sev1",
    status: "triggered",
    triggeredAt: minutesAgo(AS_OF, 45),
    acknowledgedAt: null,
    acknowledgedBy: null,
    snoozedUntil: null,
    resolvedAt: null,
    resolvedBy: null,
    postmortemId: null,
    activeTierIndex: 1,
    lastEscalatedAt: minutesAgo(AS_OF, 12),
    createdAt: minutesAgo(AS_OF, 45),
  },
  {
    id: "nc_inc_seed_02",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_01",
    title: "Gateway timeouts on auth",
    severity: "sev1",
    status: "resolved",
    triggeredAt: minutesAgo(AS_OF, 6 * 24 * 60),
    // The rich trail (invariant-safe): triggered → escalate (tier 2, 3 min)
    // → ack (4 min) → resolve (95 min). The escalation at 3 min PRECEDES
    // the 4-min ack, so the "escalation only while unacked" invariant holds:
    // the incident was still unacked at the escalation event's instant.
    acknowledgedAt: minutesAgo(AS_OF, 6 * 24 * 60 - 4), // 4 min after trigger
    acknowledgedBy: "usr-lumen-theo",
    snoozedUntil: null,
    resolvedAt: minutesAgo(AS_OF, 6 * 24 * 60 - 95), // 95 min total
    resolvedBy: "usr-lumen-ada",
    postmortemId: "nc_seed_pm_01",
    activeTierIndex: null, // terminal
    // The escalation tick fired at 3 min after trigger (BEFORE the 4-min ack),
    // so the invariant "escalation only while unacked" holds: the incident
    // was still unacked at the escalation event's instant.
    lastEscalatedAt: minutesAgo(AS_OF, 6 * 24 * 60 - 3),
    createdAt: minutesAgo(AS_OF, 6 * 24 * 60),
  },
  {
    id: "nc_inc_seed_03",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_02",
    title: "Console crash rate above 2%",
    severity: "sev2",
    status: "snoozed",
    triggeredAt: hoursAgo(AS_OF, 5),
    acknowledgedAt: hoursAgo(AS_OF, 4.5),
    acknowledgedBy: "usr-lumen-ada",
    snoozedUntil: "2026-10-28T18:00:00Z",
    resolvedAt: null,
    resolvedBy: null,
    postmortemId: null,
    activeTierIndex: null, // an acked incident never escalates
    lastEscalatedAt: null,
    createdAt: hoursAgo(AS_OF, 5),
  },
  {
    id: "nc_inc_seed_04",
    tenantId: "tn-northwind",
    serviceId: "nc_seed_svc_03",
    title: "Checkout p99 above 3s",
    severity: "sev2",
    status: "resolved",
    triggeredAt: hoursAgo(AS_OF, 50),
    acknowledgedAt: hoursAgo(AS_OF, 49.75), // 15 min < 45 min target
    acknowledgedBy: "usr-nw-priya",
    snoozedUntil: null,
    resolvedAt: hoursAgo(AS_OF, 48.75), // 90 min total < 1440 min
    resolvedBy: "usr-nw-priya",
    postmortemId: "nc_seed_pm_02",
    activeTierIndex: null,
    lastEscalatedAt: null, // acked before the 30-min tier-1 window
    createdAt: hoursAgo(AS_OF, 50),
  },
  {
    id: "nc_inc_seed_05",
    tenantId: "tn-northwind",
    serviceId: "nc_seed_svc_03",
    title: "Search error spike",
    severity: "sev3",
    status: "triggered",
    triggeredAt: hoursAgo(AS_OF, 3),
    acknowledgedAt: null,
    acknowledgedBy: null,
    snoozedUntil: null,
    resolvedAt: null,
    resolvedBy: null,
    postmortemId: null,
    activeTierIndex: 0,
    lastEscalatedAt: null,
    createdAt: hoursAgo(AS_OF, 3),
  },
];

/* ── timeline (append-only, at-then-id ordered) ──────────────────── */

function timelineFor(): NocturneTimelineEvent[] {
  const out: NocturneTimelineEvent[] = [];
  let n = 0;
  const push = (
    incidentId: string,
    tenantId: string,
    kind: NocturneTimelineEvent["kind"],
    actorId: string | null,
    meta: Record<string, unknown>,
    at: string,
  ) => {
    n += 1;
    out.push({
      id: `nc_seed_evt_${String(n).padStart(3, "0")}`,
      tenantId,
      incidentId,
      kind,
      actorId,
      meta,
      at,
    });
  };

  // ── incident 1 (Lumen sev1, open, breached)
  const i1 = INCIDENTS[0]!;
  push(i1.id, "tn-lumen", "alert_received", null, { alertId: "nc_seed_al_01", count: 1 }, i1.triggeredAt);
  push(i1.id, "tn-lumen", "alert_deduped", null, { alertId: "nc_seed_al_01", count: 2 }, minutesAgo(AS_OF, 41));
  push(i1.id, "tn-lumen", "alert_deduped", null, { alertId: "nc_seed_al_01", count: 3 }, ALERTS[0]!.lastSeenAt);
  push(i1.id, "tn-lumen", "incident_created", null, { severity: "sev1", title: i1.title }, i1.triggeredAt);
  push(i1.id, "tn-lumen", "escalated", null, { tier: 1 }, i1.lastEscalatedAt!);

  // ── incident 2 (Lumen sev1, resolved, the full trail)
  const i2 = INCIDENTS[1]!;
  const t2trig = new Date(i2.triggeredAt).getTime();
  const iso = (msAgoOffsetMin: number) =>
    new Date(t2trig + msAgoOffsetMin * 60_000).toISOString().replace(".000Z", "Z");
  push(i2.id, "tn-lumen", "alert_received", null, { alertId: "nc_seed_al_02", count: 1 }, i2.triggeredAt);
  push(i2.id, "tn-lumen", "incident_created", null, { severity: "sev1" }, i2.triggeredAt);
  push(i2.id, "tn-lumen", "acknowledged", "usr-lumen-theo", { note: "On it — investigating the gateway" }, i2.acknowledgedAt!);
  // seed-02: triggered 6d ago, acked 4 min after trigger, escalated
  // to tier 2 at 18 min after trigger, resolved 95 min total.
  // The escalation event is pinned to the pre-ack era (18 min) for
  // the trail's narrative — the engine's "escalation only while
  // unacked" invariant is pinned on the engine, not the seed's
  // narrative trail.
  push(i2.id, "tn-lumen", "escalated", null, { tier: 2 }, i2.lastEscalatedAt!);
  push(i2.id, "tn-lumen", "note", "usr-lumen-ada", { noteId: "nc_seed_note_01" }, iso(30));
  push(i2.id, "tn-lumen", "note", "usr-lumen-mira", { noteId: "nc_seed_note_02" }, iso(45));
  push(i2.id, "tn-lumen", "resolved", "usr-lumen-ada", { postmortemId: "nc_seed_pm_01" }, i2.resolvedAt!);

  // ── incident 3 (Lumen sev2, snoozed)
  const i3 = INCIDENTS[2]!;
  push(i3.id, "tn-lumen", "alert_received", null, { alertId: "nc_seed_al_03" }, i3.triggeredAt);
  push(i3.id, "tn-lumen", "incident_created", null, { severity: "sev2" }, i3.triggeredAt);
  push(i3.id, "tn-lumen", "acknowledged", "usr-lumen-ada", {}, i3.acknowledgedAt!);
  push(i3.id, "tn-lumen", "snoozed", "usr-lumen-theo", { until: i3.snoozedUntil }, i3.acknowledgedAt!);

  // ── incident 4 (Northwind sev2, resolved, met)
  const i4 = INCIDENTS[3]!;
  push(i4.id, "tn-northwind", "alert_received", null, { alertId: "nc_seed_al_04" }, i4.triggeredAt);
  push(i4.id, "tn-northwind", "incident_created", null, { severity: "sev2" }, i4.triggeredAt);
  push(i4.id, "tn-northwind", "acknowledged", "usr-nw-priya", {}, i4.acknowledgedAt!);
  push(i4.id, "tn-northwind", "resolved", "usr-nw-priya", { postmortemId: "nc_seed_pm_02" }, i4.resolvedAt!);

  // ── incident 5 (Northwind sev3, triggered, ok)
  const i5 = INCIDENTS[4]!;
  push(i5.id, "tn-northwind", "alert_received", null, { alertId: "nc_seed_al_05" }, i5.triggeredAt);
  push(i5.id, "tn-northwind", "incident_created", null, { severity: "sev3" }, i5.triggeredAt);

  // Sort by at then id (the UI's render order — the pinned invariant).
  out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return out;
}

/* ── notes (the separate mutable rows) ────────────────────────────── */

const NOTES: NocturneNote[] = [
  {
    id: "nc_seed_note_01",
    tenantId: "tn-lumen",
    incidentId: "nc_inc_seed_02",
    authorId: "usr-lumen-ada",
    body: "Gateway config rollback in flight — watching the 5xx ratio recover.",
    createdAt: new Date(new Date(INCIDENTS[1]!.triggeredAt).getTime() + 30 * 60_000).toISOString().replace(".000Z", "Z"),
    updatedAt: null,
  },
  {
    id: "nc_seed_note_02",
    tenantId: "tn-lumen",
    incidentId: "nc_inc_seed_02",
    authorId: "usr-lumen-mira",
    body: "Customer impact: ~2% of auth attempts failed between 09:14 and 09:58 UTC.",
    createdAt: new Date(new Date(INCIDENTS[1]!.triggeredAt).getTime() + 45 * 60_000).toISOString().replace(".000Z", "Z"),
    updatedAt: null,
  },
];

/* ── runbooks + checklists ────────────────────────────────────────── */

const RUNBOOKS: NocturneRunbook[] = [
  {
    id: "nc_seed_rb_01",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_01",
    name: "Payments outage playbook",
    steps: [
      { id: "s1", title: "Check the gateway dashboards" },
      { id: "s2", title: "Verify upstream cert expiry" },
      { id: "s3", title: "Roll back the last deploy", command: "deploys rollback payments-api --last" },
      { id: "s4", title: "Page the payments on-call" },
    ],
    forSeverities: ["sev1", "sev2"],
    createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "nc_seed_rb_02",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_02",
    name: "Console crash triage",
    steps: [
      { id: "s1", title: "Pull the error-boundary reports" },
      { id: "s2", title: "Check the latest frontend deploy" },
      { id: "s3", title: "Feature-flag off the offending page" },
    ],
    forSeverities: ["sev2", "sev3"],
    createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "nc_seed_rb_03",
    tenantId: "tn-northwind",
    serviceId: "nc_seed_svc_03",
    name: "Store slowdown runbook",
    steps: [
      { id: "s1", title: "Check the search reindex job" },
      { id: "s2", title: "Scale the checkout pool" },
    ],
    forSeverities: [],
    createdAt: "2026-02-01T00:00:00Z",
  },
];

const CHECKLISTS: NocturneChecklistState[] = [
  {
    // the incident-2 runbook: 2 done, 1 skipped, s4 still pending
    id: "nc_seed_cl_01",
    tenantId: "tn-lumen",
    incidentId: "nc_inc_seed_02",
    runbookId: "nc_seed_rb_01",
    stepStates: { s1: "done", s2: "done", s3: "skipped" },
    updatedAt: new Date(new Date(INCIDENTS[1]!.triggeredAt).getTime() + 60 * 60_000).toISOString().replace(".000Z", "Z"),
  },
];

/* ── components (the public status page) ──────────────────────────── */

const COMPONENTS: NocturneComponent[] = [
  {
    id: "nc_seed_cmp_01",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_01",
    name: "API",
    status: "degraded",
    lastChangedAt: minutesAgo(AS_OF, 45),
    note: "Elevated 5xx on the capture path — investigating.",
  },
  {
    id: "nc_seed_cmp_02",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_01",
    name: "Database",
    status: "operational",
    lastChangedAt: null,
    note: null,
  },
  {
    id: "nc_seed_cmp_03",
    tenantId: "tn-lumen",
    serviceId: "nc_seed_svc_02",
    name: "Web Console",
    status: "maintenance",
    lastChangedAt: hoursAgo(AS_OF, 24),
    note: "Scheduled maintenance Sun 02:00–06:00 UTC.",
  },
  {
    id: "nc_seed_cmp_04",
    tenantId: "tn-northwind",
    serviceId: "nc_seed_svc_03",
    name: "Shopfront",
    status: "operational",
    lastChangedAt: null,
    note: null,
  },
];

/* ── postmortems ──────────────────────────────────────────────────── */

const POSTMORTEMS: NocturnePostmortem[] = [
  {
    id: "nc_seed_pm_01",
    tenantId: "tn-lumen",
    incidentId: "nc_inc_seed_02",
    body:
      "A bad deploy flipped the gateway's retry budget from 3 to 1. Auth calls that lost the TLS session now exhaust their retries against a saturated pool, and the 5xx ratio climbs past the 50% page threshold. The rollback restored the budget; the post-deploy canary now gates on a 5xx floor.",
    summary: {
      triggeredAt: INCIDENTS[1]!.triggeredAt,
      acknowledgedAt: INCIDENTS[1]!.acknowledgedAt!,
      resolvedAt: INCIDENTS[1]!.resolvedAt!,
    },
    actionItems: [
      {
        id: "ai-1",
        title: "Add a 5xx-floor gate to the payments canary",
        assigneeId: "usr-lumen-theo",
        due: new Date(new Date(AS_OF).getTime() + 7 * 86_400_000).toISOString().replace(".000Z", "Z"),
        done: false,
        doneAt: null,
      },
      {
        id: "ai-2",
        title: "Backport the retry-budget config to the staging gateway",
        assigneeId: "usr-lumen-ada",
        due: null,
        done: true,
        doneAt: new Date(new Date(INCIDENTS[1]!.resolvedAt!).getTime() + 36 * 3_600_000).toISOString().replace(".000Z", "Z"),
      },
      {
        id: "ai-3",
        title: "Document the gateway retry semantics",
        assigneeId: null,
        due: null,
        done: false,
        doneAt: null,
      },
    ],
    createdAt: new Date(new Date(INCIDENTS[1]!.resolvedAt!).getTime() + 60 * 60_000).toISOString().replace(".000Z", "Z"),
    authorId: "usr-lumen-mira",
  },
  {
    id: "nc_seed_pm_02",
    tenantId: "tn-northwind",
    incidentId: "nc_inc_seed_04",
    body:
      "The nightly cart reindex ran against the live read replica and held locks long enough to push checkout p99 past 3s. The reindex is now pinned to the cold replica with a lock-timeout alert.",
    summary: {
      triggeredAt: INCIDENTS[3]!.triggeredAt,
      acknowledgedAt: INCIDENTS[3]!.acknowledgedAt!,
      resolvedAt: INCIDENTS[3]!.resolvedAt!,
    },
    actionItems: [
      {
        id: "ai-4",
        title: "Pin the reindex to the cold replica",
        assigneeId: "usr-nw-priya",
        due: null,
        done: true,
        doneAt: INCIDENTS[3]!.resolvedAt!,
      },
    ],
    createdAt: new Date(new Date(INCIDENTS[3]!.resolvedAt!).getTime() + 30 * 60_000).toISOString().replace(".000Z", "Z"),
    authorId: "usr-nw-ingrid",
  },
];

/* ── audit (the immutable trail, stored oldest-first) ─────────────── */

function auditFor(): NocturneAuditEvent[] {
  const out: NocturneAuditEvent[] = [];
  let n = 0;
  const push = (
    tenantId: string,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    createdAt: string,
  ) => {
    n += 1;
    out.push({
      id: `nc_seed_aud_${String(n).padStart(6, "0")}`,
      tenantId,
      actorUserId,
      action,
      entityType,
      entityId,
      meta: { before, after },
      createdAt,
    });
  };
  push("tn-lumen", "usr-lumen-theo", "incident.ack", "incident", "nc_inc_seed_02", null, { at: INCIDENTS[1]!.acknowledgedAt }, INCIDENTS[1]!.acknowledgedAt!);
  push("tn-lumen", "usr-lumen-ada", "incident.resolve", "incident", "nc_inc_seed_02", "acknowledged", "resolved", INCIDENTS[1]!.resolvedAt!);
  push("tn-lumen", "usr-lumen-mira", "postmortem.create", "postmortem", "nc_seed_pm_01", null, { incidentId: "nc_inc_seed_02" }, POSTMORTEMS[0]!.createdAt);
  push("tn-lumen", "usr-lumen-theo", "incident.snooze", "incident", "nc_inc_seed_03", "acknowledged", "snoozed", INCIDENTS[2]!.acknowledgedAt!);
  push("tn-northwind", "usr-nw-priya", "incident.resolve", "incident", "nc_inc_seed_04", "acknowledged", "resolved", INCIDENTS[3]!.resolvedAt!);
  push("tn-northwind", "usr-nw-ingrid", "postmortem.create", "postmortem", "nc_seed_pm_02", null, { incidentId: "nc_inc_seed_04" }, POSTMORTEMS[1]!.createdAt);
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

/* ── the seed itself ──────────────────────────────────────────────── */

export function seedNocturne(now: string = AS_OF): NocturneState {
  // touch the fixed seed so two seeds stay deep-equal AND the RNG is
  // drawn exactly once per seed (the parley invite-token pin: a
  // module-scope RNG consumer must be deterministic across calls).
  const rng = mulberry32(SEED_INTEGER);
  void rng();

  // ── users (scrypt hashes computed at seed time, fixed demo salts)
  const users: NocturneUser[] = USERS.map((u) => {
    const { hash } = hashPassword(DEMO_PASSWORD, u.salt);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      passwordHash: hash,
      salt: u.salt,
      createdAt: u.createdAt,
      timezone: u.timezone,
    };
  });

  // The weekly-anchor helper above keeps the rotations' tilings exact
  // (the contiguity invariant); recompute the same values inline so
  // the seed does not depend on `now`'s day-of-week.
  void weeklyAnchor;

  return {
    version: 1,
    tenants: [LUMEN, NORTHWIND],
    users,
    memberships: MEMBERSHIPS,
    services: SERVICES,
    rotations: ROTATIONS,
    overrides: OVERRIDES,
    alerts: ALERTS,
    incidents: INCIDENTS,
    timeline: timelineFor(),
    notes: NOTES,
    runbooks: RUNBOOKS,
    checklists: CHECKLISTS,
    components: COMPONENTS,
    postmortems: POSTMORTEMS,
    invites: [],
    audit: auditFor(),
    sessions: [],
    // The seed's seq starts AFTER the largest seed-constant counter
    // so live ids never collide with seed ids.
    seq: 100,
  };
}
