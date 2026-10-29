"use client";

/**
 * The Nocturne client store — the aria `client-store` pattern:
 * the provider bootstraps the session (a login-state probe), fetches
 * the tenant's data from the API on mount + after every mutation,
 * and never holds domain truth. The embed reset channel
 * (`nocturne-reset` postMessage) is mounted ONLY when `embed ===
 * true` (the plan §8.2 contract: origin-check + shape-check →
 * POST /nocturne/api/demo/reset → re-bootstrap + reload the data).
 *
 * The provider takes `embed` + `hasSession` (+ `demoSession`) as
 * PROPS from the server page (the F3 pin): `src/app/nocturne/
 * page.tsx` reads `searchParams.embed` + the `nocturne_ses` cookie
 * server-side through the Suspense/async-inner shape and passes
 * them in — the server render and the hydration render agree,
 * React #418 never fires.
 *
 * The clock: the provider OWNS the clock tick (`nowIso`, a pinned
 * default + a `tick()` re-render trigger) — countdowns and
 * durations in the render path are always computed through the
 * lib's format helpers over `nowIso`, never `Date.now()` inline.
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
import { can, type Action } from "@/lib/nocturne/rbac";
import {
  AS_OF,
  DEMO_PASSWORD,
  type NocturneAuditEvent,
  type NocturneChecklistState,
  type NocturneComponent,
  type NocturneComponentStatus,
  type NocturneIncident,
  type NocturneMembership,
  type NocturneNote,
  type NocturneOverride,
  type NocturnePostmortem,
  type NocturneRole,
  type NocturneRotation,
  type NocturneRunbook,
  type NocturneService,
  type NocturneTenant,
  type NocturneTimelineEvent,
  type NocturneUser,
} from "@/lib/nocturne/types";
import {
  slaState,
  remainingMs,
  type NocturneSlaState,
} from "@/lib/nocturne/sla";
import { formatCountdown, formatDurationMs, weekdayShort, monthShort } from "@/lib/nocturne/format";

/* ── shape types the provider owns ────────────────────────────────── */

export interface NocturneSessionShape {
  session: { id: string; expiresAt: string };
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string };
  role: NocturneRole;
}

export type NocturneView =
  | "dashboard"
  | "incidents"
  | "services"
  | "rotations"
  | "runbooks"
  | "postmortems"
  | "analytics"
  | "members";

/** The 8 seeded demo users' emails (the login hint + the role
 * switcher's source list — published in the UI by design). */
export const DEMO_USERS = [
  "mira@lumen.test",
  "theo@lumen.test",
  "ada@lumen.test",
  "sam@lumen.test",
  "kai@lumen.test",
  "ingrid@northwind.test",
  "priya@northwind.test",
  "marco@northwind.test",
] as const;

/**
 * An incident row as the `/nocturne/api/incidents` routes return it:
 * the lib row + the computed `slaState` + `remainingMs` +
 * `primaryOnCall` (the plan §3.5 shape).
 */
export type IncidentRow = NocturneIncident & {
  slaState: NocturneSlaState;
  remainingMs: number;
  primaryOnCall: string | null;
};

/** The incident-detail payload: the row + timeline + notes + postmortem. */
export interface IncidentDetail {
  incident: NocturneIncident;
  timeline: NocturneTimelineEvent[];
  notes: NocturneNote[];
  postmortem: NocturnePostmortem | null;
}

/** A rotation row as the `/nocturne/api/rotations` route returns it
 * (the lib row + the computed current/next seat + the handoff). */
export interface RotationRow extends NocturneRotation {
  currentSeat: { userId: string; name: string } | null;
  current: { userId: string; name: string } | null;
  nextSeat: { userId: string; name: string } | null;
  handoffAt: string | null;
}

/** A service row as the `/nocturne/api/services` route returns it
 * (the lib row + the computed `primaryOnCall`). */
export interface ServiceRow {
  service: NocturneService;
  primaryOnCall: { userId: string; name: string } | null;
}

/** The analytics response (plan §3.9's shape). */
export interface AnalyticsRow {
  mttaMs: number | null;
  mttrMs: number | null;
  incidentsBySeverity: Record<string, number>;
  incidentsByService: Record<string, number>;
  breachRate: number | null;
  onCallLoad: Record<string, number>;
}

interface NocturneApi {
  /** true while the initial session probe / bootstrap is in flight */
  loading: boolean;
  /** an error the bootstrap could not recover from (login screen shows it) */
  error: string | null;
  session: NocturneSessionShape | null;
  user: NocturneUser | null;
  tenant: NocturneTenant | null;
  role: NocturneRole;

  /** Resolve a user id to its display name (the tenant's member
   * pool; unknown ids degrade to the raw id — never a crash). */
  userName(userId: string | null): string;

  /** Format an ISO timestamp for display (UTC "Mon, Jul 14 12:00"
   * — the lib's pure date helpers, no `Date.now()`). */
  fmtTimestamp(iso: string): string;

  /** The provider-owned clock: the pinned `now` every render uses for
   * countdown/duration math (the lib's format helpers are pure over
   * this string — never `Date.now()` in a render path). */
  nowIso: string;
  /** force a re-tick (re-renders with a fresh `nowIso` read). */
  tick(): void;

  view: NocturneView;
  setView(v: NocturneView): void;

  // per-page data
  dashboard: {
    openIncidents: IncidentRow[];
    analytics: AnalyticsRow | null;
  } | null;
  incidents: IncidentRow[];
  incidentDetail: IncidentDetail | null;
  openIncident(id: string | null): void;
  services: ServiceRow[];
  serviceDetail: {
    service: NocturneService;
    oncall: {
      primary: { userId: string; name: string } | null;
      secondary: { userId: string; name: string } | null;
      handoffAt: string | null;
    };
    incidents: IncidentRow[];
    runbooks: NocturneRunbook[];
  } | null;
  openService(id: string | null): void;
  rotations: RotationRow[];
  rotationDetail: { rotation: RotationRow; overrides: NocturneOverride[] } | null;
  openRotation(id: string | null): void;
  runbooks: NocturneRunbook[];
  runbookDetail: { runbook: NocturneRunbook; checklists: import("@/lib/nocturne/types").NocturneChecklistState[] } | null;
  openRunbook(id: string | null): void;
  postmortems: NocturnePostmortem[];
  postmortemDetail: NocturnePostmortem | null;
  openPostmortem(id: string | null): void;
  analytics: AnalyticsRow | null;
  members: Array<{ membership: NocturneMembership; user: NocturneUser | null }>;
  audit: NocturneAuditEvent[];
  auditFilter: string;
  setAuditFilter(f: string): void;
  components: NocturneComponent[];

  // public status page (the one auth-free lane)
  publicStatus: import("@/lib/nocturne/status").PublicStatusResult | null;
  loadPublicStatus(slug: string): Promise<void>;

  // actions
  login(email: string, password: string): Promise<{ ok: boolean; error?: string }>;
  logout(): Promise<void>;
  ackIncident(incidentId: string, note?: string): Promise<{ ok: boolean; error?: string }>;
  resolveIncident(
    incidentId: string,
    postmortemBody?: string,
    actionItems?: Array<{ title: string; assigneeId?: string | null; due?: string | null }>,
  ): Promise<{ ok: boolean; error?: string }>;
  snoozeIncident(incidentId: string, until: string): Promise<{ ok: boolean; error?: string }>;
  escalateIncident(incidentId: string): Promise<{ ok: boolean; error?: string }>;
  addNote(incidentId: string, body: string): Promise<{ ok: boolean; error?: string }>;
  startChecklist(incidentId: string, runbookId: string): Promise<{ ok: boolean; error?: string }>;
  setChecklistStep(
    checklistId: string,
    stepId: string,
    state: "pending" | "done" | "skipped",
  ): Promise<{ ok: boolean; error?: string }>;
  setComponentStatus(
    componentId: string,
    status: NocturneComponentStatus,
    note?: string | null,
  ): Promise<{ ok: boolean; error?: string }>;
  setPostmortemAction(
    postmortemId: string,
    actionId: string,
    done: boolean,
  ): Promise<{ ok: boolean; error?: string }>;
  sendInvite(email: string, role: NocturneRole): Promise<{ ok: boolean; error?: string }>;
  canDo(action: Action): boolean;
  /** The RBAC-disabled-with-reason helper: null when allowed, the
   * human reason (naming the missing permission) when denied. */
  denyReason(action: Action): string | null;
  /** True when the current role may SEE the view's nav item. */
  viewVisible(v: NocturneView): boolean;
  /** The lib format helpers bound to the provider's clock — the
   * ONLY way a render path formats a countdown/duration. */
  fmt: { countdown(ms: number): string; duration(ms: number): string };
  refresh(): Promise<void>;
}

const NocturneContext = createContext<NocturneApi | null>(null);

export function NocturneProvider({
  children,
  embed = false,
  hasSession = false,
  demoSession = false,
}: {
  children: ReactNode;
  embed?: boolean;
  /**
   * Server-side session presence — the /nocturne page.tsx reads the
   * `nocturne_ses` cookie SERVER-side (the `cookies()` API) and
   * passes this in. In embed mode WITHOUT an existing session the
   * client skips the unauthenticated `GET /auth/session` probe (a
   * 401 that would log to the console — the poster capture lane's
   * zero-console-errors bar) and goes straight to the demo
   * auto-login POST. With a session (or standalone) the probe runs.
   */
  hasSession?: boolean;
  /** The server-rendered "a live demo session cookie exists" flag. */
  demoSession?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<NocturneSessionShape | null>(null);
  const [user, setUser] = useState<NocturneUser | null>(null);
  const [tenant, setTenant] = useState<NocturneTenant | null>(null);
  const [role, setRole] = useState<NocturneRole>("viewer");
  const [view, setView] = useState<NocturneView>("dashboard");

  // ── the provider-owned clock tick (the render path's single
  // clock read — countdowns/durations go through `fmt`, which is
  // the lib's pure format helpers bound to `nowIso`) ──
  const [tickCount, setTickCount] = useState(0);
  const tick = useCallback(() => setTickCount((n) => n + 1), []);
  // `nowIso`: the app's deterministic "now" (the pinned AS_OF by
  // default — the lib store's clock is pinned too, so the two
  // agree on the seeded fixtures; a re-tick re-reads the wall
  // clock so live countdowns advance after the seed span ends).
  const nowIso = tickCount === 0 ? AS_OF : new Date().toISOString();

  const [dashboard, setDashboard] = useState<NocturneApi["dashboard"]>(null);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [incidentDetail, setIncidentDetail] = useState<IncidentDetail | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [serviceDetail, setServiceDetail] = useState<NocturneApi["serviceDetail"]>(null);
  const [rotations, setRotations] = useState<NocturneApi["rotations"]>([]);
  const [rotationDetail, setRotationDetail] = useState<NocturneApi["rotationDetail"]>(null);
  const [runbooks, setRunbooks] = useState<NocturneRunbook[]>([]);
  const [runbookDetail, setRunbookDetail] = useState<NocturneApi["runbookDetail"]>(null);
  const [postmortems, setPostmortems] = useState<NocturnePostmortem[]>([]);
  const [postmortemDetail, setPostmortemDetail] = useState<NocturnePostmortem | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsRow | null>(null);
  const [members, setMembers] = useState<NocturneApi["members"]>([]);
  const [audit, setAudit] = useState<NocturneAuditEvent[]>([]);
  const [auditFilter, setAuditFilter] = useState("");
  const [components, setComponents] = useState<NocturneComponent[]>([]);
  const [publicStatus, setPublicStatus] = useState<NocturneApi["publicStatus"]>(null);

  // ── helpers ───────────────────────────────────────────────────────
  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!res.ok) {
      // The 401 rung: a lost/expired session flips the store back
      // to the login gate (the plan's "401 -> login gate handling").
      if (res.status === 401) {
        setSession(null);
        setUser(null);
        setTenant(null);
        setRole("viewer");
      }
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error((body as { error?: string }).error ?? res.statusText), {
        status: res.status,
        body,
      });
    }
    return res.status === 204 ? (null as T) : res.json();
  }, []);

  /** Load the tenant-scoped data the views + the dashboard need.
   * The audit lane is fetched ONLY when the role holds `audit.read`
   * (the owner lane in the matrix) so a denied role never logs a
   * spurious 403 to the console. */
  const loadTenantData = useCallback(
    async (activeRole: NocturneRole) => {
      const r = activeRole;
      const canReadAudit = r === "owner";
      const jobs: Promise<unknown>[] = [];

      jobs.push(
        fetchJson<IncidentRow[]>("/nocturne/api/incidents?status=triggered").catch(
          () => [] as IncidentRow[],
        ),
      );
      jobs.push(fetchJson<IncidentRow[]>("/nocturne/api/incidents").catch(() => [] as IncidentRow[]));
      jobs.push(
        fetchJson<ServiceRow[]>("/nocturne/api/services").catch(() => [] as ServiceRow[]),
      );
      jobs.push(
        fetchJson<NocturneApi["rotations"]>("/nocturne/api/rotations").catch(
          () => [] as NocturneApi["rotations"],
        ),
      );
      jobs.push(fetchJson<NocturneRunbook[]>("/nocturne/api/runbooks").catch(() => [] as NocturneRunbook[]));
      jobs.push(
        fetchJson<NocturnePostmortem[]>("/nocturne/api/postmortems").catch(
          () => [] as NocturnePostmortem[],
        ),
      );
      jobs.push(fetchJson<AnalyticsRow>("/nocturne/api/analytics").catch(() => null));
      jobs.push(
        fetchJson<NocturneApi["members"]>("/nocturne/api/members").catch(
          () => [] as NocturneApi["members"],
        ),
      );
      jobs.push(fetchJson<NocturneComponent[]>("/nocturne/api/components").catch(() => [] as NocturneComponent[]));
      jobs.push(
        canReadAudit
          ? fetchJson<NocturneAuditEvent[]>("/nocturne/api/audit").catch(() => [] as NocturneAuditEvent[])
          : Promise.resolve([] as NocturneAuditEvent[]),
      );

      const out = (await Promise.all(jobs)) as [
        IncidentRow[],
        IncidentRow[],
        ServiceRow[],
        NocturneApi["rotations"],
        NocturneRunbook[],
        NocturnePostmortem[],
        AnalyticsRow | null,
        NocturneApi["members"],
        NocturneComponent[],
        NocturneAuditEvent[],
      ];
      const [openRows, allRows, svc, rot, rb, pm, an, mem, cmp, aud] = out;

      setIncidents(Array.isArray(allRows) ? allRows : []);
      setDashboard({
        openIncidents: Array.isArray(openRows) ? openRows : [],
        analytics: an,
      });
      setServices(Array.isArray(svc) ? svc : []);
      setRotations(Array.isArray(rot) ? rot : []);
      setRunbooks(Array.isArray(rb) ? rb : []);
      setPostmortems(Array.isArray(pm) ? pm : []);
      setAnalytics(an ?? null);
      setMembers(Array.isArray(mem) ? mem : []);
      setComponents(Array.isArray(cmp) ? cmp : []);
      setAudit(Array.isArray(aud) ? aud : []);
    },
    [fetchJson],
  );

  const refresh = useCallback(async () => {
    try {
      const probe = await fetchJson<NocturneSessionShape>("/nocturne/api/auth/session");
      setSession(probe);
      setRole(probe.role);
      await loadTenantData(probe.role);
    } catch {
      /* not logged in — nothing to refresh */
    }
  }, [fetchJson, loadTenantData]);

  const settle = useCallback(() => {
    // the dashboard's open-incident list is re-derived from the
    // full incident list on every reload
    void 0;
  }, []);

  // ── initial mount: probe the session + auto-login if embedded ─────
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const skipProbe = embed && !hasSession;
      try {
        if (!skipProbe) {
          const probe = await fetchJson<NocturneSessionShape>("/nocturne/api/auth/session");
          setSession(probe);
          setUser(probe.user as unknown as NocturneUser);
          setRole(probe.role);
          await loadTenantData(probe.role);
        }
      } catch {
        // 401 — not logged in
        if (embed) {
          // The demo auto-login: a REAL login of the demo owner
          // (session row created server-side, cookie set) — never
          // faked auth state.
          try {
            await fetchJson<NocturneSessionShape>("/nocturne/api/auth/login", {
              method: "POST",
              body: JSON.stringify({ email: "mira@lumen.test", password: DEMO_PASSWORD }),
            });
            const probe = await fetchJson<NocturneSessionShape>("/nocturne/api/auth/session");
            setSession(probe);
            setUser(probe.user as unknown as NocturneUser);
            setRole(probe.role);
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

  // ── embed reset channel (plan §8.2: the `nocturne-reset` handshake)
  useEffect(() => {
    if (!embed || typeof window === "undefined") return;
    const onMessage = (e: MessageEvent) => {
      // origin check
      if (e.origin !== window.origin) return;
      // shape check
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || data.source !== "unown-landing" || data.type !== "nocturne-reset") return;
      (async () => {
        try {
          await fetchJson("/nocturne/api/demo/reset", { method: "POST" });
          // The reset rotates the demo session; re-probe + reload.
          const probe = await fetchJson<NocturneSessionShape>("/nocturne/api/auth/session");
          setSession(probe);
          setUser(probe.user as unknown as NocturneUser);
          setRole(probe.role);
          await loadTenantData(probe.role);
          tick();
        } catch {
          /* fall through to login */
        }
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed, fetchJson, loadTenantData, tick]);

  // ── periodic clock re-tick (the live countdown lane) ─────────────
  useEffect(() => {
    const id = setInterval(() => {
      tick();
    }, 30_000);
    return () => clearInterval(id);
  }, [tick]);

  // ── actions ────────────────────────────────────────────────────────

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const probe = await fetchJson<NocturneSessionShape>("/nocturne/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setSession(probe);
        setUser(probe.user as unknown as NocturneUser);
        setRole(probe.role);
        await loadTenantData(probe.role);
        setError(null);
        setView("dashboard");
        tick();
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        const msg = err?.body?.errors?.[0] ?? "Login failed";
        setError(msg);
        return { ok: false, error: msg };
      }
    },
    [fetchJson, loadTenantData],
  );

  const logout = useCallback(async () => {
    await fetchJson("/nocturne/api/auth/logout", { method: "POST" }).catch(() => {});
    setSession(null);
    setUser(null);
    setTenant(null);
    setRole("viewer");
    setView("dashboard");
    setDashboard(null);
    setIncidents([]);
    setIncidentDetail(null);
    setServices([]);
    setServiceDetail(null);
    setRotations([]);
    setRotationDetail(null);
    setRunbooks([]);
    setRunbookDetail(null);
    setPostmortems([]);
    setPostmortemDetail(null);
    setAnalytics(null);
    setMembers([]);
    setAudit([]);
    setComponents([]);
  }, [fetchJson]);

  const openIncident = useCallback(
    async (id: string | null) => {
      if (!id) {
        setIncidentDetail(null);
        return;
      }
      try {
        const out = await fetchJson<IncidentDetail>(
          `/nocturne/api/incidents/${encodeURIComponent(id)}`,
        );
        setIncidentDetail({ ...out, incident: out as unknown as NocturneIncident });
      } catch {
        setIncidentDetail(null);
      }
    },
    [fetchJson],
  );

  /** Re-open the current detail view after a mutation (the data
   * refresh + the clock re-tick — countdowns stay honest). */
  const reopen = useCallback(
    async (id?: string) => {
      const probe = await fetchJson<NocturneSessionShape>("/nocturne/api/auth/session");
      await loadTenantData(probe.role);
      if (id !== undefined && view === "incidents") {
        await openIncident(id);
      }
      tick();
    },
    [fetchJson, loadTenantData, view, openIncident, tick],
  );

  const openService = useCallback(
    async (id: string | null) => {
      if (!id) {
        setServiceDetail(null);
        return;
      }
      try {
        const detail = await fetchJson<{
          service: NocturneService;
          incidents: IncidentRow[];
          runbooks: NocturneRunbook[];
        }>(`/nocturne/api/services/${encodeURIComponent(id)}`);
        const oncall = await fetchJson<{
          primary: { userId: string; name: string } | null;
          secondary: { userId: string; name: string } | null;
          handoffAt: string | null;
        }>(`/nocturne/api/services/${encodeURIComponent(id)}/oncall`).catch(
          () =>
            ({
              primary: null,
              secondary: null,
              handoffAt: null,
            }) as {
              primary: { userId: string; name: string } | null;
              secondary: { userId: string; name: string } | null;
              handoffAt: string | null;
            },
        );
        setServiceDetail({ ...detail, oncall });
      } catch {
        setServiceDetail(null);
      }
    },
    [fetchJson],
  );

  const openRotation = useCallback(
    async (id: string | null) => {
      if (!id) {
        setRotationDetail(null);
        return;
      }
      try {
        const out = await fetchJson<{
          rotation: NocturneApi["rotations"][number];
          overrides: import("@/lib/nocturne/types").NocturneOverride[];
        }>(`/nocturne/api/rotations/${encodeURIComponent(id)}`);
        setRotationDetail({ rotation: out.rotation, overrides: out.overrides });
      } catch {
        setRotationDetail(null);
      }
    },
    [fetchJson],
  );

  const openRunbook = useCallback(
    async (id: string | null) => {
      if (!id) {
        setRunbookDetail(null);
        return;
      }
      try {
        const out = await fetchJson<{
          runbook: NocturneRunbook;
          checklists: import("@/lib/nocturne/types").NocturneChecklistState[];
        }>(`/nocturne/api/runbooks/${encodeURIComponent(id)}`);
        setRunbookDetail({ runbook: out.runbook, checklists: out.checklists });
      } catch {
        setRunbookDetail(null);
      }
    },
    [fetchJson],
  );

  const openPostmortem = useCallback(
    async (id: string | null) => {
      if (!id) {
        setPostmortemDetail(null);
        return;
      }
      try {
        const out = await fetchJson<NocturnePostmortem>(
          `/nocturne/api/postmortems/${encodeURIComponent(id)}`,
        );
        setPostmortemDetail(out);
      } catch {
        setPostmortemDetail(null);
      }
    },
    [fetchJson],
  );

  const loadPublicStatus = useCallback(
    async (slug: string) => {
      try {
        const out = await fetchJson<import("@/lib/nocturne/status").PublicStatusResult>(
          `/nocturne/status/${encodeURIComponent(slug)}`,
        );
        setPublicStatus(out);
      } catch {
        setPublicStatus(null);
      }
    },
    [fetchJson],
  );

  const ackIncident = useCallback(
    async (incidentId: string, note?: string) => {
      try {
        await fetchJson(`/nocturne/api/incidents/${encodeURIComponent(incidentId)}/ack`, {
          method: "POST",
          body: JSON.stringify({ note }),
        });
        await reopen(incidentId);
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Ack failed" };
      }
    },
    [fetchJson, reopen],
  );

  const resolveIncident = useCallback(
    async (
      incidentId: string,
      postmortemBody?: string,
      actionItems?: Array<{ title: string; assigneeId?: string | null; due?: string | null }>,
    ) => {
      try {
        await fetchJson(`/nocturne/api/incidents/${encodeURIComponent(incidentId)}/resolve`, {
          method: "POST",
          body: JSON.stringify({ postmortemBody, actionItems }),
        });
        await reopen(incidentId);
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Resolve failed" };
      }
    },
    [fetchJson, reopen],
  );

  const snoozeIncident = useCallback(
    async (incidentId: string, until: string) => {
      try {
        await fetchJson(`/nocturne/api/incidents/${encodeURIComponent(incidentId)}/snooze`, {
          method: "POST",
          body: JSON.stringify({ until }),
        });
        await reopen(incidentId);
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Snooze failed" };
      }
    },
    [fetchJson, reopen],
  );

  const escalateIncident = useCallback(
    async (incidentId: string) => {
      try {
        await fetchJson(`/nocturne/api/incidents/${encodeURIComponent(incidentId)}/escalate`, {
          method: "POST",
        });
        await reopen(incidentId);
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Escalate failed" };
      }
    },
    [fetchJson, reopen],
  );

  const addNote = useCallback(
    async (incidentId: string, body: string) => {
      try {
        await fetchJson(`/nocturne/api/incidents/${encodeURIComponent(incidentId)}/notes`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        await reopen(incidentId);
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Note failed" };
      }
    },
    [fetchJson, reopen],
  );

  const startChecklist = useCallback(
    async (incidentId: string, runbookId: string) => {
      try {
        await fetchJson("/nocturne/api/checklists", {
          method: "POST",
          body: JSON.stringify({ incidentId, runbookId }),
        });
        await reopen(incidentId);
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Checklist start failed" };
      }
    },
    [fetchJson, reopen],
  );

  const setChecklistStep = useCallback(
    async (checklistId: string, stepId: string, state: "pending" | "done" | "skipped") => {
      try {
        await fetchJson(`/nocturne/api/checklists/${encodeURIComponent(checklistId)}`, {
          method: "PATCH",
          body: JSON.stringify({ stepId, state }),
        });
        await reopen();
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Checklist update failed" };
      }
    },
    [fetchJson, reopen],
  );

  const setComponentStatus = useCallback(
    async (
      componentId: string,
      status: NocturneComponentStatus,
      note?: string | null,
    ) => {
      try {
        await fetchJson(
          `/nocturne/api/components/${encodeURIComponent(componentId)}/status`,
          {
            method: "POST",
            body: JSON.stringify({ status, note }),
          },
        );
        await reopen();
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Status update failed" };
      }
    },
    [fetchJson, reopen],
  );

  const setPostmortemAction = useCallback(
    async (postmortemId: string, actionId: string, done: boolean) => {
      try {
        await fetchJson(
          `/nocturne/api/postmortems/${encodeURIComponent(postmortemId)}/actions/${encodeURIComponent(actionId)}`,
          { method: "PATCH", body: JSON.stringify({ done }) },
        );
        await reopen();
        return { ok: true };
      } catch (e) {
        const err = e as { body?: { errors?: string[]; error?: string } };
        return { ok: false, error: err?.body?.errors?.[0] ?? "Action update failed" };
      }
    },
    [fetchJson, reopen],
  );

  const sendInvite = useCallback(
    async (email: string, role: NocturneRole) => {
      try {
        const out = await fetchJson<{ token: string }>(
          "/nocturne/api/invites",
          { method: "POST", body: JSON.stringify({ email, role }) },
        );
        return { ok: true, token: out.token };
      } catch (e) {
        const err = e as { status?: number; body?: { errors?: string[]; error?: string } };
        if (err?.status === 402) {
          return { ok: false, error: "Seat cap reached — upgrade the plan to send more invites." };
        }
        return { ok: false, error: err?.body?.errors?.[0] ?? "Invite failed" };
      }
    },
    [fetchJson],
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
    (v: NocturneView): boolean => {
      // The Admin lane is owner-gated (`audit.read` in the matrix);
      // every other view is all-✓ readable.
      if (v === "members") return can(role, "audit.read") || can(role, "invite.create");
      return true;
    },
    [role],
  );

  const fmt = useMemo(
    () => ({
      countdown(ms: number): string {
        return formatCountdown(ms);
      },
      duration(ms: number): string {
        return formatDurationMs(ms);
      },
    }),
    [],
  );

  const userName = useCallback(
    (userId: string | null): string => {
      if (userId === null) return "—";
      const fromMembers = members.find((m) => m.user?.id === userId)?.user?.name;
      return fromMembers ?? userId;
    },
    [members],
  );

  const fmtTimestamp = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return (
        weekdayShort(d) +
        " " +
        monthShort(d) +
        " " +
        d.getUTCDate() +
        " " +
        String(d.getUTCHours()).padStart(2, "0") +
        ":" +
        String(d.getUTCMinutes()).padStart(2, "0")
      );
    },
    [],
  );

  const api = useMemo<NocturneApi>(
    () => ({
      loading,
      error,
      session,
      user,
      tenant,
      role,
      nowIso,
      tick,
      view,
      setView,
      dashboard,
      incidents,
      incidentDetail,
      openIncident,
      services,
      serviceDetail,
      openService,
      rotations,
      rotationDetail,
      openRotation,
      runbooks,
      runbookDetail,
      openRunbook,
      postmortems,
      postmortemDetail,
      openPostmortem,
      analytics,
      members,
      audit,
      auditFilter,
      setAuditFilter,
      components,
      publicStatus,
      loadPublicStatus,
      login,
      logout,
      ackIncident,
      resolveIncident,
      snoozeIncident,
      escalateIncident,
      addNote,
      startChecklist,
      setChecklistStep,
      setComponentStatus,
      setPostmortemAction,
      sendInvite,
      canDo,
      denyReason,
      viewVisible,
      fmt,
      userName,
      fmtTimestamp,
      refresh,
    }),
    [
      loading,
      error,
      session,
      user,
      tenant,
      role,
      nowIso,
      tick,
      view,
      dashboard,
      incidents,
      incidentDetail,
      openIncident,
      services,
      serviceDetail,
      openService,
      rotations,
      rotationDetail,
      openRotation,
      runbooks,
      runbookDetail,
      openRunbook,
      postmortems,
      postmortemDetail,
      openPostmortem,
      analytics,
      members,
      audit,
      auditFilter,
      setAuditFilter,
      components,
      publicStatus,
      loadPublicStatus,
      login,
      logout,
      ackIncident,
      resolveIncident,
      snoozeIncident,
      escalateIncident,
      addNote,
      startChecklist,
      setChecklistStep,
      setComponentStatus,
      setPostmortemAction,
      sendInvite,
      canDo,
      denyReason,
      viewVisible,
      fmt,
      userName,
      fmtTimestamp,
      refresh,
    ],
  );

  return <NocturneContext.Provider value={api}>{children}</NocturneContext.Provider>;
}

export function useNocturne(): NocturneApi {
  const ctx = useContext(NocturneContext);
  if (!ctx) throw new Error("useNocturne must be used inside <NocturneProvider>");
  return ctx;
}

/* ── the countdown helper the views use (provider-owned clock) ───── */

/**
 * The SLA countdown string for an incident row at the provider's
 * clock: the lib's `remainingMs` bound to `fmt.countdown` — the
 * render path NEVER touches `Date.now()` (the provider owns the
 * tick). Returns "—" when the incident is resolved (the SLA state
 * is final, the timer stops).
 */
export function slaCountdownText(
  row: IncidentRow,
  tenant: NocturneTenant,
  nowIso: string,
  service?: NocturneService,
): string {
  if (row.status === "resolved") return "—";
  const remaining = remainingMs(row, tenant, nowIso, service);
  return formatCountdown(remaining);
}

/* re-export so views can gate on the lib SLA state without importing it */
export { slaState };

