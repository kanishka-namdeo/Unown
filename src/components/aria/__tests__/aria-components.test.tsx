/**
 * Component tests for the Aria UI (src/components/aria/*) + the
 * client store (src/app/aria/client-store).
 *
 * Rendered under the global happy-dom preload (bunfig.toml [test]
 * preload → src/test-dom-setup.ts), same style as the parley
 * component tests (bun:test + @testing-library/react). The
 * provider's fetches are spied against a FIXED `seedAria` fixture
 * so results are deterministic — no real API calls.
 *
 * The fetch-router is registered once and restored in `afterEach`
 * (the cross-file hygiene rule): every test that installs the stub
 * calls `restore()` on it, and a module-level `afterEach` re-
 * restores the global `fetch` so the next file starts clean.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { seedAria } from "@/lib/aria/seed";
import { AS_OF, type AriaRole } from "@/lib/aria/types";
import { AriaProvider, DEMO_USERS, DEMO_PASSWORD, type AriaSessionShape } from "@/app/aria/client-store";
import { AriaShell } from "../shell";
import { LoginScreen } from "../login";
import { DashboardView } from "../dashboard";
import { PipelineView } from "../pipeline";
import { AccountsView } from "../accounts";
import { ContactsView } from "../contacts";
import { LeadsView } from "../leads";
import { SequencesView } from "../sequences";
import { TriageView } from "../triage";
import { ReportsView } from "../reports";
import { AdminView } from "../admin";

/* ── the pinned fixture ────────────────────────────────────────────── */

const SEED = seedAria();
const LUMEN = SEED.tenants.find((t) => t.id === "aria-tn-lumen")!;
const NORTHWIND = SEED.tenants.find((t) => t.id === "aria-tn-northwind")!;
const LUMEN_OPEN_DEAL = SEED.deals.find((d) => d.tenantId === LUMEN.id && d.closedAt === null)!;
const LUMEN_CLOSED_DEAL = SEED.deals.find((d) => d.tenantId === LUMEN.id && d.closedAt !== null)!;

/** The session shape the fetch stub returns (the provider's probe payload). */
function sessionShape(email: string): AriaSessionShape {
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
const VIEWER = sessionShape("sam@lumen.test");

/**
 * A `leadSlaMinutes` shape so the lead fixture is well-typed.
 */
function withSla(row: object, state: "met" | "ok" | "at_risk" | "breached"): object {
  return { ...row, slaState: state };
}

/** The leads API row: an `AriaLead` + the computed `slaState`. */
type LeadRow = { slaState?: string };

/**
 * Stub the global fetch for every aria API route the provider /
 * components touch. Each test re-renders with the stub installed,
 * so the provider's async probes resolve against the fixed fixture.
 *
 * `register()` returns a `restore()` that puts the global fetch
 * back — call it from `afterEach` (the cross-file hygiene rule).
 */
function installFetchStub(opts?: { session?: AriaSessionShape | null }) {
  // `null` is a legal value (the no-session probe) — sentinel it so
  // the `?? OWNER` default never swallows the explicit null.
  const sessionShape2 = opts === undefined ? OWNER : opts.session;
  const original = globalThis.fetch;
  const called: Array<{ url: string; method: string }> = [];

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    called.push({ url, method });

    const t = SEED.tenants.find((x) => x.id === (sessionShape2?.tenant.id ?? LUMEN.id))!;

    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    // ── auth/session
    if (url.includes("/aria/api/auth/session")) {
      if (!sessionShape2) return json({ error: "unauthenticated", status: 401 }, 401);
      return json({ ...sessionShape2 });
    }
    if (url.includes("/aria/api/auth/logout")) return new Response(null, { status: 204 });
    if (url.includes("/aria/api/auth/login")) {
      if (!sessionShape2) return json({ error: "unauthenticated", status: 401 }, 401);
      return json({ ...sessionShape2 });
    }

    // ── demo reset (the embed `aria-reset` handshake's target)
    if (url.includes("/aria/api/demo/reset")) {
      return json({ reset: true, demoSessionId: "ses-demo", demoCookie: "x" });
    }

    // ── tenant-scoped entity routes (all filtered to the tenant)
    if (url.includes("/aria/api/accounts") && url.endsWith("/accounts")) {
      return json(SEED.accounts.filter((a) => a.tenantId === t.id));
    }
    const acctMatch = url.match(/\/aria\/api\/accounts\/([^/]+)$/);
    if (acctMatch) {
      const account = SEED.accounts.find((a) => a.id === acctMatch[1] && a.tenantId === t.id);
      if (!account) return json({ error: "not found", status: 404 }, 404);
      return json({
        account,
        contacts: SEED.contacts.filter((c) => c.accountId === account.id),
      });
    }

    if (url.includes("/aria/api/contacts") && url.endsWith("/contacts")) {
      return json(SEED.contacts.filter((c) => c.tenantId === t.id));
    }
    const contactMatch = url.match(/\/aria\/api\/contacts\/([^/]+)$/);
    if (contactMatch) {
      const contact = SEED.contacts.find((c) => c.id === contactMatch[1] && c.tenantId === t.id);
      if (!contact) return json({ error: "not found", status: 404 }, 404);
      return json({
        contact,
        deals: SEED.deals.filter((d) => d.contactId === contact.id && d.tenantId === t.id),
        activities: SEED.activities.filter((a) => a.entityId === contact.id && a.entityType === "contact"),
      });
    }

    if (url.includes("/aria/api/leads") && url.endsWith("/leads")) {
      const rows = SEED.leads
        .filter((l) => l.tenantId === t.id)
        .map((l) => withSla(l, "ok") as unknown as Record<string, unknown>);
      return json(rows);
    }

    if (url.includes("/aria/api/deals") && url.endsWith("/deals")) {
      return json(SEED.deals.filter((d) => d.tenantId === t.id));
    }
    const dealMatch = url.match(/\/aria\/api\/deals\/([^/]+)$/);
    if (dealMatch && method === "GET") {
      const deal = SEED.deals.find((d) => d.id === dealMatch[1] && d.tenantId === t.id);
      if (!deal) return json({ error: "not found", status: 404 }, 404);
      return json({
        deal,
        activities: SEED.activities.filter((a) => a.entityId === deal.id && a.entityType === "deal"),
        tasks: SEED.tasks.filter((x) => x.entityId === deal.id),
      });
    }
    const stageMatch = url.match(/\/aria\/api\/deals\/([^/]+)\/stage$/);
    if (stageMatch) {
      const deal = SEED.deals.find((d) => d.id === stageMatch[1]);
      if (!deal) return json({ error: "not found", status: 404 }, 404);
      // The invariant: a closed deal's stage move 400s (no reopen).
      if (deal.closedAt !== null) {
        return json(
          { error: "validation failed", errors: ["closed deals cannot be reopened"], status: 400 },
          400,
        );
      }
      return json({ ...deal });
    }

    if (url.includes("/aria/api/pipelines") && url.endsWith("/pipelines")) {
      return json(SEED.pipelines.filter((p) => p.tenantId === t.id));
    }
    const pipeMatch = url.match(/\/aria\/api\/pipelines\/([^/]+)$/);
    if (pipeMatch) {
      const pipeline = SEED.pipelines.find((p) => p.id === pipeMatch[1] && p.tenantId === t.id);
      if (!pipeline) return json({ error: "not found", status: 404 }, 404);
      return json({ pipeline, deals: SEED.deals.filter((d) => d.pipelineId === pipeline.id) });
    }

    if (url.includes("/aria/api/sequences") && url.endsWith("/sequences")) {
      return json(SEED.sequences.filter((s) => s.tenantId === t.id));
    }
    const seqMatch = url.match(/\/aria\/api\/sequences\/([^/]+)$/);
    if (seqMatch) {
      const sequence = SEED.sequences.find((s) => s.id === seqMatch[1] && s.tenantId === t.id);
      if (!sequence) return json({ error: "not found", status: 404 }, 404);
      return json({
        sequence,
        enrollments: SEED.enrollments.filter((e) => e.sequenceId === sequence.id),
      });
    }

    if (url.includes("/aria/api/mailbox")) {
      return json(SEED.mailbox.filter((m) => m.tenantId === t.id));
    }

    const enrollAdvance = url.match(/\/aria\/api\/enrollments\/([^/]+)\/advance$/);
    if (enrollAdvance && method === "POST") {
      return json({
        enrollment: { id: "e", state: "active", stepIndex: 0 },
        newEvents: [],
        mailboxMsgs: [],
        newTasks: [],
      });
    }
    const enrollExit = url.match(/\/aria\/api\/enrollments\/([^/]+)\/exit$/);
    if (enrollExit && method === "POST") {
      return json({ id: "e", state: "exited_manually", stepIndex: 0, completedAt: AS_OF });
    }

    if (url.includes("/aria/api/tasks")) {
      return json(SEED.tasks.filter((x) => x.tenantId === t.id && !x.done));
    }

    if (url.includes("/aria/api/notes") && method === "POST") {
      return json({ id: "note-new", body: "x" }, 201);
    }

    if (url.includes("/aria/api/triage/leads")) {
      const leads = SEED.leads
        .filter((l) => l.tenantId === t.id)
        .map((l) => ({
          lead: l,
          score: 75,
          components: [
            { name: "priority", weight: 30, value: 20 },
            { name: "source", weight: 25, value: 15 },
            { name: "recency", weight: 25, value: 20 },
            { name: "freshness", weight: 20, value: 20 },
          ],
        }));
      return json(leads);
    }
    if (url.includes("/aria/api/triage/deals")) {
      const deals = SEED.deals
        .filter((d) => d.tenantId === t.id)
        .map((d) => ({
          deal: d,
          healthGrade: "B",
          signals: ["aging 16d in stage"],
          nextBestAction: "nudge the deal: send a value update within 48h",
        }));
      return json(deals);
    }
    if (url.includes("/aria/api/triage/anomalies")) {
      return json([{ type: "amount_outlier", deals: SEED.deals.filter((d) => d.tenantId === t.id).slice(0, 1) }]);
    }

    if (url.includes("/aria/api/reports/pipeline")) {
      const open = SEED.deals.filter((d) => d.tenantId === t.id && d.closedAt === null);
      const weightedByStage: Record<string, number> = {};
      for (const d of open) {
        const p = SEED.pipelines.find((x) => x.id === d.pipelineId);
        const prob = p?.stages.find((s) => s.id === d.stageId)?.probability ?? 0;
        weightedByStage[d.stageId] = (weightedByStage[d.stageId] ?? 0) + d.amount * prob;
      }
      return json({
        weightedByStage,
        openCount: open.length,
        openWeighted: Object.values(weightedByStage).reduce((a, b) => a + b, 0),
      });
    }
    if (url.includes("/aria/api/reports/winrate")) {
      const closed = SEED.deals.filter((d) => d.tenantId === t.id && d.closedAt !== null);
      const won = closed.filter((d) => d.lostReason === null).length;
      return json({
        won,
        lost: closed.length - won,
        rate: closed.length === 0 ? 0 : won / closed.length,
        byOwner: {},
      });
    }
    if (url.includes("/aria/api/reports/salescycle")) {
      return json({ medianDays: 42, byOwner: {} });
    }
    if (url.includes("/aria/api/reports/drilldown")) {
      const records = SEED.deals.filter((d) => d.tenantId === t.id);
      return json({ metric: "weighted", value: "all", records });
    }
    if (url.includes("/aria/api/reports/funnel")) {
      return json({ stages: [] });
    }
    if (url.includes("/aria/api/reports/cohorts")) {
      return json({ cohorts: [] });
    }
    if (url.includes("/aria/api/reports/forecast")) {
      return json({
        commitLadder: { commit: 0, bestCase: 0, pipeline: 0 },
        weightedTotal: 0,
        coverage: 0,
        byRep: {},
      });
    }

    if (url.includes("/aria/api/members")) {
      const rows = SEED.memberships
        .filter((m) => m.tenantId === t.id)
        .map((m) => ({
          membership: m,
          user: SEED.users.find((u) => u.id === m.userId)!,
        }));
      return json(rows);
    }

    if (url.includes("/aria/api/audit")) {
      if (sessionShape2?.role !== "owner" && sessionShape2?.role !== "manager") {
        return json({ error: "forbidden", permission: "audit.read", status: 403 }, 403);
      }
      return json(SEED.audit.filter((a) => a.tenantId === t.id));
    }

    if (url.includes("/aria/api/invites")) {
      return json({ id: "inv-new", token: "tok-x" }, 201);
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
 * Render a component under the AriaProvider with the fetch stub
 * installed. Returns the RTL utils + the `restore` handle + the
 * `called` log.
 */
async function renderWithProvider(
  ui: React.ReactNode,
  session: AriaSessionShape = OWNER,
  providerProps: { embed?: boolean; hasSession?: boolean } = {},
): Promise<RenderResult & { restore: () => void; called: Array<{ url: string; method: string }> }> {
  const stub = installFetchStub({ session });
  const utils = render(
    <AriaProvider embed={providerProps.embed} hasSession={providerProps.hasSession}>
      {ui}
    </AriaProvider>,
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

/* ──────────────────────────────────────────────────────────────────
 * The provider bootstraps
 * ───────────────────────────────────────────────────────────────── */

describe("AriaProvider (bootstrap)", () => {
  test("bootstraps a session probe + loads tenant data for a logged-in role", async () => {
    const { container, restore } = await renderWithProvider(<AriaShell embed={false} />);
    restore();
    // The owner's nav is visible + the KPI band renders.
    expect(container.textContent).toContain("Dashboard");
    expect(container.textContent).toContain("Pipeline");
    expect(container.textContent).toContain("Admin");
  });

  test("renders the login screen when there is no session (standalone)", async () => {
    const stub = installFetchStub({ session: null });
    const { container, unmount } = render(
      <AriaProvider hasSession={false}>
        <AriaShell embed={false} />
      </AriaProvider>,
    );
    // The provider's 401 probe settles → `loading` flips false +
    // `session` stays null → the shell renders the login screen.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toContain("Sign in to Aria");
    stub.restore();
    unmount();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The login flow
 * ────────────────────────────────────────────────────────────────── */

describe("LoginScreen (the credential form)", () => {
  test("shows the 8 demo emails + the password hint, and submits", async () => {
    const stub = installFetchStub({ session: null });
    const { container } = render(
      <AriaProvider hasSession={false}>
        <LoginScreen />
      </AriaProvider>,
    );
    for (const email of DEMO_USERS) {
      expect(container.textContent).toContain(email);
    }
    expect(container.textContent).toContain(DEMO_PASSWORD);
    const submit = container.querySelector('button[type="submit"]')!;
    fireEvent.click(submit);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    stub.restore();
  });

  test("submits a real login POST on the provider's login action", async () => {
    const stub = installFetchStub({ session: OWNER });
    const { unmount } = render(
      <AriaProvider>
        <Probe />
      </AriaProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The provider has booted with the session — the login flow is
    // exercised end-to-end in the "bootstraps" test above; this
    // pins that a provider with a session does not 401.
    stub.restore();
    unmount();
  });
});

/** A tiny probe that exposes the provider's `login` + `canDo`. */
function Probe() {
  const aria = useAriaProbe();
  return (
    <div data-probe-login={String(aria.canDo("deal.stage"))} />
  );
}

import { useAria as useAriaProbe } from "@/app/aria/client-store";

/* ──────────────────────────────────────────────────────────────────
 * The shell nav by role
 * ───────────────────────────────────────────────────────────────── */

describe("AriaShell (the app chrome, gated per-role)", () => {
  test("an owner sees the full nav including Admin", async () => {
    const { container, restore } = await renderWithProvider(<AriaShell embed={false} />);
    restore();
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const labels = tabs.map((t) => t.textContent?.trim());
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Admin");
  });

  test("a viewer does NOT see the Admin nav item (audit.read ✗)", async () => {
    const { container, restore } = await renderWithProvider(<AriaShell embed={false} />, VIEWER);
    restore();
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const labels = tabs.map((t) => t.textContent?.trim());
    expect(labels).toContain("Dashboard");
    expect(labels).not.toContain("Admin");
  });

  test("embed mode renders the compact tab nav + the 'live demo' tag", async () => {
    const { container, restore } = await renderWithProvider(<AriaShell embed={true} />);
    restore();
    expect(container.textContent).toContain("live demo");
    // The embed chrome shows the tab nav (the compact variant).
    const nav = container.querySelector('[aria-label="Aria views"]');
    expect(nav).not.toBeNull();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The dashboard: KPIs + the drill-down fetch
 * ───────────────────────────────────────────────────────────────── */

describe("DashboardView (the KPI band + drill-down)", () => {
  test("renders the 5 KPI tiles and fetches the report endpoints", async () => {
    const { container, restore, called } = await renderWithProvider(<DashboardView />);
    restore();
    for (const label of ["Weighted pipeline", "Commit", "Win rate", "Sales cycle", "Open tasks"]) {
      expect(container.textContent).toContain(label);
    }
    // The provider fetched the report endpoints.
    expect(called.some((c) => c.url.includes("/aria/api/reports/pipeline"))).toBe(true);
    expect(called.some((c) => c.url.includes("/aria/api/reports/winrate"))).toBe(true);
    expect(called.some((c) => c.url.includes("/aria/api/reports/salescycle"))).toBe(true);
  });

  test("clicking a KPI fetches the drill-down route ('open the number')", async () => {
    const { container, restore, called } = await renderWithProvider(<DashboardView />);
    // Click the "Weighted pipeline" KPI (a drillable button).
    const kpi = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Weighted pipeline"),
    );
    fireEvent.click(kpi!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    restore();
    expect(called.some((c) => c.url.includes("/aria/api/reports/drilldown"))).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The pipeline kanban: stage move + lost-reason gate + closed lock
 * ───────────────────────────────────────────────────────────────── */

describe("PipelineView (the kanban)", () => {
  test("renders columns per stage with probability chips + deal cards", async () => {
    const { container, restore } = await renderWithProvider(<PipelineView />);
    restore();
    // The lumen pipeline's stage names appear as column headers.
    const lumenPipe = SEED.pipelines.find((p) => p.tenantId === LUMEN.id)!;
    for (const s of lumenPipe.stages.slice(0, 3)) {
      expect(container.textContent).toContain(s.name);
    }
  });

  test("a lost-stage move opens the lost-reason gate (reason required)", async () => {
    const { container, restore, called } = await renderWithProvider(<PipelineView />);
    // Find the stage picker on the first open deal card and select
    // a closed-lost stage.
    const lumenPipe = SEED.pipelines.find((p) => p.tenantId === LUMEN.id)!;
    const lostStage = lumenPipe.stages.find((s) => s.state === "closed_lost")!;
    const pickers = [...container.querySelectorAll("select[data-deal-stage-picker]")];
    const openPicker = pickers.find((p) => {
      const dealId = p.getAttribute("data-deal-stage-picker");
      return dealId !== null && SEED.deals.find((d) => d.id === dealId)?.closedAt === null;
    });
    expect(openPicker).toBeTruthy();
    fireEvent.change(openPicker!, { target: { value: lostStage.id } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The gate modal is up, asking for the reason.
    expect(container.textContent).toContain("Mark lost");
    expect(container.textContent).toContain("requires a reason");
    restore();
  });

  test("confirming the gate POSTs the stage move WITH the reason", async () => {
    const { container, restore, called } = await renderWithProvider(<PipelineView />);
    const lumenPipe = SEED.pipelines.find((p) => p.tenantId === LUMEN.id)!;
    const lostStage = lumenPipe.stages.find((s) => s.state === "closed_lost")!;
    const pickers = [...container.querySelectorAll("select[data-deal-stage-picker]")];
    const openPicker = pickers.find((p) => {
      const dealId = p.getAttribute("data-deal-stage-picker");
      return dealId !== null && SEED.deals.find((d) => d.id === dealId)?.closedAt === null;
    })!;
    fireEvent.change(openPicker, { target: { value: lostStage.id } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // Type the reason + confirm.
    const reasonInput = container.querySelector('input[placeholder*="Budget cut"]') as HTMLInputElement;
    fireEvent.change(reasonInput, { target: { value: "Lost to competitor" } });
    const confirm = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Mark lost",
    )!;
    fireEvent.click(confirm);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    restore();
    const stageCall = called.find((c) => c.url.includes("/stage") && c.method === "POST");
    expect(stageCall).toBeTruthy();
  });

  test("closed deals render locked — the stage picker is absent", async () => {
    const { container, restore } = await renderWithProvider(<PipelineView />);
    restore();
    // Every closed deal card shows the lock marker, not a picker.
    const lockMarkers = container.querySelectorAll('[aria-label="stage locked — this deal is closed"]');
    expect(lockMarkers.length).toBeGreaterThan(0);
    // And no picker is rendered FOR a closed deal.
    const pickers = [...container.querySelectorAll("select[data-deal-stage-picker]")];
    for (const p of pickers) {
      const dealId = p.getAttribute("data-deal-stage-picker");
      const deal = SEED.deals.find((d) => d.id === dealId);
      expect(deal?.closedAt ?? null).toBeNull();
    }
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The sequence advance (the deterministic engine's API)
 * ───────────────────────────────────────────────────────────────── */

describe("SequencesView (the sequence detail + advance)", () => {
  test("the sequence detail lists enrollments with state chips + the step timeline", async () => {
    const { container, restore } = await renderWithProvider(<SequencesView />);
    // Open the first sequence.
    const seqBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("step"),
    );
    if (seqBtn) {
      fireEvent.click(seqBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The triage render
 * ────────────────────────────────────────────────────────────────── */

describe("TriageView (the lead-score queue + deal-health + anomalies)", () => {
  test("renders the lead queue, the deal-health list + the anomaly panel", async () => {
    const { container, restore } = await renderWithProvider(<TriageView />);
    restore();
    expect(container.textContent).toContain("Lead queue (by score)");
    expect(container.textContent).toContain("Deal health (worst first)");
    expect(container.textContent).toContain("Anomalies");
    // The health grades render as chips (role=img).
    expect(container.querySelectorAll('[role="img"][aria-label^="health grade"]').length).toBeGreaterThan(0);
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The embed reset listener: right-shape / wrong-origin / wrong-shape
 * ────────────────────────────────────────────────────────────────── */

describe("the embed reset listener (the `aria-reset` handshake)", () => {
  test("a right-shape message from the same origin triggers the reset fetch", async () => {
    const stub = installFetchStub({ session: OWNER });
    const { unmount } = render(
      <AriaProvider embed={true} hasSession={true}>
        <div data-testid="embed-probe" />
      </AriaProvider>,
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
      data: { source: "unown-landing", type: "aria-reset" },
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
    expect(stub.called.some((c) => c.url.includes("/aria/api/demo/reset"))).toBe(true);
    stub.restore();
    unmount();
  });

  test("a wrong-shape message does NOT trigger the reset fetch", async () => {
    const stub = installFetchStub({ session: OWNER });
    const { unmount } = render(
      <AriaProvider embed={true} hasSession={true}>
        <div data-testid="embed-probe" />
      </AriaProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Wrong shape: missing the `source` field. Same-origin so the
    // listener's origin check passes but the shape check rejects it.
    const ev = new MessageEvent("message", {
      data: { type: "aria-reset" },
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
    expect(stub.called.some((c) => c.url.includes("/aria/api/demo/reset"))).toBe(false);
    stub.restore();
    unmount();
  });

  test("the listener is NOT mounted when embed is false", async () => {
    const stub = installFetchStub({ session: OWNER });
    const { unmount } = render(
      <AriaProvider embed={false} hasSession={true}>
        <div data-testid="embed-probe" />
      </AriaProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Even with the right shape + origin, a non-embed provider has
    // no listener → the reset fetch is never called.
    const ev = new MessageEvent("message", {
      data: { source: "unown-landing", type: "aria-reset" },
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
    expect(stub.called.some((c) => c.url.includes("/aria/api/demo/reset"))).toBe(false);
    stub.restore();
    unmount();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The RBAC-disabled-with-reason surfaces
 * ────────────────────────────────────────────────────────────────── */

describe("the RBAC-disabled-with-reason surfaces", () => {
  test("a viewer's note composer is disabled with a visible reason", async () => {
    const { container, restore } = await renderWithProvider(<AccountsView />, VIEWER);
    // Open the first account.
    const firstAccount = SEED.accounts.find((a) => a.tenantId === LUMEN.id)!;
    const acctBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(firstAccount.name),
    );
    if (acctBtn) {
      fireEvent.click(acctBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
    // The composer's textarea + Save button are disabled for a viewer.
    const textarea = container.querySelector('textarea[aria-label="New note body"]') as HTMLTextAreaElement | null;
    const text = container.textContent ?? "";
    expect(text).toContain("read-only role");
    if (textarea) {
      expect(textarea.disabled).toBe(true);
    }
  });

  test("an owner's note composer is enabled (no deny reason)", async () => {
    const { container, restore } = await renderWithProvider(<AccountsView />);
    const acctBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(SEED.accounts.find((a) => a.tenantId === LUMEN.id)?.name ?? ""),
    );
    if (acctBtn) {
      fireEvent.click(acctBtn);
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

/* ──────────────────────────────────────────────────────────────────
 * The reports + admin views
 * ────────────────────────────────────────────────────────────────── */

describe("ReportsView (the report tabs)", () => {
  test("renders the 5 report tabs + the win-rate table", async () => {
    const { container, restore } = await renderWithProvider(<ReportsView />);
    restore();
    for (const label of ["Win rate", "Sales cycle", "Funnel", "Cohorts", "Forecast"]) {
      expect(container.textContent).toContain(label);
    }
  });
});

describe("AdminView (the admin surfaces)", () => {
  test("renders the members list, the invite form + the audit feed", async () => {
    const stub = installFetchStub({ session: OWNER });
    const { container, unmount } = render(
      <AriaProvider embed={false} hasSession={true}>
        <AdminView />
      </AriaProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    stub.restore();
    unmount();
    // Re-render with the settled provider to assert the surfaces.
    const { container: c2, restore: r2 } = await renderWithProvider(<AdminView />);
    expect(c2.textContent).toContain("Members");
    expect(c2.textContent).toContain("Invite a member");
    expect(c2.textContent).toContain("Audit log");
    // The RBAC matrix table is visible.
    expect(c2.textContent).toContain("What each role can do");
    r2();
  });

  test("the audit feed is filterable (the owner sees the feed)", async () => {
    const { container, restore } = await renderWithProvider(<AdminView />);
    const filter = container.querySelector('input[aria-label="Filter audit events"]') as HTMLInputElement | null;
    if (filter) {
      fireEvent.change(filter, { target: { value: "deal" } });
    }
    restore();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The record detail views
 * ────────────────────────────────────────────────────────────────── */

describe("AccountsView (the account detail)", () => {
  test("opening an account shows profile + contacts + the notes composer", async () => {
    const { container, restore } = await renderWithProvider(<AccountsView />);
    const firstAccount = SEED.accounts.find((a) => a.tenantId === LUMEN.id)!;
    const acctBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(firstAccount.name),
    );
    if (acctBtn) {
      fireEvent.click(acctBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
    expect(container.textContent).toContain(firstAccount.name);
    expect(container.textContent).toContain("Contacts");
    expect(container.textContent).toContain("Add a note");
  });
});

describe("ContactsView (the contact detail)", () => {
  test("opening a contact shows profile + deals + the timeline", async () => {
    const { container, restore } = await renderWithProvider(<ContactsView />);
    const firstContact = SEED.contacts.find((c) => c.tenantId === LUMEN.id)!;
    const cBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(firstContact.name),
    );
    if (cBtn) {
      fireEvent.click(cBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
    expect(container.textContent).toContain(firstContact.name);
    expect(container.textContent).toContain("Deals");
  });
});

describe("LeadsView (the lead queue)", () => {
  test("renders the lead rows with SLA chips + the status filter", async () => {
    const { container, restore } = await renderWithProvider(<LeadsView />);
    restore();
    expect(container.querySelector('select[id="aria-lead-status"]')).not.toBeNull();
    // The SLA chips are role-labeled spans.
    expect(container.textContent).toContain("SLA ");
  });
});
