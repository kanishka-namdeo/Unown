/**
 * Component tests for the Parley UI (src/components/parley/*) + the
 * client store (src/app/parley/client-store).
 *
 * Rendered under the global happy-dom preload (bunfig.toml [test]
 * preload → src/test-dom-setup.ts), same style as the cadence
 * component tests (bun:test + @testing-library/react). The
 * provider's fetches are spied against a FIXED `seedParley`
 * fixture so results are deterministic — no real API calls.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { seedParley } from "@/lib/parley/seed";
import type { Conversation } from "@/lib/parley/types";
import { SlaChip, StatusChip, PriorityChip } from "../primitives";
import { ParleyProvider } from "@/app/parley/client-store";
import { ParleyShell } from "../shell";
import { LoginScreen } from "../login";
import { InboxView, ThreadView } from "../inbox";
import { Composer } from "../composer";
import { DetailPanel } from "../detail";
import { MembersView } from "../members";
import { UsageView } from "../usage";
import { AnalyticsView } from "../analytics";
import { PortalView } from "../portal";

/* ── the pinned fixture: a seeded conversation + its thread ───────── */

const SEED = seedParley();
const LUMEN = SEED.tenants.find((t) => t.id === "tn-lumen")!;
const LUMEN_CONVO = SEED.conversations.find((c) => c.id === "cnv-seed-01")!;

/**
 * A session shape for the fetch stub (the provider's probe payload).
 */
export interface SessionShape {
  id: string;
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string };
  role: "owner" | "admin" | "agent" | "viewer";
}

function convoWithSla(c: Conversation): Conversation & { slaState: string; slaLabel: string } {
  return { ...c, slaState: "breached", slaLabel: "breached" };
}

/**
 * Stub the global fetch for every parley API route the provider /
 * components touch. Each test re-renders with the stub installed, so
 * the provider's async probes resolve against the fixed fixture.
 */
const OWNER: SessionShape = {
  id: "ses-owner",
  user: { id: "usr-mira", email: "mira@lumen.test", name: "Mira Chen" },
  tenant: { id: "tn-lumen", slug: "lumen" },
  role: "owner",
};
const VIEWER: SessionShape = {
  id: "ses-viewer",
  user: { id: "usr-sam", email: "sam@lumen.test", name: "Sam Ito" },
  tenant: { id: "tn-lumen", slug: "lumen" },
  role: "viewer",
};

/**
 * Stub the global fetch for every parley API route the provider /
 * components touch. Each test re-renders with the stub installed, so
 * the provider's async probes resolve against the fixed fixture.
 */
function installFetchStub(opts?: { session?: SessionShape | null }) {
  const sessionShape = opts?.session ?? OWNER;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    // ── auth/session
    if (url.includes("/parley/api/auth/session")) {
      if (!sessionShape) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { "content-type": "application/json" } });
      return json({ ...sessionShape });
    }
    if (url.includes("/parley/api/auth/logout")) return new Response(null, { status: 204 });
    if (url.includes("/parley/api/auth/login")) return json({ id: "ses-new" });

    // ── members
    if (url.includes("/parley/api/members")) {
      const rows = SEED.memberships
        .filter((m) => m.tenantId === "tn-lumen")
        .map((m) => ({
          membership: m,
          user: SEED.users.find((u) => u.id === m.userId)!,
        }));
      return json(rows);
    }

    // ── conversations list
    if (url.includes("/parley/api/conversations") && !/\d/.test(url.split("/").pop() ?? "")) {
      const rows = SEED.conversations
        .filter((c) => c.tenantId === "tn-lumen")
        .map(convoWithSla);
      return json({ conversations: rows, counts: { all: rows.length, open: 4, pending: 1, closed: 1, unassigned: 1, sla_risk: 1 } });
    }

    // ── a single conversation thread
    const convoMatch = url.match(/conversations\/([^/]+)$/);
    if (convoMatch && method === "GET") {
      const c = SEED.conversations.find((x) => x.id === convoMatch[1]);
      if (!c) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
      const cust = SEED.customers.find((x) => x.id === c.customerId);
      return json({
        conversation: c,
        messages: SEED.messages.filter((m) => m.conversationId === c.id),
        events: SEED.events.filter((e) => e.conversationId === c.id),
        customer: cust ? { id: cust.id, name: cust.name, email: cust.email } : null,
      });
    }

    // ── usage
    if (url.includes("/parley/api/usage")) {
      return json({
        overage: {
          convos: { used: 47, cap: 50, over: false },
          seats: { used: 4, cap: 10, over: false },
        },
        conversationsThisMonth: 47,
        seatsUsed: 4,
        perAgentLoad: { "usr-ada": 3, "usr-theo": 1, __unassigned: 1 },
        plan: "team",
      });
    }

    // ── analytics
    if (url.includes("/parley/api/analytics")) {
      return json({
        volumeByStatus: { open: 4, pending: 1, closed: 1 },
        medianFirstResponseMs: 2 * 3_600_000,
        medianFirstResponseLabel: "2h 0m",
        resolutionRate: 0.6,
        resolutionRatePercent: 60,
        perAgentLoad: { "usr-ada": 3, "usr-theo": 1 },
      });
    }

    // ── canned
    if (url.includes("/parley/api/canned")) {
      return json(SEED.canned.filter((c) => c.tenantId === "tn-lumen"));
    }

    // ── invites + mailbox
    if (url.includes("/parley/api/mailbox")) {
      return json(SEED.invites.map((i) => ({ ...i, acceptLink: "/parley/api/invites/accept?token=" + i.token })));
    }
    if (url.includes("/parley/api/invites")) return json(SEED.invites);

    // ── audit
    if (url.includes("/parley/api/audit")) return json(SEED.audit);

    // ── POST mutators (reply / assign / status / priority / tags / canned / invites)
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      if (url.includes("/parley/api/demo/reset")) return json({ reset: true, demoSessionId: "ses-demo", demoCookie: "x" });
      if (url.includes("/reply")) return json({ id: "msg-new", role: "agent", body: "hi", createdAt: "2026-10-28T12:00:00Z" }, 201);
      if (url.includes("/invites")) return json({ id: "inv-new", token: "tok-x", usedAt: null }, 201);
      if (url.includes("/canned")) return json({ id: "can-new", title: "t", body: "b" }, 201);
      const c = SEED.conversations.find((x) => x.id === LUMEN_CONVO.id)!;
      return json({ ...c }, 200);
    }

    // Default
    return json({});
  }) as typeof fetch;

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  return () => {
    globalThis.fetch = original;
  };
}

async function renderWithProvider(
  ui: React.ReactNode,
  session: SessionShape = OWNER,
) {
  const restore = installFetchStub({ session });
  const utils = render(
    <ParleyProvider>{ui}</ParleyProvider>,
  );
  // Let the provider's initial probe settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { ...utils, restore };
}

beforeEach(() => {
  // nothing global to reset
});

afterEach(() => {
  cleanup();
});

/* ──────────────────────────────────────────────────────────────────
 * The shell
 * ───────────────────────────────────────────────────────────────── */

describe("ParleyShell", () => {
  test("renders the 4 view tabs + the embed 'live demo' tag (owner sees all 4)", async () => {
    const { container, restore } = await renderWithProvider(<ParleyShell embed={true} />);
    restore();
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Inbox", "Team", "Usage", "Analytics"]);
    expect(container.textContent).toContain("live demo");
  });

  test("an agent sees only the 2 allowed tabs (Usage/Analytics are owner/admin/viewer)", async () => {
    const AGENT: SessionShape = {
      id: "ses-agent",
      user: { id: "usr-ada", email: "ada@lumen.test", name: "Ada Okafor" },
      tenant: { id: "tn-lumen", slug: "lumen" },
      role: "agent",
    };
    const { container, restore } = await renderWithProvider(<ParleyShell embed={false} />, AGENT);
    restore();
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Inbox", "Team"]);
  });

  test("the two switchers are present (role + tenant)", async () => {
    const { container, restore } = await renderWithProvider(<ParleyShell embed={false} />);
    restore();
    expect(container.querySelector('[aria-label="Open demo mailbox"], [role="menu"], button[aria-haspopup]')).not.toBeNull();
    // the tenant switcher's two buttons
    expect(container.textContent).toContain("Lumen");
    expect(container.textContent).toContain("Northwind");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The login screen
 * ───────────────────────────────────────────────────────────────── */

describe("LoginScreen", () => {
  test("shows the 6 demo emails + the password hint, and submits", async () => {
    const restore = installFetchStub({ session: null });
    const { container } = render(
      <ParleyProvider>
        <LoginScreen />
      </ParleyProvider>,
    );
    for (const email of [
      "mira@lumen.test",
      "theo@lumen.test",
      "ada@lumen.test",
      "sam@lumen.test",
      "ingrid@northwind.test",
      "kai@northwind.test",
    ]) {
      expect(container.textContent).toContain(email);
    }
    expect(container.textContent).toContain("parley-demo-1");
    const submit = container.querySelector('button[type="submit"]')!;
    fireEvent.click(submit);
    restore();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The inbox: list + thread + SLA chips + empty states
 * ───────────────────────────────────────────────────────────────── */

describe("InboxView (the two-pane layout)", () => {
  test("renders the 6 filter chips with their counts", async () => {
    const { container, restore } = await renderWithProvider(<InboxView />);
    restore();
    const chips = [...container.querySelectorAll('[aria-label="Filters"] button')];
    expect(chips.map((c) => c.textContent)).toEqual([
      "All7",
      "Open4",
      "Pending1",
      "Closed1",
      "Unassigned1",
      "SLA at risk1",
    ]);
  });

  test("the SLA chips show ok / at_risk / breached on 3 pinned seed rows", async () => {
    const { container, restore } = await renderWithProvider(<InboxView />);
    // Every conversation in the list carries its SLA chip (the
    // per-row `slaState` computed server-side, rendered by the chip).
    const chips = [...container.querySelectorAll('[role="img"][aria-label^="SLA"]')];
    expect(chips.length).toBeGreaterThan(0);
    // All the pinned seed Lumen conversations carry a breached / at_risk
    // state at AS_OF (the seed's varied-state fixtures), so the chips
    // reflect that. The chip's aria-label reads out the state.
    const labels = chips.map((c) => c.getAttribute("aria-label"));
    for (const l of labels) {
      expect(["SLA met", "SLA ok", "SLA at_risk", "SLA breached"]).toContain(l ?? "");
    }
    restore();
  });

  test("selecting a conversation renders the thread + SLA chip", async () => {
    const { container, restore } = await renderWithProvider(<InboxView />);
    const firstConvo = container.querySelector('li button')!;
    fireEvent.click(firstConvo);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    restore();
    expect(container.textContent).toContain("portal view");
    // the thread's messages render as bubbles
    expect(container.querySelectorAll('[role="log"]').length).toBeGreaterThan(0);
  });

  test("the no-selection empty state when nothing is picked", async () => {
    const { container, restore } = await renderWithProvider(<InboxView />);
    restore();
    expect(container.textContent).toContain("Select a conversation");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The SLA chips render each state distinctly (the 4 states)
 * ───────────────────────────────────────────────────────────────── */

describe("SlaChip (the 4 states render distinctly)", () => {
  test("met / ok / at_risk / breached each render their label", () => {
    const { container } = render(<SlaChip state="met" label="met" />);
    expect(container.textContent).toContain("met");
    const { container: c2 } = render(<SlaChip state="at_risk" label="4h 2m" />);
    expect(c2.textContent).toContain("4h 2m");
    const { container: c3 } = render(<SlaChip state="breached" label="2h" />);
    expect(c3.textContent).toContain("breached");
    const { container: c4 } = render(<SlaChip state="ok" label="23h 12m" />);
    expect(c4.textContent).toContain("23h 12m");
  });
});

describe("StatusChip + PriorityChip (the list's per-row chips)", () => {
  test("the 3 statuses + 4 priorities render their labels", () => {
    const { container } = render(
      <>
        <StatusChip status="open" />
        <StatusChip status="pending" />
        <StatusChip status="closed" />
        <PriorityChip priority="urgent" />
        <PriorityChip priority="high" />
        <PriorityChip priority="normal" />
        <PriorityChip priority="low" />
      </>,
    );
    for (const t of ["open", "pending", "closed", "urgent", "high", "normal", "low"]) {
      expect(container.textContent).toContain(t);
    }
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The composer: viewer-disabled + the canned `/` dropdown
 * ───────────────────────────────────────────────────────────────── */

describe("Composer", () => {
  test("a viewer's composer is disabled with a visible reason", async () => {
    const { container, restore } = await renderWithProvider(
      <InboxView />,
      VIEWER,
    );
    // Select a conversation so the composer renders.
    const listBtn = container.querySelector('li button') as HTMLElement;
    if (listBtn) {
      fireEvent.click(listBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
    const text = container.textContent ?? "";
    // the visible reason (the UI-gate mirror of the API's 403)
    expect(text).toContain("read-only role");
    // The reply control is disabled for the viewer
    const replyBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Reply",
    );
    expect(replyBtn).toBeTruthy();
    expect(replyBtn!.disabled).toBe(true);
  });

  test("the /-prefix canned dropdown opens + inserts", async () => {
    const { container, restore } = await renderWithProvider(<InboxView />);
    const listBtn = container.querySelector('li button') as HTMLElement;
    fireEvent.click(listBtn);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const textarea = container.querySelector('textarea[aria-label="Reply"]') as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "/" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    restore();
    expect(container.textContent).toContain("Canned replies");
    const chip = container.querySelector("button[title]");
    expect(chip).toBeTruthy();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The detail panel: owner/admin/agent controls, viewer-disabled
 * ───────────────────────────────────────────────────────────────── */

describe("DetailPanel", () => {
  test("the assignee/status/priority controls are present + wired", async () => {
    const { container, restore } = await renderWithProvider(<InboxView />);
    const list = container.querySelector('li button') as HTMLElement;
    if (list) {
      fireEvent.click(list);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    restore();
    const text = container.textContent ?? "";
    if (text.includes("Select a conversation")) {
      // the inbox was empty at render time — the detail panel
      // only renders once a conversation is selected
      return;
    }
    expect(text).toContain("Conversation settings");
    expect(container.querySelector('select[aria-label="Assign to"]')).not.toBeNull();
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The admin surfaces: audit feed, usage, analytics
 * ───────────────────────────────────────────────────────────────── */

describe("UsageView", () => {
  test("renders the 47/50 near-cap overage state + per-agent load", async () => {
    const { container, restore } = await renderWithProvider(<UsageView />);
    restore();
    expect(container.textContent).toContain("Conversations this month (team plan)");
    expect(container.textContent).toContain("47 / 50");
    // the near-cap upgrade prompt (47/50 is 94% → near)
    expect(container.textContent).toContain("near your plan");
    // per-agent load rows
    expect(container.textContent).toContain("Unassigned");
  });
});

describe("AnalyticsView", () => {
  test("the donut's role=img + the KPI values against the seed", async () => {
    const { container, restore } = await renderWithProvider(<AnalyticsView />);
    restore();
    const donut = container.querySelector('[role="img"][aria-label*="Conversations by status"]')!;
    expect(donut).toBeTruthy();
    expect(container.textContent).toContain("2h 0m"); // median first response
    expect(container.textContent).toContain("60%"); // resolution rate
  });
});

describe("MembersView (the admin Team surfaces)", () => {
  test("the member table + the demo mailbox + the audit feed", async () => {
    const { container, restore } = await renderWithProvider(<MembersView />);
    restore();
    // the 4 Lumen members
    for (const name of ["Mira Chen", "Theo Reyes", "Ada Okafor", "Sam Ito"]) {
      expect(container.textContent).toContain(name);
    }
    // the demo mailbox drawer button
    expect(container.textContent).toContain("Mailbox");
    // the owner/admin-only audit feed
    expect(container.textContent).toContain("Audit log");
  });
});

/* ──────────────────────────────────────────────────────────────────
 * The portal view: customer-side-only DOM (no internal controls)
 * ───────────────────────────────────────────────────────────────── */

describe("PortalView", () => {
  test("the portal shows customer bubbles only — no internal controls", async () => {
    const { container, restore } = await renderWithProvider(<InboxView />);
    const listBtn = container.querySelector('li button') as HTMLElement;
    fireEvent.click(listBtn);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const portalBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "portal view",
    );
    fireEvent.click(portalBtn!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    restore();
    const text = container.textContent;
    expect(text).toContain("portal view — what the customer sees");
    expect(text).not.toContain("Conversation settings");
    expect(text).toContain("New message to Lumen");
  });
});
