import { Suspense } from "react";
import { EncoreShell } from "@/components/encore/shell";

/**
 * The /encore showcase route (plan §3.1 — the F3 hydration pin, the
 * cadence shape).
 *
 * `?embed=1` is read HERE, server-side (`const sp = await
 * searchParams`), so the flag reaches the client tree as a PROP —
 * the server render and the hydration render agree and React #418
 * never fires. No cookies, no session: the reset handshake
 * (plan §3.4) is a pure client-side listener on window message.
 */
async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  return <EncoreShell embed={embed} />;
}

export default function EncorePage({
  searchParams,
  params,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<Record<string, string | string[] | undefined>>;
}) {
  void params;
  return (
    <Suspense fallback={<div className="min-h-full" />}>
      <PageInner searchParams={searchParams} />
    </Suspense>
  );
}
