/**
 * The deterministic aria seed.
 *
 * No `Math.random()`, no `Date.now()` — the clock is the explicit
 * `now` param (default `AS_OF`) and the RNG is a fixed-seed
 * mulberry32. Seeded users carry FIXED demo-constant scrypt salts
 * (`s-aria-<slug>-<user>`, public-by-design for the iframe demo — a
 * fresh `crypto.randomBytes` salt would break the two-seeds-
 * deep-equal determinism pin); the scrypt hashes themselves are
 * real, computed at seed time.
 *
 * Two tenants on different plans:
 *  - Lumen Labs (starter): 3 seats used, 1 pipeline, 1 sequence,
 *    tight quotas — the "small team hitting caps" fixture.
 *  - Northwind Trading (enterprise): 4 seats used, 3 pipelines,
 *    4 sequences, roomy quotas — the "big team with shape" fixture.
 * ~2 curated quarters of deal history (2026-04 through 2026-10) so
 * forecasts, cohorts, triage and anomalies show real shapes.
 */

import { mulberry32, hex4 } from "./ids";
import { hashPassword } from "./password";
import type {
  AriaAccount,
  AriaActivity,
  AriaAuditEvent,
  AriaContact,
  AriaDeal,
  AriaEmailTemplate,
  AriaEnrollment,
  AriaEngagementEvent,
  AriaLead,
  AriaMailboxMessage,
  AriaMembership,
  AriaNote,
  AriaPipeline,
  AriaQuota,
  AriaSequence,
  AriaState,
  AriaTask,
  AriaTag,
  AriaTenant,
  AriaUser,
  SeqStep,
} from "./types";

/**
 * `hoursAgo` before `now` → ISO string (real date math — no string
 * surgery, no fragility against the `now`'s time-of-day).
 */
function hoursAgo(now: string, hours: number): string {
  return new Date(new Date(now).getTime() - hours * 3_600_000)
    .toISOString()
    .replace(".000Z", "Z");
}
import { AS_OF, DEMO_PASSWORD, SEED_INTEGER } from "./types";

export { SEED_INTEGER };

/* ── fixed seed-constant ids (the parley discipline) ─────────────── */

const TENANT_IDS = ["aria-tn-lumen", "aria-tn-northwind"];

export function isSeededTenantId(id: string): boolean {
  return TENANT_IDS.includes(id);
}

/* ── time helpers ─────────────────────────────────────────────────── */

/** `days` before `now` → ISO string. */
function daysAgo(now: string, days: number): string {
  return new Date(new Date(now).getTime() - days * 86_400_000)
    .toISOString()
    .replace(".000Z", "Z");
}

/** A YYYY-MM-DD date `days` before `now`. */
function dateDaysAgo(now: string, days: number): string {
  return new Date(new Date(now).getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The quarter containing ISO `d`: `{ start, end }` ISO strings. */
function quarterOf(d: string): { start: string; end: string } {
  const dt = new Date(d);
  const q = Math.floor(dt.getUTCMonth() / 3);
  return {
    start: new Date(Date.UTC(dt.getUTCFullYear(), q * 3, 1)).toISOString().replace(".000Z", "Z"),
    end: new Date(Date.UTC(dt.getUTCFullYear(), q * 3 + 3, 1)).toISOString().replace(".000Z", "Z"),
  };
}

/* ── tenants (the plan-differentiated pair) ──────────────────────── */

const LUMEN: AriaTenant = {
  id: "aria-tn-lumen",
  slug: "lumen",
  name: "Lumen Labs",
  plan: "starter",
  quotas: {
    "usr-lumen-ada": 150_000,
    "usr-lumen-theo": 150_000,
  },
  manages: {
    "usr-lumen-mira": ["usr-lumen-ada", "usr-lumen-theo"],
  },
  leadSlaMinutes: { low: 72 * 60, normal: 24 * 60, high: 4 * 60, urgent: 60 },
  createdAt: "2026-01-01T00:00:00Z",
};

const NORTHWIND: AriaTenant = {
  id: "aria-tn-northwind",
  slug: "northwind",
  name: "Northwind Trading",
  plan: "enterprise",
  quotas: {
    "usr-nw-priya": 600_000,
    "usr-nw-marco": 500_000,
    "usr-nw-zoe": 400_000,
  },
  manages: {
    "usr-nw-ingrid": ["usr-nw-priya", "usr-nw-marco", "usr-nw-zoe"],
  },
  leadSlaMinutes: { low: 96 * 60, normal: 48 * 60, high: 8 * 60, urgent: 120 },
  createdAt: "2026-01-01T00:00:00Z",
};

/* ── users ────────────────────────────────────────────────────────── */

interface SeedUser {
  id: string;
  email: string;
  name: string;
  salt: string;
}

const USERS: SeedUser[] = [
  { id: "usr-lumen-mira", email: "mira@lumen.test", name: "Mira Chen", salt: "s-aria-lumen-mira" },
  { id: "usr-lumen-theo", email: "theo@lumen.test", name: "Theo Reyes", salt: "s-aria-lumen-theo" },
  { id: "usr-lumen-ada", email: "ada@lumen.test", name: "Ada Okafor", salt: "s-aria-lumen-ada" },
  { id: "usr-lumen-sam", email: "sam@lumen.test", name: "Sam Ito", salt: "s-aria-lumen-sam" },
  { id: "usr-nw-ingrid", email: "ingrid@northwind.test", name: "Ingrid Larsen", salt: "s-aria-nw-ingrid" },
  { id: "usr-nw-priya", email: "priya@northwind.test", name: "Priya Nair", salt: "s-aria-nw-priya" },
  { id: "usr-nw-marco", email: "marco@northwind.test", name: "Marco Vale", salt: "s-aria-nw-marco" },
  { id: "usr-nw-zoe", email: "zoe@northwind.test", name: "Zoe Tanaka", salt: "s-aria-nw-zoe" },
];

export function isSeededUserId(id: string): boolean {
  return USERS.some((u) => u.id === id);
}

/* ── memberships ──────────────────────────────────────────────────── */

const MEMBERSHIPS: AriaMembership[] = [
  { id: "mem-lumen-owner", tenantId: LUMEN.id, userId: "usr-lumen-mira", role: "owner" },
  { id: "mem-lumen-theo", tenantId: LUMEN.id, userId: "usr-lumen-theo", role: "manager" },
  { id: "mem-lumen-ada", tenantId: LUMEN.id, userId: "usr-lumen-ada", role: "rep" },
  { id: "mem-lumen-sam", tenantId: LUMEN.id, userId: "usr-lumen-sam", role: "viewer" },
  { id: "mem-nw-owner", tenantId: NORTHWIND.id, userId: "usr-nw-ingrid", role: "owner" },
  { id: "mem-nw-priya", tenantId: NORTHWIND.id, userId: "usr-nw-priya", role: "manager" },
  { id: "mem-nw-marco", tenantId: NORTHWIND.id, userId: "usr-nw-marco", role: "rep" },
  { id: "mem-nw-zoe", tenantId: NORTHWIND.id, userId: "usr-nw-zoe", role: "rep" },
];

/* ── accounts / contacts / deals (the ~2-quarter history) ────────── */

interface AccountDef {
  id: string;
  tenant: string;
  name: string;
  domain: string;
  industry: string;
  size: number;
  owner: string;
  daysAgo: number;
}

const ACCOUNT_DEFS: AccountDef[] = [
  // Lumen (4 accounts, 2 quarters of activity)
  { id: "acr_seed_01", tenant: LUMEN.id, name: "Ferrostack Systems", domain: "ferrostack.io", industry: "Manufacturing", size: 420, owner: "usr-lumen-ada", daysAgo: 178 },
  { id: "acr_seed_02", tenant: LUMEN.id, name: "Brightline Logistics", domain: "brightline.co", industry: "Logistics", size: 95, owner: "usr-lumen-theo", daysAgo: 150 },
  { id: "acr_seed_03", tenant: LUMEN.id, name: "Copperfield Retail", domain: "copperfield.com", industry: "Retail", size: 310, owner: "usr-lumen-ada", daysAgo: 95 },
  { id: "acr_seed_04", tenant: LUMEN.id, name: "Vanta Health Group", domain: "vantah.health", industry: "Healthcare", size: 1400, owner: "usr-lumen-theo", daysAgo: 40 },
  // Northwind (6 accounts)
  { id: "acr_seed_05", tenant: NORTHWIND.id, name: "Meridian Freight", domain: "meridian-freight.com", industry: "Logistics", size: 2200, owner: "usr-nw-priya", daysAgo: 190 },
  { id: "acr_seed_06", tenant: NORTHWIND.id, name: "Halcyon Media", domain: "halcyon.media", industry: "Media", size: 180, owner: "usr-nw-marco", daysAgo: 160 },
  { id: "acr_seed_07", tenant: NORTHWIND.id, name: "Quorum Analytics", domain: "quorum.ai", industry: "Analytics", size: 90, owner: "usr-nw-zoe", daysAgo: 120 },
  { id: "acr_seed_08", tenant: NORTHWIND.id, name: "Ironclad Insurance", domain: "ironclad.insure", industry: "Insurance", size: 3400, owner: "usr-nw-priya", daysAgo: 85 },
  { id: "acr_seed_09", tenant: NORTHWIND.id, name: "Solstice Energy", domain: "solstice.energy", industry: "Energy", size: 5100, owner: "usr-nw-marco", daysAgo: 55 },
  { id: "acr_seed_10", tenant: NORTHWIND.id, name: "Bluewater Marine", domain: "bluewatermarine.com", industry: "Marine", size: 75, owner: "usr-nw-zoe", daysAgo: 25 },
];

interface ContactDef {
  id: string;
  account: string;
  name: string;
  email: string;
  title: string;
  owner: string;
  daysAgo: number;
  traits: { replyRate: number; openRate: number; busySignal: boolean };
}

const CONTACT_DEFS: ContactDef[] = [
  { id: "act_seed_01", account: "acr_seed_01", name: "Dana Whitfield", email: "dana@ferrostack.io", title: "VP Engineering", owner: "usr-lumen-ada", daysAgo: 175, traits: { replyRate: 0.7, openRate: 0.85, busySignal: false } },
  { id: "act_seed_02", account: "acr_seed_02", name: "Rui Nakamura", email: "rui@brightline.co", title: "COO", owner: "usr-lumen-theo", daysAgo: 148, traits: { replyRate: 0.4, openRate: 0.6, busySignal: true } },
  { id: "act_seed_03", account: "acr_seed_03", name: "Elena Voss", email: "elena@copperfield.com", title: "CTO", owner: "usr-lumen-ada", daysAgo: 93, traits: { replyRate: 0.2, openRate: 0.3, busySignal: true } },
  { id: "act_seed_04", account: "acr_seed_04", name: "Dr. Amir Hassan", email: "amir@vantah.health", title: "CIO", owner: "usr-lumen-theo", daysAgo: 38, traits: { replyRate: 0.9, openRate: 0.95, busySignal: false } },
  { id: "act_seed_05", account: "acr_seed_05", name: "Beatriz Costa", email: "beatriz@meridian-freight.com", title: "Head of Ops", owner: "usr-nw-priya", daysAgo: 185, traits: { replyRate: 0.8, openRate: 0.9, busySignal: false } },
  { id: "act_seed_06", account: "acr_seed_06", name: "Felix Brandt", email: "felix@halcyon.media", title: "CMO", owner: "usr-nw-marco", daysAgo: 155, traits: { replyRate: 0.55, openRate: 0.7, busySignal: false } },
  { id: "act_seed_07", account: "acr_seed_07", name: "Grace Osei", email: "grace@quorum.ai", title: "Founder", owner: "usr-nw-zoe", daysAgo: 118, traits: { replyRate: 0.95, openRate: 0.99, busySignal: false } },
  { id: "act_seed_08", account: "acr_seed_08", name: "Henrik Dahl", email: "henrik@ironclad.insure", title: "VP Underwriting", owner: "usr-nw-priya", daysAgo: 82, traits: { replyRate: 0.3, openRate: 0.5, busySignal: true } },
  { id: "act_seed_09", account: "acr_seed_09", name: "Imani Brooks", email: "imani@solstice.energy", title: "Procurement Lead", owner: "usr-nw-marco", daysAgo: 52, traits: { replyRate: 0.65, openRate: 0.8, busySignal: false } },
  { id: "act_seed_10", account: "acr_seed_10", name: "Jonah Reyes", email: "jonah@bluewatermarine.com", title: "Owner", owner: "usr-nw-zoe", daysAgo: 23, traits: { replyRate: 0.1, openRate: 0.2, busySignal: true } },
];

/**
 * Pipeline stage templates. Lumen (starter, 1 pipeline) vs
 * Northwind (enterprise, 3 pipelines).
 */
const LUMEN_PIPELINE = {
  id: "apl_seed_01",
  name: "Lumen Standard",
  stages: [
    { id: "stg_qs_01", name: "Qualified", probability: 0.15, state: "open" as const },
    { id: "stg_qs_02", name: "Demo", probability: 0.35, state: "open" as const },
    { id: "stg_qs_03", name: "Proposal", probability: 0.6, state: "open" as const },
    { id: "stg_qs_04", name: "Negotiation", probability: 0.85, state: "open" as const },
    { id: "stg_qs_won", name: "Won", probability: 1, state: "closed_won" as const },
    { id: "stg_qs_lost", name: "Lost", probability: 1, state: "closed_lost" as const },
  ],
};

const NORTHWIND_PIPELINES = [
  {
    id: "apl_seed_02",
    name: "Northwind Enterprise",
    stages: [
      { id: "stg_ne_01", name: "MQL", probability: 0.1, state: "open" as const },
      { id: "stg_ne_02", name: "SQL", probability: 0.25, state: "open" as const },
      { id: "stg_ne_03", name: "Discovery", probability: 0.45, state: "open" as const },
      { id: "stg_ne_04", name: "Pilot", probability: 0.65, state: "open" as const },
      { id: "stg_ne_05", name: "Closing", probability: 0.9, state: "open" as const },
      { id: "stg_ne_won", name: "Won", probability: 1, state: "closed_won" as const },
      { id: "stg_ne_lost", name: "Lost", probability: 1, state: "closed_lost" as const },
    ],
  },
  {
    id: "apl_seed_03",
    name: "Northwind Renewals",
    stages: [
      { id: "stg_nr_01", name: "Renewal Intent", probability: 0.4, state: "open" as const },
      { id: "stg_nr_02", name: "Renewal Negotiation", probability: 0.75, state: "open" as const },
      { id: "stg_nr_won", name: "Renewed", probability: 1, state: "closed_won" as const },
      { id: "stg_nr_lost", name: "Churned", probability: 1, state: "closed_lost" as const },
    ],
  },
  {
    id: "apl_seed_04",
    name: "Northwind Strategic",
    stages: [
      { id: "stg_ns_01", name: "Executive Sponsor", probability: 0.3, state: "open" as const },
      { id: "stg_ns_02", name: "Solution Design", probability: 0.55, state: "open" as const },
      { id: "stg_ns_03", name: "Multi-year Commit", probability: 0.8, state: "open" as const },
      { id: "stg_ns_won", name: "Closed Won", probability: 1, state: "closed_won" as const },
      { id: "stg_ns_lost", name: "Closed Lost", probability: 1, state: "closed_lost" as const },
    ],
  },
];

/**
 * Deal specs (18 deals — enough for cohorts, forecast, triage, and
 * anomalies across 2026-04..2026-10). `closeDays` is days before
 * AS_OF the deal was created; `stage` is the stage id; `closedDays`
 * is days before AS_OF it closed (null = open).
 */
interface DealSpec {
  id: string;
  tenant: string;
  pipeline: string;
  stage: string;
  account: string;
  contact: string;
  amount: number;
  category: "pipeline" | "best_case" | "commit" | "omitted" | "closed";
  owner: string;
  closeDays: number;
  closedDays: number | null;
  lostReason: string | null;
}

const DEAL_SPECS: DealSpec[] = [
  // ── Lumen (7 deals, ~2 quarters) ──
  { id: "adeal_seed_01", tenant: LUMEN.id, pipeline: LUMEN_PIPELINE.id, stage: "stg_qs_won", account: "acr_seed_01", contact: "act_seed_01", amount: 96_000, category: "closed", owner: "usr-lumen-ada", closeDays: 168, closedDays: 150, lostReason: null },
  { id: "adeal_seed_02", tenant: LUMEN.id, pipeline: LUMEN_PIPELINE.id, stage: "stg_qs_lost", account: "acr_seed_02", contact: "act_seed_02", amount: 42_000, category: "closed", owner: "usr-lumen-theo", closeDays: 140, closedDays: 118, lostReason: "Budget cut" },
  { id: "adeal_seed_03", tenant: LUMEN.id, pipeline: LUMEN_PIPELINE.id, stage: "stg_qs_won", account: "acr_seed_03", contact: "act_seed_03", amount: 78_000, category: "closed", owner: "usr-lumen-ada", closeDays: 88, closedDays: 60, lostReason: null },
  { id: "adeal_seed_04", tenant: LUMEN.id, pipeline: LUMEN_PIPELINE.id, stage: "stg_qs_03", account: "acr_seed_04", contact: "act_seed_04", amount: 154_000, category: "commit", owner: "usr-lumen-theo", closeDays: 30, closedDays: null, lostReason: null },
  { id: "adeal_seed_05", tenant: LUMEN.id, pipeline: LUMEN_PIPELINE.id, stage: "stg_qs_02", account: "acr_seed_04", contact: "act_seed_04", amount: 64_000, category: "pipeline", owner: "usr-lumen-ada", closeDays: 12, closedDays: null, lostReason: null },
  { id: "adeal_seed_06", tenant: LUMEN.id, pipeline: LUMEN_PIPELINE.id, stage: "stg_qs_01", account: "acr_seed_01", contact: "act_seed_01", amount: 36_000, category: "best_case", owner: "usr-lumen-ada", closeDays: 5, closedDays: null, lostReason: null },
  { id: "adeal_seed_07", tenant: LUMEN.id, pipeline: LUMEN_PIPELINE.id, stage: "stg_qs_04", account: "acr_seed_03", contact: "act_seed_03", amount: 121_000, category: "commit", owner: "usr-lumen-theo", closeDays: 8, closedDays: null, lostReason: null },
  // ── Northwind (11 deals) ──
  { id: "adeal_seed_08", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[0].id, stage: "stg_ne_won", account: "acr_seed_05", contact: "act_seed_05", amount: 480_000, category: "closed", owner: "usr-nw-priya", closeDays: 185, closedDays: 150, lostReason: null },
  { id: "adeal_seed_09", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[0].id, stage: "stg_ne_won", account: "acr_seed_06", contact: "act_seed_06", amount: 210_000, category: "closed", owner: "usr-nw-marco", closeDays: 140, closedDays: 120, lostReason: null },
  { id: "adeal_seed_10", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[0].id, stage: "stg_ne_lost", account: "acr_seed_07", contact: "act_seed_07", amount: 175_000, category: "closed", owner: "usr-nw-zoe", closeDays: 100, closedDays: 70, lostReason: "Went with competitor" },
  { id: "adeal_seed_11", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[0].id, stage: "stg_ne_won", account: "acr_seed_08", contact: "act_seed_08", amount: 390_000, category: "closed", owner: "usr-nw-priya", closeDays: 80, closedDays: 45, lostReason: null },
  { id: "adeal_seed_12", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[1].id, stage: "stg_nr_won", account: "acr_seed_05", contact: "act_seed_05", amount: 260_000, category: "closed", owner: "usr-nw-priya", closeDays: 65, closedDays: 30, lostReason: null },
  { id: "adeal_seed_13", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[0].id, stage: "stg_ne_04", account: "acr_seed_09", contact: "act_seed_09", amount: 425_000, category: "commit", owner: "usr-nw-marco", closeDays: 25, closedDays: null, lostReason: null },
  { id: "adeal_seed_14", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[0].id, stage: "stg_ne_03", account: "acr_seed_09", contact: "act_seed_09", amount: 185_000, category: "pipeline", owner: "usr-nw-marco", closeDays: 10, closedDays: null, lostReason: null },
  { id: "adeal_seed_15", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[2].id, stage: "stg_ns_03", account: "acr_seed_08", contact: "act_seed_08", amount: 1_250_000, category: "commit", owner: "usr-nw-priya", closeDays: 40, closedDays: null, lostReason: null },
  { id: "adeal_seed_16", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[1].id, stage: "stg_nr_02", account: "acr_seed_06", contact: "act_seed_06", amount: 95_000, category: "pipeline", owner: "usr-nw-zoe", closeDays: 15, closedDays: null, lostReason: null },
  { id: "adeal_seed_17", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[0].id, stage: "stg_ne_01", account: "acr_seed_10", contact: "act_seed_10", amount: 55_000, category: "omitted", owner: "usr-nw-zoe", closeDays: 3, closedDays: null, lostReason: null },
  { id: "adeal_seed_18", tenant: NORTHWIND.id, pipeline: NORTHWIND_PIPELINES[2].id, stage: "stg_ns_02", account: "acr_seed_10", contact: "act_seed_10", amount: 340_000, category: "best_case", owner: "usr-nw-zoe", closeDays: 20, closedDays: null, lostReason: null },
];

/* ── sequences + enrollments (the engine's fixtures) ─────────────── */

const LUMEN_SEQUENCE: { id: string; name: string; traitSeed: number; steps: SeqStep[] } = {
  id: "aseq_seed_01",
  name: "Lumen Nurture",
  traitSeed: 0.4,
  steps: [
    { id: "seq-1", type: "email", name: "Intro", email: { templateId: "atm_seed_01", subject: "A quick question, {{name}}", body: "Hi {{name}}, saw your team at Ferrostack — do you have 15 minutes this week?" } },
    { id: "seq-2", type: "wait", name: "Wait 2d", waitDays: 2 },
    { id: "seq-3", type: "branch", name: "Replied?", branch: { onEngagement: "replied", targetStepId: "seq-5" } },
    { id: "seq-4", type: "email", name: "Follow-up", email: { templateId: "atm_seed_02", subject: "Re: A quick question, {{name}}", body: "Circling back — any interest in a short demo?" } },
    { id: "seq-5", type: "task", name: "Book call", task: { title: "Schedule intro call", priority: "high" } },
  ],
};

const NORTHWIND_SEQUENCES: Array<{ id: string; name: string; traitSeed: number; steps: SeqStep[] }> = [
  {
    id: "aseq_seed_02",
    name: "NW Cold Outreach",
    traitSeed: 0.6,
    steps: [
      { id: "nw-1", type: "email", name: "Cold open", email: { templateId: "atm_seed_03", subject: "{{name}} — 1 idea for {{company}}", body: "One idea that cut onboarding time 40% for teams like yours." } },
      { id: "nw-2", type: "wait", name: "Wait 3d", waitDays: 3 },
      { id: "nw-3", type: "branch", name: "Open?", branch: { onEngagement: "opened", targetStepId: "nw-5" } },
      { id: "nw-4", type: "email", name: "Value note", email: { templateId: "atm_seed_04", subject: "A 2-minute read, {{name}}", body: "Here is the 2-minute version of the case for it." } },
      { id: "nw-5", type: "task", name: "Qualifier call", task: { title: "Run the qualifier call", priority: "normal" } },
    ],
  },
  {
    id: "aseq_seed_03",
    name: "NW Renewal Nudge",
    traitSeed: 0.3,
    steps: [
      { id: "rn-1", type: "email", name: "Renewal check-in", email: { templateId: "atm_seed_05", subject: "Your renewal window, {{name}}", body: "Your renewal window opens in 30 days — here is the plan." } },
      { id: "rn-2", type: "wait", name: "Wait 5d", waitDays: 5 },
      { id: "rn-3", type: "task", name: "Exec sponsor call", task: { title: "Call the exec sponsor", priority: "urgent" } },
    ],
  },
  {
    id: "aseq_seed_04",
    name: "NW Strategic Cadence",
    traitSeed: 0.7,
    steps: [
      { id: "ss-1", type: "email", name: "Sponsor brief", email: { templateId: "atm_seed_06", subject: "Briefing: the strategic path, {{name}}", body: "The one-pager for your exec team." } },
      { id: "ss-2", type: "wait", name: "Wait 4d", waitDays: 4 },
      { id: "ss-3", type: "branch", name: "Replied?", branch: { onEngagement: "replied", targetStepId: "ss-4" } },
      { id: "ss-4", type: "task", name: "Design session", task: { title: "Book the design session", priority: "high" } },
    ],
  },
];

interface EnrollmentDef {
  id: string;
  tenant: string;
  contact: string;
  sequence: string;
  state: AriaEnrollment["state"];
  stepIndex: number;
  traitMult: number;
  daysAgo: number;
}

const ENROLLMENT_DEFS: EnrollmentDef[] = [
  { id: "aenr_seed_01", tenant: LUMEN.id, contact: "act_seed_01", sequence: LUMEN_SEQUENCE.id, state: "completed", stepIndex: 5, traitMult: 0.82, daysAgo: 120 },
  { id: "aenr_seed_02", tenant: LUMEN.id, contact: "act_seed_02", sequence: LUMEN_SEQUENCE.id, state: "exited_by_reply", stepIndex: 3, traitMult: 0.71, daysAgo: 90 },
  { id: "aenr_seed_03", tenant: LUMEN.id, contact: "act_seed_03", sequence: LUMEN_SEQUENCE.id, state: "active", stepIndex: 1, traitMult: 0.25, daysAgo: 14 },
  { id: "aenr_seed_04", tenant: NORTHWIND.id, contact: "act_seed_05", sequence: NORTHWIND_SEQUENCES[0].id, state: "completed", stepIndex: 5, traitMult: 0.9, daysAgo: 100 },
  { id: "aenr_seed_05", tenant: NORTHWIND.id, contact: "act_seed_07", sequence: NORTHWIND_SEQUENCES[0].id, state: "active", stepIndex: 2, traitMult: 0.55, daysAgo: 30 },
  { id: "aenr_seed_06", tenant: NORTHWIND.id, contact: "act_seed_10", sequence: NORTHWIND_SEQUENCES[0].id, state: "bounced", stepIndex: 1, traitMult: 0.08, daysAgo: 20 },
  { id: "aenr_seed_07", tenant: NORTHWIND.id, contact: "act_seed_08", sequence: NORTHWIND_SEQUENCES[2].id, state: "active", stepIndex: 1, traitMult: 0.66, daysAgo: 40 },
];

/* ── leads (the triage + SLA fixtures) ───────────────────────────── */

interface LeadDef {
  id: string;
  tenant: string;
  status: "new" | "working" | "nurturing" | "unqualified" | "qualified";
  source: string;
  priority: "low" | "normal" | "high" | "urgent";
  owner: string;
  daysAgo: number;
  /** hours before AS_OF the first reply landed (null = none yet) */
  repliedHoursAgo: number | null;
  converted?: { accountId: string; contactId: string; dealId: string | null; daysAgo: number };
}

const LEAD_DEFS: LeadDef[] = [
  // Lumen (5 leads — a mix of fresh + old, replied + unresponded)
  { id: "alead_seed_01", tenant: LUMEN.id, status: "working", source: "demo", priority: "urgent", owner: "usr-lumen-ada", daysAgo: 3, repliedHoursAgo: 4 },
  { id: "alead_seed_02", tenant: LUMEN.id, status: "new", source: "inbound", priority: "high", owner: "usr-lumen-theo", daysAgo: 1, repliedHoursAgo: null },
  { id: "alead_seed_03", tenant: LUMEN.id, status: "qualified", source: "referral", priority: "normal", owner: "usr-lumen-ada", daysAgo: 21, repliedHoursAgo: 48, converted: { accountId: "acr_seed_04", contactId: "act_seed_04", dealId: null, daysAgo: 19 } },
  { id: "alead_seed_04", tenant: LUMEN.id, status: "nurturing", source: "webinar", priority: "low", owner: "usr-lumen-ada", daysAgo: 33, repliedHoursAgo: 72 },
  { id: "alead_seed_05", tenant: LUMEN.id, status: "unqualified", source: "inbound", priority: "low", owner: "usr-lumen-theo", daysAgo: 50, repliedHoursAgo: 96 },
  // Northwind (6 leads)
  { id: "alead_seed_06", tenant: NORTHWIND.id, status: "new", source: "demo", priority: "urgent", owner: "usr-nw-priya", daysAgo: 2, repliedHoursAgo: null },
  { id: "alead_seed_07", tenant: NORTHWIND.id, status: "working", source: "referral", priority: "high", owner: "usr-nw-marco", daysAgo: 6, repliedHoursAgo: 10 },
  { id: "alead_seed_08", tenant: NORTHWIND.id, status: "qualified", source: "webinar", priority: "normal", owner: "usr-nw-zoe", daysAgo: 25, repliedHoursAgo: 60 },
  { id: "alead_seed_09", tenant: NORTHWIND.id, status: "nurturing", source: "inbound", priority: "normal", owner: "usr-nw-marco", daysAgo: 40, repliedHoursAgo: 200 },
  { id: "alead_seed_10", tenant: NORTHWIND.id, status: "new", source: "inbound", priority: "low", owner: "usr-nw-zoe", daysAgo: 1, repliedHoursAgo: null },
  { id: "alead_seed_11", tenant: NORTHWIND.id, status: "unqualified", source: "demo", priority: "high", owner: "usr-nw-priya", daysAgo: 70, repliedHoursAgo: 168 },
];

/* ── tags ─────────────────────────────────────────────────────────── */

const TAG_DEFS: AriaTag[] = [
  { id: "atg_seed_01", tenantId: LUMEN.id, label: "enterprise" },
  { id: "atg_seed_02", tenantId: LUMEN.id, label: "renewal" },
  { id: "atg_seed_03", tenantId: LUMEN.id, label: "champion" },
  { id: "atg_seed_04", tenantId: NORTHWIND.id, label: "strategic" },
  { id: "atg_seed_05", tenantId: NORTHWIND.id, label: "expansion" },
  { id: "atg_seed_06", tenantId: NORTHWIND.id, label: "at-risk" },
];

/* ── the seed itself ──────────────────────────────────────────────── */

export function seedAria(now: string = AS_OF): AriaState {
  // ── users (scrypt hashes computed at seed time, fixed demo salts)
  const users: AriaUser[] = USERS.map((u) => {
    const { hash } = hashPassword(DEMO_PASSWORD, u.salt);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      passwordHash: hash,
      salt: u.salt,
      createdAt: "2026-01-01T00:00:00Z",
    };
  });

  // ── accounts
  const accounts: AriaAccount[] = ACCOUNT_DEFS.map((a) => ({
    id: a.id,
    tenantId: a.tenant,
    name: a.name,
    domain: a.domain,
    industry: a.industry,
    size: a.size,
    ownerId: a.owner,
    status: "active",
    createdAt: daysAgo(now, a.daysAgo),
  }));

  // ── contacts
  const contacts: AriaContact[] = CONTACT_DEFS.map((c) => ({
    id: c.id,
    tenantId: c.account.startsWith("acr_seed_0") ? ACCOUNT_DEFS.find((a) => a.id === c.account)!.tenant : "",
    accountId: c.account,
    name: c.name,
    email: c.email,
    title: c.title,
    ownerId: c.owner,
    traits: c.traits,
    createdAt: daysAgo(now, c.daysAgo),
  }));

  // ── pipelines
  const pipelines: AriaPipeline[] = [
    {
      id: LUMEN_PIPELINE.id,
      tenantId: LUMEN.id,
      name: LUMEN_PIPELINE.name,
      stages: LUMEN_PIPELINE.stages,
      createdAt: "2026-04-01T00:00:00Z",
    },
    ...NORTHWIND_PIPELINES.map((p) => ({
      id: p.id,
      tenantId: NORTHWIND.id,
      name: p.name,
      stages: p.stages,
      createdAt: "2026-04-01T00:00:00Z",
    })),
  ];

  // ── deals
  const deals: AriaDeal[] = DEAL_SPECS.map((d) => {
    const stage = pipelines
      .find((p) => p.id === d.pipeline)!
      .stages.find((s) => s.id === d.stage)!;
    const isClosed = d.closedDays !== null;
    return {
      id: d.id,
      tenantId: d.tenant,
      pipelineId: d.pipeline,
      stageId: d.stage,
      accountId: d.account,
      contactId: d.contact,
      amount: d.amount,
      forecastCategory: d.category,
      ownerId: d.owner,
      expectedCloseDate: dateDaysAgo(now, d.closeDays + 14),
      closedAt: isClosed ? daysAgo(now, d.closedDays!) : null,
      lostReason: d.lostReason,
      lastStageChangeAt: isClosed ? daysAgo(now, d.closedDays! + 3) : daysAgo(now, d.closeDays),
      createdAt: daysAgo(now, d.closeDays),
    };
  });

  // ── leads
  const leads: AriaLead[] = LEAD_DEFS.map((l) => {
    const tenant = l.tenant.startsWith("aria-tn-lumen") ? LUMEN : NORTHWIND;
    const slaMinutes = tenant.leadSlaMinutes[l.priority];
    return {
      id: l.id,
      tenantId: l.tenant,
      status: l.status,
      source: l.source,
      priority: l.priority,
      firstResponseAt:
        l.repliedHoursAgo === null ? null : hoursAgo(now, l.repliedHoursAgo),
      slaDueAt: new Date(new Date(daysAgo(now, l.daysAgo)).getTime() + slaMinutes * 60_000).toISOString().replace(".000Z", "Z"),
      converted: l.converted
        ? { accountId: l.converted.accountId, contactId: l.converted.contactId, dealId: l.converted.dealId, at: daysAgo(now, l.converted.daysAgo) }
        : null,
      ownerId: l.owner,
      createdAt: daysAgo(now, l.daysAgo),
    };
  });

  // ── sequences + templates
  const sequences: AriaSequence[] = [
    {
      id: LUMEN_SEQUENCE.id,
      tenantId: LUMEN.id,
      name: LUMEN_SEQUENCE.name,
      steps: LUMEN_SEQUENCE.steps,
      traitSeed: LUMEN_SEQUENCE.traitSeed,
      createdAt: "2026-05-01T00:00:00Z",
    },
    ...NORTHWIND_SEQUENCES.map((s) => ({
      id: s.id,
      tenantId: NORTHWIND.id,
      name: s.name,
      steps: s.steps,
      traitSeed: s.traitSeed,
      createdAt: "2026-05-01T00:00:00Z",
    })),
  ];

  const emailTemplates: AriaEmailTemplate[] = [
    { id: "atm_seed_01", tenantId: LUMEN.id, subject: "A quick question, {{name}}", body: "Hi {{name}}…", variables: ["name"], createdAt: "2026-05-01T00:00:00Z" },
    { id: "atm_seed_02", tenantId: LUMEN.id, subject: "Re: A quick question, {{name}}", body: "Circling back…", variables: ["name"], createdAt: "2026-05-01T00:00:00Z" },
    { id: "atm_seed_03", tenantId: NORTHWIND.id, subject: "{{name}} — 1 idea for {{company}}", body: "One idea…", variables: ["name", "company"], createdAt: "2026-05-01T00:00:00Z" },
    { id: "atm_seed_04", tenantId: NORTHWIND.id, subject: "A 2-minute read, {{name}}", body: "Here is…", variables: ["name"], createdAt: "2026-05-01T00:00:00Z" },
    { id: "atm_seed_05", tenantId: NORTHWIND.id, subject: "Your renewal window, {{name}}", body: "Your renewal…", variables: ["name"], createdAt: "2026-05-01T00:00:00Z" },
    { id: "atm_seed_06", tenantId: NORTHWIND.id, subject: "Briefing: the strategic path, {{name}}", body: "The one-pager…", variables: ["name"], createdAt: "2026-05-01T00:00:00Z" },
  ];

  // ── enrollments
  const enrollments: AriaEnrollment[] = ENROLLMENT_DEFS.map((e) => ({
    id: e.id,
    tenantId: e.tenant,
    contactId: e.contact,
    sequenceId: e.sequence,
    state: e.state,
    stepIndex: e.stepIndex,
    createdAt: daysAgo(now, e.daysAgo),
    completedAt:
      e.state === "completed" || e.state === "exited_by_reply" || e.state === "bounced"
        ? daysAgo(now, Math.max(1, e.daysAgo - 10))
        : null,
    traitMult: e.traitMult,
  }));

  // ── quotas (the current quarter, per rep)
  const q = quarterOf(now);
  const quotas: AriaQuota[] = [
    ...Object.entries(LUMEN.quotas).map(([uid, target], i) => ({
      id: `aqt_seed_0${i + 1}`,
      tenantId: LUMEN.id,
      userId: uid,
      periodStart: q.start,
      periodEnd: q.end,
      target,
    })),
    ...Object.entries(NORTHWIND.quotas).map(([uid, target], i) => ({
      id: `aqt_seed_1${i + 1}`,
      tenantId: NORTHWIND.id,
      userId: uid,
      periodStart: q.start,
      periodEnd: q.end,
      target,
    })),
  ];

  // ── engagement events (seeded history for the enrollments)
  const engagementEvents: AriaEngagementEvent[] = ENROLLMENT_DEFS.map((e, i) => ({
    id: `aevt_seed_0${i + 1}`,
    tenantId: e.tenant,
    enrollmentId: e.id,
    kind: e.state === "exited_by_reply" ? "reply" : e.state === "bounced" ? "sent" : "sent",
    at: daysAgo(now, Math.max(1, e.daysAgo - 5)),
  }));

  // ── mailbox (the seeded outbound — outcome by traitMult)
  const mailbox: AriaMailboxMessage[] = ENROLLMENT_DEFS.map((e, i) => ({
    id: `amail_seed_0${i + 1}`,
    tenantId: e.tenant,
    enrollmentId: e.id,
    contactId: e.contact,
    subject: "Seeded outbound (demo)",
    body: "Deterministic demo outbound.",
    at: daysAgo(now, Math.max(1, e.daysAgo - 2)),
    outcome: e.traitMult < 0.15 ? "bounced" : e.traitMult > 0.6 ? "replied" : e.traitMult > 0.3 ? "opened" : "sent",
  }));

  // ── activities (the deal timelines)
  const activities: AriaActivity[] = deals
    .filter((d) => d.closedAt !== null)
    .map((d, i) => ({
      id: `actv_seed_0${i + 1}`,
      tenantId: d.tenantId,
      kind: "system",
      entityType: "deal",
      entityId: d.id,
      body: d.lostReason ? `Deal closed lost — ${d.lostReason}` : "Deal closed won",
      actorId: d.ownerId,
      at: d.closedAt!,
    }));

  // ── tasks (the task-step outputs + follow-ups)
  const tasks: AriaTask[] = [
    {
      id: "atsk_seed_01",
      tenantId: LUMEN.id,
      title: "Schedule intro call (sequence: Lumen Nurture)",
      ownerId: "usr-lumen-ada",
      entityType: "contact",
      entityId: "act_seed_01",
      due: daysAgo(now, -3),
      priority: "high",
      done: true,
      doneAt: daysAgo(now, 6),
      createdAt: daysAgo(now, 110),
    },
    {
      id: "atsk_seed_02",
      tenantId: LUMEN.id,
      title: "Send Q4 pipeline review to Theo",
      ownerId: "usr-lumen-mira",
      entityType: "account",
      entityId: "acr_seed_04",
      due: daysAgo(now, 2),
      priority: "normal",
      done: false,
      doneAt: null,
      createdAt: daysAgo(now, 9),
    },
    {
      id: "atsk_seed_03",
      tenantId: NORTHWIND.id,
      title: "Run the qualifier call (sequence: NW Cold Outreach)",
      ownerId: "usr-nw-marco",
      entityType: "contact",
      entityId: "act_seed_07",
      due: daysAgo(now, -5),
      priority: "normal",
      done: false,
      doneAt: null,
      createdAt: daysAgo(now, 12),
    },
    {
      id: "atsk_seed_04",
      tenantId: NORTHWIND.id,
      title: "Book the design session (sequence: NW Strategic Cadence)",
      ownerId: "usr-nw-priya",
      entityType: "deal",
      entityId: "adeal_seed_15",
      due: daysAgo(now, -1),
      priority: "high",
      done: false,
      doneAt: null,
      createdAt: daysAgo(now, 6),
    },
  ];

  // ── notes
  const notes: AriaNote[] = [
    {
      id: "anote_seed_01",
      tenantId: LUMEN.id,
      entityType: "account",
      entityId: "acr_seed_04",
      authorId: "usr-lumen-theo",
      body: "Vanta Health is a strategic account — the CIO is a known champion. Keep touch cadence weekly.",
      at: daysAgo(now, 15),
    },
    {
      id: "anote_seed_02",
      tenantId: NORTHWIND.id,
      entityType: "deal",
      entityId: "adeal_seed_15",
      authorId: "usr-nw-priya",
      body: "Ironclad multi-year: exec sponsor is warm. The $1.25M figure assumes a 3-year term.",
      at: daysAgo(now, 8),
    },
  ];

  // ── seeded audit history (stored oldest-first; auditQuery reverses)
  const audit: AriaAuditEvent[] = [
    {
      id: "aud-aria-seed-000001",
      tenantId: LUMEN.id,
      actorUserId: "usr-lumen-mira",
      action: "deal.create",
      entityType: "deal",
      entityId: "adeal_seed_01",
      meta: { before: null, after: { amount: 96_000 } },
      createdAt: daysAgo(now, 168),
    },
    {
      id: "aud-aria-seed-000002",
      tenantId: LUMEN.id,
      actorUserId: "usr-lumen-ada",
      action: "deal.stage",
      entityType: "deal",
      entityId: "adeal_seed_03",
      meta: { before: "stg_qs_04", after: "stg_qs_won" },
      createdAt: daysAgo(now, 60),
    },
    {
      id: "aud-aria-seed-000003",
      tenantId: NORTHWIND.id,
      actorUserId: "usr-nw-priya",
      action: "deal.stage",
      entityType: "deal",
      entityId: "adeal_seed_11",
      meta: { before: "stg_ne_05", after: "stg_ne_won" },
      createdAt: daysAgo(now, 45),
    },
  ];

  // ── no seeded sessions (the demo login path creates them live)
  // The seq counter starts AFTER the seeded rows: live ids never collide
  // with the seed-constant ids.
  const maxSeedSeq = Math.max(
    0,
    ...accounts.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...contacts.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...deals.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...leads.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...pipelines.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...sequences.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...enrollments.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...activities.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...tasks.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...notes.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...engagementEvents.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
    ...mailbox.map((x) => parseInt(x.id.split("_").pop() ?? "0", 10)),
  );

  return {
    version: 1,
    tenants: [LUMEN, NORTHWIND],
    users,
    memberships: MEMBERSHIPS,
    accounts,
    contacts,
    leads,
    pipelines,
    deals,
    activities,
    tasks,
    notes,
    tags: TAG_DEFS,
    sequences,
    enrollments,
    emailTemplates,
    engagementEvents,
    mailbox,
    quotas,
    forecastSnapshots: [],
    sessions: [],
    invites: [],
    audit,
    seq: maxSeedSeq + 1,
  };
}
