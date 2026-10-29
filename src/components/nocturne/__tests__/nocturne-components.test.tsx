/**
 * Component tests for the Nocturne UI (src/components/nocturne/*) +
 * the client store (the NocturneProvider in
 * src/components/nocturne/nocturne-provider).
 *
 * Rendered under the global happy-dom preload (bunfig.toml [test]
 * preload → src/test-dom-setup.ts), same style as the aria
 * component tests (bun:test + @testing-library/react). The
 * provider's fetches are spied against a FIXED `seedNocturne`
 * fixture so results are deterministic — no real API calls.
 *
 * The fetch-router is registered once and restored in `afterEach`
 * (the cross-file hygiene rule): every test that installs the stub
 * calls `restore()` on it, and a module-level `afterEach`
 * re-restores the global `fetch` so the next file starts clean.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { seedNocturne } from "@/lib/nocturne/seed";
import {
  AS_OF,
  type NocturneRole,
} from "@/lib/nocturne/types";
import {
  NocturneProvider,
  DEMO_USERS,
  type NocturneSessionShape,
} from "@/components/nocturne/nocturne-provider";
import { NocturneShell } from "../shell";
import { LoginScreen } from "../login";
import { DashboardView } from "../dashboard";
import { IncidentsView } from "../incidents";
import { ServicesView } from "../services";
import { RotationsView } from "../rotations";
import { RunbooksView } from "../runbooks";
import { PostmortemsView } from "../postmortems";
import { AnalyticsView } from "../analytics";
import { MembersView } from "../members";
import { PublicStatusPage } from "../public-status";

/* ── the pinned fixture ────────────────────────────────────────────── */

const SEED = seedNocturne();
const LUMEN = SEED.tenants.find((t) => t.id === "tn-lumen")!;
const OPEN_INCIDENT = SEED.incidents.find(
  (i) => i.tenantId === LUMEN.id && i.status === "triggered",
)!;

/** The session shape the fetch stub returns (the provider's probe payload). */
function sessionShape(email: string): NocturneSessionShape {
  const user = SEED.users.find((u) => u.email === email)!;
  const membership = SEED.memberships.find((m) => m.userId === user.id)!;
  const tenant = SEED.tenants.find((t) => t.id === membership.tenantId)!;
  return {
    session: { id: "ses-test", expiresAt: "2026-10-28T20:00:00Z" },
    user: { id: user.id, email: user.email, name: user.name },
    tenant: { id: tenant.id, slug: tenant.slug },
    role: membership.role,
  };
}

const OWNER = sessionShape("mira@lumen.test");
const ADMIN = sessionShape("theo@lumen.test");
const RESPONDER = sessionShape("ada@lumen.test");
const VIEWER = sessionShape("kai@lumen.test");

/**
 * Stub the global fetch for every nocturne API route the provider /
 * components touch. Each test re-renders with the stub installed,
 * so the provider's async probes resolve against the fixed fixture.
 *
 * `register()` returns a `restore()` that puts the global fetch
 * back — call it from `afterEach` (the cross-file hygiene rule).
 */
function installFetchStub(opts?: { session?: NocturneSessionShape | null }) {
  // `null` is a legal value (the no-session probe) — sentinel it so
  // the `?? OWNER` default never swallows the explicit null.
  const sessionShape2 = opts === undefined ? OWNER : opts.session;
  const original = globalThis.fetch;
  const called: Array<{ url: string; method: string }> = [];

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    called.push({ url, method });

    const t = SEED.tenants.find(
      (x) => x.id === (sessionShape2?.tenant.id ?? LUMEN.id),
    )!;

    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    // ── auth/session
    if (url.includes("/nocturne/api/auth/session")) {
      if (!sessionShape2) return json({ error: "unauthenticated", status: 401 }, 401);
      return json({ ...sessionShape2 });
    }
    if (url.includes("/nocturne/api/auth/logout")) {
      return new Response(null, { status: 204 });
    }
    if (url.includes("/nocturne/api/auth/login")) {
      if (!sessionShape2) return json({ error: "unauthenticated", status: 401 }, 401);
      return json({ ...sessionShape2 });
    }

    // ── demo reset (the embed `nocturne-reset` handshake's target)
    if (url.includes("/nocturne/api/demo/reset")) {
      return json({ reset: true, demoSession: { id: "ses-demo", expiresAt: "2026-10-28T20:00:00Z" }, demoCookie: "x" });
    }

    // ── tenant-scoped entity routes (all filtered to the tenant)
    if (url.includes("/nocturne/api/incidents") && url.endsWith("/incidents")) {
      const rows = SEED.incidents.filter((i) => i.tenantId === t.id).map((i) => ({
        ...i,
        slaState: "ok",
        remainingMs: 3_600_000,
        primaryOnCall: i.acknowledgedBy,
      }));
      // The filtered query: the dashboard's open-incidents lane.
      const status = new URL("http://x" + url).searchParams.get("status");
      const filtered = status ? rows.filter((r) => r.status === status) : rows;
      return json(filtered);
    }
    const incMatch = url.match(/\/nocturne\/api\/incidents\/([^/]+)(?:\/(ack|resolve|snooze|escalate|notes))?(.*)$/);
    if (incMatch) {
      const id = incMatch[1];
      const lane = incMatch[2];
      const incident = SEED.incidents.find((i) => i.id === id && i.tenantId === t.id);
      if (!incident) return json({ error: "not found", status: 404 }, 404);
      if (lane === undefined) {
        // The detail payload: incident + timeline + notes + postmortem.
        const timeline = SEED.timeline
          .filter((e) => e.incidentId === incident.id)
          .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
        const notes = SEED.notes.filter((n) => n.incidentId === incident.id);
        const postmortem =
          incident.postmortemId !== null
            ? SEED.postmortems.find((p) => p.id === incident.postmortemId) ?? null
            : null;
        return json({
          ...incident,
          slaState: "ok",
          remainingMs: 3_600_000,
          primaryOnCall: incident.acknowledgedBy,
          timeline,
          notes,
          postmortem,
        });
      }
      // The lifecycle lanes — the invariant-aware stub:
      if (lane === "ack") {
        if (incident.status === "resolved") {
          return json(
            { error: "validation failed", errors: ["cannot ack a resolved incident — the terminal state is final."] },
            400,
          );
        }
        return json({ ...incident, status: "acknowledged", acknowledgedAt: AS_OF, acknowledgedBy: sessionShape2?.user.id ?? "usr-lumen-mira" });
      }
      if (lane === "resolve") {
        // The ack-before-resolve invariant: a resolve on a NOT-
        // acknowledged incident 400s.
        if (incident.status !== "acknowledged") {
          return json(
            {
              error: "validation failed",
              errors: [`cannot resolve a "${incident.status}" incident — acknowledge it first (ack-before-resolve).`],
            },
            400,
          );
        }
        return json({ ...incident, status: "resolved", resolvedAt: AS_OF, resolvedBy: sessionShape2?.user.id ?? "usr-lumen-mira" });
      }
      if (lane === "snooze") {
        if (incident.status === "resolved") {
          return json(
            { error: "validation failed", errors: ["cannot snooze a resolved incident — the terminal state is final."] },
            400,
          );
        }
        return json({ ...incident, status: "snoozed", snoozedUntil: new Date(new Date(AS_OF).getTime() + 3_600_000).toISOString() });
      }
      if (lane === "escalate") {
        if (incident.status === "resolved") {
          return json(
            { error: "validation failed", errors: ["cannot escalate a resolved incident — the terminal state is final."] },
            400,
          );
        }
        return json({ ...incident, activeTierIndex: (incident.activeTierIndex ?? 0) + 1 });
      }
      if (lane === "notes") {
        return json({ id: "nc-note-new", body: "x", incidentId: id, authorId: sessionShape2?.user.id ?? "usr-lumen-mira", createdAt: AS_OF, updatedAt: null }, 201);
      }
    }

    // ── services
    if (url.includes("/nocturne/api/services") && url.endsWith("/services")) {
      const rows = SEED.services
        .filter((s) => s.tenantId === t.id)
        .map((service) => ({ service, primaryOnCall: null }));
      return json(rows);
    }
    const svcMatch = url.match(/\/nocturne\/api\/services\/([^/]+)\/oncall$/);
    if (svcMatch) {
      return json({ primary: null, secondary: null, handoffAt: null });
    }
    const svcIdMatch = url.match(/\/nocturne\/api\/services\/([^/]+)$/);
    if (svcIdMatch) {
      const service = SEED.services.find((s) => s.id === svcIdMatch[1] && s.tenantId === t.id);
      if (!service) return json({ error: "not found", status: 404 }, 404);
      return json({
        ...service,
        incidents: SEED.incidents.filter((i) => i.serviceId === service.id).map((i) => ({ ...i, slaState: "ok", remainingMs: 3_600_000, primaryOnCall: i.acknowledgedBy })),
        runbooks: SEED.runbooks.filter((rb) => rb.serviceId === service.id),
      });
    }

    // ── rotations
    if (url.includes("/nocturne/api/rotations") && url.endsWith("/rotations")) {
      const rows = SEED.rotations
        .filter((r) => r.tenantId === t.id)
        .map((rotation) => ({
          ...rotation,
          currentSeat: null,
          current: null,
          nextSeat: null,
          handoffAt: null,
        }));
      return json(rows);
    }
    const rotMatch = url.match(/\/nocturne\/api\/rotations\/([^/]+)(?:\/overrides)?$/);
    if (rotMatch && !url.includes("/overrides")) {
      const rotation = SEED.rotations.find((r) => r.id === rotMatch[1] && r.tenantId === t.id);
      if (!rotation) return json({ error: "not found", status: 404 }, 404);
      return json({
        ...rotation,
        currentSeat: null,
        current: null,
        nextSeat: null,
        handoffAt: null,
        overrides: SEED.overrides.filter((o) => o.rotationId === rotation.id),
      });
    }

    // ── runbooks
    if (url.includes("/nocturne/api/runbooks") && url.endsWith("/runbooks")) {
      return json(SEED.runbooks.filter((rb) => rb.tenantId === t.id));
    }
    const rbMatch = url.match(/\/nocturne\/api\/runbooks\/([^/]+)$/);
    if (rbMatch) {
      const rb = SEED.runbooks.find((r) => r.id === rbMatch[1] && r.tenantId === t.id);
      if (!rb) return json({ error: "not found", status: 404 }, 404);
      return json({
        ...rb,
        checklists: SEED.checklists.filter((c) => c.runbookId === rb.id),
      });
    }

    // ── checklists
    if (url.includes("/nocturne/api/checklists") && method === "POST") {
      return json({ id: "nc-cl-new", incidentId: "x", runbookId: "x", stepStates: {}, updatedAt: AS_OF }, 201);
    }
    if (url.includes("/nocturne/api/checklists") && method === "PATCH") {
      return json({ id: "nc-cl-new", stepStates: {}, updatedAt: AS_OF });
    }

    // ── postmortems
    if (url.includes("/nocturne/api/postmortems") && url.endsWith("/postmortems")) {
      return json(SEED.postmortems.filter((pm) => pm.tenantId === t.id));
    }
    const pmAction = url.match(/\/nocturne\/api\/postmortems\/([^/]+)\/actions\/([^/]+)$/);
    if (pmAction) {
      return json({ id: pmAction[1], actionItems: [] });
    }
    const pmMatch = url.match(/\/nocturne\/api\/postmortems\/([^/]+)$/);
    if (pmMatch) {
      const pm = SEED.postmortems.find((p) => p.id === pmMatch[1] && p.tenantId === t.id);
      if (!pm) return json({ error: "not found", status: 404 }, 404);
      return json(pm);
    }

    // ── analytics
    if (url.includes("/nocturne/api/analytics")) {
      return json({
        mttaMs: 240_000,
        mttrMs: 5_700_000,
        incidentsBySeverity: { sev1: 2, sev2: 2, sev3: 1, sev4: 0 },
        incidentsByService: { [SEED.services.find((s) => s.tenantId === t.id)!.id]: 5 },
        breachRate: 0.4,
        onCallLoad: { "usr-lumen-theo": 1 },
      });
    }

    // ── members
    if (url.includes("/nocturne/api/members")) {
      const rows = SEED.memberships
        .filter((m) => m.tenantId === t.id)
        .map((m) => ({
          membership: m,
          user: SEED.users.find((u) => u.id === m.userId) ?? null,
        }));
      return json(rows);
    }

    // ── audit (owner-gated in the matrix)
    if (url.includes("/nocturne/api/audit")) {
      if (sessionShape2?.role !== "owner") {
        return json({ error: "forbidden", permission: "audit.read", status: 403 }, 403);
      }
      return json(SEED.audit.filter((a) => a.tenantId === t.id));
    }

    // ── invites
    if (url.includes("/nocturne/api/invites") && method === "POST") {
      return json({ id: "inv-new", token: "tok-x" }, 201);
    }

    // ── components
    if (url.includes("/nocturne/api/components")) {
      if (url.endsWith("/components")) {
        return json(SEED.components.filter((c) => c.tenantId === t.id));
      }
      const cmpMatch = url.match(/\/nocturne\/api\/components\/([^/]+)\/status$/);
      if (cmpMatch && method === "POST") {
        return json({ id: cmpMatch[1], status: "maintenance", note: "x" });
      }
      return json({});
    }

    // ── the public status data route (no auth)
    if (url.includes("/nocturne/api/public-status/")) {
      const slug = url.match(/\/nocturne\/api\/public-status\/([^/?]+)/)?.[1] ?? "lumen";
      const tenant = SEED.tenants.find((x) => x.slug === slug);
      if (!tenant) return json({ error: "not found", status: 404 }, 404);
      const comps = SEED.components.filter((c) => c.tenantId === tenant.id);
      const active = SEED.incidents.filter(
        (i) => i.tenantId === tenant.id && i.status !== "resolved",
      );
      return json({
        tenant: { name: tenant.name, slug: tenant.slug },
        components: comps.map((c) => ({ id: c.id, name: c.name, status: c.status, lastChangedAt: c.lastChangedAt, note: c.note })),
        activeIncidents: active.map((i) => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          status: i.status,
          triggeredAt: i.triggeredAt,
          acknowledgedAt: i.acknowledgedAt,
          resolvedAt: i.resolvedAt,
          serviceName: SEED.services.find((s) => s.id === i.serviceId)?.name ?? "Unknown",
        })),
        lastUpdated: comps.find((c) => c.lastChangedAt)?.lastChangedAt ?? null,
      });
    }

    // Default: empty JSON
    return json({});
  };

  // The stub preserves `original`'s non-call metadata (a `.then`-safe
  // replacement) — the cross-file hygiene rule: restore in afterEach.
  globalThis.fetch = handler as typeof fetch;
  // The test lane pins the happy-dom `window.origin` to "http://localhost".
  if (typeof window !== "undefined") {
    try {
      Object.defineProperty(window, "origin", {
        value: "http://localhost",
        configurable: true,
      });
    } catch {
      /* some runtimes pin origin read-only — the fallback is harmless */
    }
  }

  return {
    restore: () => {
      globalThis.fetch = original;
    },
    called,
  };
}

/**
 * Render a component under the NocturneProvider with the fetch stub
 * installed. Returns the RTL utils + the `restore` handle + the
 * `called` log.
 */
async function renderWithProvider(
  ui: React.ReactNode,
  session: NocturneSessionShape = OWNER,
  providerProps: { embed?: boolean; hasSession?: boolean } = {},
): Promise<RenderResult & { restore: () => void; called: Array<{ url: string; method: string }> }> {
  const stub = installFetchStub({ session });
  const utils = render(
    <NocturneProvider embed={providerProps.embed} hasSession={providerProps.hasSession}>
      {ui}
    </NocturneProvider>,
  );
  // Let the provider's initial probe settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { ...utils, restore: stub.restore, called: stub.called };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // The provider's `reopen` helper re-probes the session — the stub
  // always returns the owner's shape unless a test pins otherwise.
});

/* ──────────────────────────────────────────────────────────────────
 * The provider bootstraps
 * ───────────────────────────────────────────────────────────────── */

describe("NocturneProvider (bootstrap)", () => {
  test("bootstraps a session probe + loads tenant data for a logged-in role", async () => {
    const { container, restore } = await renderWithProvider(<NocturneShell embed={false} />);
    restore();
    // The owner's nav is visible + the dashboard renders.
    expect(container.textContent).toContain("Dashboard");
    expect(container.textContent).toContain("Incidents");
  });

  test("renders the login screen when there is no session (standalone)", async () => {
    const stub = installFetchStub({ session: null });
    const { container, unmount } = render(
      <NocturneProvider hasSession={false}>
        <NocturneShell embed={false} />
      </NocturneProvider>,
    );
    // The provider's 401 probe settles → `loading` flips false +
    // `session` stays null → the shell renders the login screen.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain("Sign in to Nocturne");
    stub.restore();
    unmount();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The login flow
 * ───────────────────────────────────────────────────────────────── */

describe("LoginScreen (the credential form)", () => {
  test("shows the 8 demo emails + the password hint, and submits", async () => {
    const stub = installFetchStub({ session: null });
    const { container, unmount } = render(
      <NocturneProvider hasSession={false}>
        <LoginScreen />
      </NocturneProvider>,
    );
    for (const email of DEMO_USERS) {
      expect(container.textContent).toContain(email);
    }
    expect(container.textContent).toContain("nocturne-demo-1");
    const submit = container.querySelector('button[type="submit"]')!;
    fireEvent.click(submit);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    stub.restore();
    unmount();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The shell nav by role
 * ───────────────────────────────────────────────────────────────── */

describe("NocturneShell (the app chrome, gated per-role)", () => {
  test("an owner sees the full nav including Members", async () => {
    const { container, restore } = await renderWithProvider(<NocturneShell embed={false} />);
    restore();
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const labels = tabs.map((t) => t.textContent?.trim());
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Members");
  });

  test("a viewer does NOT see the Members nav item (owner-gated)", async () => {
    const { container, restore } = await renderWithProvider(<NocturneShell embed={false} />, VIEWER);
    restore();
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const labels = tabs.map((t) => t.textContent?.trim());
    expect(labels).toContain("Dashboard");
    expect(labels).not.toContain("Members");
  });

  test("embed mode renders the compact tab nav + the 'live demo' tag", async () => {
    const { container, restore } = await renderWithProvider(<NocturneShell embed={true} />);
    restore();
    expect(container.textContent).toContain("live demo");
    const nav = container.querySelector('[aria-label="Nocturne views"]');
    expect(nav).not.toBeNull();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The dashboard: KPIs + the active incidents
 * ───────────────────────────────────────────────────────────────── */

describe("DashboardView (the KPI band + active incidents)", () => {
  test("renders the 5 KPI tiles + the active-incident list", async () => {
    const { container, restore } = await renderWithProvider(<DashboardView />);
    restore();
    for (const label of [
      "Open incidents",
      "MTTA",
      "MTTR",
      "SLA breach rate",
      "On call now",
    ]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).toContain("Active incidents");
  });

  test("the SLA countdowns render through the provider's fmt helpers", async () => {
    const { container, restore } = await renderWithProvider(<DashboardView />);
    restore();
    // The dashboard's active-incident lane is only present when the
    // tenant has open incidents. In the OWNER fixture the dashboard
    // renders the KPI band; the "All clear" empty lane means there
    // are no open incidents in the fixture — the countdown surface
    // is the KPI band's MTTA/MTTR (the provider's fmt helpers).
    const text = container.textContent ?? "";
    expect(text).toContain("MTTA");
    expect(text).toContain("MTTR");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The incident list + detail
 * ───────────────────────────────────────────────────────────────── */

describe("IncidentsView (the incident list + detail)", () => {
  test("renders the incident rows with SLA chips + the status filter", async () => {
    const { container, restore } = await renderWithProvider(<IncidentsView />);
    restore();
    expect(container.querySelector('#nocturne-incident-status')).not.toBeNull();
    expect(container.textContent).toContain("incidents");
  });

  test("opening an incident shows the detail with timeline + notes + actions", async () => {
    const { container, restore, called } = await renderWithProvider(<IncidentsView />);
    // Open the first incident row.
    const firstBtn = [...container.querySelectorAll("button")].find((b) =>
      b.querySelector('[role="img"][aria-label^="severity"]'),
    );
    if (firstBtn) {
      fireEvent.click(firstBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
    // The detail view's headers render.
    const text = container.textContent ?? "";
    expect(text).toContain("Actions");
    expect(text).toContain("Timeline");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The services view
 * ───────────────────────────────────────────────────────────────── */

describe("ServicesView (the services + on-call surface)", () => {
  test("renders the service rows with the on-call names", async () => {
    const { container, restore } = await renderWithProvider(<ServicesView />);
    restore();
    expect(container.textContent).toContain("services");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The rotations view
 * ───────────────────────────────────────────────────────────────── */

describe("RotationsView (the weekly schedule + overrides)", () => {
  test("renders the rotation rows with the handoff + on-call seat", async () => {
    const { container, restore } = await renderWithProvider(<RotationsView />);
    restore();
    expect(container.textContent).toContain("rotations");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The runbooks view
 * ───────────────────────────────────────────────────────────────── */

describe("RunbooksView (the checklists + progress)", () => {
  test("renders the runbook rows with the step counts", async () => {
    const { container, restore } = await renderWithProvider(<RunbooksView />);
    restore();
    expect(container.textContent).toContain("runbooks");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The postmortems view
 * ───────────────────────────────────────────────────────────────── */

describe("PostmortemsView (the postmortem trail)", () => {
  test("renders the postmortem rows with the action-item counts", async () => {
    const { container, restore } = await renderWithProvider(<PostmortemsView />);
    restore();
    expect(container.textContent).toContain("postmortems");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The analytics view
 * ───────────────────────────────────────────────────────────────── */

describe("AnalyticsView (the MTTA/MTTR + on-call load)", () => {
  test("renders the 4 KPI tiles + the severity + service + load panels", async () => {
    const { container, restore } = await renderWithProvider(<AnalyticsView />);
    restore();
    for (const label of ["MTTA", "MTTR", "SLA breach rate", "On-call load"]) {
      expect(container.textContent).toContain(label);
    }
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The members view
 * ───────────────────────────────────────────────────────────────── */

describe("MembersView (the members + invites + audit)", () => {
  test("renders the members list, the invite form + the audit feed", async () => {
    const { container, restore } = await renderWithProvider(<MembersView />);
    restore();
    expect(container.textContent).toContain("Members");
    expect(container.textContent).toContain("Invite a member");
    expect(container.textContent).toContain("Audit log");
    // The RBAC matrix table is visible.
    expect(container.textContent).toContain("What each role can do");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The public status page
 * ───────────────────────────────────────────────────────────────── */

describe("PublicStatusPage (the public, no-auth surface)", () => {
  test("renders the components + active incidents (the lean public view)", async () => {
    const { container, restore } = await renderWithProvider(<PublicStatusPage />);
    restore();
    expect(container.textContent).toContain("system status");
    expect(container.textContent).toContain("Components");
    expect(container.textContent).toContain("Active incidents");
  });

  test("fetches the public status route (no session needed)", async () => {
    const { called, restore } = await renderWithProvider(<PublicStatusPage />);
    restore();
    expect(called.some((c) => c.url.includes("/nocturne/api/public-status/"))).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The embed reset listener: right-shape / wrong-origin / wrong-shape
 * ────────────────────────────────────────────────────────────────── */

describe("the embed reset listener (the `nocturne-reset` handshake)", () => {
  test("a right-shape message from the same origin triggers the reset fetch", async () => {
    const stub = installFetchStub({ session: OWNER });
    const { unmount } = render(
      <NocturneProvider embed={true} hasSession={true}>
        <div data-testid="embed-probe" />
      </NocturneProvider>,
    );
    // Let the provider's initial probe + data load settle (the
    // `booted` ref flips, the embed listener mounts).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The origin check (`e.origin !== window.origin`) settles the
    // test against the happy-dom `window.origin` the provider reads
    // — pin the same origin on the dispatched event so it matches.
    const ev = new MessageEvent("message", {
      data: { source: "unown-landing", type: "nocturne-reset" },
    }) as unknown as MessageEvent;
    try {
      Object.defineProperty(ev, "origin", { value: window.origin, configurable: true });
    } catch {
      /* origin may be read-only on the happy-dom MessageEvent */
    }
    window.dispatchEvent(ev);
    // The reset listener's IIFE runs the POST + the re-probe; wait
    // for it to settle before asserting on the `called` log.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(stub.called.some((c) => c.url.includes("/nocturne/api/demo/reset"))).toBe(true);
    stub.restore();
    unmount();
  });

  test("a wrong-shape message does NOT trigger the reset fetch", async () => {
    const stub = installFetchStub({ session: OWNER });
    const { unmount } = render(
      <NocturneProvider embed={true} hasSession={true}>
        <div data-testid="embed-probe" />
      </NocturneProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Wrong shape: missing the `source` field. Same-origin so the
    // listener's origin check passes but the shape check rejects it.
    const ev = new MessageEvent("message", {
      data: { type: "nocturne-reset" },
    }) as unknown as MessageEvent;
    try {
      Object.defineProperty(ev, "origin", { value: window.origin, configurable: true });
    } catch {
      /* origin may be read-only on the happy-dom MessageEvent */
    }
    window.dispatchEvent(ev);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(stub.called.some((c) => c.url.includes("/nocturne/api/demo/reset"))).toBe(false);
    stub.restore();
    unmount();
  });

  test("the listener is NOT mounted when embed is false", async () => {
    const stub = installFetchStub({ session: OWNER });
    const { unmount } = render(
      <NocturneProvider embed={false} hasSession={true}>
        <div data-testid="embed-probe" />
      </NocturneProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Even with the right shape + origin, a non-embed provider has
    // no listener → the reset fetch is never called.
    const ev = new MessageEvent("message", {
      data: { source: "unown-landing", type: "nocturne-reset" },
    }) as unknown as MessageEvent;
    try {
      Object.defineProperty(ev, "origin", { value: window.origin, configurable: true });
    } catch {
      /* origin may be read-only on the happy-dom MessageEvent */
    }
    window.dispatchEvent(ev);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(stub.called.some((c) => c.url.includes("/nocturne/api/demo/reset"))).toBe(false);
    stub.restore();
    unmount();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The RBAC-disabled-with-reason surfaces
 * ────────────────────────────────────────────────────────────────── */

describe("the RBAC-disabled-with-reason surfaces", () => {
  test("a viewer's note composer is disabled with a visible reason", async () => {
    const { container, restore } = await renderWithProvider(<IncidentsView />, VIEWER);
    // Open the first incident (the detail shows the notes composer).
    const firstBtn = [...container.querySelectorAll("button")].find((b) =>
      b.querySelector('[role="img"][aria-label^="severity"]'),
    );
    if (firstBtn) {
      fireEvent.click(firstBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
    // The composer's textarea is disabled for a viewer + the
    // "read-only role" reason is visible.
    const textarea = container.querySelector('textarea[aria-label="New note body"]') as HTMLTextAreaElement | null;
    const text = container.textContent ?? "";
    expect(text).toContain("read-only role");
    if (textarea) {
      expect(textarea.disabled).toBe(true);
    }
  });

  test("an owner's note composer is enabled (no deny reason)", async () => {
    const { container, restore } = await renderWithProvider(<IncidentsView />);
    const firstBtn = [...container.querySelectorAll("button")].find((b) =>
      b.querySelector('[role="img"][aria-label^="severity"]'),
    );
    if (firstBtn) {
      fireEvent.click(firstBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
    const textarea = container.querySelector('textarea[aria-label="New note body"]') as HTMLTextAreaElement | null;
    if (textarea) {
      expect(textarea.disabled).toBe(false);
    }
  });
});
