import { Suspense } from "react";

// searchParams is per-request data: this route must never be prerendered.
// Next 16's static analysis prerendered the sync-outer shell with the inner
// resolved at build time (measured live: x-nextjs-prerender:1, s-maxage=1y,
// the query silently dropped — embed:false serialized for ?embed=1);
// force-dynamic is the documented segment config that guarantees the
// per-request render the other three live-demo routes get naturally.
export const dynamic = "force-dynamic";
import { FlowsEntry } from "@/components/fugue/entries";

/**
 * /fugue/flows — PLAN.md §7. `?embed=1` read server-side (the
 * bazaar/cadence/parley hydration pattern) and passed to the client tree as
 * a PROP. Sync-outer + Suspense + async-inner: the exact shape the three
 * live gallery apps ship — a fully-async default export measured live to
 * drop the query (embed:false serialized into the RSC payload for
 * ?embed=1).
 */
export async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  return <FlowsEntry embed={embed} />;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="min-h-full" />}>
      {/* Explicit prop pass (not a spread): the server-side read stays
          name-bound. */}
      <PageInner searchParams={searchParams} />
    </Suspense>
  );
}
