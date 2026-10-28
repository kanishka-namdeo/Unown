"use client";

/**
 * The tenant switcher — mira@lumen.test ↔ ingrid@northwind.test
 * (the brief's "make isolation visible"). Calls the provider's
 * `switchTenant`, a real re-login as the other tenant's owner.
 */
import { useParley } from "@/app/parley/client-store";

/** Derive the active tenant's slug from the provider state. */
export function tenantSlug(parley: ReturnType<typeof useParley>): string {
  return parley.tenant?.slug ?? "lumen";
}

export function TenantSwitcher({ slug }: { slug: string }) {
  const parley = useParley();
  const other = slug === "lumen" ? "northwind" : "lumen";
  return (
    <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-0.5">
      {["lumen", "northwind"].map((s) => (
        <button
          key={s}
          onClick={() => s !== slug && parley.switchTenant(s)}
          disabled={s === slug}
          aria-pressed={s === slug}
          className={
            "rounded px-2 py-1 text-xs font-medium " +
            (s === slug ? "bg-accent/20 text-accent" : "text-muted hover:bg-surface-2")
          }
        >
          {s === "lumen" ? "Lumen" : "Northwind"}
        </button>
      ))}
    </div>
  );
}
