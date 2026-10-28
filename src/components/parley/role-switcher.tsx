"use client";

/**
 * The role switcher (the shell's dropdown): the 6 seeded users, each a
 * `switchRole` re-login. The "demo session" badge renders when
 * embedded — the brief's "make RBAC visible".
 */
import { useState } from "react";
import { useParley, DEMO_USERS } from "@/app/parley/client-store";

const NAMES: Record<string, string> = {
  "mira@lumen.test": "Mira Chen",
  "theo@lumen.test": "Theo Reyes",
  "ada@lumen.test": "Ada Okafor",
  "sam@lumen.test": "Sam Ito",
  "ingrid@northwind.test": "Ingrid Larsen",
  "kai@northwind.test": "Kai Moreau",
};

export function RoleSwitcher() {
  const parley = useParley();
  const [open, setOpen] = useState(false);
  const current = parley.session?.user.email;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2"
      >
        <span className="text-muted">{current ? NAMES[current] ?? current : "Sign in"}</span>
        <span aria-hidden="true" className="text-[10px]">▾</span>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-line bg-surface p-1 shadow-xl animate-parley-pop"
          role="menu"
        >
          {DEMO_USERS.map((email) => (
            <button
              key={email}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void parley.switchRole(email);
              }}
              className={
                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs " +
                (email === current ? "bg-accent/15 text-accent" : "hover:bg-surface-2")
              }
            >
              <span>{NAMES[email]}</span>
              <span className="text-[10px] text-muted">{email.split("@")[0]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
