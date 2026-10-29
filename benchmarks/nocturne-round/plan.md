# Nocturne — AI-Native Incident Operations Platform: The Build Contract (Gallery App #7)

In-repo at `src/lib/nocturne/` (pure domain), `src/app/nocturne/` (routes + API handlers + status page), `src/components/nocturne/` (UI). Follows the parley patterns (fail-closed tenancy, scrypt + HMAC session, RBAC matrix, immutable audit, metering), the fugue patterns (file-backed JSON store, clock-injected deterministic engine with `EngineCtx`), the aria plan structure, and cadence's chart + primitives conventions (accessible SVG, `role="img"` + `aria-label`, `Kpi`, `StreakChip`-style chips).

---

## 1. The Complete Data Model

**Conventions (all entities):**
- Row-level tenancy: every tenant-owned row carries `tenantId` (fail-closed, parley pattern). The public status page is the one exception: it reads ONLY its tenant's `services` / `components` / active `incidents` by slug, never users or schedules.
- ID scheme (fugue `seq` + parley seed discipline): deterministic `nc_${prefix}_${seq}` from the store's `seq` counter for live rows; seed-constant prefixed ids (`nc_seed_svc_01`, `nc_inc_seed_04` style) for seeded rows.
- Every time-dependent field is an ISO string; every domain function takes an explicit `now`. No `Date.now()`, no `Math.random()` anywhere in `src/lib/nocturne/` (the fugue determinism contract).
- `AS_OF` anchor: `2026-10-28T12:00:00Z` (the repo's pinned clock, shared with the aria/parley seeds). Seed spans ~9 weeks: `2026-08-31` through `2026-10-28`, so MTTR/MTTA shapes, rotation coverage and the postmortem trail are real.
- `DEMO_PASSWORD = "nocturne-demo-1"`, seed salts `s-nocturne-<slug>-<user>`.
- `HMAC_SECRET = "nocturne-demo-hmac-secret"`, `SESSION_TTL_MS = 8h`, `SEED_INTEGER = 0x5e2b7c11` (nocturne's own fixed seed).
- Time formatting: countdowns + durations use the parley `formatCountdown`/`formatDurationMs` shape (pure, explicit `now`); weekday/date helpers reuse the cadence `format.ts` conventions.

**Plans & caps:**
```ts
type NocturnePlan = "starter" | "professional" | "enterprise";
NOCTURNE_PLAN_CAPS: Record<NocturnePlan, { seats: number; services: number; rotations: number; runbooks: number }>
// starter:      { seats: 5,  services: 2, rotations: 2, runbooks: 5 }
// professional: { seats: 25, services: 10, rotations: 10, runbooks: 30 }
// enterprise:   { seats: 100, services: 50, rotations: 50, runbooks: 100 }
```

**Roles & visibility:**
```ts
type NocturneRole = "owner" | "admin" | "responder" | "viewer";
```
- `responder` — paged user: may ack/resolve/comment/escalate incidents, edit their own overrides, read schedules/runbooks.
- `viewer` — read-only (all schedules, incidents, analytics, status page), no mutations.
- `admin` — responders + config (services, escalation policies, rotations, runbooks, invites) but NOT tenant settings/plan.
- `owner` — everything.
- Visibility: no ownership scoping like aria's rep/manager layer — incident ops is team-shaped. The layer instead is **schedule-aware**: `whoIsOnCall` + `activeRotationWindow` are the computed surfaces; every incident read carries the resolved `primaryOnCall`/`escalatedTo` ids.

**Severities:**
```ts
type Severity = "sev1" | "sev2" | "sev3" | "sev4";
// sev1 = outage, sev2 = degradation, sev3 = anomaly, sev4 = informational
```

**Entities (every field):**

```ts
/* ── Tenants & users ── */
interface NocturneTenant {
  id: string; slug: string; name: string;
  plan: NocturnePlan;
  /** ack + resolve SLA targets in MINUTES, per severity (data-driven, plan-differentiated). */
  slaMinutes: Record<Severity, { ack: number; resolve: number }>;
  /** the 402-cap fields */
  createdAt: string;
}

interface NocturneUser {
  id: string; email: string; name: string;
  passwordHash: string; salt: string; createdAt: string;
  /** ISO-8601 tz, e.g. "UTC", "America/Los_Angeles" — display-only, never used in math */
  timezone: string;
}

interface NocturneMembership {
  id: string; tenantId: string; userId: string; role: NocturneRole;
}

/* ── Services, severity rules & escalation ── */
interface NocturneService {
  id: string; tenantId: string;
  name: string;
  description: string;
  /** the service the on-call rotation schedules (null = no rotation yet). */
  rotationId: string | null;
  /** who pages first for this service (the rotation's window, else an explicit user). */
  escalationPolicy: EscalationPolicy;
  createdAt: string;
}

interface EscalationPolicy {
  /** ordered tiers; tier[i] is paged only after tier[0..i-1] stayed silent. */
  tiers: Array<{
    id: string;                    // "e1", "e2", "e3"
    kind: "rotation" | "user" | "manager";  // rotation → primary seat, user → fixed user, manager → owner-role user of the tenant (deterministic: first owner, else first admin)
    /** minutes of silence before the NEXT tier is paged (tier N uses its own timeout). */
    waitMinutes: number;
    /** null = infinite (the last tier just keeps ringing). */
    toTierIndex: number | null;
  }>;
  /** which severities this policy applies to; defaults to all when null. */
  appliesTo?: Severity[];
}

/* ── On-call rotations ── */
/** A rotation = an ordered seat list that repeats on a period. A "seat" is one
    position in the list; one seat = one user (no multi-user seats, no underpages —
    the demo's deterministic scope). Contiguity invariant: seats tile the timeline
    with zero gaps and no overlaps. */
interface NocturneRotation {
  id: string; tenantId: string;
  name: string;
  /** one seat per entry; `length` = the number of people in the cycle. */
  seats: Array<{
    seatIndex: number;         // 0-based position in the cycle
    userId: string;
    /** ISO instant when this seat's shift BEGINS (the tiling's left edge).
        For seats after the first: seats[i].start = seats[i-1].start + i*shiftLengthMs.
        The tiling is checked by `contiguity(seats, shiftLengthMs)` — the PBT invariant. */
    start: string;
  }>;
  /** the shift length every seat gets (ms); e.g. 7 days = 604_800_000. */
  shiftLengthMs: number;
  /** day-of-week + hour the week boundary falls on (e.g. 0=Sunday, 1=Monday …)
      — used only for display ("weekly handoff Sun 00:00"). */
  boundaryDow: number;
  createdAt: string;
}

/** An override: one user pages FOR another user for a bounded window.
    `forUserId` is the person being covered; `userId` is the cover. */
interface NocturneOverride {
  id: string; tenantId: string;
  rotationId: string;
  forUserId: string;
  userId: string;           // who is on call during the window
  /** ISO start (inclusive). */
  startsAt: string;
  /** ISO end (exclusive). */
  endsAt: string;
  reason: string;
  createdAt: string;
}

/* ── Alerts & incidents ── */
interface NocturneAlert {
  id: string; tenantId: string;
  /** the free-text key used for DEDUP: same service + same dedupKey inside the window
      = the same logical alert (one incident entry). */
  serviceId: string;
  dedupKey: string;
  /** human-readable title + body. */
  title: string;
  body: string;
  severity: Severity;
  /** the instant this alert fired (ISO). For dedup the engine uses the LATEST fire inside the window. */
  firedAt: string;
  /** ISO of the last alert that merged into this logical alert (the dedup's "last seen"). */
  lastSeenAt: string;
  /** how many raw alerts merged into this one (dedup count — the UI's "×3" chip). */
  count: number;
  /** which incident this alert feeds; null when it was never correlated (a standalone alert). */
  incidentId: string | null;
  createdAt: string;
}

type IncidentStatus = "triggered" | "acknowledged" | "snoozed" | "resolved";
type IncidentLifecyclePhase = "triggered" | "acknowledged" | "resolved";

interface NocturneIncident {
  id: string; tenantId: string;
  serviceId: string;
  title: string;           // the title of the alert that TRIGGERED the incident
  severity: Severity;
  status: IncidentStatus;
  /** ISO of the trigger alert's `firedAt`. */
  triggeredAt: string;
  /** ISO of the FIRST ack; null while unacked. */
  acknowledgedAt: string | null;
  /** who acked (user id); null while unacked. */
  acknowledgedBy: string | null;
  /** ISO of the last snooze; null when not snoozed. */
  snoozedUntil: string | null;
  /** ISO of resolution; null while open. */
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** the postmortem's id, set when one is written (null = open). */
  postmortemId: string | null;
  /** the escalation tier index currently paging (0-based); null while untriggered or resolved. */
  activeTierIndex: number | null;
  /** ISO of the last escalation tick; null while no tick fired yet. */
  lastEscalatedAt: string | null;
  createdAt: string;
}

/* ── The event-sourced timeline (IMMUTABLE — append-only, like parley's events) ── */
type TimelineEventKind =
  | "alert_received"   // the alert that triggered the incident
  | "alert_deduped"    // an alert merged into an open logical alert (count++)
  | "alert_correlated" // a standalone alert was correlated into an open incident
  | "incident_created" // a new incident was born from the trigger alert
  | "acknowledged"
  | "snoozed"
  | "escalated"        // a tier advanced (the tier's index in meta)
  | "note"
  | "status_changed"   // triggered → acknowledged / acknowledged → snoozed / …
  | "resolved";

interface NocturneTimelineEvent {
  id: string; tenantId: string;
  incidentId: string;
  kind: TimelineEventKind;
  actorId: string | null;   // null for system events (alerts, escalations)
  meta: Record<string, unknown>;
  /** ISO — when the event happened. TIMELINE ORDER: sort by `at` then `id`. */
  at: string;
}

/* ── Notes (separate from the timeline so a note can be edited/updated in place) ── */
interface NocturneNote {
  id: string; tenantId: string;
  incidentId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string | null;
}

/* ── Runbooks ── */
interface NocturneRunbook {
  id: string; tenantId: string;
  serviceId: string;       // the service this runbook belongs to
  name: string;
  /** the ordered checklist. Each step: `title` + optional `command` (a copy-paste snippet). */
  steps: Array<{ id: string; title: string; command?: string }>;
  /** which severities this runbook is recommended for (empty = all). */
  forSeverities: Severity[];
  createdAt: string;
}

/** Per-incident runbook checklist STATE (the "progress" overlay). */
interface NocturneChecklistState {
  id: string; tenantId: string;
  incidentId: string;
  runbookId: string;
  /** stepId → "pending" | "done" | "skipped" (steps not in the map are pending). */
  stepStates: Record<string, "pending" | "done" | "skipped">;
  /** ISO of the last step transition. */
  updatedAt: string;
}

/* ── Public status page (per-tenant, by slug) ── */
interface NocturneComponent {
  id: string; tenantId: string;
  serviceId: string;
  /** the component's public label ("API", "Database", "CDN"). */
  name: string;
  /** the component's own status INDEPENDENT of the incident (for manual maintenance windows). */
  status: "operational" | "degraded" | "down" | "maintenance" | "unknown";
  /** ISO of the last status change; null when seeded. */
  lastChangedAt: string | null;
  /** short public note ("Scheduled maintenance Sun 02:00–06:00 UTC"). */
  note: string | null;
}

/* ── Postmortems (on resolved incidents) ── */
interface NocturnePostmortem {
  id: string; tenantId: string;
  incidentId: string;
  /** the root-cause writeup (markdown). */
  body: string;
  /** the timeline summary: triggered → ack → escalate → resolve (ms deltas). */
  summary: { triggeredAt: string; acknowledgedAt: string | null; resolvedAt: string };
  /** the action items. */
  actionItems: Array<{
    id: string;
    title: string;
    assigneeId: string | null;   // null = unassigned
    due: string | null;          // ISO, null = no due
    done: boolean;
    doneAt: string | null;
  }>;
  /** ISO when the postmortem was written (required for a resolved incident). */
  createdAt: string;
  authorId: string;
}

/* ── Audit (immutable, copy-on-write) ── */
interface NocturneAuditEvent {
  id: string; tenantId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  meta: { before: unknown; after: unknown };
  createdAt: string;
}

/* ── Sessions ── */
interface NocturneSession {
  id: string; userId: string; tenantId: string;
  expiresAt: string;   // ISO — now + 8h TTL
}

/* ── Full state (the seed + store own this shape) ── */
interface NocturneState {
  version: 1;
  tenants: NocturneTenant[];
  users: NocturneUser[];
  memberships: NocturneMembership[];
  services: NocturneService[];
  rotations: NocturneRotation[];
  overrides: NocturneOverride[];
  alerts: NocturneAlert[];
  incidents: NocturneIncident[];
  timeline: NocturneTimelineEvent[];
  notes: NocturneNote[];
  runbooks: NocturneRunbook[];
  checklists: NocturneChecklistState[];
  components: NocturneComponent[];
  postmortems: NocturnePostmortem[];
  invites: NocturneInvite[];
  audit: NocturneAuditEvent[];
  sessions: NocturneSession[];
  /** monotonic counter for deterministic id generation. */
  seq: number;
}

/* ── The invite (the parley single-use token pattern) ── */
interface NocturneInvite {
  id: string; tenantId: string; email: string; role: NocturneRole;
  token: string;
  usedAt: string | null;
  expiresAt: string;   // ISO — 24h from creation
  createdAt: string;
}

/* ── The pinned clock ── */
export const AS_OF = "2026-10-28T12:00:00Z";

export const DEMO_PASSWORD = "nocturne-demo-1";
export const HMAC_SECRET = "nocturne-demo-hmac-secret";
export const SESSION_TTL_MS = 8 * 3_600_000;
export const SEED_INTEGER = 0x5e2b7c11;
```

---

## 2. The `src/lib/nocturne/` Module List

One line per module; pure functions, explicit `now`, no I/O in domain modules (the store is the only I/O owner).

```
src/lib/nocturne/
├── types.ts          # All domain types + the NocturneState interface + AS_OF + PLAN caps
├── ids.ts           # mulberry32 + newId(prefix, seq) deterministic id helpers
├── clock.ts         # Pinned clock (setClock/resetClock/now) — the single mutable read
├── tenancy.ts       # assertTenant + crossTenant + makeCtx (fail-closed, parley pattern)
├── rbac.ts          # The data-driven can(role, action) matrix + owner/admin carve-out
├── password.ts      # scrypt hash/verify (parley pattern: N=16384, r=8, p=1, 32-byte key)
├── sessions.ts      # Session row + HMAC-signed cookie (parley pattern)
├── audit.ts         # recordAudit (copy-on-write) + auditQuery (newest-first, filterable)
├── metering.ts      # seat caps, service/rotation/runbook caps, overage verdicts (402)
├── validation.ts    # Pure field validators for every API input (400 body shape)
├── seed.ts          # Deterministic seed: 2 tenants, 9 weeks of incidents + rotations
├── store.ts         # File-backed JSON store: atomic writes, cache, structural reseed
├── dedup.ts         # The dedup engine: dedupKey + window → logical alert, idempotent merge
├── correlate.ts     # Correlation: standalone alert → open incident (service + severity match)
├── escalation.ts    # Escalation timer: tier advance on silence, clock-injected, deterministic
├── rotation.ts      # Rotation resolution: whoIsOnCall + activeWindow + override precedence
├── sla.ts           # SLA math: ack/resolve due dates, breach detection, remaining ms
├── incident.ts      # Incident lifecycle: ack, resolve, snooze, timeline append (pure)
├── postmortem.ts    # Postmortem creation + action-item state (pure)
├── analytics.ts     # MTTA/MTTR, incident counts by severity/service, breach rate, on-call load
├── status.ts        # The public status page's computed surface: component status + active incidents
└── *.test.ts       # One test file per module (lib tests: ~240-280 total, see §5)
```

---

## 3. The API Route Map

**Auth level ladder (parley pattern):**
- `public` — no session required (the status page, the login route, the demo reset)
- `auth` — requires a valid session (401 if absent/invalid/expired)
- `auth + can(role, action)` — 403 when the RBAC matrix denies
- `auth + crossTenant` — 404 when the record is outside the tenant's scope (never 403)

**Error bodies (parley shape):**
- 401: `{ error: "unauthenticated", status: 401 }`
- 403: `{ error: "forbidden", permission: "<action>", status: 403 }`
- 404: `{ error: "not found", status: 404 }`
- 402: `{ error: "quota_exceeded", status: 402 }`
- 400: `{ error: "validation failed", errors: [...], status: 400 }`

### 3.1 Auth routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| POST | `/nocturne/api/auth/login` | public | — | `{ email, password }` | 200 `{ session, user, tenant, role }` + Set-Cookie; 401 on bad creds |
| POST | `/nocturne/api/auth/logout` | auth | — | — | 204 + clears cookie; 401 if no session |
| GET | `/nocturne/api/auth/session` | auth | — | — | 200 `{ session, user, tenant, role }`; 401 if no/invalid |

### 3.2 Tenant & member routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/nocturne/api/tenants` | auth | `tenant.list` | — | 200 `[NocturneTenant]` |
| GET | `/nocturne/api/tenants/[id]` | auth | `tenant.read` | — | 200 `NocturneTenant`; 404 cross-tenant |
| PATCH | `/nocturne/api/tenants/[id]` | auth | `tenant.settings` | `{ name?, slaMinutes? }` | 200 `NocturneTenant`; 403 for non-owner |
| GET | `/nocturne/api/members` | auth | `member.list` | — | 200 `[{ membership, user }]` |
| POST | `/nocturne/api/invites` | auth | `invite.create` | `{ email, role }` | 201 `NocturneInvite`; 402 at seat cap |
| POST | `/nocturne/api/invites/accept` | public | — (token) | `{ token, name, password }` | 201 `{ user, membership }`; 404 unknown; 410 used/expired; 402 at cap |

### 3.3 Service & escalation routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/nocturne/api/services` | auth | `service.list` | — | 200 `[NocturneService]` + computed `primaryOnCall` per service |
| GET | `/nocturne/api/services/[id]` | auth | `service.read` | — | 200 `NocturneService` + `incidents: [NocturneIncident]` + `runbooks: [NocturneRunbook]`; 404 |
| POST | `/nocturne/api/services` | auth | `service.create` | `{ name, description, rotationId?, escalationPolicy }` | 201 `NocturneService`; 402 at service cap |
| PATCH | `/nocturne/api/services/[id]` | auth | `service.update` | `{ name?, description?, rotationId?, escalationPolicy? }` | 200 `NocturneService` |
| GET | `/nocturne/api/services/[id]/oncall` | auth | `service.read` | `?at=` (ISO, default now) | 200 `{ primary: { userId, name }, secondary: { userId, name } \| null, handoffAt: string }` |

### 3.4 Rotation & override routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/nocturne/api/rotations` | auth | `rotation.list` | — | 200 `[NocturneRotation]` + computed `currentSeat` + `nextSeat` |
| GET | `/nocturne/api/rotations/[id]` | auth | `rotation.read` | — | 200 `NocturneRotation` + `overrides: [NocturneOverride]`; 404 |
| POST | `/nocturne/api/rotations` | auth | `rotation.create` | `{ name, seats: [{ userId, start }], shiftLengthMs, boundaryDow }` | 201 `NocturneRotation`; 402 at cap; 400 if contiguity violated |
| PATCH | `/nocturne/api/rotations/[id]` | auth | `rotation.update` | `{ name?, shiftLengthMs?, boundaryDow? }` | 200 `NocturneRotation` |
| POST | `/nocturne/api/rotations/[id]/overrides` | auth | `rotation.override` | `{ forUserId, userId, startsAt, endsAt, reason }` | 201 `NocturneOverride`; 400 if window invalid or `forUserId` not in rotation |
| DELETE | `/nocturne/api/overrides/[id]` | auth | `rotation.override` | — | 204; 404 cross-tenant |

### 3.5 Alert & incident routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| POST | `/nocturne/api/alerts` | auth | `alert.ingest` | `{ serviceId, dedupKey, title, body, severity, firedAt? }` | 201 `{ alert, incident: NocturneIncident \| null, deduped: boolean, correlated: boolean }` |
| GET | `/nocturne/api/alerts` | auth | `alert.list` | `?serviceId=` `?severity=` `?incidentId=` | 200 `[NocturneAlert]` (newest-first, with `count` chip data) |
| GET | `/nocturne/api/incidents` | auth | `incident.list` | `?serviceId=` `?status=` `?severity=` | 200 `[NocturneIncident]` + computed `slaState` + `primaryOnCall` |
| GET | `/nocturne/api/incidents/[id]` | auth | `incident.read` | — | 200 `NocturneIncident` + `timeline: [NocturneTimelineEvent]` + `notes: [NocturneNote]` + `postmortem: NocturnePostmortem \| null`; 404 |
| POST | `/nocturne/api/incidents/[id]/ack` | auth | `incident.ack` | `{ note? }` | 200 `NocturneIncident` (status → `acknowledged`, `acknowledgedAt` set, timeline event appended); 400 if already resolved |
| POST | `/nocturne/api/incidents/[id]/resolve` | auth | `incident.resolve` | `{ postmortemBody?, actionItems?: [{ title, assigneeId?, due? }] }` | 200 `NocturneIncident` (status → `resolved`, `resolvedAt` set, timeline event; postmortem created if `postmortemBody` given); 400 if not acknowledged |
| POST | `/nocturne/api/incidents/[id]/snooze` | auth | `incident.snooze` | `{ until: ISO }` | 200 `NocturneIncident` (status → `snoozed`, `snoozedUntil` set); 400 if resolved |
| POST | `/nocturne/api/incidents/[id]/escalate` | auth | `incident.escalate` | — | 200 `NocturneIncident` (tier advanced manually, `activeTierIndex`++); 400 if resolved or no policy |
| POST | `/nocturne/api/incidents/[id]/notes` | auth | `incident.note` | `{ body }` | 201 `NocturneNote` (timeline event of kind `note` appended) |
| PATCH | `/nocturne/api/notes/[id]` | auth | `incident.note` | `{ body }` | 200 `NocturneNote` (author-only or admin); 403 otherwise |

### 3.6 Runbook routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/nocturne/api/runbooks` | auth | `runbook.list` | `?serviceId=` | 200 `[NocturneRunbook]` |
| GET | `/nocturne/api/runbooks/[id]` | auth | `runbook.read` | — | 200 `NocturneRunbook` + `checklists: [NocturneChecklistState]` (per incident); 404 |
| POST | `/nocturne/api/runbooks` | auth | `runbook.create` | `{ serviceId, name, steps: [{ title, command? }], forSeverities? }` | 201 `NocturneRunbook`; 402 at cap; 400 if `serviceId` unknown or steps empty |
| PATCH | `/nocturne/api/runbooks/[id]` | auth | `runbook.update` | `{ name?, steps?, forSeverities? }` | 200 `NocturneRunbook` |
| DELETE | `/nocturne/api/runbooks/[id]` | auth | `runbook.delete` | — | 204; 404 cross-tenant |
| POST | `/nocturne/api/checklists` | auth | `checklist.start` | `{ incidentId, runbookId }` | 201 `NocturneChecklistState` (all steps `pending`); 400 if runbook doesn't belong to the incident's service |
| PATCH | `/nocturne/api/checklists/[id]` | auth | `checklist.update` | `{ stepId, state: "pending" \| "done" \| "skipped" }` | 200 `NocturneChecklistState`; 404 if step not in the runbook |

### 3.7 Status page routes (public)

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/nocturne/status/[slug]` | public | — | — | 200 `{ tenant: { name, slug }, components: [NocturneComponent], activeIncidents: [NocturneIncident] (active = triggered or acknowledged or snoozed), lastUpdated: string }`; 404 unknown slug |
| POST | `/nocturne/api/components/[id]/status` | auth | `component.update` | `{ status, note? }` | 200 `NocturneComponent` (manual status override for maintenance windows); 404 cross-tenant |
| GET | `/nocturne/api/components` | auth | `component.list` | `?serviceId=` | 200 `[NocturneComponent]` |

### 3.8 Postmortem routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/nocturne/api/postmortems` | auth | `postmortem.list` | `?incidentId=` | 200 `[NocturnePostmortem]` (newest-first) |
| GET | `/nocturne/api/postmortems/[id]` | auth | `postmortem.read` | — | 200 `NocturnePostmortem` + `actionItems`; 404 |
| PATCH | `/nocturne/api/postmortems/[id]/actions/[actionId]` | auth | `postmortem.action` | `{ done, doneAt? }` | 200 `NocturnePostmortem` (action item updated); 404 |

### 3.9 Analytics & audit routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/nocturne/api/analytics` | auth | `analytics.read` | `?from=&to=` (ISO, default last 30d) | 200 `{ mttaMs, mttrMs, incidentsBySeverity, incidentsByService, breachRate, onCallLoad: Record<userId, number> }` |
| GET | `/nocturne/api/audit` | auth | `audit.read` | `?action=` `?entityType=` | 200 `[NocturneAuditEvent]` (newest-first, filtered) |
| POST | `/nocturne/api/demo/reset` | public | — | — | 200 `{ reset: true, demoSession, demoCookie }` + Set-Cookie |

---

## 4. The Engine Design

**The determinism contract (fugue `EngineCtx` + aria `sequences.ts` pattern):**
- Every engine function is a **pure function** — zero I/O, zero `Date.now()`, zero `Math.random()`.
- `ctx: { now(): string; nextEventId(): string; nextTimelineId(): string; }` — the clock and id generators are injected.
- Two calls with the same inputs → the same outputs (the "two seeds deep-equal" pin, parley pattern).

### 4.1 Dedup (the `dedup.ts` engine)

**The dedup key + window:**
- `dedupKey` is a free string per alert (the caller's choice — typically a hash of `serviceId + metricName + threshold`).
- The dedup window is a constant: `DEDUP_WINDOW_MS = 60_000` (1 minute). Two alerts with the same `(serviceId, dedupKey)` within the window are ONE logical alert.

**The engine (`mergeDedup`):**
```
Given: state, serviceId, dedupKey, newAlert, ctx
  1. Find the LATEST alert with the same (serviceId, dedupKey) whose `lastSeenAt` is within DEDUP_WINDOW_MS of `newAlert.firedAt`.
  2. If found: `found.count++`, `found.lastSeenAt = newAlert.firedAt`. No new alert row. The incident (if any) is untouched.
     → return `{ alert: found, deduped: true, incident: found.incidentId ? getIncident : null, correlated: false }`.
  3. If not found: create a new `NocturneAlert` row with `count: 1`.
     → return `{ alert: newAlert, deduped: false, incident: null, correlated: false }`.
```

**Idempotence:** calling `mergeDedup` twice with the same `(serviceId, dedupKey, firedAt)` produces the same logical alert (the PBT invariant pins this — the second call dedupes onto the first).

### 4.2 Correlation (the `correlate.ts` engine)

**The rule:** a standalone alert (one that was NOT deduped into an existing logical alert) gets correlated into an open incident when:
- There is exactly one open incident (status `triggered` or `acknowledged`) on the same `serviceId` AND the same `severity`.
- The alert's `firedAt` is within `CORRELATION_WINDOW_MS = 3_600_000` (5 minutes) of the incident's `triggeredAt`.

**The engine (`correlate`):**
```
Given: state, standaloneAlert, ctx
  1. Find open incidents on the same serviceId with the same severity.
  2. If exactly one AND (standaloneAlert.firedAt - incident.triggeredAt) < CORRELATION_WINDOW_MS:
     → incident gets a new alert linked (`alert.incidentId = incident.id`).
     → a timeline event `alert_correlated` is appended.
     → return `{ alert, incident, correlated: true }`.
  3. If none: the alert stays standalone. No incident is created (the caller decides when a NEW incident is born — the API route's `alert.ingest` creates one when there is no open incident).
```

### 4.3 Escalation (the `escalation.ts` engine)

**The timer:** every open incident has an `activeTierIndex` (0-based, starts at 0 when triggered). The policy's `tiers[i].waitMinutes` is the silence window before tier `i+1` is paged.

**The engine (`tickEscalation`):**
```
Given: incident, service (with escalationPolicy), ctx
  1. If incident.status === "resolved" → no-op.
  2. If incident.status === "snoozed" → no-op (the timer is frozen while snoozed).
  3. Let lastTick = incident.lastEscalatedAt ?? incident.triggeredAt.
     Let currentTier = incident.activeTierIndex ?? 0.
     Let waitMs = tiers[currentTier].waitMinutes * 60_000.
  4. If (ctx.now() - lastTick) >= waitMs AND currentTier < tiers.length - 1:
     → incident.activeTierIndex = currentTier + 1
     → incident.lastEscalatedAt = ctx.now()
     → a timeline event `escalated` is appended (meta: { tier: currentTier + 1 }).
     → return true (a tick fired).
  5. Otherwise: return false.
```

**The "who gets paged" resolution:** tier `i`'s `kind` determines the target:
- `rotation` → the `primaryOnCall` seat at `ctx.now()` for the service's rotation (overrides applied).
- `user` → the fixed user (the tier's `userId`).
- `manager` → the first owner-role user of the tenant, else the first admin (deterministic tie-break: by `createdAt` ascending).

**Invariants:**
- An incident is NEVER escalated while `acknowledged` OR `snoozed` (the escalation only fires while unacked — the PBT invariant "escalation only while unacked").
- A resolved incident's `activeTierIndex` is `null` (final).

### 4.4 Rotation resolution (the `rotation.ts` engine)

**The tiling invariant (contiguity):**
```
Given: rotation (with seats sorted by seatIndex, shiftLengthMs)
  For all i in 0..seats.length-1:
    seats[i].start + shiftLengthMs == seats[(i+1) % seats.length].start
```
- The PBT invariant "contiguous rotations" pins this: the seed's rotations always satisfy it; a rotation that violates it is rejected at `rotation.create` (400) — the tiling is structural, not an invariant to check at read time.

**`whoIsOnCall(rotation, overrides, now)`:**
```
1. Find the current seat index: the seat whose [start, start + shiftLengthMs) contains now.
   (Deterministic: seats are sorted by start; the tiling guarantees exactly one match.)
2. If an override covers `now` for the seat's userId: return the override's userId (the cover).
   Override precedence: the LATEST override (by startsAt descending) wins.
3. Otherwise: return the seat's userId.
```

**`nextHandoff(rotation, now)`:** the start of the NEXT seat (the seat after the current one in the cycle).

### 4.5 SLA breach detection (the `sla.ts` engine)

**The due dates:**
```
ackDue(incident, tenant)  = incident.triggeredAt + tenant.slaMinutes[incident.severity].ack * 60_000
resolveDue(incident, tenant) = incident.acknowledgedAt ?? incident.triggeredAt + tenant.slaMinutes[incident.severity].resolve * 60_000
```

**`slaState(incident, tenant, now)`:**
```
- If incident.status === "resolved":
    if incident.resolvedAt <= resolveDue → "met"
    else → "breached"
- If incident.acknowledgedAt !== null AND incident.status !== "resolved":
    judge on the RESOLVE target:
      remaining = resolveDue - now
      if remaining < 0 → "breached"
      if remaining < 0.2 * resolveTarget → "at_risk"
      else → "ok"
- If incident.acknowledgedAt === null (still unacked):
    judge on the ACK target:
      remaining = ackDue - now
      if remaining < 0 → "breached"
      if remaining < 0.2 * ackTarget → "at_risk"
      else → "ok"
```

**Invariants:**
- A resolved incident's SLA state is FINAL (`met` or `breached`, never `ok`/`at_risk`).
- MTTA is computed ONLY over resolved incidents (the PBT invariant "MTTA/MTTR over resolved only").

### 4.6 The incident lifecycle (the `incident.ts` engine)

**State machine (terminals are final):**
```
triggered → acknowledged → resolved
   │              │
   │              └→ snoozed → acknowledged (on snooze expiry, auto)
   └→ resolved (direct, for sev4 informational)
```
- `ack` is only valid from `triggered` or `snoozed` (400 otherwise).
- `resolve` is only valid from `acknowledged` (400 from `triggered` or `snoozed` — you must ack before resolving, the PBT invariant "ack-before-resolve").
- `snooze` is only valid from `triggered` or `acknowledged` (400 from `resolved`).
- Terminal states (`resolved`) never transition (the invariant pins this).

**Timeline events (append-only):**
- Every state transition appends exactly one `NocturneTimelineEvent` row (the event's `at` is `ctx.now()`).
- The timeline is SORTED by `at` then `id` — the UI renders it in that order.
- A `note` event is appended when a `NocturneNote` is created; the note itself is a separate mutable row (editable in place, but the timeline event is immutable evidence).

---

## 5. The Test Plan

### 5.1 Lib tests (~240-280 total, one file per module)

| File | ~Count | What it pins |
|---|---|---|
| `tenancy.test.ts` | 15 | assertTenant throws on null/undefined/empty; crossTenant true/false; makeCtx builds the ctx |
| `rbac.test.ts` | 20 | The matrix: every (action, role) pair; the owner-seat carve-out |
| `password.test.ts` | 10 | scrypt round-trip; wrong password → false; corrupt digest → false (no throw) |
| `sessions.test.ts` | 15 | createSession + isExpired; HMAC sign/verify; malformed cookie → null |
| `audit.test.ts` | 10 | recordAudit appends (copy-on-write); auditQuery filters newest-first |
| `ids.test.ts` | 10 | mulberry32 determinism; two seeds → deep-equal states |
| `metering.test.ts` | 15 | seat caps, service/rotation/runbook caps, overage verdicts |
| `validation.test.ts` | 25 | Every input validator: 400 field errors, rotation contiguity, escalation tier validity |
| `seed.test.ts` | 15 | Two seeds deep-equal; the AS_OF pin; the tenant-differentiated SLA policies; all rotations satisfy contiguity |
| `store.test.ts` | 25 | loadState (missing → reseed, corrupt → reseed, stale version → reseed); saveState atomic; nextId increments; resetState |
| `dedup.test.ts` | 20 | The dedup window: alerts within 60s merge; outside do not; idempotence (two calls → same logical alert); count increments |
| `correlate.test.ts` | 15 | Correlation: open incident on same service+severity within 5 min → correlated; no open incident → standalone; two open incidents → no correlation |
| `escalation.test.ts` | 20 | Tick: silence window → tier advance; acknowledged/snoozed → no tick; last tier → no advance; the "manager" resolution tie-break |
| `rotation.test.ts` | 25 | whoIsOnCall: correct seat for every `now` in the cycle; override precedence (latest wins); nextHandoff; contiguity violations rejected at create |
| `sla.test.ts` | 20 | slaState: every state (met/breached/ok/at_risk); the 20% at-risk band; MTTA/MTTR only over resolved |
| `incident.test.ts` | 25 | The state machine: ack from triggered; resolve only from acknowledged; snooze + auto-un-snooze; terminals are final; timeline events are immutable |
| `postmortem.test.ts` | 10 | Postmortem creation (requires resolved incident); action-item state; the summary ms-deltas |
| `analytics.test.ts` | 20 | MTTA/MTTR over resolved only; incident counts by severity/service; breach rate; on-call load (open incidents per user) |
| `status.test.ts` | 10 | The status page's computed surface: active incidents (triggered/acknowledged/snoozed), component status override, lastUpdated |
| `invariant.test.ts` | 30 | PBT-style: the seven contract invariants pinned on the seed's real data (see §5.4) |

### 5.2 API tests (~120-140, in `src/app/nocturne/api/__tests__/`)

| File | ~Count | What it pins |
|---|---|---|
| `auth.test.ts` | 15 | 401 ladder (absent/invalid/expired cookie); 403 permission; 404 cross-tenant; 402 quota |
| `tenancy.test.ts` | 15 | Every entity route: cross-tenant read → 404 (never 403); no-context → 401 |
| `services.test.ts` | 10 | CRUD + oncall computation; 402 at service cap |
| `rotations.test.ts` | 15 | CRUD + contiguity (400 on violation); overrides (400 on invalid window); whoIsOnCall on the seeded rotation |
| `alerts.test.ts` | 15 | Ingest: dedup behavior (same key within window → count++); correlation; new incident creation; the timeline events appended |
| `incidents.test.ts` | 20 | ack (400 from resolved); resolve (400 from triggered — ack-before-resolve); snooze (400 from resolved); escalate (manual tier advance); notes |
| `runbooks.test.ts` | 10 | CRUD + checklist start (400 on service mismatch) + step update |
| `status.test.ts` | 10 | The public status page (no auth): component list, active incidents, lastUpdated; 404 on unknown slug; component status override (auth) |
| `postmortems.test.ts` | 10 | List + read + action-item update (404 on unknown action) |
| `analytics.test.ts` | 10 | MTTA/MTTR + counts + breach rate + on-call load (the seeded numbers are pinned) |
| `adversarial.test.ts` | 20 | 27-probe adversarial suite (the parley pattern): malformed cookies, cross-tenant probes, RBAC matrix sweep, dedup race probes |

### 5.3 UI tests (~40-50, in `src/components/nocturne/__tests__/`)

| File | ~Count | What it pins |
|---|---|---|
| `nocturne-components.test.tsx` | 35 | Shell (embed-aware chrome); login screen; dashboard (5 KPIs: open incidents, MTTA, MTTR, breach rate, on-call now); incident list + detail (ack/resolve/snooze/escalate + timeline + notes); rotation view (whoIsOnCall + overrides + handoff); status page (public, component status + active incidents); analytics (MTTA/MTTR chart + severity bars + on-call load); RBAC-disabled-with-reason surfaces; the embed reset listener |
| `nocturne-invariant.test.tsx` | 10 | The UI never resolves an unacked incident (the ack-before-resolve invariant surfaces as a disabled state); the UI never escalates a resolved incident; the timeline renders in `at`-then-`id` order |

**Total: ~400-470 tests across the three lanes.**

### 5.4 The PBT invariants (the `invariant.test.ts` pins)

1. **Ack-before-resolve:** every incident with `resolvedAt !== null` has `acknowledgedAt !== null` AND `acknowledgedAt <= resolvedAt`.
2. **Escalation only while unacked:** for every `escalated` timeline event, the incident's `acknowledgedAt` is null at that event's `at`.
3. **Contiguous rotations:** every rotation's seats tile the timeline (the tiling check in §4.4).
4. **MTTA/MTTR over resolved only:** the analytics module's MTTA/MTTR inputs are ONLY `incidents` with `resolvedAt !== null`.
5. **Dedup idempotence:** calling `mergeDedup` twice with the same `(serviceId, dedupKey, firedAt)` produces the same logical alert (the second call dedupes onto the first, the count increments by 1).
6. **Terminals are final:** a resolved incident's timeline has no events AFTER its `resolved` event (the `at`-then-`id` sort proves this).
7. **Timeline immutability:** every timeline event in the state is an APPEND — no event's `at` or `kind` or `meta` is ever mutated in place (the copy-on-write contract, pinned by reference identity).

---

## 6. The Build Phase Decomposition

### Phase 0 — Plan (this document)
- **Acceptance:** The plan is committed; the data model, module list, route map, engine design, test plan, and risk list are the build contract.
- **What a build session is told:** "This is the plan. It is the build contract. Zero human edits will follow it. Build the lib phase next."

### Phase 1 — Lib (the domain layer)
- **What:** `src/lib/nocturne/` — all 20 modules + 19 test files (~240-280 tests).
- **Acceptance:**
  - `bun test src/lib/nocturne` → all tests green.
  - `bun run typecheck` → clean.
  - The store's `loadState` / `saveState` / `nextId` / `resetState` are pinned (atomic writes, structural reseed).
  - The escalation engine's `tickEscalation` is hermetic (zero I/O, clock-injected, determinism pinned).
  - The invariant tests pin: ack-before-resolve, escalation-only-while-unacked, contiguous rotations, MTTA/MTTR over resolved only, dedup idempotence, terminals final, timeline immutability.
- **Commit:** `nocturne: the domain layer` (explicit paths: `src/lib/nocturne/**`).

### Phase 2 — API (the routes)
- **What:** `src/app/nocturne/` — the layout, page, `globals.css`, `_auth.ts`, `_rate.ts`, and all ~50 route files + 12 test files (~120-140 tests).
- **Acceptance:**
  - `bun test src/app/nocturne` → all tests green.
  - The 401/403/404/402/400 ladder is pinned (the `adversarial.test.ts` suite).
  - The status page route (`/nocturne/status/[slug]`) is public and reads only components + active incidents (no users, no schedules).
  - The demo reset route works (reseed + demo session rotation).
  - The `alert.ingest` route does dedup + correlation in one atomic call (the engine's output is the 201 body).
- **Commit:** `nocturne: the API layer` (explicit paths: `src/app/nocturne/**`).

### Phase 3 — UI (the components + client store)
- **What:** `src/components/nocturne/` — the shell, login, dashboard, incident list + detail (timeline + notes + runbook checklist), rotation view, status page, analytics, admin + primitives + 2 test files (~40-50 tests).
- **Acceptance:**
  - `bun test src/components/nocturne` → all tests green.
  - The RBAC-disabled-with-reason surfaces are pinned (a viewer's UI shows the write controls disabled + the reason).
  - The embed reset listener is origin-checked + shape-checked (the `nocturne-reset` handshake).
  - The chart + primitives follow the cadence pattern (accessible SVG, `role="img"` + `aria-label`).
  - The timeline renders in `at`-then-`id` order (the PBT invariant #6 surfaces in the UI).
- **Commit:** `nocturne: the UI layer` (explicit paths: `src/components/nocturne/**`, `src/app/nocturne/client-store.tsx`, `src/app/nocturne/page.tsx`).

### Phase 4 — Embed + landing
- **What:** The embed-contract requirements (Section 8) + the landing gallery entry.
- **Acceptance:**
  - `?embed=1` serializes `embed: true` (the server-side read, the F3 pin).
  - The `nocturne-reset` postMessage handshake works (the origin-checked listener).
  - CSP frame-ancestors for `/nocturne/:path*` is in `next.config.ts`.
  - The scoped stylesheet + favicon are in place.
  - The landing gallery entry + test pins are green.
- **Commit:** `nocturne: the embed + landing` (explicit paths: `next.config.ts`, `src/components/landing/live-demo-data.ts`, `public/nocturne/favicon.svg`).

### Phase 5 — E2E + review
- **What:** The live headless-Chromium pass + the adversarial review round.
- **Acceptance:**
  - E2E: all 8 steps green (login, dashboard, incident detail, ack, rotation view, status page, analytics, reset).
  - The adversarial suite (27 probes) is green.
  - The P0 regression pins are in place.
- **Commit:** `nocturne: the E2E + review round` (explicit paths: the test files + any fixes).

---

## 7. The Risks List (12+ with mitigations)

1. **Cross-tenant leak (P0):** a route returns 403 instead of 404 for a cross-tenant read.
   - **Mitigation:** the `crossTenant` helper is the single source of truth; the API layer maps `true` → 404. The `tenancy.test.ts` + `adversarial.test.ts` pin the 404 (never 403) for every entity route.

2. **Ack-before-resolve violation (P0):** a resolve call succeeds on an unacked incident.
   - **Mitigation:** the `incident.resolve` route checks `incident.acknowledgedAt !== null` → 400 otherwise. The invariant test pins "every resolved incident has `acknowledgedAt <= resolvedAt`." The UI disables the resolve button for unacked incidents.

3. **Escalation while unacked (P0):** an escalation tick fires on an acknowledged or snoozed incident.
   - **Mitigation:** the `tickEscalation` engine returns early when `incident.status !== "triggered"`. The invariant test pins "every `escalated` timeline event has `acknowledgedAt === null` at that event's `at`." The UI disables the escalate button for non-triggered incidents.

4. **Dedup race (P1):** two concurrent `alert.ingest` calls for the same `(serviceId, dedupKey)` within the window create two separate logical alerts.
   - **Mitigation:** the store's `mergeDedup` is called UNDER THE STORE LOCK (the file-backed JSON store's `saveState` is synchronous + atomic; the read-modify-write cycle is inside one `getNocturne()` + `persist()` pair). The PBT invariant "dedup idempotence" pins this: two calls → one logical alert. The `adversarial.test.ts` fires 5 concurrent ingests for the same key and asserts exactly one alert row with `count: 5`.

5. **Escalation combinatorics (P1):** the tier advance logic has an off-by-one (tier 0 → 1 → 2 → … → last).
   - **Mitigation:** the `escalation.test.ts` pins every tier transition explicitly (a 4-tier policy: 4 ticks, the last one stops). The engine's `currentTier < tiers.length - 1` guard is the single source of truth. The UI's "escalate" button is disabled when `activeTierIndex === tiers.length - 1`.

6. **Rotation contiguity violation (P1):** a rotation's seats have a gap or overlap.
   - **Mitigation:** the `rotation.create` route runs `contiguity(seats, shiftLengthMs)` → 400 on violation. The seed's rotations are validated at seed time (the `seed.test.ts` pins it). The invariant test re-checks every rotation in the state (defense in depth).

7. **SLA breach false-positive (P1):** a snoozed incident's timer runs (the breach fires while the incident is legitimately snoozed).
   - **Mitigation:** the `slaState` function checks `incident.status === "snoozed"` → the timer is FROZEN (the `snoozedUntil` is the only time that matters; on expiry the incident auto-un-snoozes and the timer resumes from where it was frozen). The `incident.test.ts` pins this: a snooze + un-snooze cycle does not count the snoozed time toward the SLA.

8. **Timeline immutability (P1):** a timeline event is mutated in place (the copy-on-write contract breaks).
   - **Mitigation:** `appendTimeline` returns a new state with a new array (the parley pattern). The invariant test pins "every timeline event is an append — the array reference changes, the object references stay the same."

9. **Seat-cap bypass (P1):** an invite lands on a tenant at the cap.
   - **Mitigation:** the `invite.accept` route checks `seatsUsed >= PLAN_CAPS[plan].seats` → 402. The `metering.test.ts` pins the cap.

10. **Service/rotation/runbook cap bypass (P1):** a tenant creates more entities than the plan allows.
    - **Mitigation:** the `service.create` / `rotation.create` / `runbook.create` routes check the cap → 402. The `metering.test.ts` pins the caps.

11. **Status page leak (P1):** the public status page returns user emails, schedule details or runbook contents.
    - **Mitigation:** the `GET /nocturne/status/[slug]` route returns ONLY `components` + `activeIncidents` (the incident's `id`, `title`, `severity`, `status`, `triggeredAt`, `acknowledgedAt`, `resolvedAt` — no `acknowledgedBy`, no `resolvedBy`, no user ids). The `status.test.ts` pins the response shape. The CSP frame-ancestors header is the same-origin only.

12. **Postmortem before resolution (P2):** a postmortem is written on an open incident.
    - **Mitigation:** the `postmortem.create` route checks `incident.status === "resolved"` → 400 otherwise. The UI only shows the "write postmortem" button on resolved incidents.

13. **HMAC secret in the repo (accepted, documented):** the demo HMAC key + the seed's scrypt salts are public-by-design (the parley round's conscious acceptance for a same-origin iframe demo).
    - **Mitigation:** the risk is documented in the session record + the AGENTS.md; a real deployment would source the key from env. The embed is same-origin only (the CSP frame-ancestors header enforces it).

14. **Rate-limit bucket bleed (P2):** the `_rate.ts` buckets leak across test files.
    - **Mitigation:** the `resetRateBuckets()` test-lane convenience is called in every API test's `beforeEach` (the parley pattern). The `api.test.ts` pins the 429 → 200 recovery.

15. **Multi-instance state divergence (accepted, documented):** each server instance has its own seed + its own session rows + its own mutations (the parley round's honest bound — the Vercel multi-instance property; not fixed with Redis/DB).
    - **Mitigation:** the risk is documented in the session record; the file-backed store's `data/nocturne/state.json` is per-instance (the fugue pattern). The embed reset route reseeds the instance's store.

---

## 8. The Embed-Contract Requirements

### 8.1 `?embed=1` serialization
- **The server-side read (the F3 pin):** `src/app/nocturne/page.tsx` reads `searchParams.embed` server-side (the `Suspense` + async inner shape, the bazaar/cadence/parley/aria pattern) and passes `embed: boolean` as a PROP to the client tree.
- **The client:** `NocturneProvider`-shaped client store takes `embed: boolean` + `hasSession: boolean` (the server also reads the `nocturne_ses` cookie and passes it).
- **The test pin:** `?embed=1` serializes `embed: true` in the HTML; no-query serializes `embed: false`. The `src/app/nocturne/__tests__/page.test.tsx` pins this.

### 8.2 The `nocturne-reset` postMessage handshake
- **The client listener:** `NocturneProvider` mounts a `window.addEventListener("message", ...)` ONLY when `embed === true`.
- **The origin check:** `if (e.origin !== window.origin) return;`
- **The shape check:** `if (!data || data.source !== "unown-landing" || data.type !== "nocturne-reset") return;`
- **The action:** POST `/nocturne/api/demo/reset` (the no-session route), re-probe the session, reload the tenant's data (the parley `client-store.tsx` pattern).
- **The test pin:** the `nocturne-components.test.tsx` fires a `postMessage` with the right shape → the fetch is called; a wrong origin or shape → the fetch is NOT called.

### 8.3 CSP frame-ancestors for `/nocturne/:path*`
- **The `next.config.ts` block:**
  ```ts
  {
    source: "/nocturne/:path*",
    headers: [
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ],
  }
  ```
- **The test pin:** the `src/app/nocturne/__tests__/layout.test.tsx` pins the headers on a `GET /nocturne?embed=1` response.

### 8.4 The scoped stylesheet
- **The `src/app/nocturne/globals.css`:**
  - `@import "tailwindcss";` + the `@source` scoping (the parley pattern: `@source "../../../components/nocturne"`, `@source "../../../lib/nocturne"`, `@source "../../nocturne"`).
  - The `.nocturne-scope` wrapper (the standalone app's `:root` rules re-anchored onto the wrapper — the parley `globals.css` pattern).
  - The GBA 5-bit palette tokens (dark by default, light theme swaps the same tokens).
- **The layout:** `src/app/nocturne/layout.tsx` imports the scoped stylesheet (Next injects it for `/nocturne` routes only) and renders the `.nocturne-scope` wrapper.

### 8.5 The favicon
- **The `public/nocturne/favicon.svg`:** the nocturne mark (a stylized "N" with a moon + a pulse line — the incident ops glyph).
- **The layout's `metadata.icons`:** `{ icon: [{ url: "/nocturne/favicon.svg", type: "image/svg+xml" }] }`.

### 8.6 The landing gallery entry
- **The `src/components/landing/live-demo-data.ts` entry:**
  ```ts
  {
    id: "nocturne",
    name: "Nocturne",
    route: "/nocturne",
    url: "unown-nine.vercel.app/nocturne?embed=1",
    poster: "/landing/nocturne/poster.png",
    posterAlt: "Nocturne — the incident-ops platform unown built: alerts, on-call rotations, escalations and postmortems, running live",
    resetType: "nocturne-reset",
    receipt: {
      sessions: 24,
      toolCalls: 1100,
      files: 110,
      tests: 440,
      commits: 6,
      embeddingAdaptations: 9,
      receiptDoc: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/nocturne-demo-session.md",
    },
  }
  ```
- **The test pin:** the `live-demo.test.tsx` pins the 7th entry + the `nocturne-reset` type + the `poster` path + the `route` + the `receipt` numbers.
- **The copy update:** the band's default text changes from "Six apps, live. Pick one." to **"Seven apps, live. Pick one."** (the `live-demo.tsx` line 100).

### 8.7 The poster
- **The `public/landing/nocturne/poster.png`:** captured by `scripts/landing_demo_poster.mjs` from the **production build** at `/nocturne?embed=1` (2880×1800 @2x, IHDR-pinned by the landing test suite — the parley/aria poster convention).
- **The gallery entry's `posterAlt`:** a truthful one-liner: "the incident-ops platform unown built: alerts, on-call rotations, escalations and postmortems, running live."

---

**The plan is complete.** Every entity field, every module, every route, every test, every phase, every risk, and every embed requirement is named. The next build session takes this document as the contract and executes Phase 1 (the lib layer) first.
