import { Suspense } from "react";

// searchParams is per-request data: this route must never be prerendered.
// Next 16's static analysis prerendered the sync-outer shell with the inner
// resolved at build time (measured live: x-nextjs-prerender:1, s-maxage=1y,
// the query silently dropped — embed:false serialized for ?embed=1);
// force-dynamic is the documented segment config that guarantees the
// per-request render the other three live-demo routes get naturally.
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import FugueShell from "@/components/fugue/Shell";

/**
 * /fugue — embed entry (PLAN.md §7, the bazaar/cadence/parley hydration
 * pattern). `?embed=1` is read HERE, server-side, so the flag reaches the
 * client tree as a PROP — the server render and the hydration render agree
 * and React #418 never fires. In Next 15+/16 `searchParams` is a Promise;
 * the sync-outer + Suspense + async-inner shape is the exact contract the
 * three live gallery apps already ship (bazaar §commerce round, cadence
 * §cadence round, parley §parley round) — a fully-async default export
 * measured live to drop the query (the RSC payload serialized
 * embed:false for ?embed=1; the redirect fired on the embed route too).
 * Without embed, redirect to /fugue/flows.
 */
export async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  if (!embed) redirect("/fugue/flows");
  return (
    <FugueShell embed={embed}>
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
        Fugue embed - switch between Flows / Runs / Stats from your host nav.
      </div>
    </FugueShell>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="min-h-full" />}>
      {/* Explicit prop pass (not a {...props} spread): the server-side
          read stays name-bound — a renamed prop is a type error, not a
          silent miss. */}
      <PageInner searchParams={searchParams} />
    </Suspense>
  );
}

