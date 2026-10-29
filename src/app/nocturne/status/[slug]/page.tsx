import { cookies } from "next/headers";
import { PublicStatusPage } from "@/components/nocturne/public-status";
import { NocturneProvider } from "@/components/nocturne/nocturne-provider";

/**
 * The PUBLIC status-page route (plan §3.7's tenancy exception) — the
 * one surface that reads WITHOUT authentication. It is mounted
 * under its own `NocturneProvider` with `hasSession` read
 * server-side (the `nocturne_ses` cookie through `cookies()`): in
 * the public lane the provider skips the unauthenticated session
 * probe (a 401 that would log to the console) and the client falls
 * through to the public status fetch.
 *
 * The slug is read from the route's params (`/nocturne/status/
 * <slug>` → the matching tenant's status; an unknown slug is the
 * public route's 404 — pinned by the API test).
 */
export default async function NocturneStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const hasSession = !!cookieStore.get("nocturne_ses")?.value;
  return (
    <NocturneProvider hasSession={hasSession}>
      <PublicStatusPage slug={slug} />
    </NocturneProvider>
  );
}
