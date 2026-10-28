import { Suspense } from "react";
import { CadenceProvider } from "@/lib/cadence/store";
import { CadenceShell } from "@/components/cadence/shell";

/**
 * The /cadence live-demo route. Identical contract to /bazaar (and /demo):
 * `?embed=1` is read HERE, server-side, so the flag reaches the client tree
 * as a PROP — the server render and the hydration render agree and React
 * #418 never fires.
 *
 * In the embedded copy the flag also arms the frame reset channel: the store
 * mounts an embed-only `message` listener for the landing page's Reset
 * button (see store.tsx) — never in the standalone app.
 *
 * Docs: docs/cadence-demo-session.md (created in a later phase).
 */
async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  return (
    <CadenceProvider embed={embed}>
      <CadenceShell embed={embed} />
    </CadenceProvider>
  );
}

export default function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="min-h-full" />}>
      {/* Explicit prop pass (not a {...props} spread): the server-side
          searchParams contract (React #418) is preserved while the params
          prop stays declared so the route's typing is complete. */}
      <PageInner searchParams={searchParams} />
    </Suspense>
  );
}
