# Aria — Enterprise CRM: The Build Contract (Gallery App #6)

In-repo at `src/lib/aria/` (pure domain), `src/app/aria/` (routes + API handlers), `src/components/aria/` (UI). Follows the parley patterns (fail-closed tenancy, scrypt + HMAC session, RBAC matrix, immutable audit, metering) and the fugue patterns (file-backed JSON store, clock-injected deterministic engine), with cadence's chart + primitives conventions.

---

## 1. The Complete Data Model

**Conventions (all entities):**
- Row-level tenancy: every tenant-owned row carries `tenantId` (fail-closed, parley pattern).
- ID scheme (fugue `seq` pattern): deterministic `${prefix}_${seq}` from the store's `seq` counter for live rows; seed-constant prefixed ids (`acr_seed_01` style, parley's `cnv-seed-NN` discipline) for seeded rows.
- Every time-dependent field is an ISO string; every domain function takes an explicit `now`.
- `AS_OF` anchor: `2026-10-28T12:00:00Z` (the repo's pinned clock). Seed spans ~2 curated quarters: `2026-04` through `2026-10`, so cohort/forecast/anomaly shapes are real.
- `DEMO_PASSWORD = "aria-demo-1"`, seed salts `s-aria-<slug>-<user>`.
- `HMAC_SECRET = "aria-demo-hmac-secret"`, `SESSION_TTL_MS = 8h`.

**Plans & caps:**
```ts
type AriaPlan = "starter" | "growth" | "enterprise";
ARIA_PLAN_CAPS: Record<AriaPlan, { seats: number; pipelines: number; sequences: number }>
// starter: { seats: 5, pipelines: 1, sequences: 1 }
// growth: { seats: 25, pipelines: 4, sequences: 10 }
// enterprise: { seats: 100, pipelines: 20, sequences: 50 }
```

**Roles & visibility:**
```ts
type AriaRole = "owner" | "admin" | "manager" | "rep" | "viewer";
```
- Visibility layers (data-driven, on top of `can(role, action)`):
  - `rep` → sees records they own (`ownerId === self`)
  - `manager` → sees team records (owners in their managed rep set)
  - `admin`/`owner` → whole tenant
  - `viewer` → read-only whole tenant (no mutations)
- `teamOf(state, tenantId, managerId): string[]` returns managed rep ids (the manager's `manages` field, a `Record<managerId, repId[]>` on the tenant row).

**Entities (every field):**

```ts
interface AriaTenant {
  id: string; slug: string; name: string;
  plan: AriaPlan;
  /** per-rep annual quota in $ (the "quota per user per period" — period is quarter) */
  quotas: Record<repUserId, number>;
  /** manager -> rep ids they supervise */
  manages: Record<managerId, repUserId[]>;
  /** lead SLA: first-response minutes by lead priority */
  leadSlaMinutes: Record<LeadPriority, number>;
  createdAt: string;
}

interface AriaUser {
  id: string; email: string; name: string;
  passwordHash: string; salt: string; createdAt: string;
}

interface AriaMembership {
  id: string; tenantId: string; userId: string; role: AriaRole;
}

/* ── CRM entities ── */
interface AriaAccount {
  id: string; tenantId: string; name: string;
  domain: string;            // the company email domain
  industry: string;          // for firmographic fit
  size: number;              // employee count bucket
  ownerId: string;          // the rep who owns the account
  status: "active" | "inactive";
  createdAt: string;
}

interface AriaContact {
  id: string; tenantId: string;
  accountId: string;        // the company
  name: string; email: string; title: string;
  ownerId: string;
  /** traits the sequence engine seeds deterministically from */
  traits: { replyRate: number; openRate: number; busySignal: boolean };
  createdAt: string;
}

interface AriaLead {
  id: string; tenantId: string;
  status: "new" | "working" | "nurturing" | "unqualified" | "qualified";
  source: string;
  priority: LeadPriority;
  /** ISO — set when the first reply to this lead landed */
  firstResponseAt: string | null;
  /** ISO — created + SLA target by priority */
  slaDueAt: string;
  /** null until converted */
  converted: { accountId: string; contactId: string; dealId: string | null; at: string } | null;
  ownerId: string;
  createdAt: string;
}
type LeadPriority = "low" | "normal" | "high" | "urgent";

interface AriaPipeline {
  id: string; tenantId: string; name: string;
  /** ordered stages, index = position; open = not won/lost, closed = won|lost */
  stages: Array<{ id: string; name: string; probability: number; state: "open" | "closed_won" | "closed_lost" }>;
  createdAt: string;
}

interface AriaDeal {
  id: string; tenantId: string;
  pipelineId: string;
  stageId: string;         // the current stage within the pipeline
  accountId: string; contactId: string;
  amount: number;          // USD
  forecastCategory: "pipeline" | "best_case" | "commit" | "omitted" | "closed";
  ownerId: string;
  expectedCloseDate: string; // YYYY-MM-DD
  /** ISO when the deal was closed (won or lost), null while open */
  closedAt: string | null;
  lostReason: string | null;  // REQUIRED when moving to a lost stage
  /** ISO of the LAST stage change — stalled-days signal */
  lastStageChangeAt: string;
  createdAt: string;
}

/* ── Activities & tasks ── */
type ActivityKind = "call" | "email" | "meeting" | "note" | "system";
interface AriaActivity {
  id: string; tenantId: string;
  kind: ActivityKind;
  /** which entity the activity is attached to */
  entityType: "account" | "contact" | "deal";
  entityId: string;
  body: string;
  actorId: string | null;  // null for system events
  at: string;
}

interface AriaTask {
  id: string; tenantId: string;
  title: string;
  ownerId: string;
  entityType: "account" | "contact" | "deal" | "lead";
  entityId: string;
  due: string;           // ISO
  priority: "low" | "normal" | "high" | "urgent";
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}

/* ── Notes & tags ── */
interface AriaNote {
  id: string; tenantId: string;
  entityType: "account" | "contact" | "deal" | "lead";
  entityId: string;
  authorId: string;
  body: string;
  at: string;
}

interface AriaTag {
  id: string; tenantId: string;
  label: string;
}

/* Tags on an entity: a many-to-many via a `tags` array on the entity row
   (the parley `Conversation.tags` pattern — denormalized label lists,
   validated against the tenant's vocabulary on write). */

/* ── Sequences (the deterministic cadence engine) ── */
type SeqStepType = "email" | "wait" | "task" | "branch";

interface AriaSequence {
  id: string; tenantId: string;
  name: string;
  /** the ordered step list */
  steps: Array<SeqStep>;
  /** the deterministic trait seed the engine uses (0..1) */
  traitSeed: number;
  createdAt: string;
}

interface SeqStep {
  id: string;
  type: SeqStepType;
  name: string;
  /** email step: the template + variables */
  email?: { templateId: string; subject: string; body: string; variables?: Record<string, string> };
  /** wait step: business days to wait */
  waitDays?: number;
  /** task step: the task title + priority */
  task?: { title: string; priority: "low" | "normal" | "high" | "urgent" };
  /** branch step: on engagement state */
  branch?: { onEngagement: "none" | "replied" | "opened" | "meeting_booked"; targetStepId?: string };
}

type AriaEngagement = "sent" | "open" | "reply" | "meeting_booked";

interface AriaEnrollment {
  id: string; tenantId: string;
  contactId: string;
  sequenceId: string;
  state: "enrolled" | "active" | "completed" | "exited_by_reply" | "exited_manually" | "bounced";
  /** the current step cursor */
  stepIndex: number;
  /** ISO — when the enrollment was created */
  createdAt: string;
  /** ISO — when the enrollment reached a terminal state */
  completedAt: string | null;
  /** the deterministic per-contact trait multiplier (0..1) */
  traitMult: number;
}

interface AriaEmailTemplate {
  id: string; tenantId: string;
  subject: string;
  body: string;
  variables: string[];
  createdAt: string;
}

/* ── The deterministic engagement event log (simulated from traits) ── */
interface AriaEngagementEvent {
  id: string; tenantId: string;
  enrollmentId: string;
  kind: AriaEngagement;
  at: string;  // ISO
}

/* ── Mailbox (the simulated outbound) ── */
interface AriaMailboxMessage {
  id: string; tenantId: string;
  enrollmentId: string | null;  // null for manual outbound
  contactId: string;
  subject: string;
  body: string;
  at: string;
  /** the deterministic engagement outcome (sent → open → reply?) */
  outcome: "sent" | "opened" | "replied" | "bounced";
}

/* ── Quotas ── */
interface AriaQuota {
  id: string; tenantId: string;
  userId: string;
  /** ISO of the period start (quarter boundary) */
  periodStart: string;
  /** ISO of the period end */
  periodEnd: string;
  target: number;  // USD
}

/* ── Forecast snapshots (IMMUTABLE) ── */
interface AriaForecastSnapshot {
  id: string; tenantId: string;
  periodStart: string;  // ISO quarter start
  periodEnd: string;
  /** ISO — when the snapshot was taken */
  capturedAt: string;
  /** the weighted pipeline total at capture */
  weightedTotal: number;
  /** per-stage breakdown */
  byStage: Record<stageId, number>;
  /** per-category breakdown */
  byCategory: Record<forecastCategory, number>;
  /** the raw record ids this total was computed from (drill-down) */
  dealIds: string[];
}

/* ── Audit (immutable, copy-on-write) ── */
interface AriaAuditEvent {
  id: string; tenantId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  meta: { before: unknown; after: unknown };
  createdAt: string;
}

/* ── Full state (the seed + store own this shape) ── */
interface AriaState {
  version: 1;
  tenants: AriaTenant[];
  users: AriaUser[];
  memberships: AriaMembership[];
  accounts: AriaAccount[];
  contacts: AriaContact[];
  leads: AriaLead[];
  pipelines: AriaPipeline[];
  deals: AriaDeal[];
  activities: AriaActivity[];
  tasks: AriaTask[];
  notes: AriaNote[];
  tags: AriaTag[];
  sequences: AriaSequence[];
  enrollments: AriaEnrollment[];
  emailTemplates: AriaEmailTemplate[];
  engagementEvents: AriaEngagementEvent[];
  mailbox: AriaMailboxMessage[];
  quotas: AriaQuota[];
  forecastSnapshots: AriaForecastSnapshot[];
  sessions: Array<{ id: string; userId: string; tenantId: string; expiresAt: string }>;
  audit: AriaAuditEvent[];
  /** monotonic counter for deterministic id generation */
  seq: number;
}
```

---

## 2. The `src/lib/aria/` Module List

Each module is one-line responsibility; pure functions, explicit `now`, no I/O in domain modules (the store is the only I/O owner).

```
src/lib/aria/
├── types.ts          # All domain types + the AriaState interface + AS_OF + PLAN caps
├── ids.ts           # mulberry32 + newId(prefix) deterministic id generators
├── clock.ts         # Pinned clock (setClock/resetClock/now) — the single mutable read
├── tenancy.ts       # assertTenant + crossTenant + makeCtx (fail-closed, parley pattern)
├── rbac.ts          # The data-driven can(role, action) matrix + owner-seat carve-out
├── visibility.ts    # The ownership/visibility layer: visibleRecords(state, ctx, entityType)
├── password.ts      # scrypt hash/verify (parley pattern: N=16384, r=8, p=1)
├── sessions.ts      # Session row + HMAC-signed cookie (parley pattern)
├── audit.ts         # recordAudit (copy-on-write) + auditQuery
├── metering.ts      # seat caps, pipeline/sequence caps, quota checks
├── validation.ts    # Pure field validators for every API input (400 body shape)
├── seed.ts          # Deterministic seed: 2 tenants, ~2 quarters of deal history
├── store.ts         # File-backed JSON store: atomic writes, cache, structural reseed
├── forecast.ts      # Pure forecast math: weightedValue, commit ladder, rollups, coverage
├── triage.ts        # Deterministic AI triage: lead score, deal health, NBA, anomalies
├── reporting.ts     # Pure reporting: win rate, sales cycle, funnel, cohorts, drill-down
├── sequences.ts     # The deterministic cadence engine: advance(enrollment, events, ctx)
├── store.test.ts   # (the store's test — lives alongside, fugue pattern)
└── *.test.ts       # One test file per module (lib tests: ~200-240 total)
```

---

## 3. The API Route Map

**Auth level ladder (parley pattern):**
- `public` — no session required
- `auth` — requires a valid session (401 if absent/invalid/expired)
- `auth + can(role, action)` — 403 when the RBAC matrix denies
- `auth + can + visibility` — 404 when the record is outside the user's visibility scope

**Error bodies (parley shape):**
- 401: `{ error: "unauthenticated", status: 401 }`
- 403: `{ error: "forbidden", permission: "<action>", status: 403 }`
- 404: `{ error: "not found", status: 404 }`
- 402: `{ error: "quota_exceeded", status: 402 }`
- 400: `{ error: "validation failed", errors: [...], status: 400 }`

### 3.1 Auth routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| POST | `/aria/api/auth/login` | public | — | `{ email, password }` | 200 `{ session, user, tenant, role }` + Set-Cookie; 401 on bad creds |
| POST | `/aria/api/auth/logout` | auth | — | — | 204 + clears cookie; 401 if no session |
| GET | `/aria/api/auth/session` | auth | — | — | 200 `{ session, user, tenant, role }`; 401 if no/invalid |

### 3.2 Tenant & member routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/aria/api/tenants` | auth | `tenant.list` | — | 200 `[AriaTenant]` |
| GET | `/aria/api/tenants/[id]` | auth | `tenant.read` | — | 200 `AriaTenant`; 404 cross-tenant |
| PATCH | `/aria/api/tenants/[id]` | auth | `tenant.settings` | `{ name?, plan?, quotas? }` | 200 `AriaTenant`; 403 for non-owner |
| GET | `/aria/api/members` | auth | `member.list` | — | 200 `[{ membership, user }]` |
| POST | `/aria/api/invites` | auth | `invite.create` | `{ email, role }` | 201 `AriaInvite`; 402 at seat cap |
| POST | `/aria/api/invites/accept` | public | — (token) | `{ token, name, password }` | 201 `{ user, membership }`; 404 unknown; 410 used/expired; 402 at cap |

### 3.3 CRM entity routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/aria/api/accounts` | auth | `account.list` | `?q=` `?ownerId=` `?status=` | 200 `[AriaAccount]` (filtered by visibility) |
| GET | `/aria/api/accounts/[id]` | auth | `account.read` | — | 200 `AriaAccount` + `contacts: [AriaContact]`; 404 cross-tenant or invisible |
| POST | `/aria/api/accounts` | auth | `account.create` | `{ name, domain, industry, size, ownerId }` | 201 `AriaAccount` |
| PATCH | `/aria/api/accounts/[id]` | auth | `account.update` | `{ name?, industry?, size?, status? }` | 200 `AriaAccount` |
| GET | `/aria/api/contacts` | auth | `contact.list` | `?q=` `?accountId=` `?ownerId=` | 200 `[AriaContact]` |
| GET | `/aria/api/contacts/[id]` | auth | `contact.read` | — | 200 `AriaContact` + `deals: [AriaDeal]` + `activities: [AriaActivity]`; 404 |
| POST | `/aria/api/contacts` | auth | `contact.create` | `{ accountId, name, email, title, ownerId, traits? }` | 201 `AriaContact`; 409 if email already exists in tenant |
| PATCH | `/aria/api/contacts/[id]` | auth | `contact.update` | `{ name?, title?, email?, traits? }` | 200 `AriaContact` |
| GET | `/aria/api/leads` | auth | `lead.list` | `?status=` `?source=` `?slaState=` | 200 `[AriaLead]` with computed `slaState` |
| GET | `/aria/api/leads/[id]` | auth | `lead.read` | — | 200 `AriaLead` + `activities`; 404 |
| POST | `/aria/api/leads` | auth | `lead.create` | `{ name, email, source, priority, ownerId }` | 201 `AriaLead` (find-or-create contact + account) |
| PATCH | `/aria/api/leads/[id]` | auth | `lead.update` | `{ status?, source?, priority? }` | 200 `AriaLead` |
| POST | `/aria/api/leads/[id]/convert` | auth | `lead.convert` | `{ accountId?, contactId?, dealId?, amount? }` | 200 `{ lead, account, contact, deal }` (atomic: creates/links all, moves lead to converted) |

### 3.4 Pipeline & deal routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/aria/api/pipelines` | auth | `pipeline.list` | — | 200 `[AriaPipeline]` |
| POST | `/aria/api/pipelines` | auth | `pipeline.create` | `{ name, stages: [{name, probability, state}] }` | 201 `AriaPipeline`; 402 at cap |
| GET | `/aria/api/pipelines/[id]` | auth | `pipeline.read` | — | 200 `AriaPipeline` + `deals: [AriaDeal]`; 404 |
| PATCH | `/aria/api/pipelines/[id]` | auth | `pipeline.update` | `{ name?, stages? }` | 200 `AriaPipeline` |
| GET | `/aria/api/deals` | auth | `deal.list` | `?pipelineId=` `?stageId=` `?ownerId=` `?forecastCategory=` `?status=open\|won\|lost` | 200 `[AriaDeal]` (visibility-filtered) |
| GET | `/aria/api/deals/[id]` | auth | `deal.read` | — | 200 `AriaDeal` + `activities` + `tasks`; 404 |
| POST | `/aria/api/deals` | auth | `deal.create` | `{ pipelineId, stageId, accountId, contactId, amount, forecastCategory, ownerId, expectedCloseDate }` | 201 `AriaDeal` |
| PATCH | `/aria/api/deals/[id]` | auth | `deal.update` | `{ amount?, stageId?, forecastCategory?, expectedCloseDate?, ownerId?, lostReason? }` | 200 `AriaDeal`; 400 if moving to lost without `lostReason` |
| POST | `/aria/api/deals/[id]/stage` | auth | `deal.stage` | `{ stageId, lostReason? }` | 200 `AriaDeal`; 400 if target is lost-stage without `lostReason`; 400 if deal is closed (invariant) |

### 3.5 Activity & task routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/aria/api/activities` | auth | `activity.list` | `?entityType=` `?entityId=` `?kind=` | 200 `[AriaActivity]` (timeline, newest-first) |
| POST | `/aria/api/activities` | auth | `activity.create` | `{ kind, entityType, entityId, body }` | 201 `AriaActivity` |
| GET | `/aria/api/tasks` | auth | `task.list` | `?entityId=` `?ownerId=` `?done=` `?slaState=` | 200 `[AriaTask]` with computed `slaState` |
| POST | `/aria/api/tasks` | auth | `task.create` | `{ title, ownerId, entityType, entityId, due, priority }` | 201 `AriaTask` |
| PATCH | `/aria/api/tasks/[id]` | auth | `task.update` | `{ title?, due?, priority?, done?, doneAt? }` | 200 `AriaTask` |

### 3.6 Note & tag routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/aria/api/notes` | auth | `note.list` | `?entityType=` `?entityId=` | 200 `[AriaNote]` (newest-first) |
| POST | `/aria/api/notes` | auth | `note.create` | `{ entityType, entityId, body }` | 201 `AriaNote` |
| GET | `/aria/api/tags` | auth | `tag.list` | — | 200 `[AriaTag]` |
| POST | `/aria/api/tags` | auth | `tag.create` | `{ label }` | 201 `AriaTag`; 409 if duplicate in tenant |
| PATCH | `/aria/api/tags/[id]` | auth | `tag.update` | `{ label }` | 200 `AriaTag` |
| DELETE | `/aria/api/tags/[id]` | auth | `tag.delete` | — | 204; removes tag from all entity rows |

### 3.7 Sequence & enrollment routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/aria/api/sequences` | auth | `sequence.list` | — | 200 `[AriaSequence]` |
| POST | `/aria/api/sequences` | auth | `sequence.create` | `{ name, steps, traitSeed }` | 201 `AriaSequence`; 402 at cap |
| GET | `/aria/api/sequences/[id]` | auth | `sequence.read` | — | 200 `AriaSequence` + `enrollments: [AriaEnrollment]`; 404 |
| POST | `/aria/api/enrollments` | auth | `enrollment.create` | `{ contactId, sequenceId }` | 201 `AriaEnrollment` (state: `enrolled`) |
| POST | `/aria/api/enrollments/[id]/advance` | auth | `enrollment.advance` | `{ events: AriaEngagement[] }` | 200 `{ enrollment, newEvents, mailboxMsgs }` (the deterministic engine's output) |
| POST | `/aria/api/enrollments/[id]/exit` | auth | `enrollment.exit` | `{ reason: "manual" }` | 200 `AriaEnrollment` (state: `exited_manually`) |
| GET | `/aria/api/mailbox` | auth | `mailbox.list` | `?contactId=` `?outcome=` | 200 `[AriaMailboxMessage]` (newest-first) |

### 3.8 Reporting & triage routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| GET | `/aria/api/reports/pipeline` | auth | `report.read` | `?pipelineId=` | 200 `{ weightedByStage: Record<stageId, number>, openCount, openWeighted }` |
| GET | `/aria/api/reports/stuck` | auth | `report.read` | `?days=14` | 200 `[AriaDeal]` (deals stalled ≥ days in current stage) |
| GET | `/aria/api/reports/slipped` | auth | `report.read` | — | 200 `[AriaDeal]` (close date moved ≥ 1x from original) |
| GET | `/aria/api/reports/winrate` | auth | `report.read` | `?period=quarter` | 200 `{ won, lost, rate, byOwner: Record<ownerId, {won,lost,rate}> }` |
| GET | `/aria/api/reports/salescycle` | auth | `report.read` | — | 200 `{ medianDays, byOwner: Record<ownerId, number> }` |
| GET | `/aria/api/reports/funnel` | auth | `report.read` | `?pipelineId=` | 200 `{ stages: [{ id, name, count, conversion }] }` |
| GET | `/aria/api/reports/cohorts` | auth | `report.read` | `?months=6` | 200 `{ cohorts: [{ month, created, won, winRate }] }` |
| GET | `/aria/api/reports/forecast` | auth | `report.read` | `?period=` | 200 `{ commitLadder, weightedTotal, coverage, byRep: Record<repId, {quota, actual, remaining}> }` |
| GET | `/aria/api/reports/drilldown` | auth | `report.read` | `?metric=weighted\|commit\|stage&value=<id>` | 200 `{ metric, value, records: [AriaDeal] }` (the "open the number" route) |
| GET | `/aria/api/triage/leads` | auth | `triage.read` | `?top=` | 200 `[AriaLead]` with `score: 0-100` + `components: [{name, weight, value}]` |
| GET | `/aria/api/triage/deals` | auth | `triage.read` | `?top=` | 200 `[AriaDeal]` with `healthGrade: A-D` + `signals: [string]` + `nextBestAction: string` |
| GET | `/aria/api/triage/anomalies` | auth | `triage.read` | — | 200 `[{ type: "amount_outlier"\|"forecast_drift"\|"quarter_end_bunching", deals: [AriaDeal] }]` |

### 3.9 Import & audit routes

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| POST | `/aria/api/import` | auth | `import.run` | `{ type: "contacts"\|"deals", csv: string, dryRun: boolean }` | 200 `{ imported: number, errors: [{row, field, message}], duplicates: [{email\|domain, existingId}] }` |
| GET | `/aria/api/audit` | auth | `audit.read` | `?action=` `?entityType=` | 200 `[AriaAuditEvent]` (newest-first, filtered) |
| POST | `/aria/api/demo/reset` | public | — | — | 200 `{ reset: true, demoSessionId, demoCookie }` + Set-Cookie |

### 3.10 Forecast snapshot route

| Method | Path | Auth | RBAC | Request | Response |
|---|---|---|---|---|---|
| POST | `/aria/api/forecast/snapshot` | auth | `forecast.capture` | `{ periodStart, periodEnd }` | 201 `AriaForecastSnapshot` (IMMUTABLE — no PATCH/DELETE routes) |
| GET | `/aria/api/forecast/snapshots` | auth | `report.read` | — | 200 `[AriaForecastSnapshot]` |

---

## 4. The Sequence-Engine Design

**The determinism contract (fugue EngineCtx pattern):**
- `advance(enrollment, sequence, events, ctx)` is a **pure function** — zero I/O, zero `Date.now()`, zero `Math.random()`.
- `ctx: { now(): string; nextEventId(): string; nextMailId(): string; }` — the clock and id generators are injected.
- The engine simulates engagement **deterministically from the enrollment's `traitMult`** (a per-contact 0..1 value derived from `contact.traits` + `sequence.traitSeed`).
- Two calls with the same inputs → the same outputs (the "two seeds deep-equal" pin, parley pattern).

**States & transitions:**
```
enrolled → active → completed
                 → exited_by_reply
                 → exited_manually
                 → bounced
```
- `enrolled` → `active`: on the first `advance` call.
- `active` → `completed`: when all steps are consumed and no terminal event fired.
- `active` → `exited_by_reply`: on a `reply` event (auto-exit — the brief's "reply auto-exits").
- `active` → `exited_manually`: on the `exit` API call.
- `active` → `bounced`: when the simulated engagement outcome is `bounced` (traitMult < 0.15, the deterministic threshold).

**Step semantics:**
1. **`email` step** — the engine:
   - Generates a deterministic engagement outcome: `sent` → (if traitMult > 0.3) `open` → (if traitMult > 0.6 AND a `reply` event is in the input) `reply` → `meeting_booked` (if traitMult > 0.8).
   - Appends a `AriaMailboxMessage` with the outcome.
   - If the outcome is `reply`, the enrollment exits immediately.
   - If the outcome is `bounced`, the enrollment exits immediately.
2. **`wait` step** — the engine records a `AriaEngagementEvent` with `kind: "sent"` and the `waitDays` as the delay; the step is marked consumed (the actual waiting is simulated — no real timer).
3. **`task` step** — the engine creates a `AriaTask` (via the ctx's `nextTaskId()` — the store provides it) with the step's `title` + `priority`.
4. **`branch` step** — the engine checks the current engagement state:
   - If `onEngagement: "replied"` AND the last event is `reply` → jump to `targetStepId` (or fall-through).
   - If `onEngagement: "opened"` AND the last event is `open` → jump to `targetStepId`.
   - Otherwise → fall-through to the next step.

**The engine's output (the API route's 200 body):**
```ts
{
  enrollment: AriaEnrollment,  // the updated enrollment
  newEvents: AriaEngagementEvent[],  // the events generated
  mailboxMsgs: AriaMailboxMessage[],  // the outbound emails
}
```

**Determinism invariants (the PBT-style tests pin these):**
- Same `enrollment` + `sequence` + `events` + `ctx` → same output, always.
- The engine never reopens a closed enrollment (terminal states are final).
- The traitMult is a pure function of `contact.traits` + `sequence.traitSeed` (no per-call randomness).

---

## 5. The Test Plan

### 5.1 Lib tests (~200-240 total, one file per module)

| File | ~Count | What it pins |
|---|---|---|
| `tenancy.test.ts` | 15 | assertTenant throws on null/undefined/empty; crossTenant true/false; makeCtx builds the ctx |
| `rbac.test.ts` | 20 | The matrix: every (action, role) pair; the owner-seat carve-out |
| `visibility.test.ts` | 20 | rep sees own; manager sees team; admin/owner see all; viewer read-only |
| `password.test.ts` | 10 | scrypt round-trip; wrong password → false; corrupt digest → false (no throw) |
| `sessions.test.ts` | 15 | createSession + isExpired; HMAC sign/verify; malformed cookie → null |
| `audit.test.ts` | 10 | recordAudit appends (copy-on-write); auditQuery filters newest-first |
| `ids.test.ts` | 10 | mulberry32 determinism; two seeds → deep-equal states |
| `metering.test.ts` | 15 | seat caps, pipeline caps, sequence caps, quota checks |
| `validation.test.ts` | 25 | Every input validator: 400 field errors, email regex, duplicate detection |
| `seed.test.ts` | 15 | Two seeds deep-equal; the AS_OF pin; the tenant-differentiated quotas/SLAs |
| `store.test.ts` | 25 | loadState (missing → reseed, corrupt → reseed, stale version → reseed); saveState atomic; nextId increments; resetState |
| `forecast.test.ts` | 20 | weightedValue = amount × probability; commit ladder sums; rollups; coverage ratio |
| `triage.test.ts` | 20 | Lead score 0-100 (components sum); deal health A-D; NBA ranking; anomaly flags (2σ, drift, bunching) |
| `reporting.test.ts` | 20 | Win rate; median sales cycle; funnel conversion; cohorts; drill-down recomputable |
| `sequences.test.ts` | 30 | Every step type's semantics; the state machine (no reopening terminals); determinism (same input → same output); reply auto-exit; bounce threshold |
| `invariant.test.ts` | 25 | PBT-style: deal stage transitions never reopen closed deals; contacts unique by email per tenant; every forecast total recomputable from raw records; audit events never mutate |

### 5.2 API tests (~100-120, in `src/app/aria/api/__tests__/`)

| File | ~Count | What it pins |
|---|---|---|
| `auth.test.ts` | 15 | 401 ladder (absent/invalid/expired cookie); 403 permission; 404 cross-tenant; 402 quota |
| `tenancy.test.ts` | 15 | Every entity route: cross-tenant read → 404 (never 403); no-context → 401 |
| `accounts.test.ts` | 10 | CRUD + find-or-create; 409 on duplicate domain |
| `contacts.test.ts` | 10 | CRUD + email uniqueness (409); traits simulation |
| `leads.test.ts` | 15 | CRUD + conversion (atomic: creates account + contact + deal, moves lead to converted) |
| `deals.test.ts` | 15 | CRUD + stage transitions (lost requires reason; closed deals never reopen) |
| `activities.test.ts` | 5 | Timeline append + filter |
| `tasks.test.ts` | 10 | CRUD + SLA state computation |
| `sequences.test.ts` | 15 | Enrollment + advance + exit; mailbox append; the deterministic engine's output |
| `import.test.ts` | 10 | CSV dry-run validation; duplicate email/domain detection; per-row errors |
| `audit.test.ts` | 5 | Filterable feed; admin-only (403 for rep/viewer) |
| `forecast.test.ts` | 10 | Snapshot capture (IMMUTABLE — no mutation routes); drill-down recompute |
| `triage.test.ts` | 10 | Lead score + deal health + anomaly flags (the deterministic rules) |
| `adversarial.test.ts` | 15 | 27-probe adversarial suite (the parley pattern): malformed cookies, cross-tenant probes, RBAC matrix sweep |

### 5.3 UI tests (~30-40, in `src/components/aria/__tests__/`)

| File | ~Count | What it pins |
|---|---|---|
| `aria-components.test.tsx` | 35 | Shell (embed-aware chrome); login screen; account list; deal detail (stage transitions, lost-reason gate); sequence timeline; RBAC-disabled-with-reason surfaces; the embed reset listener |
| `aria-invariant.test.tsx` | 5 | The UI never reopens a closed deal (the invariant surfaces in the disabled state) |

**Total: ~330-380 tests across the three lanes.**

---

## 6. The Build Phase Decomposition

### Phase 0 — Plan (this document)
- **Acceptance:** The plan is committed; the data model, module list, route map, engine design, test plan, and risk list are the build contract.
- **What a build session is told:** "This is the plan. It is the build contract. Zero human edits will follow it. Build the lib phase next."

### Phase 1 — Lib (the domain layer)
- **What:** `src/lib/aria/` — all 16 modules + 16 test files (~200-240 tests).
- **Acceptance:**
  - `bun test src/lib/aria` → all tests green.
  - `bun run typecheck` → clean.
  - The store's `loadState` / `saveState` / `nextId` / `resetState` are pinned (atomic writes, structural reseed).
  - The sequence engine's `advance` is hermetic (zero I/O, clock-injected, determinism pinned).
  - The invariant tests pin: no closed-deal reopening, email uniqueness, forecast recompute, audit immutability.
- **Commit:** `aria: the domain layer` (explicit paths: `src/lib/aria/**`).

### Phase 2 — API (the routes)
- **What:** `src/app/aria/` — the layout, page, `globals.css`, `_auth.ts`, `_rate.ts`, and all ~50 route files + 13 test files (~100-120 tests).
- **Acceptance:**
  - `bun test src/app/aria` → all tests green.
  - The 401/403/404/402/400 ladder is pinned (the `adversarial.test.ts` suite).
  - The demo reset route works (reseed + demo session rotation).
  - The CSV import route does dry-run validation (duplicate detection, per-row errors).
  - The mailbox route serves the simulated outbound.
- **Commit:** `aria: the API layer` (explicit paths: `src/app/aria/**`).

### Phase 3 — UI (the components + client store)
- **What:** `src/components/aria/` — the shell, login, account list, deal detail, sequence timeline, primitives + 2 test files (~30-40 tests).
- **Acceptance:**
  - `bun test src/components/aria` → all tests green.
  - The RBAC-disabled-with-reason surfaces are pinned (a viewer's UI shows the write controls disabled + the reason).
  - The embed reset listener is origin-checked + shape-checked (the `aria-reset` handshake).
  - The chart + primitives follow the cadence pattern (accessible SVG, `role="img"` + `aria-label`).
- **Commit:** `aria: the UI layer` (explicit paths: `src/components/aria/**`, `src/app/aria/client-store.tsx`, `src/app/aria/page.tsx`).

### Phase 4 — Embed + landing
- **What:** The embed-contract requirements (Section 8) + the landing gallery entry.
- **Acceptance:**
  - `?embed=1` serializes `embed: true` (the server-side read, the F3 pin).
  - The `aria-reset` postMessage handshake works (the origin-checked listener).
  - CSP frame-ancestors for `/aria/:path*` is in `next.config.ts`.
  - The scoped stylesheet + favicon are in place.
  - The landing gallery entry + test pins are green.
- **Commit:** `aria: the embed + landing` (explicit paths: `next.config.ts`, `src/components/landing/live-demo-data.ts`, `public/aria/favicon.svg`).

### Phase 5 — E2E + review
- **What:** The live headless-Chromium pass + the adversarial review round.
- **Acceptance:**
  - E2E: all 8 steps green (login, account list, deal detail, sequence advance, import dry-run, forecast drill-down, audit feed, reset).
  - The adversarial suite (27 probes) is green.
  - The P0 regression pins are in place.
- **Commit:** `aria: the E2E + review round` (explicit paths: the test files + any fixes).

---

## 7. The Risks List (12+ with mitigations)

1. **Cross-tenant leak (P0):** a route returns 403 instead of 404 for a cross-tenant read.
   - **Mitigation:** the `crossTenant` helper is the single source of truth; the API layer maps `true` → 404. The `tenancy.test.ts` + `adversarial.test.ts` pin the 404 (never 403) for every entity route.

2. **Closed-deal reopening (P0):** a stage transition moves a won/lost deal back to an open stage.
   - **Mitigation:** the `deal.stage` route checks `deal.closedAt !== null` → 400. The invariant test pins "deal stage transitions never reopen a closed deal." The UI disables the stage picker for closed deals.

3. **Email uniqueness violation (P0):** two contacts in the same tenant share an email.
   - **Mitigation:** the `contact.create` route does a case-insensitive email lookup → 409. The invariant test pins "contacts unique by email per tenant."

4. **Forecast drift (P1):** a forecast snapshot's total doesn't match the raw records.
   - **Mitigation:** the `AriaForecastSnapshot` carries `dealIds` — the drill-down route recomputes the total from the raw records and compares. The invariant test pins "every forecast total is recomputable from raw records."

5. **Sequence engine non-determinism (P1):** two `advance` calls with the same input produce different outputs.
   - **Mitigation:** the engine is a pure function (zero I/O, clock-injected, no `Math.random`). The traitMult is a pure function of `contact.traits` + `sequence.traitSeed`. The `sequences.test.ts` pins the determinism contract (same input → same output, 100 iterations).

6. **Audit mutation (P1):** an audit event is modified in place (the copy-on-write contract breaks).
   - **Mitigation:** `recordAudit` returns a new state with a new array (the parley pattern). The invariant test pins "audit events never mutate" (the array reference changes, the object references stay the same).

7. **Seat-cap bypass (P1):** an invite lands on a tenant at the cap.
   - **Mitigation:** the `invite.accept` route checks `seatsUsed >= PLAN_CAPS[plan].seats` → 402. The `metering.test.ts` pins the cap.

8. **Pipeline/sequence cap bypass (P1):** a tenant creates more pipelines/sequences than the plan allows.
   - **Mitigation:** the `pipeline.create` / `sequence.create` routes check the cap → 402. The `metering.test.ts` pins the caps.

9. **CSV import silent failure (P2):** a malformed CSV row is silently dropped.
   - **Mitigation:** the `import.run` route does a dry-run first (the `dryRun: true` flag) — it returns per-row errors + duplicate detection without committing. The `import.test.ts` pins the error shape.

10. **Mailbox overflow (P2):** the simulated mailbox grows unbounded.
    - **Mitigation:** the store's `RETENTION` cap (the fugue pattern): keep the latest N=100 mailbox messages per tenant; older messages are pruned on write. The `store.test.ts` pins the retention.

11. **HMAC secret in the repo (accepted, documented):** the demo HMAC key + the seed's scrypt salts are public-by-design (the parley round's conscious acceptance for a same-origin iframe demo).
    - **Mitigation:** the risk is documented in the session record + the AGENTS.md; a real deployment would source the key from env (the parley `sessions.ts` header says exactly this). The embed is same-origin only (the CSP frame-ancestors header enforces it).

12. **Rate-limit bucket bleed (P2):** the `_rate.ts` buckets leak across test files.
    - **Mitigation:** the `resetRateBuckets()` test-lane convenience is called in every API test's `beforeEach` (the parley pattern). The `api.test.ts` pins the 429 → 200 recovery.

13. **Multi-instance state divergence (accepted, documented):** each server instance has its own seed + its own session rows + its own mutations (the parley round's honest bound — the Vercel multi-instance property; not fixed with Redis/DB).
    - **Mitigation:** the risk is documented in the session record; the file-backed store's `data/aria/state.json` is per-instance (the fugue pattern). The embed reset route reseeds the instance's store (the "Reset returns to seed" pin).

---

## 8. The Embed-Contract Requirements

### 8.1 `?embed=1` serialization
- **The server-side read (the F3 pin):** `src/app/aria/page.tsx` reads `searchParams.embed` server-side (the `Suspense` + async inner shape, the bazaar/cadence/parley pattern) and passes `embed: boolean` as a PROP to the client tree.
- **The client:** `ParleyProvider`-shaped `AriaProvider` takes `embed: boolean` + `hasSession: boolean` (the server also reads the `aria_ses` cookie and passes it).
- **The test pin:** `?embed=1` serializes `embed: true` in the HTML; no-query serializes `embed: false`. The `src/app/aria/__tests__/page.test.tsx` pins this.

### 8.2 The `aria-reset` postMessage handshake
- **The client listener:** `AriaProvider` mounts a `window.addEventListener("message", ...)` ONLY when `embed === true`.
- **The origin check:** `if (e.origin !== window.origin) return;`
- **The shape check:** `if (!data || data.source !== "unown-landing" || data.type !== "aria-reset") return;`
- **The action:** POST `/aria/api/demo/reset` (the no-session route), re-probe the session, reload the tenant's data (the parley `client-store.tsx` pattern).
- **The test pin:** the `aria-components.test.tsx` fires a `postMessage` with the right shape → the fetch is called; a wrong origin or shape → the fetch is NOT called.

### 8.3 CSP frame-ancestors for `/aria/:path*`
- **The `next.config.ts` block:**
  ```ts
  {
    source: "/aria/:path*",
    headers: [
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ],
  }
  ```
- **The test pin:** the `src/app/aria/__tests__/layout.test.tsx` pins the headers on a `GET /aria?embed=1` response.

### 8.4 The scoped stylesheet
- **The `src/app/aria/globals.css`:**
  - `@import "tailwindcss";` + the `@source` scoping (the parley pattern: `@source "../../../components/aria"`, `@source "../../../lib/aria"`, `@source "../../aria"`).
  - The `.aria-scope` wrapper (the standalone app's `:root` rules re-anchored onto the wrapper — the parley `globals.css` pattern).
  - The GBA 5-bit palette tokens (dark by default, light theme swaps the same tokens).
- **The layout:** `src/app/aria/layout.tsx` imports the scoped stylesheet (Next injects it for `/aria` routes only) and renders the `.aria-scope` wrapper.

### 8.5 The favicon
- **The `public/aria/favicon.svg`:** the two-speech-bubble CRM mark (the parley favicon pattern — the F7 finding's ship).
- **The layout's `metadata.icons`:** `{ icon: [{ url: "/aria/favicon.svg", type: "image/svg+xml" }] }`.

### 8.6 The landing gallery entry
- **The `src/components/landing/live-demo-data.ts` entry:**
  ```ts
  {
    id: "aria",
    name: "Aria",
    route: "/aria",
    url: "unown-nine.vercel.app/aria?embed=1",
    poster: "/landing/aria/poster.png",
    posterAlt: "Aria — the enterprise CRM unown built: accounts, deals, sequences and forecasts, running live",
    resetType: "aria-reset",
    receipt: {
      sessions: 24,
      toolCalls: 1300,
      files: 90,
      tests: 350,
      commits: 8,
      embeddingAdaptations: 9,
      receiptDoc: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/aria-demo-session.md",
    },
  }
  ```
- **The test pin:** the `live-demo.test.tsx` pins the 6th entry + the `aria-reset` type.

---

**The plan is complete.** Every entity field, every module, every route, every test, every phase, every risk, and every embed requirement is named. The next build session takes this document as the contract and executes Phase 1 (the lib layer) first.