import { Suspense } from "react";
import { cookies } from "next/headers";
import { NocturneProvider } from "@/components/nocturne/nocturne-provider";
import { NocturneShell } from "@/components/nocturne/shell";
import { SESSION_COOKIE } from "./api/_auth";

/**
 * The /nocturne live-demo route. Same contract as /aria + /cadence
 * + /parley + /bazaar: `?embed=1` is read HERE, server-side, so the
 * flag reaches the client tree as a PROP — the server render and
 * the hydration render agree and React #418 never fires (the F3
 * pin).
 *
 * `hasSession` is also read HERE, server-side, through the
 * nocturne session cookie (`cookies()`): the F13 pin (modeled on
 * the aria sibling) — an EXPLICIT `false` skips the unauthenticated
 * `GET /auth/session` probe (a 401 that would log to the console —
 * the live ui-pass lane's zero-console-errors bar): embed + no
 * session goes straight to the demo auto-login POST, standalone +
 * no session lands on the login screen; `true` (a session cookie
 * present) probes as today.
 */
async function PageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const embed = sp.embed === "1";
  const cookieStore = await cookies();
  const hasSession = !!cookieStore.get(SESSION_COOKIE)?.value;
  return (
    <NocturneProvider embed={embed} hasSession={hasSession}>
      <NocturneShell embed={embed} />
    </NocturneProvider>
  );
}

export default function NocturnePage({
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
