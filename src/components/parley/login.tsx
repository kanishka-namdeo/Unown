"use client";

/**
 * The login screen — the credential form (email + password) + the
 * demo-credentials hint (the 6 seeded emails + `parley-demo-1`,
 * the brief's "display the demo credentials in the login screen's
 * demo hint"). Submit → the provider's `login` (a real API call).
 */
import { useState } from "react";
import { useParley, DEMO_USERS } from "@/app/parley/client-store";

export function LoginScreen() {
  const parley = useParley();
  const [email, setEmail] = useState("mira@lumen.test");
  const [password, setPassword] = useState("parley-demo-1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await parley.login(email, password);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Login failed");
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 animate-parley-pop">
      <h1 className="text-lg font-bold">Sign in to Parley</h1>
      <p className="mt-1 text-xs text-muted">
        Multi-tenant support inbox — this is a live demo.
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block text-sm">
          <span className="text-muted">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:border-accent"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:border-accent"
          />
        </label>

        {error && (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* The demo-credentials hint (published in the UI by design) */}
      <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs">
        <div className="font-semibold text-foreground">Demo credentials</div>
        <p className="mt-1 text-muted">
          Password for every account: <code className="font-mono text-accent">parley-demo-1</code>
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
          {DEMO_USERS.map((u) => (
            <li key={u} className="text-muted">
              {u}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
