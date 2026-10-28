"use client";

import type { Workspace } from "@/lib/fugue/types";
import { apiFetch, useAuth, useEmbedChannel, DEMO_EMAIL, DEMO_PASSWORD } from "@/components/fugue/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export interface ShellProps {
  /** True when the app was requested with ?embed=1 (bazaar hydration pattern). */
  embed: boolean;
  /** Initial selected workspace id (server-injected, optional). */
  initialWorkspaceId?: string;
}

export default function FugueShell({
  embed,
  initialWorkspaceId,
  children,
}: ShellProps & { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [ws, setWs] = useState<string>("");

  const refreshWorkspaces = useCallback(async () => {
    const body = await apiFetch<{ workspaces: Workspace[] }>("/workspaces");
    if (body) setWorkspaces(body.workspaces);
  }, []);

  useEffect(() => {
    if (user) void refreshWorkspaces();
  }, [user, refreshWorkspaces]);

  useEffect(() => {
    if (!ws && workspaces.length > 0) {
      setWs(
        initialWorkspaceId && workspaces.some((w) => w.id === initialWorkspaceId)
          ? initialWorkspaceId
          : workspaces[0].id,
      );
    }
  }, [workspaces, ws, initialWorkspaceId]);

  const handleWsChange = (id: string) => {
    setWs(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("workspaceId", id);
    const q = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  };

  // Embed reset channel (cadence-round pattern, docs/cadence-demo-session.md
  // adaptation 3): the landing frame's "Reset demo" button posts
  // { source: "unown-landing", type: "fugue-reset" }; mounted ONLY when
  // embed=true, origin-checked + shape-checked. On reset: POST the auth-gated
  // reset route (wipes + reseeds the server store) then re-fetch the app
  // state so the frame converges to the fresh seed.
  const onReset = useCallback(async () => {
    await apiFetch("/reset", { method: "POST" });
    void refreshWorkspaces();
  }, [refreshWorkspaces]);
  useEmbedChannel({ embed, onReset });

  if (!user && !loading) {
    return <AuthScreen embed={embed} />;
  }
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!embed && (
        <header className="sticky top-0 z-50 border-b border-border bg-background">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
            <Link href="/fugue/flows" className="text-lg font-semibold tracking-tight">
              Fugue
            </Link>
            <nav aria-label="Primary" className="flex gap-1">
              <Link
                href="/fugue/flows"
                className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-secondary"
              >
                Flows
              </Link>
              <Link
                href="/fugue/runs"
                className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-secondary"
              >
                Runs
              </Link>
              <Link
                href="/fugue/stats"
                className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-secondary"
              >
                Stats
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <label className="sr-only" htmlFor="ws-select">
                Workspace
              </label>
              <select
                id="ws-select"
                value={ws}
                onChange={(e) => handleWsChange(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm shadow-sm hover:bg-secondary"
              >
                Logout
              </button>
            </div>
          </div>
        </header>
      )}
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

// ── Login / signup screens ──

function AuthScreen({ embed }: { embed: boolean }) {
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const path = mode === "login" ? "/auth/login" : "/auth/signup";
    const res = await fetch(`/fugue/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      window.location.reload();
      return;
    }
    const body = await res.json().catch(() => null);
    if (res.status === 401) setError("Invalid credentials");
    else if (res.status === 409) setError("Email already registered");
    else if (body?.errors?.length) setError(body.errors.map((x: { message: string }) => x.message).join("; "));
    else setError("Request failed");
  };

  return (
    <div className={`flex min-h-screen items-center justify-center px-4 ${embed ? "py-4" : "py-12"}`}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">
          {embed ? "Fugue (embedded)" : "Fugue — workflow automation"}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {mode === "login" ? "Sign in to your workspace" : "Create an account"}
        </p>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 shadow-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 shadow-sm"
            />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-50"
          >
            {busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <div className="mt-4 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="hover:text-foreground"
          >
            {mode === "login" ? "Create an account" : "Back to sign in"}
          </button>
        </div>
        <div className="mt-6 rounded-lg border border-dashed border-border bg-muted p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Demo credentials</p>
          <p className="mt-1">
            <code className="font-mono">{DEMO_EMAIL}</code>{" "}
            <span aria-hidden> / </span>
            <code className="font-mono">{DEMO_PASSWORD}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
