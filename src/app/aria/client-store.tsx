"use client";

/**
 * The aria client store — the parley `client-store.tsx` pattern: the
 * provider bootstraps the session (a login-state probe), fetches
 * from the API on mount + after every mutation, and never holds
 * domain truth. The embed reset channel (`aria-reset` postMessage)
 * is mounted ONLY when `embed === true` (the plan §8.2 contract:
 * origin-check + shape-check → POST /aria/api/demo/reset →
 * re-bootstrap).
 *
 * The provider takes `embed` + `hasSession` (+ `demoSession`) as
 * PROPS from the server page (the F3 pin): `src/app/aria/page.tsx`
 * reads `searchParams.embed` + the `aria_ses` cookie server-side
 * through the Suspense/async-inner shape and passes them in — the
 * server render and the hydration render agree, React #418 never
 * fires.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { can, type Action } from "@/lib/aria/rbac";
import type {
  AriaAccount,
  AriaActivity,
  AriaAuditEvent,
  AriaContact,
  AriaDeal,
  AriaLead,
  AriaMailboxMessage,
  AriaMembership,
  AriaNote,
  AriaPipeline,
  AriaRole,
  AriaSequence,
  AriaEnrollment,
  AriaTask,
  AriaTenant,
  AriaUser,
} from "@/lib/aria/types";

/* ── shape types the provider owns ────────────────────────────────── */

export interface AriaSessionShape {
  session: { id: string; expiresAt: string };
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string };
  role: AriaRole;
}

export type AriaView =
  | "dashboard"
  | "pipeline"
  | "accounts"
  | "contacts"
  | "leads"
  | "sequences"
  | "triage"
  | "reports"
  | "admin";

/** The 8 seeded demo users' emails (the login hint + the role
 * switcher's source list — published in the UI by design). */
export const DEMO_USERS = [
  "mira@lumen.test",
  "theo@lumen.test",
  "ada@lumen.test",
  "sam@lumen.test",
  "ingrid@northwind.test",
  "priya@northwind.test",
  "marco@northwind.test",
  "zoe@northwind.test",
] as const;

export const DEMO_PASSWORD = "aria-demo-1";

export type AriaTaskWithSla = AriaTask & { slaState: "ok" | "late" | "done" };

interface AriaApi {
  /** true while the initial session probe / bootstrap is in flight */
  loading: boolean;
  /** an error the bootstrap could not recover from (login screen shows it) */
  error: string | null;
  session: AriaSessionShape | null;
  user: AriaUser | null;
  tenant: AriaTenant | null;
  role: AriaRole;

  view: AriaView;
  setView(v: AriaView): void;

  // dashboard / reports data
  dashboard: {
    pipeline: { weightedByStage: Record<string, number>; openCount: number; openWeighted: number };
    winrate: { won: number; lost: number; rate: number; byOwner: Record<string, { won: number; lost: number; rate: number }> };
    salescycle: { medianDays: number; byOwner: Record<string, number> };
    openTasks: AriaTaskWithSla[];
  } | null;
  drilldown: { metric: string; value: string; records: AriaDeal[] } | null;
  openDrill(metric: string, value: string): Promise<void>;

  // CRM entities
  accounts: AriaAccount[];
  accountDetail: { account: AriaAccount; contacts: AriaContact[] } | null;
  openAccountDetail(id: string | null): void;

  contacts: AriaContact[];
  contactDetail: { contact: AriaContact; deals: AriaDeal[]; activities: AriaActivity[] } | null;
  openContactDetail(id: string | null): void;

  deals: AriaDeal[];
  dealDetail: { deal: AriaDeal; activities: AriaActivity[]; tasks: AriaTask[] } | null;
  openDealDetail(id: string | null): void;
  moveDealStage(dealId: string, stageId: string, lostReason?: string): Promise<{ ok: boolean; error?: string }>;
  addNote(entityType: string, entityId: string, body: string): Promise<{ ok: boolean; error?: string }>;

  leads: Array<AriaLead & { slaState?: string }>;

  // pipelines
  pipelines: AriaPipeline[];
  selectedPipelineId: string;
  setSelectedPipelineId(id: string): void;

  // sequences
  sequences: AriaSequence[];
  sequenceDetail: { sequence: AriaSequence; enrollments: AriaEnrollment[] } | null;
  openSequence(id: string | null): void;
  advanceEnrollment(id: string, events: Array<"sent" | "open" | "reply" | "meeting_booked">): Promise<{ ok: boolean; error?: string }>;
  exitEnrollment(id: string): Promise<{ ok: boolean; error?: string }>;
  mailbox: AriaMailboxMessage[];

  // triage
  triageLeads: Array<{ lead: AriaLead; score: number; components: Array<{ name: string; weight: number; value: number }> }>;
  triageDeals: Array<{ deal: AriaDeal; healthGrade: string; signals: string[]; nextBestAction: string }>;
  anomalies: Array<{ type: string; deals: AriaDeal[] }>;

  // admin
  members: Array<{ membership: AriaMembership; user: AriaUser }>;
  audit: AriaAuditEvent[];
  auditFilter: string;
  setAuditFilter(f: string): void;

  // actions
  login(email: string, password: string): Promise<{ ok: boolean; error?: string }>;
  logout(): Promise<void>;
  switchRole(email: string): Promise<void>;
  switchTenant(slug: string): Promise<void>;
  canDo(action: Action): boolean;
  /** The RBAC-disabled-with-reason helper: null when allowed, the
   * human reason (naming the missing permission) when denied. */
  denyReason(action: Action): string | null;
  /** True when the current role can see the view's nav item. */
  viewVisible(v: AriaView): boolean;
  refresh(): Promise<void>;
}

const AriaContext = createContext<AriaApi | null>(null);

export function AriaProvider({
  children,
  embed = false,
  hasSession = false,
  demoSession = false,
}: {
  children: ReactNode;
  embed?: boolean;
  /**
   * Server-side session presence — the /aria page.tsx reads the
   * `aria_ses` cookie SERVER-side (the `cookies()` API) and passes
   * this in. In embed mode WITHOUT an existing session the client
   * skips the unauthenticated `GET /auth/session` probe (a 401 that
   * would log to the console — the poster capture lane's
   * zero-console-errors bar) and goes straight to the demo
   * auto-login POST. With a session (or standalone) the probe runs.
   */
  hasSession?: boolean;
  /** The server-rendered "a live demo session cookie exists" flag. */
  demoSession?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<AriaSessionShape | null>(null);
  const [user, setUser] = useState<AriaUser | null>(null);
  const [tenant, setTenant] = useState<AriaTenant | null>(null);
  const [role, setRole] = useState<AriaRole>("viewer");
  const [view, setView] = useState<AriaView>("dashboard");

  const [dashboard, setDashboard] = useState<AriaApi["dashboard"]>(null);
  const [drilldown, setDrilldown] = useState<AriaApi["drilldown"]>(null);

  const [accounts, setAccounts] = useState<AriaAccount[]>([]);
  const [accountDetail, setAccountDetail] = useState<AriaApi["accountDetail"]>(null);

  const [contacts, setContacts] = useState<AriaContact[]>([]);
  const [contactDetail, setContactDetail] = useState<AriaApi["contactDetail"]>(null);

  const [deals, setDeals] = useState<AriaDeal[]>([]);
  const [dealDetail, setDealDetail] = useState<AriaApi["dealDetail"]>(null);

  const [leads, setLeads] = useState<AriaApi["leads"]>([]);

  const [pipelines, setPipelines] = useState<AriaPipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");

  const [sequences, setSequences] = useState<AriaSequence[]>([]);
  const [sequenceDetail, setSequenceDetail] = useState<AriaApi["sequenceDetail"]>(null);
  const [mailbox, setMailbox] = useState<AriaMailboxMessage[]>([]);

  const [triageLeads, setTriageLeads] = useState<AriaApi["triageLeads"]>([]);
  const [triageDeals, setTriageDeals] = useState<AriaApi["triageDeals"]>([]);
  const [anomalies, setAnomalies] = useState<AriaApi["anomalies"]>([]);

  const [members, setMembers] = useState<AriaApi["members"]>([]);
  const [audit, setAudit] = useState<AriaAuditEvent[]>([]);
  const [auditFilter, setAuditFilter] = useState("");

  // ── helpers ───────────────────────────────────────────────────────
  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error((body as { error?: string }).error ?? res.statusText), {
        status: res.status,
        body,
      });
    }
    return res.status === 204 ? (null as T) : res.json();
  }, []);

  /**
   * Load the tenant-scoped data the current view + the dashboard band
   * need, fetching ONLY the lanes the role's permissions allow (the
   * matrix's read gates). A lane the role can't read is skipped, so
   * the provider never logs a spurious 403 to the console.
   */
  const loadTenantData = useCallback(
    async (activeRole: AriaRole) => {
      const r = activeRole;
      const canReadAudit = r === "owner" || r === "manager";
      const jobs: Promise<unknown>[] = [];

      jobs.push(fetchJson<AriaAccount[]>("/aria/api/accounts").catch(() => [] as AriaAccount[]));
      jobs.push(fetchJson<AriaContact[]>("/aria/api/contacts").catch(() => [] as AriaContact[]));
      jobs.push(
        fetchJson<Array<AriaLead & { slaState?: string }>>("/aria/api/leads").catch(
          () => [] as AriaApi["leads"],
        ),
      );
      jobs.push(fetchJson<AriaDeal[]>("/aria/api/deals").catch(() => [] as AriaDeal[]));
      jobs.push(fetchJson<AriaPipeline[]>("/aria/api/pipelines").catch(() => [] as AriaPipeline[]));
      jobs.push(fetchJson<AriaSequence[]>("/aria/api/sequences").catch(() => [] as AriaSequence[]));
      jobs.push(fetchJson<AriaMailboxMessage[]>("/aria/api/mailbox").catch(() => [] as AriaMailboxMessage[]));
      jobs.push(fetchJson<AriaTaskWithSla[]>("/aria/api/tasks?done=false").catch(() => [] as AriaTaskWithSla[]));
      jobs.push(
        fetchJson<{ lead: AriaLead; score: number; components: Array<{ name: string; weight: number; value: number }> }[]>(
          "/aria/api/triage/leads",
        ).catch(() => [] as AriaApi["triageLeads"]),
      );
      jobs.push(
        fetchJson<
          Array<{ deal: AriaDeal; healthGrade: string; signals: string[]; nextBestAction: string }>
        >("/aria/api/triage/deals").catch(() => [] as AriaApi["triageDeals"]),
      );
      jobs.push(
        fetchJson<Array<{ type: string; deals: AriaDeal[] }>>("/aria/api/triage/anomalies").catch(
          () => [] as AriaApi["anomalies"],
        ),
      );

      // the report endpoints (all ✓ for every role — `report.read`)
      jobs.push(
        fetchJson<{ weightedByStage: Record<string, number>; openCount: number; openWeighted: number }>(
          "/aria/api/reports/pipeline",
        ).catch(() => null),
      );
      jobs.push(
        fetchJson<{ won: number; lost: number; rate: number; byOwner: Record<string, { won: number; lost: number; rate: number }> }>(
          "/aria/api/reports/winrate",
        ).catch(() => null),
      );
      jobs.push(
        fetchJson<{ medianDays: number; byOwner: Record<string, number> }>("/aria/api/reports/salescycle").catch(
          () => null,
        ),
      );
      jobs.push(fetchJson<AriaTaskWithSla[]>("/aria/api/tasks?done=false").catch(() => [] as AriaTaskWithSla[]));

      jobs.push(
        fetchJson<Array<{ membership: AriaMembership; user: AriaUser }>>("/aria/api/members").catch(
          () => [] as AriaApi["members"],
        ),
      );
      jobs.push(
        canReadAudit
          ? fetchJson<AriaAuditEvent[]>("/aria/api/audit").catch(() => [] as AriaAuditEvent[])
          : Promise.resolve([] as AriaAuditEvent[]),
      );

      const out = (await Promise.all(jobs)) as [
        AriaAccount[],
        AriaContact[],
        AriaApi["leads"],
        AriaDeal[],
        AriaPipeline[],
        AriaSequence[],
        AriaMailboxMessage[],
        AriaTaskWithSla[],
        AriaApi["triageLeads"],
        AriaApi["triageDeals"],
        AriaApi["anomalies"],
        { weightedByStage: Record<string, number>; openCount: number; openWeighted: number } | null,
        { won: number; lost: number; rate: number; byOwner: Record<string, { won: number; lost: number; rate: number }> } | null,
        { medianDays: number; byOwner: Record<string, number> } | null,
        AriaTaskWithSla[],
        AriaApi["members"],
        AriaAuditEvent[],
      ];
      const [a, c, l, d, p, seq, mbox, openTasksA, tLeads, tDeals, anoms, pipe, wr, sc, openTasksB, mem, aud] = out;

      setAccounts(Array.isArray(a) ? a : []);
      setContacts(Array.isArray(c) ? c : []);
      setLeads(Array.isArray(l) ? l : []);
      setDeals(Array.isArray(d) ? d : []);
      setPipelines(Array.isArray(p) ? p : []);
      setSequences(Array.isArray(seq) ? seq : []);
      setMailbox(Array.isArray(mbox) ? mbox : []);
      setTriageLeads(Array.isArray(tLeads) ? tLeads : []);
      setTriageDeals(Array.isArray(tDeals) ? tDeals : []);
      setAnomalies(Array.isArray(anoms) ? anoms : []);
      setMembers(Array.isArray(mem) ? mem : []);
      setAudit(Array.isArray(aud) ? aud : []);
      void openTasksA;
      setDashboard(
        pipe && wr && sc
          ? {
              pipeline: pipe,
              winrate: wr,
              salescycle: sc,
              openTasks: Array.isArray(openTasksB) ? openTasksB : [],
            }
          : null,
      );
    },
    [fetchJson],
  );

  const refresh = useCallback(async () => {
    try {
      const probe = await fetchJson<AriaSessionShape>("/aria/api/auth/session");
      setSession(probe);
      setRole(probe.role);
      await loadTenantData(probe.role);
    } catch {
      /* not logged in — nothing to refresh */
    }
  }, [fetchJson, loadTenantData]);

  // ── initial mount: probe the session + auto-login if embedded ─────
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const skipProbe = embed && !hasSession;
      try {
        if (!skipProbe) {
          const probe = await fetchJson<AriaSessionShape>("/aria/api/auth/session");
          setSession(probe);
          setUser(probe.user as unknown as AriaUser);
          setRole(probe.role);
          setTenant({
            id: probe.tenant.id,
            slug: probe.tenant.slug,
            name: "",
            plan: "starter",
            quotas: {},
            manages: {},
            leadSlaMinutes: { low: 1440, normal: 1440, high: 240, urgent: 60 },
            createdAt: "",
          } as unknown as AriaTenant);
          await loadTenantData(probe.role);
        }
      } catch {
        // 401 — not logged in
        if (embed) {
          // The demo auto-login: a REAL login of mira@lumen.test
          // (session row created server-side, cookie set) — never
          // faked auth state.
          try {
            await fetchJson<AriaSessionShape>("/aria/api/auth/login", {
              method: "POST",
              body: JSON.stringify({ email: "mira@lumen.test", password: DEMO_PASSWORD }),
            });
            const probe = await fetchJson<AriaSessionShape>("/aria/api/auth/session");
            setSession(probe);
            setUser(probe.user as unknown as AriaUser);
            setRole(probe.role);
            setTenant({
              id: probe.tenant.id,
              slug: probe.tenant.slug,
              name: "",
              plan: "starter",
              quotas: {},
              manages: {},
              leadSlaMinutes: { low: 1440, normal: 1440, high: 240, urgent: 60 },
              createdAt: "",
            } as unknown as AriaTenant);
            await loadTenantData(probe.role);
          } catch {
            /* stay on the login screen */
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [embed, hasSession, fetchJson, loadTenantData]);

  // ── embed reset channel (plan §8.2: the `aria-reset` handshake) ───
  useEffect(() => {
    if (!embed || typeof window === "undefined") return;
    const onMessage = (e: MessageEvent) => {
      // origin check
      if (e.origin !== window.origin) return;
      // shape check
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || data.source !== "unown-landing" || data.type !== "aria-reset") return;
      (async () => {
        try {
          await fetchJson("/aria/api/demo/reset", { method: "POST" });
          // The reset rotates the demo session; re-probe + reload.
          const probe = await fetchJson<AriaSessionShape>("/aria/api/auth/session");
          setSession(probe);
          setUser(probe.user as unknown as AriaUser);
          setRole(probe.role);
          setTenant({
            id: probe.tenant.id,
            slug: probe.tenant.slug,
            name: "",
            plan: "starter",
            quotas: {},
            manages: {},
            leadSlaMinutes: { low: 1440, normal: 1440, high: 240, urgent: 60 },
            createdAt: "",
          } as unknown as AriaTenant);
          await loadTenantData(probe.role);
        } catch {
          /* fall through to login */
        }
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed, fetchJson, loadTenantData]);

  // ── actions ────────────────────────────────────────────────────────

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const probe = await fetchJson<AriaSessionShape>("/aria/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setSession(probe);
        setUser(probe.user as unknown as AriaUser);
        setRole(probe.role);
        setTenant({
          id: probe.tenant.id,
          slug: probe.tenant.slug,
          name: "",
          plan: "starter",
          quotas: {},
          manages: {},
          leadSlaMinutes: { low: 1440, normal: 1440, high: 240, urgent: 60 },
          createdAt: "",
        } as unknown as AriaTenant);
        await loadTenantData(probe.role);
        setError(null);
        setView("dashboard");
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        setError(err?.body?.errors?.[0] ?? "Login failed");
        return { ok: false, error: err?.body?.errors?.[0] ?? "Login failed" };
      }
    },
    [fetchJson, loadTenantData],
  );

  const logout = useCallback(async () => {
    await fetchJson("/aria/api/auth/logout", { method: "POST" }).catch(() => {});
    setSession(null);
    setUser(null);
    setTenant(null);
    setRole("viewer");
    setView("dashboard");
    setDashboard(null);
    setDrilldown(null);
    setAccounts([]);
    setContacts([]);
    setLeads([]);
    setDeals([]);
    setPipelines([]);
    setSequences([]);
    setMailbox([]);
    setMembers([]);
    setAudit([]);
    setTriageLeads([]);
    setTriageDeals([]);
    setAnomalies([]);
    setAccountDetail(null);
    setContactDetail(null);
    setDealDetail(null);
    setSequenceDetail(null);
  }, [fetchJson]);

  const switchRole = useCallback(
    async (email: string) => {
      await logout();
      try {
        await login(email, DEMO_PASSWORD);
      } catch {
        /* stay on the login screen */
      }
    },
    [logout, login],
  );

  const switchTenant = useCallback(
    async (slug: string) => {
      const email = slug === "northwind" ? "ingrid@northwind.test" : "mira@lumen.test";
      await logout();
      try {
        await login(email, DEMO_PASSWORD);
      } catch {
        /* stay on the login screen */
      }
    },
    [logout, login],
  );

  const openDrill = useCallback(
    async (metric: string, value: string) => {
      try {
        const out = await fetchJson<AriaApi["drilldown"]>(
          `/aria/api/reports/drilldown?metric=${encodeURIComponent(metric)}&value=${encodeURIComponent(value)}`,
        );
        setDrilldown(out);
      } catch {
        /* the number is unchanged — the drill failed silently */
      }
    },
    [fetchJson],
  );

  const openAccountDetail = useCallback(
    async (id: string | null) => {
      if (!id) {
        setAccountDetail(null);
        return;
      }
      try {
        const out = await fetchJson<{ account: AriaAccount; contacts: AriaContact[] }>(
          `/aria/api/accounts/${encodeURIComponent(id)}`,
        );
        setAccountDetail(out);
      } catch {
        setAccountDetail(null);
      }
    },
    [fetchJson],
  );

  const openContactDetail = useCallback(
    async (id: string | null) => {
      if (!id) {
        setContactDetail(null);
        return;
      }
      try {
        const out = await fetchJson<{ contact: AriaContact; deals: AriaDeal[]; activities: AriaActivity[] }>(
          `/aria/api/contacts/${encodeURIComponent(id)}`,
        );
        setContactDetail(out);
      } catch {
        setContactDetail(null);
      }
    },
    [fetchJson],
  );

  const openDealDetail = useCallback(
    async (id: string | null) => {
      if (!id) {
        setDealDetail(null);
        return;
      }
      try {
        const out = await fetchJson<{ deal: AriaDeal; activities: AriaActivity[]; tasks: AriaTask[] }>(
          `/aria/api/deals/${encodeURIComponent(id)}`,
        );
        setDealDetail(out);
      } catch {
        setDealDetail(null);
      }
    },
    [fetchJson],
  );

  const moveDealStage = useCallback(
    async (dealId: string, stageId: string, lostReason?: string) => {
      try {
        await fetchJson<AriaDeal>(`/aria/api/deals/${encodeURIComponent(dealId)}/stage`, {
          method: "POST",
          body: JSON.stringify({ stageId, lostReason }),
        });
        await openDealDetail(dealId);
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Stage move failed" };
      }
    },
    [fetchJson, openDealDetail],
  );

  const addNote = useCallback(
    async (entityType: string, entityId: string, body: string) => {
      try {
        await fetchJson("/aria/api/notes", {
          method: "POST",
          body: JSON.stringify({ entityType, entityId, body }),
        });
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Note failed" };
      }
    },
    [fetchJson],
  );

  const openSequence = useCallback(
    async (id: string | null) => {
      if (!id) {
        setSequenceDetail(null);
        return;
      }
      try {
        const out = await fetchJson<{ sequence: AriaSequence; enrollments: AriaEnrollment[] }>(
          `/aria/api/sequences/${encodeURIComponent(id)}`,
        );
        setSequenceDetail(out);
      } catch {
        setSequenceDetail(null);
      }
    },
    [fetchJson],
  );

  const advanceEnrollment = useCallback(
    async (id: string, events: Array<"sent" | "open" | "reply" | "meeting_booked">) => {
      try {
        await fetchJson(`/aria/api/enrollments/${encodeURIComponent(id)}/advance`, {
          method: "POST",
          body: JSON.stringify({ events }),
        });
        await refresh();
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Advance failed" };
      }
    },
    [fetchJson, refresh],
  );

  const exitEnrollment = useCallback(
    async (id: string) => {
      try {
        await fetchJson(`/aria/api/enrollments/${encodeURIComponent(id)}/exit`, {
          method: "POST",
          body: JSON.stringify({ reason: "manual" }),
        });
        await refresh();
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Exit failed" };
      }
    },
    [fetchJson, refresh],
  );

  const canDo = useCallback((action: Action) => can(role, action), [role]);

  const denyReason = useCallback(
    (action: Action): string | null => {
      if (can(role, action)) return null;
      return `read-only role — ${action} is not granted to ${role}`;
    },
    [role],
  );

  const viewVisible = useCallback(
    (v: AriaView): boolean => {
      // Admin is gated on audit.read (owner + manager only in the
      // matrix — a rep/viewer doesn't see the Admin nav item).
      if (v === "admin") return can(role, "audit.read");
      return true;
    },
    [role],
  );

  const api = useMemo<AriaApi>(
    () => ({
      loading,
      error,
      session,
      user,
      tenant,
      role,
      view,
      setView,
      dashboard,
      drilldown,
      openDrill,
      accounts,
      accountDetail,
      openAccountDetail,
      contacts,
      contactDetail,
      openContactDetail,
      deals,
      dealDetail,
      openDealDetail,
      moveDealStage,
      addNote,
      leads,
      pipelines,
      selectedPipelineId,
      setSelectedPipelineId,
      sequences,
      sequenceDetail,
      openSequence,
      advanceEnrollment,
      exitEnrollment,
      mailbox,
      triageLeads,
      triageDeals,
      anomalies,
      members,
      audit,
      auditFilter,
      setAuditFilter,
      login,
      logout,
      switchRole,
      switchTenant,
      canDo,
      denyReason,
      viewVisible,
      refresh,
    }),
    [
      loading,
      error,
      session,
      user,
      tenant,
      role,
      view,
      dashboard,
      drilldown,
      openDrill,
      accounts,
      accountDetail,
      openAccountDetail,
      contacts,
      contactDetail,
      openContactDetail,
      deals,
      dealDetail,
      openDealDetail,
      moveDealStage,
      addNote,
      leads,
      pipelines,
      selectedPipelineId,
      sequences,
      sequenceDetail,
      openSequence,
      advanceEnrollment,
      exitEnrollment,
      mailbox,
      triageLeads,
      triageDeals,
      anomalies,
      members,
      audit,
      auditFilter,
      login,
      logout,
      switchRole,
      switchTenant,
      canDo,
      denyReason,
      viewVisible,
      refresh,
    ],
  );

  return <AriaContext.Provider value={api}>{children}</AriaContext.Provider>;
}

export function useAria(): AriaApi {
  const ctx = useContext(AriaContext);
  if (!ctx) throw new Error("useAria must be used inside <AriaProvider>");
  return ctx;
}
