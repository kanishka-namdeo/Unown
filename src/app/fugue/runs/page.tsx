import { Suspense } from "react";

// searchParams is per-request data: this route must never be prerendered.
// Next 16's static analysis prerendered the sync-outer shell with the inner
// resolved at build time (measured live: x-nextjs-prerender:1, s-maxage=1y,
// the query silently dropped — embed:false serialized for ?embed=1);
// force-dynamic is the documented segment config that guarantees the
// per-request render the other three live-demo routes get naturally.
export const dynamic = "force-dynamic";
import { RunsEntry } from "@/components/fugue/entries";

/** Async inner: awaits the searchParams Promise (the Next 15+/16 contract). */
export async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  return <RunsEntry embed={embed} />;
}

/** Sync outer + Suspense: the bazaar/cadence/parley shape — a fully-async
 *  default export measured live to drop the query (embed:false serialized
 *  for ?embed=1). */
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="min-h-full" />}>
      <PageInner searchParams={searchParams} />
    </Suspense>
  );
}
