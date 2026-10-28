/**
 * The deterministic parley seed.
 *
 * No `Math.random()`, no `Date.now()` — the clock is the explicit
 * `now` param (default `AS_OF`) and the RNG is a fixed-seed mulberry32.
 * Seeded users carry FIXED demo-constant scrypt salts (public-by-
 * design for the iframe demo — a fresh `crypto.randomBytes` salt
 * would break the two-seeds-deep-equal determinism pin); the scrypt
 * hashes themselves are real, computed at seed time.
 *
 * The 12 conversations are deliberately varied states, each pinned
 * against `AS_OF` + the two tenants' distinct `SlaPolicy` objects:
 * one breached-urgent, one at-risk-high, one unassigned-normal, one
 * closed full thread, one pending with 2+ replies. Northwind's 5
 * land in the current month; the "47/50 conversations this month"
 * near-cap pin is reached by 42 additional older-month conversation
 * rows (created before October), so Northwind sits at 47/50 on its
 * free plan.
 */

import { mulberry32 } from "./ids";
import { hashPassword } from "./password";
import type {
  AuditEvent,
  CannedReply,
  Conversation,
  Customer,
  Invite,
  Membership,
  Message,
  ParleyState,
  Priority,
  SlaPolicy,
  Status,
  SystemEvent,
  Tenant,
  User,
} from "./types";
import { AS_OF } from "./types";

export const SEED_INTEGER = 0x2a1f0c9e; // parley's own fixed seed
export const DEMO_PASSWORD = "parley-demo-1";

/* ── ids (the closed seeded sets) ─────────────────────────────────── */

const TENANT_IDS = ["tn-lumen", "tn-northwind"];
const USER_IDS = [
  "usr-mira",
  "usr-theo",
  "usr-ada",
  "usr-sam",
  "usr-ingrid",
  "usr-kai",
];
const CONVO_IDS = Array.from({ length: 12 }, (_, i) => `cnv-seed-${String(i + 1).padStart(2, "0")}`);
const SEED_MESSAGE_IDS = Array.from({ length: 40 }, (_, i) => `msg-seed-${String(i + 1).padStart(3, "0")}`);
const SEED_EVENT_IDS = Array.from({ length: 20 }, (_, i) => `evt-seed-${String(i + 1).padStart(3, "0")}`);

export function isSeededTenantId(id: string): boolean {
  return TENANT_IDS.includes(id);
}
export function isSeededUserId(id: string): boolean {
  return USER_IDS.includes(id);
}
export function isSeededConversationId(id: string): boolean {
  return CONVO_IDS.includes(id);
}
export function isSeededMessageId(id: string): boolean {
  return SEED_MESSAGE_IDS.includes(id);
}
export function isSeededEventId(id: string): boolean {
  return SEED_EVENT_IDS.includes(id);
}

/* ── SLA policies (the plan-differentiated pair) ──────────────────── */

const LUMEN_SLA: SlaPolicy = {
  firstResponseHours: { urgent: 1, high: 4, normal: 24, low: 72 },
  resolveHours: { urgent: 4, high: 24, normal: 72, low: 168 },
};
const NORTHWIND_SLA: SlaPolicy = {
  // Free plan — slower targets than Lumen's team plan
  firstResponseHours: { urgent: 2, high: 8, normal: 48, low: 120 },
  resolveHours: { urgent: 12, high: 48, normal: 96, low: 240 },
};

/** Hours before `now` → ISO string. */
function hoursAgo(now: string, hours: number): string {
  return new Date(new Date(now).getTime() - hours * 3_600_000)
    .toISOString()
    .replace(".000Z", "Z");
}

/* ── the users ─────────────────────────────────────────────────────── */

interface SeedUser {
  id: string;
  email: string;
  name: string;
  /** demo-constant salt (public by design — see the header) */
  salt: string;
}

const USERS: SeedUser[] = [
  { id: "usr-mira", email: "mira@lumen.test", name: "Mira Chen", salt: "s-lumen-mira" },
  { id: "usr-theo", email: "theo@lumen.test", name: "Theo Reyes", salt: "s-lumen-theo" },
  { id: "usr-ada", email: "ada@lumen.test", name: "Ada Okafor", salt: "s-lumen-ada" },
  { id: "usr-sam", email: "sam@lumen.test", name: "Sam Ito", salt: "s-lumen-sam" },
  { id: "usr-ingrid", email: "ingrid@northwind.test", name: "Ingrid Larsen", salt: "s-nw-ingrid" },
  { id: "usr-kai", email: "kai@northwind.test", name: "Kai Moreau", salt: "s-nw-kai" },
];

/* ── conversation specs ───────────────────────────────────────────── */

interface ConvoSpec {
  n: number; // 1-based index → id cnv-seed-NN
  tenant: "lumen" | "northwind";
  customer: number; // 1-based within the tenant's customer list
  subject: string;
  status: Status;
  priority: Priority;
  assignee?: string | null; // undefined = keep the default (null)
  /** hours before `now` the conversation was created */
  ageHours: number;
  /** hours before `now` the first agent reply landed (null = no reply) */
  repliedHoursAgo?: number | null;
  /** hours before `now` it closed (only for closed) */
  closedHoursAgo?: number | null;
  tags?: string[];
  /** which thread shape: fills out the message + event timeline */
  thread: ThreadShape;
}

type ThreadShape =
  | "open-brief" // 2 messages: customer → agent
  | "open-customer-only" // 1 message: customer
  | "pending-2-replies" // 4+ messages: c → a → c → a
  | "closed-full" // 6 messages: c → a → c → a → c → closed
  | "filler-1" // 1 message
  | "filler-2"; // 2 messages

const SPECS: ConvoSpec[] = [
  // ── Lumen (7) ─────────────────────────────────────────────────
  {
    n: 1,
    tenant: "lumen",
    customer: 1,
    subject: "Unit won't pair over Bluetooth",
    status: "open",
    priority: "urgent",
    assignee: "usr-ada",
    ageHours: 5, // 5h > 1h Lumen-urgent FR target → breached
    repliedHoursAgo: null, // no reply at all
    thread: "open-customer-only",
  },
  {
    n: 2,
    tenant: "lumen",
    customer: 2,
    subject: "Firmware 2.4 bricked the display",
    status: "open",
    priority: "high",
    assignee: "usr-theo",
    ageHours: 22, // 22h elapsed of a 24h resolve → remaining 2h < 4.8h band → at_risk
    repliedHoursAgo: 5, // replied → judged on the 24h resolve target
    thread: "open-brief",
  },
  {
    n: 3,
    tenant: "lumen",
    customer: 3,
    subject: "Warranty question for a 3-year-old board",
    status: "open",
    priority: "normal",
    assignee: undefined, // null → the unassigned-normal fixture
    ageHours: 3,
    repliedHoursAgo: null,
    thread: "open-customer-only",
  },
  {
    n: 4,
    tenant: "lumen",
    customer: 4,
    subject: "Replacement shipped — tracking number?",
    status: "closed",
    priority: "normal",
    assignee: "usr-ada",
    ageHours: 96,
    repliedHoursAgo: 20,
    closedHoursAgo: 10,
    thread: "closed-full", // the ≥5-message full thread
  },
  {
    n: 5,
    tenant: "lumen",
    customer: 5,
    subject: "Intermittent reboot on the 11-inch model",
    status: "pending",
    priority: "high",
    assignee: "usr-ada",
    ageHours: 30,
    repliedHoursAgo: 12,
    thread: "pending-2-replies", // the 2+ agent replies fixture
  },
  {
    n: 6,
    tenant: "lumen",
    customer: 1,
    subject: "Shipping the dev kit — label not printing",
    status: "open",
    priority: "normal",
    assignee: "usr-theo",
    ageHours: 10,
    repliedHoursAgo: 2,
    thread: "open-brief",
  },
  {
    n: 7,
    tenant: "lumen",
    customer: 2,
    subject: "Batch pricing for a pilot program",
    status: "closed",
    priority: "low",
    assignee: "usr-mira",
    ageHours: 480,
    repliedHoursAgo: 200,
    closedHoursAgo: 100,
    thread: "filler-1",
  },
  // ── Northwind (5) ─────────────────────────────────────────────
  {
    n: 8,
    tenant: "northwind",
    customer: 1,
    subject: "Urgent: kit arrived with missing screws",
    status: "open",
    priority: "urgent",
    assignee: "usr-kai",
    ageHours: 6, // 6h > 2h Northwind-urgent FR target → breached (ITS slower policy)
    repliedHoursAgo: null,
    thread: "open-customer-only",
  },
  {
    n: 9,
    tenant: "northwind",
    customer: 2,
    subject: "Paint chipping on the wooden frame",
    status: "open",
    priority: "normal",
    assignee: null,
    ageHours: 40, // 40h of a 48h Northwind-normal FR target → remaining 8h > 9.6h band → ok
    repliedHoursAgo: null,
    thread: "open-customer-only",
  },
  {
    n: 10,
    tenant: "northwind",
    customer: 3,
    subject: "Glue bottle empty — resupply please",
    status: "pending",
    priority: "normal",
    assignee: "usr-kai",
    ageHours: 50,
    repliedHoursAgo: 20,
    thread: "pending-2-replies",
  },
  {
    n: 11,
    tenant: "northwind",
    customer: 1,
    subject: "Sticker sheet for the bonus sheet",
    status: "closed",
    priority: "low",
    assignee: "usr-ingrid",
    ageHours: 200,
    repliedHoursAgo: 80,
    closedHoursAgo: 60,
    thread: "filler-2",
  },
  {
    n: 12,
    tenant: "northwind",
    customer: 2,
    subject: "Sanding block recommendation",
    status: "open",
    priority: "low",
    assignee: "usr-kai",
    ageHours: 24,
    repliedHoursAgo: 6,
    thread: "open-brief",
  },
];

/* ── the seed itself ──────────────────────────────────────────────── */

export function seedParley(now: string = AS_OF): ParleyState {
  // ── the RNG: pin the invite token BEFORE the 42 older-row ids are
  //     generated, so two seeds deep-equal regardless of call order. (The
  //     counter suffix in ids.ts is module-scope shared state; only the
  //     RNG-portion prefix is deterministic per seed. The invite token is
  //     the one seed-owned RNG consumer, so it draws first.)
  const rng = mulberry32(SEED_INTEGER);
  const inviteTokenPrefix = `${Math.floor(rng() * 0x10000).toString(16).padStart(4, "0")}${Math.floor(rng() * 0x10000).toString(16).padStart(4, "0")}`;

  // ── tenants
  const tenants: Tenant[] = [
    {
      id: "tn-lumen",
      slug: "lumen",
      name: "Lumen Labs",
      plan: "team",
      slas: LUMEN_SLA,
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "tn-northwind",
      slug: "northwind",
      name: "Northwind Kits",
      plan: "free",
      slas: NORTHWIND_SLA,
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];
  const tenantOf = (t: "lumen" | "northwind") => (t === "lumen" ? "tn-lumen" : "tn-northwind");

  // ── users (scrypt hashes computed at seed time, fixed demo salts)
  const users: User[] = USERS.map((u) => {
    const { hash } = hashPassword(DEMO_PASSWORD, u.salt);
    return { id: u.id, email: u.email, name: u.name, passwordHash: hash, salt: u.salt };
  });

  // ── memberships (Lumen 4, Northwind 2)
  const memberships: Membership[] = [
    { id: "mem-owner", tenantId: "tn-lumen", userId: "usr-mira", role: "owner" },
    { id: "mem-theo", tenantId: "tn-lumen", userId: "usr-theo", role: "admin" },
    { id: "mem-ada", tenantId: "tn-lumen", userId: "usr-ada", role: "agent" },
    { id: "mem-sam", tenantId: "tn-lumen", userId: "usr-sam", role: "viewer" },
    { id: "mem-nw-owner", tenantId: "tn-northwind", userId: "usr-ingrid", role: "owner" },
    { id: "mem-kai", tenantId: "tn-northwind", userId: "usr-kai", role: "agent" },
  ];

  // ── customers (Lumen 5, Northwind 3)
  const customerDefs: Array<{ id: string; tenantId: string; name: string; email: string }> = [
    { id: "cst-lumen-1", tenantId: "tn-lumen", name: "Priya Nair", email: "priya@lumen-cust.test" },
    { id: "cst-lumen-2", tenantId: "tn-lumen", name: "Luis Ortega", email: "luis@lumen-cust.test" },
    { id: "cst-lumen-3", tenantId: "tn-lumen", name: "Hana Sato", email: "hana@lumen-cust.test" },
    { id: "cst-lumen-4", tenantId: "tn-lumen", name: "Tom Beyer", email: "tom@lumen-cust.test" },
    { id: "cst-lumen-5", tenantId: "tn-lumen", name: "Ava Lindqvist", email: "ava@lumen-cust.test" },
    { id: "cst-nw-1", tenantId: "tn-northwind", name: "Rosa Delgado", email: "rosa@nw-cust.test" },
    { id: "cst-nw-2", tenantId: "tn-northwind", name: "Ben Carter", email: "ben@nw-cust.test" },
    { id: "cst-nw-3", tenantId: "tn-northwind", name: "Mei Wong", email: "mei@nw-cust.test" },
  ];
  const customers: Customer[] = customerDefs;
  const customerFor = (tenant: "lumen" | "northwind", i: number): Customer => {
    const prefix = tenant === "lumen" ? "cst-lumen-" : "cst-nw-";
    return customers.find((c) => c.id === `${prefix}${i}`)!;
  };

  // ── tags (Lumen 3, Northwind 2)
  const tags = [
    { id: "tag-lumen-1", tenantId: "tn-lumen", label: "firmware" },
    { id: "tag-lumen-2", tenantId: "tn-lumen", label: "hardware" },
    { id: "tag-lumen-3", tenantId: "tn-lumen", label: "shipping" },
    { id: "tag-nw-1", tenantId: "tn-northwind", label: "craft" },
    { id: "tag-nw-2", tenantId: "tn-northwind", label: "resupply" },
  ];

  // ── canned replies (Lumen 2, Northwind 1)
  const canned: CannedReply[] = [
    {
      id: "can-lumen-1",
      tenantId: "tn-lumen",
      title: "Outage acknowledged",
      body: "We've seen the failure and our firmware team is on it. Thanks for the report — we'll update this thread the moment we have a build.",
    },
    {
      id: "can-lumen-2",
      tenantId: "tn-lumen",
      title: "Shipping follow-up",
      body: "Your replacement is on the way. The tracking number should hit your email within the hour; nudge us here if it doesn't.",
    },
    {
      id: "can-nw-1",
      tenantId: "tn-northwind",
      title: "Resupply on its way",
      body: "We've sent a fresh bottle of glue and a replacement sticker sheet — both ship within 48 hours with the next kit batch.",
    },
  ];

  // ── conversations + messages + events (the 12 varied states)
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const events: SystemEvent[] = [];
  let msgIdx = 0;
  let evtIdx = 0;

  const addMsg = (convoId: string, tenantId: string, role: "customer" | "agent", body: string, at: string, authorId: string | null = null) => {
    messages.push({
      id: SEED_MESSAGE_IDS[msgIdx],
      tenantId,
      conversationId: convoId,
      authorId,
      body,
      role,
      createdAt: at,
    });
    msgIdx += 1;
  };
  const addEvt = (convoId: string, tenantId: string, kind: SystemEvent["kind"], meta: Record<string, unknown>, actorId: string | null, at: string) => {
    events.push({
      id: SEED_EVENT_IDS[evtIdx],
      tenantId,
      conversationId: convoId,
      kind,
      meta,
      actorId,
      createdAt: at,
    });
    evtIdx += 1;
  };

  for (const spec of SPECS) {
    const tenantId = tenantOf(spec.tenant);
    const customer = customerFor(spec.tenant, spec.customer);
    const convoId = CONVO_IDS[spec.n - 1];
    const createdAt = hoursAgo(now, spec.ageHours);
    const repliedAt = spec.repliedHoursAgo === null || spec.repliedHoursAgo === undefined ? null : hoursAgo(now, spec.repliedHoursAgo);
    const closedAt = spec.closedHoursAgo === null || spec.closedHoursAgo === undefined ? null : hoursAgo(now, spec.closedHoursAgo);
    const assigneeId = spec.assignee === undefined ? null : spec.assignee;

    conversations.push({
      id: convoId,
      tenantId,
      customerId: customer.id,
      subject: spec.subject,
      status: spec.status,
      priority: spec.priority,
      assigneeId,
      tags: spec.tags ?? [],
      createdAt,
      firstRespondedAt: repliedAt,
      closedAt,
    });

    // ── the thread, shape by shape
    if (spec.thread === "open-customer-only") {
      addMsg(convoId, tenantId, "customer", `Hi — ${spec.subject.toLowerCase()}. This is really urgent, any update?`, createdAt);
      addEvt(convoId, tenantId, "created", { subject: spec.subject }, null, createdAt);
    } else if (spec.thread === "open-brief") {
      addMsg(convoId, tenantId, "customer", `Hi — ${spec.subject.toLowerCase()}. Could you take a look?`, createdAt);
      addEvt(convoId, tenantId, "created", { subject: spec.subject }, null, createdAt);
      if (assigneeId) {
        addEvt(convoId, tenantId, "assigned", { to: assigneeId }, assigneeId, hoursAgo(now, spec.ageHours - 1));
      }
      addMsg(convoId, tenantId, "agent", "Thanks for the report — we're looking into it now and will follow up here.", repliedAt!);
      addEvt(convoId, tenantId, "replied", { messageId: SEED_MESSAGE_IDS[msgIdx] }, assigneeId ?? "usr-theo", repliedAt!);
    } else if (spec.thread === "pending-2-replies") {
      const t2 = hoursAgo(now, (spec.ageHours * 0.75) | 0);
      const t3 = hoursAgo(now, (spec.ageHours * 0.5) | 0);
      const t4 =
        spec.repliedHoursAgo === undefined || spec.repliedHoursAgo === null
          ? t2
          : hoursAgo(now, spec.repliedHoursAgo);
      addMsg(convoId, tenantId, "customer", `Hi — ${spec.subject.toLowerCase()}. It's been a few days, any news?`, createdAt);
      addEvt(convoId, tenantId, "created", { subject: spec.subject }, null, createdAt);
      addMsg(convoId, tenantId, "agent", "We've confirmed the issue and are preparing a fix. In the meantime, could you share a log so we can narrow it down?", t4);
      addEvt(convoId, tenantId, "replied", { messageId: SEED_MESSAGE_IDS[msgIdx] }, assigneeId ?? "usr-ada", t4);
      addMsg(convoId, tenantId, "customer", `Attached the log. Also is there a workaround we can ship to our users?`, t3);
      addMsg(convoId, tenantId, "agent", "Good catch — there is a workaround: holding the power button for 8 seconds resets the watchdog. We'll ship the permanent fix in the next build.", t2);
      addEvt(convoId, tenantId, "status_changed", { before: "open", after: "pending" }, assigneeId ?? "usr-ada", t2);
    } else if (spec.thread === "closed-full") {
      const t1 = hoursAgo(now, spec.ageHours - 1);
      const t2 = hoursAgo(now, spec.repliedHoursAgo! + 40);
      const t3 = hoursAgo(now, spec.repliedHoursAgo! + 20);
      const t4 = spec.closedHoursAgo!;
      addMsg(convoId, tenantId, "customer", `Hi — ${spec.subject.toLowerCase()}. What's the status?`, createdAt);
      addEvt(convoId, tenantId, "created", { subject: spec.subject }, null, createdAt);
      if (assigneeId) addEvt(convoId, tenantId, "assigned", { to: assigneeId }, assigneeId, t1);
      addMsg(convoId, tenantId, "agent", "We've identified the root cause and a fix is on the way. Shipment ships tomorrow.", t2);
      addEvt(convoId, tenantId, "replied", { messageId: SEED_MESSAGE_IDS[msgIdx] }, assigneeId ?? "usr-ada", t2);
      addMsg(convoId, tenantId, "customer", "Got it — any update on the timeline?", t3);
      addMsg(convoId, tenantId, "agent", "The tracking number is 1Z999AA10123456784. It lands tomorrow afternoon.", hoursAgo(now, spec.repliedHoursAgo! + 10));
      addMsg(convoId, tenantId, "customer", "Received, thank you!", closedAt!);
      addEvt(convoId, tenantId, "status_changed", { before: "open", after: "closed" }, assigneeId ?? "usr-mira", closedAt!);
    } else if (spec.thread === "filler-1") {
      addMsg(convoId, tenantId, "customer", `Hi — ${spec.subject.toLowerCase()}.`, createdAt);
      addMsg(convoId, tenantId, "agent", "Happy to help — see the attached quote. Closing this thread once the pilot kicks off.", hoursAgo(now, spec.repliedHoursAgo!));
      addEvt(convoId, tenantId, "status_changed", { before: "open", after: "closed" }, "usr-mira", closedAt!);
    } else {
      // filler-2
      addMsg(convoId, tenantId, "customer", `Hi — ${spec.subject.toLowerCase()}.`, createdAt);
      addMsg(convoId, tenantId, "agent", "Sent you a selection of grits — medium works best on the wooden frames.", hoursAgo(now, spec.repliedHoursAgo!));
      addEvt(convoId, tenantId, "status_changed", { before: "open", after: "closed" }, "usr-ingrid", closedAt!);
    }
  }

  // ── invites: 1 pending unexpired for casey@lumen.test (admin)
  //    (the invite token is generated BEFORE the older-row filler ids,
  //     so the RNG call order is deterministic: seed → older rows → invite
  //     would shift the token across runs. We pin it the other way.)
  // ── Northwind "47/50 this month": 42 older-month filler rows
  //    (created before October, so they don't count toward the month)
  const olderConvoSubjects = [
    "Starter kit inventory check",
    "Resin hardening tips",
    "Gift card balance",
    "Stain color matching",
    "Bulk order pricing",
    "Frame cornering jig",
    "Paperweight base sizes",
    "Return window question",
    "Wood type recommendations",
    "Shipping to Canada",
    "Sticker backing options",
    "Varnish finish tips",
  ];
  const olderConvoIds: string[] = [];
  for (let i = 0; i < 42; i++) {
    const older = new Date("2026-10-10T09:00:00Z").getTime() - i * 1000; // all October
    const id = `cnv-nw-old-${String(i + 1).padStart(2, "0")}`; // deterministic seed-constant id
    olderConvoIds.push(id);
    conversations.push({
      id,
      tenantId: "tn-northwind",
      customerId: `cst-nw-${(i % 3) + 1}`,
      subject: `${olderConvoSubjects[i % olderConvoSubjects.length]} (#${i + 1})`,
      status: i % 4 === 0 ? "pending" : "closed",
      priority: (["low", "normal", "high", "normal"] as Priority[])[i % 4],
      assigneeId: i % 5 === 0 ? "usr-ingrid" : "usr-kai",
      tags: [],
      createdAt: new Date(older).toISOString().replace(".000Z", "Z"),
      firstRespondedAt: null,
      closedAt: null,
    });
  }
  // 42 older-month + 5 current-month = 47 Northwind conversations this month

  const invites: Invite[] = [
    {
      id: "inv-seed-000001",
      tenantId: "tn-lumen",
      email: "casey@lumen.test",
      role: "admin",
      token: `tok-${inviteTokenPrefix}-000001`,
      expiresAt: new Date(new Date(now).getTime() + 24 * 3_600_000)
        .toISOString()
        .replace(".000Z", "Z"),
      usedAt: null,
      createdAt: now,
    },
  ];

  // ── seeded audit history (stored oldest-first, the same order as
  //    recordAudit's append-to-end; auditFeed reverses to newest-first)
  const audit: AuditEvent[] = [
    {
      id: "aud-seed-000003",
      tenantId: "tn-lumen",
      actorUserId: "usr-theo",
      action: "conversation.status",
      entityType: "conversation",
      entityId: CONVO_IDS[4],
      meta: { before: "open", after: "pending" },
      createdAt: hoursAgo(now, 22), // 22h ago (oldest)
    },
    {
      id: "aud-seed-000001",
      tenantId: "tn-lumen",
      actorUserId: "usr-mira",
      action: "conversation.create",
      entityType: "conversation",
      entityId: CONVO_IDS[0],
      meta: { before: null, after: { subject: SPECS[0].subject, priority: "urgent" } },
      createdAt: hoursAgo(now, SPECS[0].ageHours), // 5h ago
    },
    {
      id: "aud-seed-000002",
      tenantId: "tn-lumen",
      actorUserId: "usr-ada",
      action: "conversation.assign",
      entityType: "conversation",
      entityId: CONVO_IDS[0],
      meta: { before: null, after: "usr-ada" },
      createdAt: hoursAgo(now, SPECS[0].ageHours - 1), // 4h ago (newest)
    },
  ];

  // ── no seeded sessions (the demo login path creates them live)
  return {
    tenants,
    users,
    memberships,
    customers,
    conversations,
    messages,
    events,
    tags,
    canned,
    invites,
    sessions: [],
    audit,
  };
}
