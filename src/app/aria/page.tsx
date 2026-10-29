import { Suspense } from "react";
import { cookies } from "next/headers";
import { AriaProvider } from "./client-store";
import { AriaShell } from "@/components/aria/shell";
import { SESSION_COOKIE } from "./api/_auth";

/**
 * The /aria live-demo route. Same contract as /bazaar + /cadence +
 * /parley: `?embed=1` is read HERE, server-side, so the flag reaches
 * the client tree as a PROP — the server render and the hydration
 * render agree and React #418 never fires (the F3 pin).
 *
 * `hasSession` is also read HERE, server-side, through the aria
 * session cookie (`cookies()`): in embed mode without a session the
 * client skips the unauthenticated `GET /auth/session` probe (a 401
 * that would log to the console — the poster capture lane's
 * zero-console-errors bar) and goes straight to the demo auto-login
 * POST; with a session (or standalone) the probe runs as today.
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
    <AriaProvider embed={embed} hasSession={hasSession}>
      <AriaShell embed={embed} />
    </AriaProvider>
  );
}

export default function AriaPage({
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
