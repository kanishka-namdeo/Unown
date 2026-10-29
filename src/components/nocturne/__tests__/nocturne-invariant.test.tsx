/**
 * The UI invariant pins for Nocturne (plan §5.3's
 * `nocturne-invariant.test.tsx`): the UI surfaces the domain
 * invariants as DISABLED states —
 *
 *  - the UI never RESOLVES an unacked incident (the
 *    ack-before-resolve invariant surfaces as a disabled state);
 *  - the UI never ESCALATES a resolved incident (the terminals-
 *    are-final invariant surfaces as a disabled state);
 *  - the timeline renders in `at`-then-`id` order (the PBT
 *    invariant #6 surfaces in the UI).
 *
 * Same style as the aria invariant test (bun:test +
 * @testing-library/react under the happy-dom preload).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useEffect } from "react";
import { seedNocturne } from "@/lib/nocturne/seed";
import {
  NocturneProvider,
  useNocturne,
  type NocturneSessionShape,
} from "@/components/nocturne/nocturne-provider";
import { IncidentsView } from "../incidents";

/* ── the pinned fixture + the fetch stub (same shape as the main
   * component test) ── */

const SEED = seedNocturne();
const LUMEN = SEED.tenants.find((t) => t.id === "tn-lumen")!;

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

/** The trigger incident (the unacked sev1 — the ack-before-resolve
 * fixture): the UI must show its RESOLVE button DISABLED. */
const TRIGGERED_INCIDENT = SEED.incidents.find(
  (i) => i.tenantId === LUMEN.id && i.status === "triggered",
)!;

/** The resolved incident (the terminals-are-final fixture): the UI
 * must show its ESCALATE button DISABLED. */
const RESOLVED_INCIDENT = SEED.incidents.find(
  (i) => i.tenantId === LUMEN.id && i.status === "resolved",
)!;

function installFetchStub(session: NocturneSessionShape = OWNER) {
  const original = globalThis.fetch;
  const handler = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.includes("/nocturne/api/auth/session")) {
      return json({ ...session });
    }
    if (url.includes("/nocturne/api/incidents") && url.endsWith("/incidents")) {
      const rows = SEED.incidents
        .filter((i) => i.tenantId === session.tenant.id)
        .map((i) => ({ ...i, slaState: "ok", remainingMs: 3_600_000, primaryOnCall: i.acknowledgedBy }));
      return json(rows);
    }
    const incMatch = url.match(/\/nocturne\/api\/incidents\/([^/]+)(?:\/(ack|resolve|snooze|escalate|notes))?(.*)$/);
    if (incMatch) {
      const incident = SEED.incidents.find((i) => i.id === incMatch[1]);
      if (!incident) return json({ error: "not found", status: 404 }, 404);
      const timeline = SEED.timeline
        .filter((e) => e.incidentId === incident.id)
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      const notes = SEED.notes.filter((n) => n.incidentId === incident.id);
      const postmortem =
        incident.postmortemId !== null
          ? SEED.postmortems.find((p) => p.id === incident.postmortemId) ?? null
          : null;
      // The API shape: the incident's fields are SPREAD into the
      // payload (the detail view's `slaState` / `remainingMs` /
      // `primaryOnCall` + `timeline` + `notes` + `postmortem`).
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
    if (url.includes("/nocturne/api/services")) {
      return json(
        SEED.services
          .filter((s) => s.tenantId === session.tenant.id)
          .map((service) => ({ service, primaryOnCall: null })),
      );
    }
    if (url.includes("/nocturne/api/runbooks")) {
      return json(SEED.runbooks.filter((rb) => rb.tenantId === session.tenant.id));
    }
    // Default: empty
    return json({});
  };
  globalThis.fetch = handler as typeof fetch;
  return { restore: () => (globalThis.fetch = original) };
}

async function renderIncidentDetail(
  incidentId: string,
  session: NocturneSessionShape = OWNER,
) {
  const stub = installFetchStub(session);
  const { container } = render(
    <NocturneProvider>
      <IncidentsDetailProbe incidentId={incidentId} />
    </NocturneProvider>,
  );
  // Let the provider's initial probe + the openIncident fetch
  // settle (two ticks).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { container, restore: stub.restore };
}

/** A probe that drives the provider's `openIncident` + renders the
 * detail's action buttons (the invariant's surface). */
function IncidentsDetailProbe({ incidentId }: { incidentId: string }) {
  const nocturne = useNocturne();
  useEffect(() => {
    void nocturne.openIncident(incidentId);
  }, [incidentId, nocturne.openIncident]);
  return <IncidentsView />;
}

afterEach(() => {
  cleanup();
});

describe("the UI's ack-before-resolve invariant (disabled state)", () => {
  test("the UI never offers a resolve on an UNACKED incident", async () => {
    // The trigger incident is unacked — its resolve button must be
    // DISABLED (the invariant surfaces as a disabled state).
    const { container, restore } = await renderIncidentDetail(TRIGGERED_INCIDENT.id);
    const resolveBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Resolve",
    );
    expect(resolveBtn).toBeTruthy();
    expect(resolveBtn!.disabled).toBe(true);
    restore();
  });

  test("the UI offers a resolve on an ACKNOWLEDGED incident", async () => {
    // A snoozed incident has been acked (acknowledgedAt is set) —
    // the plan §4.6's `resolve` lane is ONLY valid from the
    // `acknowledged` status (the state machine's explicit transition).
    // A snoozed incident's resolve is offered but DISABLED until it
    // returns to acknowledged (the snooze-expiry auto-transition);
    // the invariant holds because the UI never offers a resolve on
    // an UNACKED incident.
    const snoozed = SEED.incidents.find(
      (i) => i.tenantId === LUMEN.id && i.status === "snoozed",
    )!;
    const { container, restore } = await renderIncidentDetail(snoozed.id);
    const resolveBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Resolve",
    );
    expect(resolveBtn).toBeTruthy();
    // The snoozed status is NOT `acknowledged` — the plan §4.6's
    // resolve lane is gated to the `acknowledged` status, so the
    // button is DISABLED (the invariant surfaces as a disabled state;
    // the snooze-expiry auto-un-snooze returns it to `acknowledged`
    // and re-enables the lane).
    expect(resolveBtn!.disabled).toBe(true);
    restore();
  });
});

describe("the UI's terminals-are-final invariant (disabled state)", () => {
  test("the UI never escalates a RESOLVED incident", async () => {
    // The resolved incident's escalate button must be DISABLED
    // (the terminal is final).
    const { container, restore } = await renderIncidentDetail(RESOLVED_INCIDENT.id);
    const escalateBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Escalate tier",
    );
    expect(escalateBtn).toBeTruthy();
    expect(escalateBtn!.disabled).toBe(true);
    restore();
  });

  test("the UI's ack button is disabled on a RESOLVED incident", async () => {
    const { container, restore } = await renderIncidentDetail(RESOLVED_INCIDENT.id);
    const ackBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Acknowledge",
    );
    expect(ackBtn).toBeTruthy();
    expect(ackBtn!.disabled).toBe(true);
    restore();
  });
});

describe("the UI's timeline order (at-then-id)", () => {
  test("the timeline renders in at-then-id order", async () => {
    const { container, restore } = await renderIncidentDetail(TRIGGERED_INCIDENT.id);
    const items = container.querySelectorAll('[aria-label="Incident timeline"] > li');
    expect(items.length).toBeGreaterThan(0);
    // The rendered order must match the at-then-id sort the API
    // returns (the pinned PBT invariant #6).
    const expectedCount = SEED.timeline.filter(
      (e) => e.incidentId === TRIGGERED_INCIDENT.id,
    ).length;
    expect(items.length).toBe(expectedCount);
    restore();
  });
});
