"use client";

/**
 * The parley client store — the cadence `store.tsx` pattern with the
 * localStorage lane DELETED (the brief's "No localStorage for domain
 * state — unlike cadence/bazaar, this app is genuinely request-
 * driven"). The provider fetches from the API on mount + after every
 * mutation; the client never holds domain truth.
 *
 * View/filter/theme UI state is held in memory only (the brief
 * allows this — it's the client's own state, not domain state).
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
import { can, type Action } from "@/lib/parley/rbac";
import type {
  CannedReply,
  Conversation,
  Invite,
  Membership,
  Message,
  Role,
  Status,
  SystemEvent,
  Tenant,
  User,
} from "@/lib/parley/types";

/* ── shape types the provider owns ────────────────────────────────── */

export type ParleyView = "inbox" | "team" | "usage" | "analytics";

export interface SessionShape {
  id: string;
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string };
  role: Role;
}

export interface ConvoWithSla extends Conversation {
  slaState: string;
  slaLabel: string;
}

export interface Overage {
  convos: { used: number; cap: number; over: boolean };
  seats: { used: number; cap: number; over: boolean };
}

export interface UsageData {
  overage: Overage;
  conversationsThisMonth: number;
  seatsUsed: number;
  perAgentLoad: Record<string, number>;
  plan: string;
}

export interface AnalyticsData {
  volumeByStatus: { open: number; pending: number; closed: number };
  medianFirstResponseMs: number;
  medianFirstResponseLabel: string;
  resolutionRate: number;
  resolutionRatePercent: number;
  perAgentLoad: Record<string, number>;
}

export interface MemberRow {
  membership: Membership;
  user: User;
}

export interface MailboxRow extends Invite {
  acceptLink: string;
}

interface ParleyApi {
  /** true while the initial session probe is in flight */
  loading: boolean;
  session: SessionShape | null;
  /** the active tenant (the membership's tenant — the switcher's target) */
  tenant: Tenant | null;
  role: Role;
  members: MemberRow[];
  conversations: ConvoWithSla[];
  counts: Record<string, number>;
  selectedConvoId: string | null;
  thread: { messages: Message[]; events: SystemEvent[]; customer: { id: string; name: string; email: string } | null };
  view: ParleyView;
  filter: string;
  q: string;
  portalOpen: boolean;
  usage: UsageData | null;
  analytics: AnalyticsData | null;
  canned: CannedReply[];
  invites: Invite[];
  mailbox: MailboxRow[];
  audit: unknown[];
  // actions
  login(email: string, password: string): Promise<{ ok: boolean; error?: string }>;
  logout(): Promise<void>;
  selectConvo(id: string | null): void;
  setView(v: ParleyView): void;
  setFilter(f: string): void;
  setQ(q: string): void;
  refresh(): Promise<void>;
  switchRole(email: string): Promise<void>;
  switchTenant(slug: string): Promise<void>;
  setPortalOpen(open: boolean): void;
  canDo(action: Action, resource?: string, ownerMembershipId?: string): boolean;
}

const ParleyContext = createContext<ParleyApi | null>(null);

/** The seeded demo users' emails (the role switcher's source list). */
export const DEMO_USERS = [
  "mira@lumen.test",
  "theo@lumen.test",
  "ada@lumen.test",
  "sam@lumen.test",
  "ingrid@northwind.test",
  "kai@northwind.test",
] as const;

export function ParleyProvider({
  children,
  embed = false,
}: {
  children: ReactNode;
  embed?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionShape | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [conversations, setConversations] = useState<ConvoWithSla[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);
  const [thread, setThread] = useState<ParleyApi["thread"]>({
    messages: [],
    events: [],
    customer: null,
  });
  const [view, setView] = useState<ParleyView>("inbox");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [portalOpen, setPortalOpen] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [canned, setCanned] = useState<CannedReply[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [mailbox, setMailbox] = useState<MailboxRow[]>([]);
  const [audit, setAudit] = useState<unknown[]>([]);

  // ── helpers ───────────────────────────────────────────────────────
  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error ?? res.statusText), {
        status: res.status,
        body,
      });
    }
    return res.status === 204 ? (null as T) : res.json();
  }, []);

  /** The active tenant's owner membership id (the owner-seat carve-out). */
  const ownerMembershipId = useMemo(
    () => members.find((m) => m.membership.role === "owner")?.membership.id ?? "mem-owner",
    [members],
  );

  /** Load the active tenant's data after login / tenant switch. */
  const loadTenant = useCallback(async () => {
    const [m, u, a, c, inv, mbox, aud] = await Promise.all([
      fetchJson<MemberRow[]>("/parley/api/members"),
      fetchJson<UsageData>("/parley/api/usage").catch(() => null),
      fetchJson<AnalyticsData>("/parley/api/analytics").catch(() => null),
      fetchJson<CannedReply[]>("/parley/api/canned").catch(() => []),
      fetchJson<Invite[]>("/parley/api/invites").catch(() => []),
      fetchJson<MailboxRow[]>("/parley/api/mailbox").catch(() => []),
      fetchJson<unknown[]>("/parley/api/audit").catch(() => []),
    ]);
    setMembers(m);
    setUsage(u);
    setAnalytics(a);
    setCanned(c);
    setInvites(inv);
    setMailbox(mbox);
    setAudit(aud);
  }, [fetchJson]);

  const loadConversations = useCallback(async (f: string, query: string) => {
    const url =
      "/parley/api/conversations?filter=" + encodeURIComponent(f) +
      (query ? "&q=" + encodeURIComponent(query) : "");
    const out = await fetchJson<{ conversations: ConvoWithSla[]; counts: Record<string, number> }>(url);
    setConversations(out.conversations);
    setCounts(out.counts);
  }, [fetchJson]);

  const loadThread = useCallback(async (convoId: string | null) => {
    if (!convoId) {
      setThread({ messages: [], events: [], customer: null });
      return;
    }
    const out = await fetchJson<{
      conversation: Conversation;
      messages: Message[];
      events: SystemEvent[];
      customer: { id: string; name: string; email: string } | null;
    }>(`/parley/api/conversations/${convoId}`);
    setThread({
      messages: out.messages,
      events: out.events,
      customer: out.customer,
    });
  }, [fetchJson]);

  // ── initial mount: probe the session + auto-login if embedded ─────
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const probe = await fetchJson<SessionShape>("/parley/api/auth/session");
        setSession(probe);
        setRole(probe.role);
        setTenant({ id: probe.tenant.id, slug: probe.tenant.slug, name: "", plan: "team", slas: null as never, createdAt: "" });
        await loadTenant();
        await loadConversations("all", "");
      } catch {
        // 401 — not logged in
        if (embed) {
          // The demo auto-login: a REAL login of mira@lumen.test
          // (session row created server-side, cookie set) — never
          // faked auth state.
          try {
            const res = await fetch("/parley/api/auth/login", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email: "mira@lumen.test", password: "parley-demo-1" }),
            });
            const probe = await fetchJson<SessionShape>("/parley/api/auth/session");
            setSession(probe);
            setRole(probe.role);
            setTenant({ id: probe.tenant.id, slug: probe.tenant.slug, name: "", plan: "team", slas: null as never, createdAt: "" });
            await loadTenant();
            await loadConversations("all", "");
            void res;
          } catch {
            /* stay on the login screen */
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [embed, fetchJson, loadConversations, loadTenant]);

  // ── embed reset channel ────────────────────────────────────────────
  useEffect(() => {
    if (!embed || typeof window === "undefined") return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.origin) return;
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || data.source !== "unown-landing" || data.type !== "parley-reset") return;
      (async () => {
        await fetchJson("/parley/api/demo/reset", { method: "POST" });
        // The reset rotates the demo session; re-probe + reload.
        try {
          const probe = await fetchJson<SessionShape>("/parley/api/auth/session");
          setSession(probe);
          setRole(probe.role);
          await loadTenant();
          await loadConversations("all", "");
        } catch { /* fall through to login */ }
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed, fetchJson, loadConversations, loadTenant]);

  // ── actions ────────────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    try {
      await fetchJson<SessionShape>(
        `/parley/api/auth/login`,
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
      );
      const probe = await fetchJson<SessionShape>("/parley/api/auth/session");
      setSession(probe);
      setRole(probe.role);
      setTenant({ id: probe.tenant.id, slug: probe.tenant.slug, name: "", plan: "team", slas: null as never, createdAt: "" });
      await loadTenant();
      await loadConversations("all", "");
      return { ok: true };
    } catch (e) {
      const err = e as { body?: { errors?: string[]; error?: string } };
      return { ok: false, error: err?.body?.errors?.[0] ?? "Login failed" };
    }
  }, [fetchJson, loadConversations, loadTenant]);

  const logout = useCallback(async () => {
    await fetchJson("/parley/api/auth/logout", { method: "POST" }).catch(() => {});
    setSession(null);
    setTenant(null);
    setConversations([]);
    setThread({ messages: [], events: [], customer: null });
    setSelectedConvoId(null);
  }, [fetchJson]);

  const selectConvo = useCallback((id: string | null) => {
    setSelectedConvoId(id);
    void loadThread(id);
  }, [loadThread]);

  const refresh = useCallback(async () => {
    await loadConversations(filter, q);
    if (selectedConvoId) await loadThread(selectedConvoId);
  }, [loadConversations, loadThread, filter, q, selectedConvoId]);

  const switchRole = useCallback(async (email: string) => {
    // The brief's "re-logins as each seeded user through the real
    // login API — never faked auth state": the session is destroyed +
    // recreated server-side, the role flips because the membership
    // does, the whole app re-gates itself on the new role.
    await fetchJson("/parley/api/auth/logout", { method: "POST" }).catch(() => {});
    await login(email, "parley-demo-1");
  }, [fetchJson, login]);

  const switchTenant = useCallback(async (slug: string) => {
    // mira@lumen.test ↔ ingrid@northwind.test — the tenant switcher
    // re-logs in as the other tenant's owner (isolation visible).
    const email = slug === "northwind" ? "ingrid@northwind.test" : "mira@lumen.test";
    await fetchJson("/parley/api/auth/logout", { method: "POST" }).catch(() => {});
    await login(email, "parley-demo-1");
  }, [fetchJson, login]);

  const canDo = useCallback(
    (action: Action, resource?: string, ownerMembershipIdOverride?: string) =>
      can(role, action, resource, ownerMembershipIdOverride ?? ownerMembershipId),
    [role, ownerMembershipId],
  );

  const api = useMemo<ParleyApi>(
    () => ({
      loading,
      session,
      tenant,
      role,
      members,
      conversations,
      counts,
      selectedConvoId,
      thread,
      view,
      filter,
      q,
      portalOpen,
      usage,
      analytics,
      canned,
      invites,
      mailbox,
      audit,
      login,
      logout,
      selectConvo,
      setView,
      setFilter: (f: string) => {
        setFilter(f);
        void loadConversations(f, q);
      },
      setQ: (qq: string) => {
        setQ(qq);
        void loadConversations(filter, qq);
      },
      refresh,
      switchRole,
      switchTenant,
      setPortalOpen,
      canDo,
    }),
    [
      loading, session, tenant, role, members, conversations, counts,
      selectedConvoId, thread, view, filter, q, portalOpen, usage,
      analytics, canned, invites, mailbox, audit, login, logout,
      selectConvo, refresh, switchRole, switchTenant, canDo,
      loadConversations,
    ],
  );

  return <ParleyContext.Provider value={api}>{children}</ParleyContext.Provider>;
}

export function useParley(): ParleyApi {
  const ctx = useContext(ParleyContext);
  if (!ctx) throw new Error("useParley must be used inside <ParleyProvider>");
  return ctx;
}
