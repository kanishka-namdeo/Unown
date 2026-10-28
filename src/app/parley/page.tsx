import { Suspense } from "react";
import { ParleyProvider } from "./client-store";
import { ParleyShell } from "@/components/parley/shell";

/**
 * The /parley live-demo route. Same contract as /bazaar + /cadence:
 * `?embed=1` is read HERE, server-side, so the flag reaches the client
 * tree as a PROP — the server render and the hydration render agree
 * and React #418 never fires.
 *
 * In the embedded copy the flag also arms the frame reset channel:
 * the provider mounts an embed-only `message` listener for the
 * landing page's Reset button (the parley-reset postMessage) — never
 * in the standalone app.
 */
async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  return (
    <ParleyProvider embed={embed}>
      <ParleyShell embed={embed} />
    </ParleyProvider>
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
      <PageInner searchParams={searchParams} />
    </Suspense>
  );
}
