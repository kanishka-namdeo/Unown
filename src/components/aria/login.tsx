"use client";

/**
 * The aria login screen — the credential form (email + password) +
 * the demo-credentials hint (the 8 seeded emails + `aria-demo-1`,
 * published in the UI by design). Submit → the provider's `login`
 * (a real API call).
 */
import { useState } from "react";
import { useAria, DEMO_USERS, DEMO_PASSWORD } from "@/app/aria/client-store";

export function LoginScreen() {
  const aria = useAria();
  const [email, setEmail] = useState("mira@lumen.test");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await aria.login(email, password);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Login failed");
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h1 className="text-lg font-bold">Sign in to Aria</h1>
      <p className="mt-1 text-xs text-muted">
        The enterprise CRM — this is a live demo.
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

      {/* The demo-credentials hint (published in the UI by design). */}
      <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs">
        <div className="font-semibold text-foreground">Demo credentials</div>
        <p className="mt-1 text-muted">
          Password for every account:{" "}
          <code className="font-mono text-accent">{DEMO_PASSWORD}</code>
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
